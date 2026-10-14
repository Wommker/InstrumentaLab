"""Un lazo agrupa elementos y ejecuta su lógica en orden causal."""

from dataclasses import dataclass, field
from heapq import heappop, heappush

from .alarms import Alarm
from .instruments import Controller, FinalControlElement, Instrument, Sensor, Switch, Transmitter
from .process import Process, ProcessActuator, ProcessVariable
from .signals import Connection, Quality, SignalBoard, SignalSample


@dataclass
class ControlLoop:
    tag: str
    board: SignalBoard = field(default_factory=SignalBoard)
    processes: dict[str, Process] = field(default_factory=dict)
    instruments: dict[str, Instrument] = field(default_factory=dict)
    alarms: dict[str, Alarm] = field(default_factory=dict)
    connections: list[Connection] = field(default_factory=list)
    _pending: list[tuple[float, int, str, SignalSample]] = field(default_factory=list, init=False, repr=False)
    _sequence: int = field(default=0, init=False, repr=False)
    _last_at: float | None = field(default=None, init=False, repr=False)

    def add_process(self, process: Process) -> None:
        if process.tag in self.processes:
            raise ValueError(f"Proceso duplicado: {process.tag}")
        old_tags = {variable.tag for existing in self.processes.values() for variable in existing.variables.values()}
        if old_tags.intersection(process.variables):
            raise ValueError("Las etiquetas de variables deben ser únicas en el lazo")
        self.processes[process.tag] = process

    def variable(self, tag: str) -> ProcessVariable:
        for process in self.processes.values():
            if tag in process.variables:
                return process.variables[tag]
        raise KeyError(tag)

    def add_instrument(self, instrument: Instrument) -> None:
        if instrument.tag in self.instruments:
            raise ValueError(f"Instrumento duplicado: {instrument.tag}")
        self.instruments[instrument.tag] = instrument

    def add_alarm(self, alarm: Alarm) -> None:
        if alarm.tag in self.alarms:
            raise ValueError(f"Alarma duplicada: {alarm.tag}")
        self.alarms[alarm.tag] = alarm

    def connect(self, connection: Connection) -> None:
        if any(item.target == connection.target for item in self.connections):
            raise ValueError(f"Destino ya conectado: {connection.target}")
        self.connections.append(connection)

    def _sources(self, instrument: Instrument) -> list[str]:
        if isinstance(instrument, Sensor):
            return [instrument.source_a] + ([instrument.source_b] if instrument.source_b else [])
        if isinstance(instrument, Transmitter):
            return [instrument.source]
        if isinstance(instrument, Switch):
            return [instrument.source]
        if isinstance(instrument, Controller):
            return list(instrument.inputs.values())
        if isinstance(instrument, FinalControlElement):
            return [instrument.source]
        raise TypeError(f"Instrumento no soportado: {type(instrument).__name__}")

    def _order(self) -> list[Instrument]:
        process_channels = {v.channel for p in self.processes.values() for v in p.variables.values()}
        process_channels.update(f"process:{p.tag}:{name}" for p in self.processes.values()
                                if p.capacity_m3 is not None for name in (
                                    "fill", "volume", "inflow_effective", "outflow_effective"))
        process_channels.update(f"process:{p.tag}:pressure" for p in self.processes.values()
                                if p.pressure_scenario is not None)
        output_producers = {item.output: item.tag for item in self.instruments.values()}
        routes = {item.target: item.source for item in self.connections}
        available = process_channels | set(output_producers)
        if any(item.source not in available for item in self.connections):
            raise ValueError("Una conexión tiene un origen desconocido")
        if any(item.target in available for item in self.connections):
            raise ValueError("El destino de conexión coincide con un canal reservado")
        dependencies: dict[str, set[str]] = {}
        for instrument in self.instruments.values():
            sources = self._sources(instrument)
            if any(not source or (source not in available and source not in routes) for source in sources):
                raise ValueError(f"Entrada desconocida en {instrument.tag}")
            predecessors = {output_producers[routes.get(source, source)]
                            for source in sources if routes.get(source, source) in output_producers}
            dependencies[instrument.tag] = predecessors
        ordered: list[Instrument] = []
        pending = dict(dependencies)
        while pending:
            ready = sorted(tag for tag, predecessors in pending.items() if not predecessors)
            if not ready:
                raise ValueError("Hay una dependencia circular entre instrumentos")
            for tag in ready:
                ordered.append(self.instruments[tag])
                del pending[tag]
            for predecessors in pending.values():
                predecessors.difference_update(ready)
        return ordered

    def _route(self, source: str, at: float) -> None:
        sample = self.board.get(source)
        if sample is None or sample.quality != Quality.GOOD:
            return
        for connection in self.connections:
            if connection.source == source:
                if connection.delay_seconds == 0:
                    self.board.publish(connection.target, sample)
                else:
                    self._sequence += 1
                    heappush(self._pending, (at + connection.delay_seconds,
                                             self._sequence, connection.target, sample))

    def _process_actuation(self, process: Process) -> tuple[float, float, bool]:
        inlet_opening, outlet_opening, outlet_connected = 100.0, 0.0, False
        bindings = list(process.actuators)
        if process.relief_element_tag and not any(
                item.element_tag == process.relief_element_tag for item in bindings):
            bindings.append(ProcessActuator(process.relief_element_tag, "outlet"))
        for binding in bindings:
            element = self.instruments.get(binding.element_tag)
            if not isinstance(element, FinalControlElement):
                raise ValueError(f"{process.tag} requiere un elemento final válido: {binding.element_tag}")
            opening = max(0.0, min(100.0, element.position.to("%").value))
            if binding.role == "inlet":
                inlet_opening = min(inlet_opening, opening)
            else:
                outlet_connected = True
                outlet_opening = max(outlet_opening, opening)
        return inlet_opening, outlet_opening, outlet_connected

    def tick(self, at: float) -> None:
        if self._last_at is not None and at < self._last_at:
            raise ValueError("El tiempo del lazo no puede retroceder")
        order = self._order()
        elapsed = 0.0 if self._last_at is None else at - self._last_at
        self._last_at = at
        # Los resultados viejos siguen visibles, pero su calidad ya no permite control.
        for instrument in self.instruments.values():
            self.board.mark_stale(instrument.output)
        for connection in self.connections:
            self.board.mark_stale(connection.target)
        while self._pending and self._pending[0][0] <= at:
            _, _, target, sample = heappop(self._pending)
            self.board.publish(target, sample)
        for process in self.processes.values():
            for variable in process.variables.values():
                if variable.constant_value is not None:
                    variable.set(self.board, variable.constant_value, at)
                self._route(variable.channel, at)
        for process in self.processes.values():
            incoming_flow = self.board.get(process.inflow_channel)
            if incoming_flow and incoming_flow.quality == Quality.GOOD:
                if not hasattr(incoming_flow.magnitude, "to") or incoming_flow.magnitude.dimension != "volume_flow":
                    raise ValueError(f"{process.tag} recibe caudal con dimensión incompatible")
                process.inflow_m3_h = incoming_flow.magnitude.to("m³/h").value
            inlet_opening, outlet_opening, outlet_connected = self._process_actuation(process)
            process.advance(elapsed, outlet_opening, inlet_opening, outlet_connected)
            process.publish_state(self.board, at)
            if process.pressure_scenario is not None:
                self._route(f"process:{process.tag}:pressure", at)
                for variable in process.variables.values():
                    if variable.follow_process_pressure and variable.constant_value is None:
                        self._route(variable.channel, at)
            if process.capacity_m3 is not None:
                self._route(f"process:{process.tag}:fill", at)
                self._route(f"process:{process.tag}:volume", at)
                self._route(f"process:{process.tag}:inflow_effective", at)
                self._route(f"process:{process.tag}:outflow_effective", at)
        for instrument in order:
            instrument.evaluate(self.board, at)
            self._route(instrument.output, at)
        for process in self.processes.values():
            if any(connection.target == process.inflow_channel for connection in self.connections):
                incoming_flow = self.board.get(process.inflow_channel)
                if incoming_flow and incoming_flow.quality == Quality.GOOD:
                    if not hasattr(incoming_flow.magnitude, "to") or incoming_flow.magnitude.dimension != "volume_flow":
                        raise ValueError(f"{process.tag} recibe caudal con dimensión incompatible")
                    # La lectura de instrumento queda disponible para el siguiente paso del proceso.
                    process.inflow_m3_h = incoming_flow.magnitude.to("m³/h").value
        for alarm in self.alarms.values():
            alarm.evaluate(self.board.get(alarm.channel))
