# Mi Carrera · Ingeniería en Informática (UNLaM)

Web para hacer el seguimiento del **Plan de Estudios 2023** de Ingeniería en Informática: estado de cada materia, correlatividades, progreso de la carrera e historial de notas.

## Funcionalidades

- **Modo oscuro** por defecto, con un botón para cambiar a modo claro (la preferencia se guarda).
- **Plan de Estudios**: malla curricular por año/cuatrimestre con cada materia coloreada según su estado. Hacé clic en una materia para abrir un editor donde cambiás su **estado** y cargás su **nota**.
  - Estados: Aprobada, Cursando, Pendiente de final, Disponible (se puede cursar), No disponible (faltan correlativas).
  - La **disponibilidad se calcula con las correlativas reales** del plan: una materia se habilita cuando todas sus correlativas están **aprobadas o pendientes de final**. Estar cursándolas no alcanza para habilitar las que dependen de ellas.
- **Estadísticas**: porcentaje de carrera, promedio, materias disponibles, cursando y restantes, con gráfico.
- **Historial de Notas**: registro por cuatrimestre, **editable**. Podés agregar materias y cuatrimestres a medida que llegan las notas.
- Todos los cambios (estados, notas e historial) se **guardan en el navegador** (localStorage) automáticamente.

## Cómo verla

La página usa `fetch`, así que **no funciona abriéndola con doble clic** (file://). Necesita servirse por HTTP. La forma recomendada es **GitHub Pages**:

1. En GitHub: **Settings → Pages**.
2. En *Source* elegí *Deploy from a branch*, rama `main`, carpeta `/ (root)`, y guardá.
3. En 1–2 minutos queda publicada en `https://<usuario>.github.io/mi-carrera/`.

Para probarla localmente (opcional): `python -m http.server 5500` y abrí `http://localhost:5500/`.

## Estructura

| Archivo | Descripción |
|---|---|
| `index.html` / `styles.css` / `script.js` | La aplicación (HTML/CSS/JS, sin frameworks). |
| `plan.json` | Materias: código, nombre, trayecto, condición, nota, año y cuatrimestre. |
| `correlativas.json` | Correlatividades (código → códigos requeridos), según el plan oficial. |
| `historial.json` | Historial de notas inicial por cuatrimestre. |
| `Plan de Estudios 2023 ... .xlsx` | Excel original (fuente de los datos). |
| `plan_correlativas.pdf` | Plan oficial de la facultad (fuente de las correlativas). |

## Datos

Basado en el Plan de Estudios 2023 de Ingeniería en Informática — UNLaM, Departamento de Ingeniería e Investigaciones Tecnológicas (DIIT).
