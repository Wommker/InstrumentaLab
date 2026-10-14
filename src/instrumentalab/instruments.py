"""Instrumentos: medición, transmisión, decisión y acción."""

from dataclasses import dataclass, field
from math import exp
from random import Random

from .logic import SpokenRule
from .signals import Quality, SignalBoard, SignalSample
from .units import Quantity, UnitError, difference


@dataclass
class MeasurementBehavior:
    bias_base: float = 0.0
    gain: float = 1.0
    noise_base: float = 0.0
    response_seconds: float = 0.0
    seed: int = 0
    _last_value: float | None = field(default=None, init=False, repr=False)
    _last_at: float | None = field(default=None, init=False, repr=False)
    _random: Random = field(init=False, repr=False)

    def __post_init__(self) -> None:
        if self.noise_base < 0 or self.response_seconds < 0:
            raise ValueError("Ruido y tiempo de respuesta deben ser no negativos")
        self._random = Random(self.seed)

    def apply(self, value: Quantity, at: float) -> Quantity:
        ideal = value.base_value * self.gain + self.bias_base
        ideal += self._random.gauss(0, self.noise_base) if self.noise_base else 0.0
        if self._last_at is not None and at < self._last_at:
            raise ValueError("El tiempo no puede retroceder")
        if self._last_value is None or self.response_seconds == 0:
            observed = ideal
        else:
            alpha = 1 - exp(-(at - self._last_at) / self.response_seconds)
            observed = self._last_value + alpha * (ideal - self._last_value)
        self._last_value, self._last_at = observed, at
        return Quantity(observed, value.canonical().unit)


@dataclass(frozen=True)
class LinearMapping:
    input_low: Quantity
    input_high: Quantity
    output_low: Quantity
    output_high: Quantity

    def __post_init__(self) -> None:
        if self.input_low.dimension != self.input_high.dimension:
            raise UnitError("Rango de entrada incompatible")
        if self.output_low.dimension != self.output_high.dimension:
            raise UnitError("Rango de salida incompatible")
        if self.input_low.base_value == self.input_high.base_value:
            raise ValueError("El rango de entrada debe tener amplitud")

    def apply(self, value: Quantity) -> Quantity:
        if value.dimension != self.input_low.dimension:
            raise UnitError("Magnitud incompatible con el rango de entrada")
        fraction = ((value.base_value - self.input_low.base_value) /
                    (self.input_high.base_value - self.input_low.base_value))
        output = self.output_low.base_value + fraction * (
            self.output_high.base_value - self.output_low.base_value)
        return Quantity(output, self.output_low.canonical().unit)

    def scale_uncertainty(self, uncertainty_base: float) -> float:
        ratio = abs((self.output_high.base_value - self.output_low.base_value) /
                    (self.input_high.base_value - self.input_low.base_value))
        return uncertainty_base * ratio


@dataclass
class PressureThresholdControl:
    """Orden discreta con histéresis para abrir salida o cerrar entrada."""

    actuate_at: Quantity
    return_at: Quantity
    high_action: str = "open"
    active: bool = False

    def __post_init__(self) -> None:
        if self.actuate_at.dimension != "pressure" or self.return_at.dimension != "pressure":
            raise UnitError("Los umbrales del controlador deben ser presiones")
        if self.return_at.base_value > self.actuate_at.base_value:
            raise ValueError("El umbral de retorno debe ser menor o igual al de actuación")
        if self.high_action not in {"open", "close"}:
            raise ValueError("La acción alta debe abrir o cerrar")

    def evaluate(self, pressure: Quantity) -> Quantity:
        if pressure.dimension != "pressure":
            raise UnitError("El controlador de presión requiere una lectura de presión")
        if pressure.base_value >= self.actuate_at.base_value:
            self.active = True
        elif pressure.base_value <= self.return_at.base_value:
            self.active = False
        open_valve = self.active if self.high_action == "open" else not self.active
        return Quantity(20 if open_valve else 4, "mA")

    def reset(self) -> None:
        self.active = False


@dataclass
class Instrument:
    tag: str
    enabled: bool = True

    @property
    def output(self) -> str:
        return f"{self.tag}.out"

    def evaluate(self, board: SignalBoard, at: float) -> None:
        raise NotImplementedError


@dataclass
class Sensor(Instrument):
    source_a: str = ""
    source_b: str | None = None
    behavior: MeasurementBehavior = field(default_factory=MeasurementBehavior)
    output_unit: str | None = None

    def evaluate(self, board: SignalBoard, at: float) -> None:
        if not self.enabled:
            return
        first = board.get(self.source_a)
        second = board.get(self.source_b) if self.source_b else None
        if first is None or first.quality != Quality.GOOD or (self.source_b and (second is None or second.quality != Quality.GOOD)):
            return
        raw = difference(first.magnitude, second.magnitude) if second else first.magnitude
        measured = self.behavior.apply(raw, at)
        if self.output_unit:
            measured = measured.to(self.output_unit)
        board.publish(self.output, SignalSample(measured, at, self.tag, uncertainty_base=self.behavior.noise_base))


@dataclass
class Transmitter(Instrument):
    # source puede ser la salida de un sensor separado o una variable de proceso:
    # el segundo caso representa un instrumento sensor-transmisor integrado.
    source: str = ""
    behavior: MeasurementBehavior = field(default_factory=MeasurementBehavior)
    mapping: LinearMapping | None = None
    calibration: LinearMapping | None = None
    output_unit: str | None = None

    def evaluate(self, board: SignalBoard, at: float) -> None:
        if not self.enabled:
            return
        incoming = board.get(self.source)
        if incoming is None or incoming.quality != Quality.GOOD:
            return
        measured = self.behavior.apply(incoming.magnitude, at)
        transmitted = self.mapping.apply(measured) if self.mapping else measured
        if self.calibration:
            transmitted = self.calibration.apply(transmitted)
        if self.output_unit:
            transmitted = transmitted.to(self.output_unit)
        uncertainty = incoming.uncertainty_base * abs(self.behavior.gain) + self.behavior.noise_base
        if self.mapping:
            uncertainty = self.mapping.scale_uncertainty(uncertainty)
        if self.calibration:
            uncertainty = self.calibration.scale_uncertainty(uncertainty)
        board.publish(self.output, SignalSample(transmitted, at, self.tag,
                                               uncertainty_base=uncertainty))


@dataclass
class Switch(Instrument):
    """Interruptor de presión, temperatura, caudal o nivel con salida discreta."""

    source: str = ""
    threshold: Quantity = field(default_factory=lambda: Quantity(0, "Pa"))
    operator: str = ">"
    deadband: Quantity | None = None
    state: bool = False

    def __post_init__(self) -> None:
        if self.operator not in {">", "<"}:
            raise ValueError("El switch admite comparación mayor o menor")
        expected_deadband = ("temperature_difference" if self.threshold.dimension == "temperature"
                             else self.threshold.dimension)
        if self.deadband is not None and self.deadband.dimension != expected_deadband:
            raise UnitError("La banda muerta debe usar la dimensión diferencial del umbral")

    def evaluate(self, board: SignalBoard, at: float) -> None:
        if not self.enabled:
            return
        sample = board.get(self.source)
        if sample is None or sample.quality != Quality.GOOD:
            return
        if not isinstance(sample.magnitude, Quantity):
            raise UnitError("Un switch de magnitud necesita una entrada analógica")
        if sample.magnitude.dimension != self.threshold.dimension:
            raise UnitError("La entrada y el umbral del switch tienen dimensiones distintas")
        measured, limit = sample.magnitude.base_value, self.threshold.base_value
        deadband = self.deadband.base_value if self.deadband else 0.0
        if self.operator == ">":
            self.state = measured > (limit - deadband if self.state else limit)
        else:
            self.state = measured < (limit + deadband if self.state else limit)
        board.publish(self.output, SignalSample(self.state, at, self.tag))


@dataclass
class Controller(Instrument):
    inputs: dict[str, str] = field(default_factory=dict)
    input_mappings: dict[str, LinearMapping] = field(default_factory=dict)
    translation: LinearMapping | None = None
    threshold_action: PressureThresholdControl | None = None
    rules: list[SpokenRule] = field(default_factory=list)

    def evaluate(self, board: SignalBoard, at: float) -> None:
        if not self.enabled:
            return
        received: dict[str, Quantity | bool] = {}
        for name, channel in self.inputs.items():
            sample = board.get(channel)
            if sample is None or sample.quality != Quality.GOOD:
                return
            if isinstance(sample.magnitude, bool):
                received[name.upper()] = sample.magnitude
                continue
            mapping = self.input_mappings.get(name)
            received[name.upper()] = mapping.apply(sample.magnitude) if mapping else sample.magnitude
        if self.threshold_action and received:
            measured = received.get("PV", next(iter(received.values())))
            if not isinstance(measured, Quantity):
                raise UnitError("El controlador de presión requiere una entrada analógica")
            command = self.threshold_action.evaluate(measured)
            board.publish(self.output, SignalSample(command, at, self.tag))
            return
        if self.translation and received:
            first = next(iter(received.values()))
            if not isinstance(first, Quantity):
                raise UnitError("El traductor del controlador requiere una señal analógica")
            translated = self.translation.apply(first)
            board.publish(self.output, SignalSample(translated, at, self.tag))
            return
        for rule in self.rules:
            output = rule.evaluate(received)
            if output is not None:
                board.publish(self.output, SignalSample(output, at, self.tag))
                return


@dataclass
class FinalControlElement(Instrument):
    source: str = ""
    position: Quantity = field(default_factory=lambda: Quantity(0, "%"))
    command_mapping: LinearMapping | None = None

    def evaluate(self, board: SignalBoard, at: float) -> None:
        if not self.enabled:
            return
        command = board.get(self.source)
        if command is None or command.quality != Quality.GOOD:
            return
        if not isinstance(command.magnitude, Quantity):
            raise UnitError("El elemento final espera una orden analógica")
        if self.command_mapping:
            requested = self.command_mapping.apply(command.magnitude)
        elif command.magnitude.dimension == "current":
            milliamps = command.magnitude.to("mA").value
            requested = Quantity((milliamps - 4) / 16 * 100, "%")
        else:
            requested = command.magnitude
        if requested.dimension != "percent":
            raise UnitError("El elemento final espera una orden en % o 4–20 mA")
        self.position = Quantity(max(0, min(100, requested.to("%").value)), "%")
        board.publish(self.output, SignalSample(self.position, at, self.tag))
