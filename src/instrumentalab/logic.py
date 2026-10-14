"""Gramática limitada de reglas habladas; no ejecuta código del usuario."""

import re
from dataclasses import dataclass

from .units import Quantity, UnitError


_NUMBER = r"[-+]?(?:\d+(?:\.\d*)?|\.\d+)"
_RULE = re.compile(
    rf"^si (?P<input>[a-zA-Z][\w]*) (?P<comparison>mayor que|menor que|igual a) "
    rf"(?P<limit>{_NUMBER}) (?P<limit_unit>\S+) entonces salida "
    rf"(?P<true>{_NUMBER}) (?P<true_unit>\S+)"
    rf"(?: si no salida (?P<false>{_NUMBER}) (?P<false_unit>\S+))?$",
    re.IGNORECASE,
)
_SWITCH_RULE = re.compile(
    rf"^si (?P<input>[a-zA-Z][\w]*) (?:esta|está) (?P<state>activo|desactivado|encendido|apagado) "
    rf"entonces salida (?P<true>{_NUMBER}) (?P<true_unit>\S+)"
    rf"(?: si no salida (?P<false>{_NUMBER}) (?P<false_unit>\S+))?$",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class SpokenRule:
    input_name: str
    comparison: str
    limit: Quantity | bool
    true_output: Quantity
    false_output: Quantity | None = None

    @classmethod
    def parse(cls, sentence: str) -> "SpokenRule":
        sentence = sentence.strip()
        switch_match = _SWITCH_RULE.fullmatch(sentence)
        match = _RULE.fullmatch(sentence)
        if switch_match:
            data = switch_match.groupdict()
            try:
                true = Quantity(float(data["true"]), data["true_unit"])
                false = (Quantity(float(data["false"]), data["false_unit"])
                         if data["false"] is not None else None)
            except UnitError as error:
                raise ValueError(str(error)) from error
            if true.dimension != "percent" or (false and false.dimension != "percent"):
                raise ValueError("La salida del controlador debe ser porcentaje")
            state = data["state"].lower() in {"activo", "encendido"}
            return cls(data["input"].upper(), "estado", state, true, false)
        if match is None:
            raise ValueError("Regla no reconocida. Use: si PV mayor que 100 kPa entonces salida 100 % si no salida 0 %")
        data = match.groupdict()
        try:
            limit = Quantity(float(data["limit"]), data["limit_unit"])
            true = Quantity(float(data["true"]), data["true_unit"])
            false = (Quantity(float(data["false"]), data["false_unit"])
                     if data["false"] is not None else None)
        except UnitError as error:
            raise ValueError(str(error)) from error
        if true.dimension != "percent" or (false and false.dimension != "percent"):
            raise ValueError("La salida del controlador debe ser porcentaje")
        return cls(data["input"].upper(), data["comparison"].lower(), limit, true, false)

    def evaluate(self, inputs: dict[str, Quantity]) -> Quantity | None:
        value = inputs.get(self.input_name)
        if value is None:
            return None
        if self.comparison == "estado":
            if not isinstance(value, bool):
                return None
            return self.true_output if value is self.limit else self.false_output
        if not isinstance(value, Quantity) or not isinstance(self.limit, Quantity):
            return None
        if value.dimension != self.limit.dimension:
            raise ValueError(f"{self.input_name} y el umbral tienen dimensiones distintas")
        measured, limit = value.base_value, self.limit.base_value
        condition = {
            "mayor que": measured > limit,
            "menor que": measured < limit,
            "igual a": measured == limit,
        }[self.comparison]
        return self.true_output if condition else self.false_output
