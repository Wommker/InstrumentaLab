"""Magnitudes y conversiones. Temperaturas absolutas y diferencias son distintas."""

from dataclasses import dataclass


class UnitError(ValueError):
    pass


@dataclass(frozen=True)
class Unit:
    dimension: str
    factor: float
    offset: float = 0.0


# base = value * factor + offset
UNITS: dict[str, Unit] = {
    "Pa": Unit("pressure", 1),
    "kPa": Unit("pressure", 1000),
    "bar": Unit("pressure", 100000),
    "psi": Unit("pressure", 6894.757293168),
    "K": Unit("temperature", 1),
    "°C": Unit("temperature", 1, 273.15),
    "°F": Unit("temperature", 5 / 9, 255.3722222222222),
    "ΔK": Unit("temperature_difference", 1),
    "Δ°C": Unit("temperature_difference", 1),
    "Δ°F": Unit("temperature_difference", 5 / 9),
    "m": Unit("length", 1),
    "cm": Unit("length", 0.01),
    "m³": Unit("volume", 1),
    "L": Unit("volume", 0.001),
    "m³/s": Unit("volume_flow", 1),
    "m³/h": Unit("volume_flow", 1 / 3600),
    "L/s": Unit("volume_flow", 0.001),
    "L/min": Unit("volume_flow", 0.001 / 60),
    "L/h": Unit("volume_flow", 0.001 / 3600),
    "A": Unit("current", 1),
    "mA": Unit("current", 0.001),
    "%": Unit("percent", 1),
}

BASE_UNIT = {
    "pressure": "Pa", "temperature": "K", "temperature_difference": "ΔK",
    "length": "m", "volume": "m³", "volume_flow": "m³/s",
    "current": "A", "percent": "%",
}


@dataclass(frozen=True)
class Quantity:
    value: float
    unit: str

    def __post_init__(self) -> None:
        if self.unit not in UNITS:
            raise UnitError(f"Unidad desconocida: {self.unit}")

    @property
    def dimension(self) -> str:
        return UNITS[self.unit].dimension

    @property
    def base_value(self) -> float:
        definition = UNITS[self.unit]
        return self.value * definition.factor + definition.offset

    def to(self, unit: str) -> "Quantity":
        if unit not in UNITS:
            raise UnitError(f"Unidad desconocida: {unit}")
        target = UNITS[unit]
        if target.dimension != self.dimension:
            raise UnitError(f"No se puede convertir {self.unit} a {unit}")
        return Quantity((self.base_value - target.offset) / target.factor, unit)

    def canonical(self) -> "Quantity":
        return self.to(BASE_UNIT[self.dimension])


def difference(first: Quantity, second: Quantity) -> Quantity:
    if first.dimension != second.dimension or first.dimension not in {"pressure", "temperature"}:
        raise UnitError("La medición diferencial requiere dos presiones o dos temperaturas")
    result_unit = "Pa" if first.dimension == "pressure" else "ΔK"
    return Quantity(first.base_value - second.base_value, result_unit)
