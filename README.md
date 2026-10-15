# InstrumentaLab

Aplicación local de verificación de variables críticas para equipos de campo, diseñada para tablet. Abre `index.html` (redirige a `web/index.html`) o sirve la carpeta con `python3 -m http.server 8000 --bind 127.0.0.1`.

## Flujo

1. En **Creador**, elige unidad **12** o **16** y selecciona un equipo en los mosaicos. Edita tag, unidad, servicio, nombre y descripción; pulsa **Siguiente** para abrir las tres columnas de sistemas, variables y configuración. El botón **Validar equipo** comprueba límites y regresa al inicio del Creador.
2. La plantilla del compresor incluye lubricación, variables de proceso y sellos secos. **Sus cifras son ejemplos ilustrativos, no límites operativos.** Sustitúyelas y confirma su revisión contra la documentación aprobada del equipo antes de diagnosticar.
3. En **Campo**, elige unidad y equipo, luego sistema y variable. Puedes avanzar con **Siguiente** sin registrar; **Validar** guarda la lectura, calcula su estado y revela la referencia cuando el equipo fue aprobado. Las unidades de lectura se convierten a la unidad configurada para comparar.
4. Tras validar todas las variables del sistema, **Diagnóstico general** presenta el estado conjunto. **Nueva verificación** borra las lecturas del equipo seleccionado, pero conserva su configuración.

La configuración y las lecturas se guardan solo en `localStorage` del navegador; no hay sincronización ni respaldo automático. Esta herramienta no sustituye la ficha técnica, los procedimientos de campo ni los sistemas instrumentados de protección.

El modelo orientado a objetos está en `web/diagnostics.js` (`Equipment`, `CriticalSystem`, `VariableSpec`, `UnitConverter`, `DiagnosticEngine`). La interfaz está en `web/app.js` y `web/styles.css`. El antiguo prototipo Python en `src/` es independiente y no se carga en la página.

Pruebas: `node tests/test_diagnostics.js`, `node tests/test_app_ui.js` y `PYTHONPATH=src python3 -m unittest discover -s tests`.
