# InstrumentaLab

Núcleo lógico de instrumentación en Python más un editor de diagramas web local. La entidad principal es el **lazo de control**. En el editor, cada variable de un objeto puede quedar estática, subir o bajar con el tiempo; los tanques también pueden usar un balance simple de llenado. Ninguno de estos modos pretende resolver mecánica de fluidos.

## Filosofía de objetos

- **Proceso** (`Tank`, `ProcessLine`): contiene variables identificadas por etiqueta y ubicación. Puede calcular volumen y porcentaje de llenado por balance entre flujo entrante y saliente; el editor web permite tendencias independientes sin exigir diámetro, compresibilidad ni caudal. Admite valores fijos para pruebas.
- **Variable de proceso**: soporta presión, temperatura, caudal y nivel. Se actualiza explícitamente con un valor y un instante, o se configura con un valor constante.
- **Sensor**: mide una variable o la diferencia entre dos variables de la misma dimensión. Puede incorporar sesgo, ganancia, ruido y respuesta lenta.
- **Transmisor**: recibe una medida de un sensor separado o directamente de una variable de proceso (instrumento integrado). Su módulo de calibración puede traducir, por ejemplo, 0–100 psi a 4–20 mA.
- **Switch**: crea una salida ON/OFF a partir de umbrales de presión, temperatura, caudal o nivel, con banda muerta opcional.
- **Controlador**: recibe canales con nombres como `PV`, puede convertir 4–20 mA de vuelta a unidades de ingeniería y ejecuta reglas declarativas en español o una acción simple de presión alta con histéresis. No evalúa código libre.
- **Elemento final de control**: recibe una orden en porcentaje o 4–20 mA y expone su apertura entre 0 y 100 %. Un vínculo `ProcessActuator` indica si gobierna la entrada o la salida del proceso.
- **Señales**: matriz central con un valor por canal en unidad canónica, calidad, origen, instante e incertidumbre básica. `view()` convierte solo para presentación.
- **Alarmas**: observan cualquier canal, incluso sin controlador asociado. Admiten reconocimiento manual.
- **Conexiones**: permiten rutas explícitas y retardos de transporte. El motor detecta dependencias circulares.

Para presiones se calcula en Pa; para temperaturas absolutas, K; para diferencias térmicas, ΔK; para caudal, m³/s; para niveles lineales, m; para corriente, A; y para órdenes, %. Se admiten psi, kPa, bar, °C, °F, L/min, m³/h, mA y otras unidades definidas en `units.py`. Las conversiones se realizan en los límites de entrada y salida; no se recalcula una matriz completa para cada unidad de visualización.

## Editor local de diagramas

El editor está en `web/` y funciona sin servicios remotos. Permite crear tarjetas para tanques o tuberías, variables, sensores/transmisores, controladores y elementos finales; moverlas; configurar valores constantes; y conectarlas arrastrando entre puntos de cualquiera de los cuatro lados. Los puntos no son entradas ni salidas fijas: el sentido se establece al conectar. El estado se guarda en `localStorage` y se puede importar/exportar como JSON. El botón de la luna alterna el tema claro/oscuro y recuerda la elección en el navegador.

Las etiquetas son el título principal de cada tarjeta; el nombre queda como dato secundario. Cada objeto mantiene variables de presión, temperatura, caudal y nivel identificadas solo por etiqueta. En el menú derecho, entra a **Variables** para añadirlas y elegir **Estática**, **Subir** o **Bajar**; define inicio, meta y tiempo en segundos. Puedes extraer una tarjeta de lectura de una variable concreta. En el modo de balance también puedes asociar el nivel al llenado y el caudal a la entrada o salida nominal. Una tarjeta de temperatura no puede leer presión. Un switch tiene umbrales ON y OFF independientes.

El panel derecho usa botones por sección y un botón **←** para volver al menú. El transmisor entrega 4–20 mA. El controlador recibe esa corriente y permite una respuesta **progresiva** o **ON/OFF** con umbrales y órdenes configurables en mA; ya no toma decisiones a partir de presión de ingeniería. La válvula convierte 4–20 mA en 0–100 % de apertura. Al conectarla con un objeto, en **Acciones** puedes añadir varias órdenes sobre sus variables: subir, bajar o fijar un valor cuando la válvula abre o cierra. La simulación avanza en segundos reales.

El diagrama inicial muestra un lazo circular completo. También puedes añadir **«Descarga por presión»** o **«Cierre de alimentación»**. En ambos, la presión empieza en 100 kPa y tiende a 500 kPa en 10 s. El transmisor escala 0–500 kPa a 4–20 mA; el controlador conmuta a 15,2 mA y retorna a 9,76 mA. La válvula conectada reduce la presión a razón de 116 kPa/s mientras se cumple su condición de apertura o cierre. Puedes editar, pausar, reiniciar y repetir. Es una tendencia de prueba, no una predicción física.

La tarjeta de válvula permite elegir **Entrada / alimentación** o **Salida / descarga**. En balance volumétrico, su apertura también modula el caudal nominal correspondiente. Sus acciones adicionales pueden afectar varias variables del objeto o el porcentaje de llenado. El motor toma la posición de la válvula al inicio de cada paso temporal para evitar un ciclo algebraico instantáneo.

El núcleo Python conserva por separado `GuidedPressureScenario` y reglas habladas de control. Asigna `pressure_scenario` a un `ProcessLine`, y marca con `follow_process_pressure=True` la variable que debe publicar esa lectura. Usa `line.add_actuator(ProcessActuator("PCV", "outlet"))` para abrir una descarga o `"inlet"` para cerrar una alimentación. El campo anterior `relief_element_tag` sigue siendo compatible como salida.

```python
from instrumentalab import GuidedPressureScenario, ProcessLine, ProcessVariable, Quantity

line = ProcessLine("PL-101", pressure_scenario=GuidedPressureScenario(
    Quantity(100, "kPa"), Quantity(500, "kPa"), 10,
    Quantity(120, "kPa"), 5,
))
line.add_variable(ProcessVariable("P1", "Presión de línea", "pressure",
                                  follow_process_pressure=True))
line.advance(1)  # 140 kPa; sin diámetro ni cálculo de caudal
```

Para abrirlo solo en esta computadora desde la carpeta del proyecto: `python3 -m http.server 8000 --bind 127.0.0.1 --directory web` y visitar `http://127.0.0.1:8000`.

## Ejemplo mínimo

```python
from instrumentalab import ControlLoop, Tank, ProcessVariable, Quantity
from instrumentalab import Sensor, Transmitter, Controller, FinalControlElement, SpokenRule

loop = ControlLoop("L-101")
tank = Tank("TK-101")
tank.add_variable(ProcessVariable("P1", "Presión superior", "pressure", "techo"))
loop.add_process(tank)
loop.add_instrument(Sensor("PE-101", source_a="process:P1"))
loop.add_instrument(Transmitter("PT-101", source="PE-101.out"))
loop.add_instrument(Controller("PC-101", inputs={"PV": "PT-101.out"}, rules=[
    SpokenRule.parse("si PV mayor que 100 psi entonces salida 100 % si no salida 0 %")
]))
loop.add_instrument(FinalControlElement("PCV-101", source="PC-101.out"))

loop.variable("P1").set(loop.board, Quantity(110, "psi"), at=0)
loop.tick(at=0)
print(loop.board.view("PT-101.out", "kPa"))
print(loop.instruments["PCV-101"].position)
```

Instalación local: `python3 -m pip install -e .`. Pruebas sin instalar: `PYTHONPATH=src python3 -m unittest discover -s tests` y `node tests/test_simulation.js`.

## Límites de esta primera etapa

La gramática hablada admite `si <entrada> mayor que|menor que|igual a <valor> <unidad> entonces salida <valor> % [si no salida <valor> %]`. Las reglas son de orden y el primer resultado aplicable gana. El tiempo lo entrega el usuario en segundos a `tick`; se puede simular sin reloj real. No hay aún PID, enclavamientos, persistencia ni enlace físico. La calidad de señal evita usar lecturas instrumentales antiguas como si fueran nuevas; una variable de proceso conserva su última lectura hasta que se actualice.
