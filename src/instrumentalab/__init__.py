"""Dominio lógico de instrumentación; sin dependencias de interfaz web."""

from .alarms import Alarm, AlarmState
from .engine import ControlLoop
from .instruments import Controller, FinalControlElement, LinearMapping, MeasurementBehavior, PressureThresholdControl, Sensor, Switch, Transmitter
from .logic import SpokenRule
from .process import GuidedPressureScenario, ProcessActuator, ProcessLine, ProcessVariable, Tank
from .signals import Connection, ConnectionMedium, Quality, SignalBoard, SignalSample
from .units import Quantity, UnitError

__all__ = [
    "Alarm", "AlarmState", "Connection", "ConnectionMedium", "ControlLoop", "Controller",
    "FinalControlElement", "GuidedPressureScenario", "LinearMapping", "MeasurementBehavior", "PressureThresholdControl",
    "ProcessActuator", "ProcessLine", "ProcessVariable", "Quality", "Quantity", "Sensor", "SignalBoard", "SignalSample", "SpokenRule",
    "Switch", "Tank", "Transmitter", "UnitError",
]
