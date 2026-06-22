# Mi Carrera · Ingeniería en Informática (UNLaM)

Web para hacer el seguimiento del **Plan de Estudios 2023** de Ingeniería en Informática: estado de cada materia, correlatividades, progreso de la carrera e historial de notas.

## Funcionalidades

- **Plan de Estudios**: malla curricular por año/cuatrimestre con cada materia coloreada según su estado. Hacé clic en una materia para cambiar su estado.
  - Estados: Aprobada, Cursando, Pendiente de final, Disponible (se puede cursar), No disponible (faltan correlativas).
  - La **disponibilidad se calcula con las correlativas reales** del plan: una materia se habilita cuando todas sus correlativas están al menos regularizadas (cursadas o aprobadas).
- **Estadísticas**: porcentaje de carrera, promedio, materias disponibles, cursando y restantes, con gráfico.
- **Listado**: tabla con buscador, filtros por estado y edición de notas.
- **Historial de Notas**: registro por cuatrimestre, **editable**. Podés agregar materias y cuatrimestres a medida que llegan las notas. Se guarda en el navegador.

## Cómo correr

La página usa `fetch`, así que **no funciona abriéndola con doble clic** (file://). Necesita un servidor local:

- **Windows (fácil):** doble clic en `Abrir Mi Carrera.bat` → levanta el servidor y abre el navegador en `http://localhost:5500/`.
- **Manual:** desde la carpeta, `powershell -ExecutionPolicy Bypass -File servidor.ps1` y abrí `http://localhost:5500/`.
- **Con Python (si está):** `python -m http.server 5500`.

## Estructura

| Archivo | Descripción |
|---|---|
| `index.html` / `styles.css` / `script.js` | La aplicación (HTML/CSS/JS, sin frameworks). |
| `plan.json` | Materias: código, nombre, trayecto, condición, nota, año y cuatrimestre. |
| `correlativas.json` | Correlatividades (código → códigos requeridos), según el plan oficial. |
| `historial.json` | Historial de notas inicial por cuatrimestre. |
| `servidor.ps1` / `Abrir Mi Carrera.bat` | Servidor local y lanzador. |
| `Plan de Estudios 2023 ... .xlsx` | Excel original (fuente de los datos). |
| `plan_correlativas.pdf` | Plan oficial de la facultad (fuente de las correlativas). |

## Datos

Basado en el Plan de Estudios 2023 de Ingeniería en Informática — UNLaM, Departamento de Ingeniería e Investigaciones Tecnológicas (DIIT).
