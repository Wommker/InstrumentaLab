import math
import unittest

from instrumentalab import (
    Alarm, AlarmState, Connection, ControlLoop, Controller, FinalControlElement,
    GuidedPressureScenario, PressureThresholdControl, ProcessActuator,
    ProcessLine, ProcessVariable, Quantity, Sensor, SpokenRule, Switch, Tank,
    Transmitter, UnitError,
)
from instrumentalab.instruments import LinearMapping, MeasurementBehavior
from instrumentalab.signals import Quality


class InstrumentationTests(unittest.TestCase):
    def tank_loop(self):
        loop = ControlLoop("L-101")
        tank = Tank("TK-101")
        tank.add_variable(ProcessVariable("P_TOP", "Presión", "pressure", "techo"))
        tank.add_variable(ProcessVariable("P_BOTTOM", "Presión", "pressure", "fondo"))
        tank.add_variable(ProcessVariable("T_TOP", "Temperatura", "temperature", "techo"))
        tank.add_variable(ProcessVariable("T_BOTTOM", "Temperatura", "temperature", "fondo"))
        loop.add_process(tank)
        return loop

    def test_units_and_independent_variables(self):
        loop = self.tank_loop()
        loop.variable("P_TOP").set(loop.board, Quantity(100, "psi"), 0)
        loop.variable("P_BOTTOM").set(loop.board, Quantity(200000, "Pa"), 0)
        self.assertAlmostEqual(loop.board.view("process:P_TOP", "psi").value, 100)
        self.assertAlmostEqual(loop.board.view("process:P_TOP", "kPa").value, 689.4757293168)
        self.assertEqual(loop.board.view("process:P_BOTTOM", "Pa").value, 200000)
        with self.assertRaises(UnitError):
            loop.board.view("process:P_TOP", "°C")

    def test_differential_pressure_and_temperature(self):
        loop = self.tank_loop()
        loop.variable("P_TOP").set(loop.board, Quantity(30, "psi"), 0)
        loop.variable("P_BOTTOM").set(loop.board, Quantity(100, "kPa"), 0)
        loop.variable("T_TOP").set(loop.board, Quantity(30, "°C"), 0)
        loop.variable("T_BOTTOM").set(loop.board, Quantity(68, "°F"), 0)
        loop.add_instrument(Sensor("DP-101", source_a="process:P_TOP", source_b="process:P_BOTTOM"))
        loop.add_instrument(Sensor("DT-101", source_a="process:T_TOP", source_b="process:T_BOTTOM"))
        loop.tick(0)
        self.assertAlmostEqual(loop.board.view("DP-101.out", "psi").value, 30 - 100000 / 6894.757293168)
        self.assertAlmostEqual(loop.board.view("DT-101.out", "Δ°C").value, 10)

    def test_sensor_transmitter_controller_and_final_element(self):
        loop = self.tank_loop()
        loop.variable("P_TOP").set(loop.board, Quantity(120, "psi"), 0)
        loop.add_instrument(Sensor("PE-101", source_a="process:P_TOP"))
        loop.add_instrument(Transmitter("PT-101", source="PE-101.out", output_unit="kPa"))
        loop.add_instrument(Controller("PC-101", inputs={"PV": "PT-101.out"}, rules=[
            SpokenRule.parse("si PV mayor que 800 kPa entonces salida 100 % si no salida 0 %")]))
        loop.add_instrument(FinalControlElement("PCV-101", source="PC-101.out"))
        loop.tick(0)
        self.assertEqual(loop.instruments["PCV-101"].position.value, 100)
        loop.variable("P_TOP").set(loop.board, Quantity(90, "psi"), 1)
        loop.tick(1)
        self.assertEqual(loop.instruments["PCV-101"].position.value, 0)

    def test_integrated_transmitter_mapping_and_local_alarm(self):
        loop = self.tank_loop()
        loop.variable("P_BOTTOM").set(loop.board, Quantity(50, "psi"), 0)
        loop.add_instrument(Transmitter(
            "PIT-201", source="process:P_BOTTOM",
            mapping=LinearMapping(Quantity(0, "psi"), Quantity(100, "psi"),
                                  Quantity(4, "mA"), Quantity(20, "mA"))))
        loop.add_alarm(Alarm("PAH-201", "PIT-201.out", ">", Quantity(10, "mA")))
        loop.tick(0)
        self.assertAlmostEqual(loop.board.view("PIT-201.out", "mA").value, 12)
        self.assertEqual(loop.alarms["PAH-201"].state, AlarmState.ACTIVE)
        loop.alarms["PAH-201"].acknowledge()
        self.assertEqual(loop.alarms["PAH-201"].state, AlarmState.ACKNOWLEDGED)

    def test_controller_decodes_current_to_pressure(self):
        loop = self.tank_loop()
        loop.variable("P_TOP").set(loop.board, Quantity(75, "psi"), 0)
        loop.add_instrument(Transmitter(
            "PT", source="process:P_TOP",
            mapping=LinearMapping(Quantity(0, "psi"), Quantity(100, "psi"),
                                  Quantity(4, "mA"), Quantity(20, "mA"))))
        loop.add_instrument(Controller(
            "PC", inputs={"PV": "PT.out"},
            input_mappings={"PV": LinearMapping(
                Quantity(4, "mA"), Quantity(20, "mA"),
                Quantity(0, "psi"), Quantity(100, "psi"))},
            rules=[SpokenRule.parse("si PV mayor que 70 psi entonces salida 100 % si no salida 0 %")]))
        loop.tick(0)
        self.assertEqual(loop.board.view("PT.out", "mA").value, 16)
        self.assertEqual(loop.board.view("PC.out", "%").value, 100)

    def test_transport_delay_and_stale_signal(self):
        loop = self.tank_loop()
        loop.variable("P_TOP").set(loop.board, Quantity(100, "kPa"), 0)
        loop.add_instrument(Sensor("PE", source_a="process:P_TOP"))
        loop.add_instrument(Transmitter("PT", source="wire:PE"))
        loop.connect(Connection("PE.out", "wire:PE", 2))
        loop.tick(0)
        self.assertIsNone(loop.board.get("PT.out"))
        loop.tick(1)
        self.assertIsNone(loop.board.get("PT.out"))
        loop.tick(2)
        self.assertEqual(loop.board.view("PT.out", "kPa").value, 100)
        loop.instruments["PE"].enabled = False
        loop.tick(3)
        self.assertEqual(loop.board.get("PT.out").quality, Quality.GOOD)  # llegó la lectura de t=1
        loop.tick(4)
        self.assertEqual(loop.board.get("PT.out").quality, Quality.GOOD)  # llegó la lectura de t=2
        loop.tick(5)
        self.assertEqual(loop.board.get("PT.out").quality, Quality.STALE)

    def test_response_error_and_rules(self):
        behavior = MeasurementBehavior(bias_base=1000, response_seconds=2)
        self.assertEqual(behavior.apply(Quantity(0, "Pa"), 0).value, 1000)
        result = behavior.apply(Quantity(10000, "Pa"), 2)
        self.assertAlmostEqual(result.value, 1000 + (1 - math.exp(-1)) * 10000)
        with self.assertRaises(ValueError):
            SpokenRule.parse("eval('inseguro')")
        with self.assertRaises(ValueError):
            SpokenRule.parse("si PV mayor que 10 Pa entonces salida 3 Pa")

    def test_cycle_is_rejected(self):
        loop = self.tank_loop()
        loop.add_instrument(Transmitter("A", source="B.out"))
        loop.add_instrument(Transmitter("B", source="A.out"))
        with self.assertRaisesRegex(ValueError, "circular"):
            loop.tick(0)

    def test_pressure_temperature_flow_and_level_variables(self):
        loop = ControlLoop("L-TYPES")
        process = Tank("TK-TYPES")
        for variable in (
            ProcessVariable("P", "Presión", "pressure"),
            ProcessVariable("T", "Temperatura", "temperature"),
            ProcessVariable("Q", "Caudal", "flow"),
            ProcessVariable("L", "Nivel", "level"),
        ):
            process.add_variable(variable)
        loop.add_process(process)
        values = {"P": Quantity(14.7,"psi"), "T": Quantity(25,"°C"),
                  "Q": Quantity(60,"L/min"), "L": Quantity(35,"%")}
        for tag, value in values.items():
            loop.variable(tag).set(loop.board, value, 0)
        self.assertAlmostEqual(loop.board.view("process:Q","m³/h").value, 3.6)
        self.assertEqual(loop.board.view("process:L","%").value, 35)
        with self.assertRaises(UnitError):
            loop.variable("Q").set(loop.board, Quantity(4,"psi"), 1)

    def test_switch_outputs_discrete_state_to_controller_and_alarm(self):
        loop = ControlLoop("L-SW")
        process = Tank("TK-SW")
        process.add_variable(ProcessVariable("P", "Presión", "pressure",
                                             constant_value=Quantity(120,"kPa")))
        loop.add_process(process)
        loop.add_instrument(Switch("PSH", source="process:P", threshold=Quantity(100,"kPa")))
        loop.add_instrument(Controller("C", inputs={"INTERLOCK":"PSH.out"}, rules=[
            SpokenRule.parse("si INTERLOCK está activo entonces salida 100 % si no salida 0 %")]))
        loop.add_alarm(Alarm("PAH", "PSH.out", "is_on", True))
        loop.tick(0)
        self.assertIs(loop.board.get("PSH.out").magnitude, True)
        self.assertEqual(loop.board.view("C.out","%").value, 100)
        self.assertEqual(loop.alarms["PAH"].state, AlarmState.ACTIVE)

    def test_switches_cover_pressure_temperature_flow_and_level(self):
        loop = ControlLoop("L-SW-TYPES")
        process = Tank("TK-SW-TYPES")
        cases = [
            ("P", "pressure", Quantity(100,"kPa"), Quantity(90,"kPa")),
            ("T", "temperature", Quantity(25,"°C"), Quantity(20,"°C")),
            ("Q", "flow", Quantity(80,"L/min"), Quantity(1,"m³/h")),
            ("L", "level", Quantity(1.5,"m"), Quantity(100,"cm")),
        ]
        for tag, dimension, value, threshold in cases:
            process.add_variable(ProcessVariable(tag, dimension, dimension, constant_value=value))
        loop.add_process(process)
        for tag, dimension, _, threshold in cases:
            loop.add_instrument(Switch(f"S-{tag}",source=f"process:{tag}",threshold=threshold))
        loop.tick(0)
        for tag, *_ in cases:
            self.assertIs(loop.board.get(f"S-{tag}.out").magnitude, True)

    def test_tank_and_line_fill_from_flow_signal_and_fixed_fill(self):
        loop = ControlLoop("L-FILL")
        feed = ProcessLine("FEED")
        feed.add_variable(ProcessVariable("Q-IN", "Caudal recibido", "flow",
                                         constant_value=Quantity(1000,"L/h")))
        tank = Tank("TK", capacity_m3=2, fill_percent=25)
        line = ProcessLine("LINE", capacity_m3=4, fill_percent=10)
        fixed_tank = Tank("TK-FIX", capacity_m3=1, fill_percent=40, fixed_fill=True,
                          inflow_m3_h=8)
        measured_tank = Tank("TK-MEASURED", capacity_m3=1, fill_percent=0)
        for process in (feed,tank,line,fixed_tank,measured_tank):
            loop.add_process(process)
        loop.connect(Connection("process:Q-IN", tank.inflow_channel, medium="hydraulic"))
        loop.connect(Connection("process:Q-IN", line.inflow_channel, medium="hydraulic"))
        loop.add_instrument(Transmitter("FIT", source="process:Q-IN"))
        loop.connect(Connection("FIT.out", measured_tank.inflow_channel, medium="electrical"))
        loop.tick(0)
        loop.tick(3600)
        self.assertAlmostEqual(tank.fill_percent, 75)
        self.assertAlmostEqual(tank.volume_m3, 1.5)
        self.assertAlmostEqual(line.fill_percent, 35)
        self.assertAlmostEqual(measured_tank.fill_percent, 100)
        self.assertAlmostEqual(fixed_tank.fill_percent, 40)

    def test_pressure_control_loop_opens_outlet_or_closes_inlet(self):
        for role, action, expected_high, expected_low in (
            ("outlet", "open", 100, 0),
            ("inlet", "close", 0, 100),
        ):
            with self.subTest(role=role):
                loop = ControlLoop(f"L-{role}")
                process = ProcessLine("PL", pressure_scenario=GuidedPressureScenario(
                    Quantity(100, "kPa"), Quantity(500, "kPa"), 10,
                    Quantity(120, "kPa"), 5))
                process.add_variable(ProcessVariable("P", "Presión", "pressure",
                                                     follow_process_pressure=True))
                process.add_actuator(ProcessActuator("V", role))
                loop.add_process(process)
                loop.add_instrument(Transmitter("PT", source="process:P", mapping=LinearMapping(
                    Quantity(0, "kPa"), Quantity(500, "kPa"),
                    Quantity(4, "mA"), Quantity(20, "mA"))))
                loop.add_instrument(Controller("PC", inputs={"PV": "PT.out"},
                    input_mappings={"PV": LinearMapping(
                        Quantity(4, "mA"), Quantity(20, "mA"),
                        Quantity(0, "kPa"), Quantity(500, "kPa"))},
                    threshold_action=PressureThresholdControl(
                        Quantity(350, "kPa"), Quantity(180, "kPa"), action)))
                loop.add_instrument(FinalControlElement("V", source="PC.out"))
                for second in range(8):
                    loop.tick(second)
                self.assertAlmostEqual(loop.board.view("process:PL:pressure", "kPa").value, 380)
                self.assertEqual(loop.instruments["V"].position.value, expected_high)
                loop.tick(8)
                self.assertAlmostEqual(loop.board.view("process:P", "kPa").value, 304)
                self.assertAlmostEqual(loop.board.view("PT.out", "mA").value, 13.728)
                loop.tick(9)
                loop.tick(10)
                self.assertAlmostEqual(loop.board.view("process:P", "kPa").value, 152)
                self.assertEqual(loop.instruments["V"].position.value, expected_low)
                loop.tick(11)
                self.assertAlmostEqual(loop.board.view("process:P", "kPa").value, 192)

    def test_final_elements_modulate_nominal_volume_flows(self):
        process = Tank("TK", capacity_m3=1, fill_percent=50,
                       inflow_m3_h=360, outflow_m3_h=180)
        process.advance(1, valve_opening=0, inlet_opening=100, outlet_connected=True)
        self.assertAlmostEqual(process.effective_inflow_m3_h, 360)
        self.assertAlmostEqual(process.effective_outflow_m3_h, 0)
        self.assertAlmostEqual(process.fill_percent, 60)
        process.advance(1, valve_opening=100, inlet_opening=0, outlet_connected=True)
        self.assertAlmostEqual(process.effective_inflow_m3_h, 0)
        self.assertAlmostEqual(process.effective_outflow_m3_h, 180)
        self.assertAlmostEqual(process.fill_percent, 55)


if __name__ == "__main__":
    unittest.main()
