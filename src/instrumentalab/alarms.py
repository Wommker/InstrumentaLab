"""Alarmas locales, independientes de los controladores."""

from dataclasses import dataclass
from enum import Enum

from .signals import Quality, SignalSample
from .units import Quantity


class AlarmState(str, Enum):
    NORMAL = "normal"
    ACTIVE = "active"
    ACKNOWLEDGED = "acknowledged"


@dataclass
class Alarm:
    tag: str
    channel: str
    operator: str
    threshold: Quantity | bool
    state: AlarmState = AlarmState.NORMAL

    def __post_init__(self) -> None:
        if self.operator not in {">", "<", ">=", "<=", "is_on", "is_off"}:
            raise ValueError("Operador de alarma inválido")

    def evaluate(self, sample: SignalSample | None) -> AlarmState:
        # La pérdida de señal no se interpreta como un valor normal.
        if sample is None or sample.quality != Quality.GOOD:
            return self.state
        if isinstance(sample.magnitude, bool):
            if self.operator not in {"is_on", "is_off"}:
                raise ValueError("Una alarma discreta debe usar is_on o is_off")
            triggered = sample.magnitude if self.operator == "is_on" else not sample.magnitude
            if not triggered:
                self.state = AlarmState.NORMAL
            elif self.state == AlarmState.NORMAL:
                self.state = AlarmState.ACTIVE
            return self.state
        if not isinstance(self.threshold, Quantity) or self.operator in {"is_on", "is_off"}:
            raise ValueError("La alarma analógica requiere umbral con unidades")
        if sample.magnitude.dimension != self.threshold.dimension:
            raise ValueError(f"Dimensión incompatible en alarma {self.tag}")
        measured = sample.magnitude.base_value
        limit = self.threshold.base_value
        triggered = {
            ">": measured > limit, "<": measured < limit,
            ">=": measured >= limit, "<=": measured <= limit,
        }[self.operator]
        if not triggered:
            self.state = AlarmState.NORMAL
        elif self.state == AlarmState.NORMAL:
            self.state = AlarmState.ACTIVE
        return self.state

    def acknowledge(self) -> None:
        if self.state == AlarmState.ACTIVE:
            self.state = AlarmState.ACKNOWLEDGED
