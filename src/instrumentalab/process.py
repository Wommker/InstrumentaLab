"""Procesos con variables identificadas individualmente, sin modelo físico."""

from dataclasses import dataclass, field

from .signals import SignalBoard, SignalSample
from .units import Quantity, UnitError


@dataclass
class GuidedPressureScenario:
    """Tendencia de presión prescrita; no representa mecánica de fluidos."""

    initial: Quantity
    target: Quantity
    rise_seconds: float
    relieved: Quantity
    relief_seconds: float
    pressure: Quantity = field(init=False)
    fixed: bool = False

    def __post_init__(self) -> None:
        if any(item.dimension != "pressure" for item in (self.initial, self.target, self.relieved)):
            raise UnitError("El escenario requiere presiones")
        if self.rise_seconds <= 0 or self.relief_seconds <= 0:
            raise ValueError("Los tiempos del escenario deben ser mayores que cero")
        self.reset()

    def reset(self) -> None:
        self.pressure = self.initial

    def advance(self, seconds: float, valve_opening: float = 0,
                inlet_opening: float = 100) -> None:
        if seconds < 0:
            raise ValueError("El intervalo de proceso no puede ser negativo")
        if self.fixed:
            return
        inlet = max(0.0, min(1.0, inlet_opening / 100))
        outlet = max(0.0, min(1.0, valve_opening / 100))
        rise_rate = max(0.0, self.target.base_value - self.initial.base_value) / self.rise_seconds
        fall_rate = max(0.0, self.target.base_value - self.relieved.base_value) / self.relief_seconds
        relief_strength = max(outlet, 1 - inlet)
        rate = rise_rate * inlet * (1 - outlet) - fall_rate * relief_strength
        current = self.pressure.base_value
        proposed = current + rate * seconds
        if rate >= 0:
            new_base = current if current >= self.target.base_value else min(self.target.base_value, proposed)
        else:
            new_base = max(min(self.relieved.base_value, current), proposed)
        self.pressure = Quantity(new_base, "Pa").to(self.initial.unit)


@dataclass(frozen=True)
class ProcessActuator:
    """Vínculo de retorno entre un elemento final y una entrada/salida del proceso."""

    element_tag: str
    role: str

    def __post_init__(self) -> None:
        if self.role not in {"inlet", "outlet"}:
            raise ValueError("El actuador debe ser de entrada o salida")


@dataclass
class ProcessVariable:
    tag: str
    name: str
    dimension: str
    position: str = ""
    constant_value: Quantity | None = None
    follow_process_pressure: bool = False

    @property
    def channel(self) -> str:
        return f"process:{self.tag}"

    def set(self, board: SignalBoard, value: Quantity, at: float) -> None:
        accepted = {
            "pressure": {"pressure"}, "temperature": {"temperature"},
            "flow": {"volume_flow"}, "level": {"length", "percent"},
        }
        if self.dimension not in accepted or value.dimension not in accepted[self.dimension]:
            raise UnitError(f"{self.tag} espera {self.dimension}, recibió {value.dimension}")
        board.publish(self.channel, SignalSample(value, at, self.tag))


@dataclass
class Process:
    tag: str
    variables: dict[str, ProcessVariable] = field(default_factory=dict)
    capacity_m3: float | None = None
    fill_percent: float = 0.0
    inflow_m3_h: float = 0.0
    outflow_m3_h: float = 0.0
    fixed_fill: bool = False
    pressure_scenario: GuidedPressureScenario | None = None
    relief_element_tag: str = ""
    actuators: list[ProcessActuator] = field(default_factory=list)
    effective_inflow_m3_h: float = field(default=0.0, init=False)
    effective_outflow_m3_h: float = field(default=0.0, init=False)

    def add_variable(self, variable: ProcessVariable) -> None:
        if variable.tag in self.variables:
            raise ValueError(f"Variable duplicada: {variable.tag}")
        self.variables[variable.tag] = variable

    def add_actuator(self, actuator: ProcessActuator) -> None:
        if any(item.element_tag == actuator.element_tag for item in self.actuators):
            raise ValueError(f"Elemento final ya asociado: {actuator.element_tag}")
        self.actuators.append(actuator)

    @property
    def volume_m3(self) -> float | None:
        if self.capacity_m3 is None:
            return None
        return self.capacity_m3 * self.fill_percent / 100

    def advance(self, seconds: float, valve_opening: float = 0,
                inlet_opening: float = 100, outlet_connected: bool = False) -> None:
        if seconds < 0:
            raise ValueError("El intervalo de proceso no puede ser negativo")
        if self.pressure_scenario is not None:
            self.pressure_scenario.advance(seconds, valve_opening, inlet_opening)
        self.effective_inflow_m3_h = self.inflow_m3_h * max(0.0, min(100.0, inlet_opening)) / 100
        self.effective_outflow_m3_h = self.outflow_m3_h * (
            max(0.0, min(100.0, valve_opening)) / 100 if outlet_connected else 1)
        if self.capacity_m3 is None or self.capacity_m3 <= 0 or self.fixed_fill:
            return
        net_flow_m3_s = (self.effective_inflow_m3_h - self.effective_outflow_m3_h) / 3600
        volume = max(0.0, min(self.capacity_m3, (self.volume_m3 or 0) + net_flow_m3_s * seconds))
        self.fill_percent = volume / self.capacity_m3 * 100

    def publish_state(self, board: SignalBoard, at: float) -> None:
        if self.pressure_scenario is not None:
            board.publish(f"process:{self.tag}:pressure", SignalSample(
                self.pressure_scenario.pressure, at, self.tag))
        if self.capacity_m3 is not None:
            board.publish(f"process:{self.tag}:inflow_effective", SignalSample(
                Quantity(self.effective_inflow_m3_h, "m³/h"), at, self.tag))
            board.publish(f"process:{self.tag}:outflow_effective", SignalSample(
                Quantity(self.effective_outflow_m3_h, "m³/h"), at, self.tag))
            board.publish(f"process:{self.tag}:fill", SignalSample(
                Quantity(self.fill_percent, "%"), at, self.tag))
            board.publish(f"process:{self.tag}:volume", SignalSample(
                Quantity(self.volume_m3 or 0, "m³"), at, self.tag))
        for variable in self.variables.values():
            if variable.constant_value is not None:
                variable.set(board, variable.constant_value, at)
            elif variable.follow_process_pressure and self.pressure_scenario is not None:
                if variable.dimension != "pressure":
                    raise UnitError(f"{variable.tag} no es una variable de presión")
                variable.set(board, self.pressure_scenario.pressure, at)

    @property
    def inflow_channel(self) -> str:
        return f"process:{self.tag}:inflow"


class Tank(Process):
    pass


class ProcessLine(Process):
    pass
