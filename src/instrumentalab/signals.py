"""Matriz de señales: un valor canónico por canal y conversiones solo al consultar."""

from dataclasses import dataclass, replace
from enum import Enum

from .units import Quantity, UnitError


class Quality(str, Enum):
    GOOD = "good"
    BAD = "bad"
    STALE = "stale"


class ConnectionMedium(str, Enum):
    ELECTRICAL = "electrical"
    HYDRAULIC = "hydraulic"
    PNEUMATIC = "pneumatic"
    MECHANICAL = "mechanical"
    WIRELESS = "wireless"


@dataclass(frozen=True)
class SignalSample:
    magnitude: Quantity | bool
    timestamp: float
    source: str
    quality: Quality = Quality.GOOD
    uncertainty_base: float = 0.0

    def __post_init__(self) -> None:
        if self.uncertainty_base < 0:
            raise ValueError("La incertidumbre no puede ser negativa")
        if isinstance(self.magnitude, Quantity):
            object.__setattr__(self, "magnitude", self.magnitude.canonical())

    def display(self, unit: str) -> Quantity:
        if isinstance(self.magnitude, bool):
            raise UnitError("Una señal ON/OFF no tiene unidad de ingeniería")
        return self.magnitude.to(unit)


@dataclass(frozen=True)
class Connection:
    source: str
    target: str
    delay_seconds: float = 0.0
    medium: ConnectionMedium | str = ConnectionMedium.ELECTRICAL

    def __post_init__(self) -> None:
        if self.delay_seconds < 0:
            raise ValueError("El retardo debe ser no negativo")
        try:
            object.__setattr__(self, "medium", ConnectionMedium(self.medium))
        except ValueError as error:
            raise ValueError(f"Medio de conexión desconocido: {self.medium}") from error


class SignalBoard:
    def __init__(self) -> None:
        self._latest: dict[str, SignalSample] = {}

    def publish(self, channel: str, sample: SignalSample) -> None:
        magnitude = sample.magnitude.canonical() if isinstance(sample.magnitude, Quantity) else sample.magnitude
        self._latest[channel] = replace(sample, magnitude=magnitude)

    def get(self, channel: str) -> SignalSample | None:
        return self._latest.get(channel)

    def mark_stale(self, channel: str) -> None:
        previous = self._latest.get(channel)
        if previous is not None:
            self._latest[channel] = replace(previous, quality=Quality.STALE)

    def view(self, channel: str, unit: str) -> Quantity | None:
        sample = self.get(channel)
        return None if sample is None else sample.display(unit)

    def snapshot(self) -> dict[str, SignalSample]:
        return dict(self._latest)
