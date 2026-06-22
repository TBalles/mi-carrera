'use strict';

/* ════════════════════════════════════════════════════════
   Estado global
   ════════════════════════════════════════════════════════ */
let planData = [];
let correlativas = {};
let customEstados = {};         // override por código -> estado
let customNotas = {};           // override por código -> nota
let statusChart = null;

const STORE_ESTADOS = 'plan.customEstados.v2';
const STORE_NOTAS = 'plan.customNotas.v1';
const STORE_HISTORIAL = 'plan.historial.v2';
const STORE_THEME = 'plan.theme.v1';

// Estados que el usuario puede asignar (en orden de ciclo)
const CICLO = ['no cursada', 'cursando', 'pendiente de final', 'aprobada'];

// Una correlativa se considera CUMPLIDA si está aprobada o pendiente de final.
// (Estar cursándola NO habilita las que dependen de ella.)
const HABILITA = new Set(['aprobada', 'pendiente de final']);

/* ════════════════════════════════════════════════════════
   Tema (oscuro / claro)
   ════════════════════════════════════════════════════════ */
function applyTheme(theme) {
  if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
  else document.documentElement.removeAttribute('data-theme');
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = theme === 'light' ? '☀' : '☾';
}
function initTheme() {
  const saved = localStorage.getItem(STORE_THEME) || 'dark';
  applyTheme(saved);
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const now = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    localStorage.setItem(STORE_THEME, now);
    applyTheme(now);
  });
}

/* ════════════════════════════════════════════════════════
   Tabs
   ════════════════════════════════════════════════════════ */
function initTabs() {
  const tabs = document.querySelectorAll('.tab');
  const panels = document.querySelectorAll('.tabpanel');
  tabs.forEach(t => t.addEventListener('click', () => {
    const target = t.dataset.tab;
    tabs.forEach(x => x.classList.toggle('tab--active', x === t));
    panels.forEach(p => p.classList.toggle('tabpanel--active', p.dataset.panel === target));
  }));
}

/* ════════════════════════════════════════════════════════
   Carga y cálculo del plan
   ════════════════════════════════════════════════════════ */
function loadStore(key) {
  try { return JSON.parse(localStorage.getItem(key)) || {}; }
  catch { return {}; }
}
function loadCustomEstados() { customEstados = loadStore(STORE_ESTADOS); }
function saveCustomEstados() { localStorage.setItem(STORE_ESTADOS, JSON.stringify(customEstados)); }
function loadCustomNotas() { customNotas = loadStore(STORE_NOTAS); }
function saveCustomNotas() { localStorage.setItem(STORE_NOTAS, JSON.stringify(customNotas)); }

function condicionToEstado(condicion) {
  if (condicion === 'Aprobada') return 'aprobada';
  if (condicion === 'Cursada') return 'cursando';
  return 'no cursada';
}

function baseEstado(item) {
  if (customEstados[item.codigo]) return customEstados[item.codigo];
  return condicionToEstado(item.condicion);
}

function baseNota(item) {
  if (item.codigo in customNotas) return customNotas[item.codigo];
  return item.nota || 0;
}

// Recalcula disponibilidad: una materia "no cursada" está Disponible si
// TODAS sus correlativas están aprobadas o pendientes de final.
function recalcular() {
  const estadoPorCodigo = {};
  planData.forEach(i => { estadoPorCodigo[i.codigo] = i.estado; });

  planData.forEach(item => {
    const prereqs = correlativas[item.codigo] || [];
    const habilitada = prereqs.every(c => HABILITA.has(estadoPorCodigo[c]));
    item.habilitada = habilitada;            // ¿cumple correlativas?
    if (item.estado !== 'no cursada') {
      item.disponibilidad = 'No disponible'; // ya en curso/pendiente/aprobada => no "para cursar"
    } else {
      item.disponibilidad = habilitada ? 'Disponible' : 'No disponible';
    }
  });
}

// Estado visual para colorear (5 categorías)
function displayStatus(item) {
  if (item.estado === 'aprobada') return 'aprobada';
  if (item.estado === 'cursando') return 'cursando';
  if (item.estado === 'pendiente de final') return 'pendiente';
  return item.disponibilidad === 'Disponible' ? 'disponible' : 'bloqueada';
}

async function loadPlan() {
  const [plan, corr] = await Promise.all([
    fetch('plan.json').then(r => r.json()),
    fetch('correlativas.json').then(r => r.json()),
  ]);
  planData = plan;
  correlativas = corr;
  loadCustomEstados();
  loadCustomNotas();
  planData.forEach(i => { i.estado = baseEstado(i); i.nota = baseNota(i); });
  recalcular();
  renderAll();
}

function setEstado(codigo, nuevo) {
  const item = planData.find(i => i.codigo === codigo);
  if (!item) return;
  item.estado = nuevo;
  // Persistir override (o limpiar si coincide con el original del Excel)
  if (nuevo === condicionToEstado(item.condicion)) delete customEstados[codigo];
  else customEstados[codigo] = nuevo;
  saveCustomEstados();
  recalcular();
  renderAll();
}

function setNota(codigo, nota) {
  const item = planData.find(i => i.codigo === codigo);
  if (!item) return;
  item.nota = nota;
  if (!nota) delete customNotas[codigo];
  else customNotas[codigo] = nota;
  saveCustomNotas();
  renderAll();
}

/* ════════════════════════════════════════════════════════
   Render
   ════════════════════════════════════════════════════════ */
function renderAll() {
  renderStats();
  renderMalla();
}

function getStats() {
  const total = planData.length;
  const aprobadas = planData.filter(i => i.estado === 'aprobada').length;
  const cursando = planData.filter(i => i.estado === 'cursando').length;
  const pendientes = planData.filter(i => i.estado === 'pendiente de final').length;
  const disponibles = planData.filter(i => displayStatus(i) === 'disponible').length;
  const bloqueadas = planData.filter(i => displayStatus(i) === 'bloqueada').length;
  const restantes = total - aprobadas;
  const porcentaje = total ? (aprobadas / total * 100) : 0;

  const notas = planData.filter(i => i.estado === 'aprobada' && i.nota > 0).map(i => i.nota);
  const promedio = notas.length ? (notas.reduce((a, b) => a + b, 0) / notas.length) : null;

  return { total, aprobadas, cursando, pendientes, disponibles, bloqueadas, restantes, porcentaje, promedio };
}

function renderStats() {
  const s = getStats();
  document.getElementById('st-porcentaje').textContent = s.porcentaje.toFixed(1) + '%';
  document.getElementById('st-progress').style.width = s.porcentaje + '%';
  document.getElementById('st-aprobadas').textContent = s.aprobadas;
  document.getElementById('st-total').textContent = s.total;
  document.getElementById('st-promedio').textContent = s.promedio !== null ? s.promedio.toFixed(2) : '—';
  document.getElementById('st-disponibles').textContent = s.disponibles;
  document.getElementById('st-cursando').textContent = s.cursando;
  document.getElementById('st-restantes').textContent = s.restantes;
  renderChart(s);
}

function renderChart(s) {
  const data = {
    labels: ['Aprobadas', 'Cursando', 'Pendientes', 'Disponibles', 'No disponibles'],
    datasets: [{
      data: [s.aprobadas, s.cursando, s.pendientes, s.disponibles, s.bloqueadas],
      backgroundColor: ['#22c55e', '#f59e0b', '#60a5fa', '#22d3ee', '#475569'],
      borderWidth: 0,
    }],
  };
  if (statusChart) { statusChart.data = data; statusChart.update(); return; }
  const ctx = document.getElementById('statusChart');
  if (!ctx || typeof Chart === 'undefined') return;
  statusChart = new Chart(ctx, {
    type: 'doughnut',
    data,
    options: {
      cutout: '64%',
      plugins: { legend: { display: false } },
      responsive: true,
      maintainAspectRatio: false,
    },
  });
}

function renderMalla() {
  const cont = document.getElementById('malla');
  const anios = [1, 2, 3, 4, 5];
  let html = '';

  anios.forEach(anio => {
    const delAnio = planData.filter(i => i.anio === anio);
    if (!delAnio.length) return;
    const aprob = delAnio.filter(i => i.estado === 'aprobada').length;
    html += `
      <div class="anio">
        <div class="anio__head">${anio}º Año
          <span class="chip-count">${aprob}/${delAnio.length} aprobadas</span>
        </div>
        <div class="anio__body">
          ${cuatriCol(delAnio, '1°C', 'Primer cuatrimestre')}
          ${cuatriCol(delAnio, '2°C', 'Segundo cuatrimestre')}
        </div>
      </div>`;
  });

  // Transversales
  const trans = planData.filter(i => i.cuatri === 'Transversal');
  if (trans.length) {
    html += `
      <div class="anio">
        <div class="anio__head">Materias Transversales
          <span class="chip-count">${trans.filter(i => i.estado === 'aprobada').length}/${trans.length} aprobadas</span>
        </div>
        <div class="anio__body" style="grid-template-columns:1fr">
          <div class="cuatri">
            <div class="cuatri__list">${trans.map(subjectCard).join('')}</div>
          </div>
        </div>
      </div>`;
  }

  cont.innerHTML = html;
  cont.querySelectorAll('.subject').forEach(el => {
    el.addEventListener('click', () => openModal(parseInt(el.dataset.codigo, 10)));
  });
}

function cuatriCol(materias, cuatri, titulo) {
  const list = materias.filter(i => i.cuatri === cuatri);
  if (!list.length) return '';
  return `
    <div class="cuatri">
      <div class="cuatri__title">${titulo}</div>
      <div class="cuatri__list">${list.map(subjectCard).join('')}</div>
    </div>`;
}

function subjectCard(item) {
  const st = displayStatus(item);
  const nota = (item.estado === 'aprobada' && item.nota > 0)
    ? `<span class="subject__nota">${item.nota}</span>` : '';
  return `
    <div class="subject subject--${st}" data-codigo="${item.codigo}" title="${escAttr(item.materia)}">
      <span class="subject__st"></span>
      <span class="subject__code">${item.codigo}</span>
      <span class="subject__name">${item.materia}</span>
      ${nota}
    </div>`;
}

/* ════════════════════════════════════════════════════════
   Modal editor de materia
   ════════════════════════════════════════════════════════ */
const ESTADO_LABEL = {
  aprobada: 'Aprobada', cursando: 'Cursando',
  'pendiente de final': 'Pendiente de final', 'no cursada': 'No cursada',
};

let modalCodigo = null;

function openModal(codigo) {
  const item = planData.find(i => i.codigo === codigo);
  if (!item) return;
  modalCodigo = codigo;

  document.getElementById('modal-code').textContent = `Código ${item.codigo}`;
  document.getElementById('modal-title').textContent = item.materia;
  const anioLabel = item.cuatri === 'Transversal' ? 'Transversal' : `${item.anio}º año · ${item.cuatri}`;
  document.getElementById('modal-meta').textContent = `${item.trayecto || '—'} · ${anioLabel}`;

  // Correlativas
  const corr = correlativas[item.codigo] || [];
  const corrEl = document.getElementById('modal-corr');
  if (!corr.length) {
    corrEl.innerHTML = 'Sin correlativas.';
  } else {
    const parts = corr.map(c => {
      const dep = planData.find(p => p.codigo === c);
      const ok = dep && HABILITA.has(dep.estado);
      const nombre = dep ? dep.materia : c;
      return `<span class="${ok ? 'ok' : 'no'}">${ok ? '✓' : '✗'} ${nombre}</span>`;
    });
    corrEl.innerHTML = 'Correlativas: ' + parts.join(' · ');
  }

  renderModalStates(item.estado);
  renderModalNota(item);

  document.getElementById('modal-backdrop').classList.add('open');
}

function renderModalStates(actual) {
  const cont = document.getElementById('modal-states');
  cont.innerHTML = CICLO.map(e =>
    `<button class="state-opt ${e === actual ? 'state-opt--active' : ''}" data-st="${e}">
       <i></i>${ESTADO_LABEL[e]}
     </button>`
  ).join('');
  cont.querySelectorAll('.state-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      setEstado(modalCodigo, btn.dataset.st);
      // refrescar el modal con el item actualizado
      const item = planData.find(i => i.codigo === modalCodigo);
      renderModalStates(item.estado);
      renderModalNota(item);
    });
  });
}

function renderModalNota(item) {
  const row = document.getElementById('modal-nota-row');
  const input = document.getElementById('modal-nota');
  // La nota solo tiene sentido cuando la materia está aprobada
  row.classList.toggle('is-hidden', item.estado !== 'aprobada');
  input.value = item.nota > 0 ? item.nota : '';
}

function commitModalNota() {
  if (modalCodigo === null) return;
  const item = planData.find(i => i.codigo === modalCodigo);
  if (!item || item.estado !== 'aprobada') return;
  const input = document.getElementById('modal-nota');
  let v = parseInt(input.value, 10);
  if (isNaN(v)) v = 0;
  else v = Math.max(1, Math.min(10, v));
  setNota(modalCodigo, v);
}

function closeModal() {
  commitModalNota();
  document.getElementById('modal-backdrop').classList.remove('open');
  modalCodigo = null;
}

function initModal() {
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-backdrop').addEventListener('click', e => {
    if (e.target.id === 'modal-backdrop') closeModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.getElementById('modal-backdrop').classList.contains('open')) closeModal();
  });
  // Guardar la nota al salir del campo
  document.getElementById('modal-nota').addEventListener('change', commitModalNota);
}

/* ════════════════════════════════════════════════════════
   Historial de Notas (editable)
   ════════════════════════════════════════════════════════ */
const COLS = [
  { key: 'primerParcial',  label: '1º Parcial / TP' },
  { key: 'segundoParcial', label: '2º Parcial' },
  { key: 'recuperatorio',  label: 'Recuperatorio' },
  { key: 'notaPromocion',  label: 'Prom. / 1º Final' },
  { key: 'segundoIntento', label: '2º Final' },
  { key: 'tercerIntento',  label: '3º Final' },
];

let historialData = [];

function nuevaMateria() {
  return { materia: '', primerParcial: '', segundoParcial: '', recuperatorio: '', notaPromocion: '', segundoIntento: '', tercerIntento: '' };
}

async function loadHistorial() {
  const saved = localStorage.getItem(STORE_HISTORIAL);
  if (saved) {
    try { historialData = JSON.parse(saved); }
    catch { historialData = await fetchHistorialBase(); }
  } else {
    historialData = await fetchHistorialBase();
  }
  renderHistorial();
}

async function fetchHistorialBase() {
  try { return await fetch('historial.json').then(r => r.json()); }
  catch { return []; }
}

function saveHistorial() {
  localStorage.setItem(STORE_HISTORIAL, JSON.stringify(historialData));
}

function notaClase(val) {
  const n = parseFloat(val);
  if (isNaN(n)) return '';
  return n >= 4 ? 'hist-nota-ok' : 'hist-nota-bad';
}

function promedioSemestre(sem) {
  const finals = sem.materias.map(m => {
    const cand = [m.notaPromocion, m.segundoIntento, m.tercerIntento]
      .map(x => parseFloat(x)).filter(x => !isNaN(x));
    return cand.length ? Math.max(...cand) : NaN;
  }).filter(x => !isNaN(x));
  if (!finals.length) return null;
  return finals.reduce((a, b) => a + b, 0) / finals.length;
}

function renderHistorial() {
  const cont = document.getElementById('historial-container');
  if (!historialData.length) {
    cont.innerHTML = `<p class="muted" style="padding:20px">No hay cuatrimestres. Agregá uno con “+ Cuatrimestre”.</p>`;
    return;
  }

  cont.innerHTML = historialData.map((sem, si) => {
    const avg = promedioSemestre(sem);
    const headCols = COLS.map(c => `<th>${c.label}</th>`).join('');
    const rows = sem.materias.map((m, mi) => {
      const notas = COLS.map(c =>
        `<td><input class="hist-input hist-input--nota ${notaClase(m[c.key])}" data-s="${si}" data-m="${mi}" data-k="${c.key}" value="${escAttr(m[c.key])}" placeholder="—"></td>`
      ).join('');
      return `<tr>
        <td><input class="hist-input hist-input--materia" data-s="${si}" data-m="${mi}" data-k="materia" value="${escAttr(m.materia)}" placeholder="Nombre de la materia"></td>
        ${notas}
        <td class="hist-row-actions"><button class="icon-btn" data-del-row="${si},${mi}" title="Eliminar fila">✕</button></td>
      </tr>`;
    }).join('');

    return `
      <div class="semestre">
        <div class="semestre__head">
          <input class="semestre__title" data-title="${si}" value="${escAttr(sem.semestre)}" placeholder="Ej: 1°C 2026">
          <span class="semestre__avg">${avg !== null ? `Promedio: <b>${avg.toFixed(2)}</b>` : ''}</span>
        </div>
        <div class="table-wrap">
          <table class="hist-table">
            <thead><tr><th>Materia</th>${headCols}<th></th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div class="semestre__foot">
          <button class="link-add" data-add-row="${si}">+ Agregar materia</button>
          <button class="btn btn--danger semestre__del" data-del-sem="${si}">Eliminar cuatrimestre</button>
        </div>
      </div>`;
  }).join('');

  bindHistorialEvents();
}

function bindHistorialEvents() {
  const cont = document.getElementById('historial-container');

  cont.querySelectorAll('.hist-input').forEach(inp => {
    inp.addEventListener('input', e => {
      const { s, m, k } = e.target.dataset;
      historialData[s].materias[m][k] = e.target.value;
      if (k !== 'materia') {
        e.target.className = `hist-input hist-input--nota ${notaClase(e.target.value)}`;
      }
      saveHistorial();
      const avgEl = cont.querySelectorAll('.semestre__avg')[s];
      if (avgEl) {
        const avg = promedioSemestre(historialData[s]);
        avgEl.innerHTML = avg !== null ? `Promedio: <b>${avg.toFixed(2)}</b>` : '';
      }
    });
  });

  cont.querySelectorAll('.semestre__title').forEach(inp => {
    inp.addEventListener('input', e => {
      historialData[e.target.dataset.title].semestre = e.target.value;
      saveHistorial();
    });
  });

  cont.querySelectorAll('[data-add-row]').forEach(btn => {
    btn.addEventListener('click', () => {
      historialData[btn.dataset.addRow].materias.push(nuevaMateria());
      saveHistorial(); renderHistorial();
    });
  });

  cont.querySelectorAll('[data-del-row]').forEach(btn => {
    btn.addEventListener('click', () => {
      const [s, m] = btn.dataset.delRow.split(',').map(Number);
      historialData[s].materias.splice(m, 1);
      saveHistorial(); renderHistorial();
    });
  });

  cont.querySelectorAll('[data-del-sem]').forEach(btn => {
    btn.addEventListener('click', () => {
      const s = Number(btn.dataset.delSem);
      if (confirm(`¿Eliminar el cuatrimestre "${historialData[s].semestre || ''}"?`)) {
        historialData.splice(s, 1);
        saveHistorial(); renderHistorial();
      }
    });
  });
}

function initHistorialControls() {
  document.getElementById('add-semestre').addEventListener('click', () => {
    historialData.push({ semestre: 'Nuevo cuatrimestre', materias: [nuevaMateria()] });
    saveHistorial(); renderHistorial();
    const titles = document.querySelectorAll('.semestre__title');
    if (titles.length) titles[titles.length - 1].focus();
  });

  document.getElementById('export-historial').addEventListener('click', () => {
    descargar('historial_notas.json', JSON.stringify(historialData, null, 2));
  });

  document.getElementById('reset-historial').addEventListener('click', async () => {
    if (confirm('Esto descarta tus cambios y restaura el historial original del Excel. ¿Continuar?')) {
      historialData = await fetchHistorialBase();
      saveHistorial(); renderHistorial();
    }
  });
}

/* ════════════════════════════════════════════════════════
   Utilidades
   ════════════════════════════════════════════════════════ */
function escAttr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function descargar(nombre, contenido) {
  const blob = new Blob([contenido], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nombre; a.click();
  URL.revokeObjectURL(url);
}

/* ════════════════════════════════════════════════════════
   Init
   ════════════════════════════════════════════════════════ */
window.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  initTabs();
  initModal();
  initHistorialControls();
  try {
    await loadPlan();
  } catch (err) {
    console.error(err);
    document.getElementById('malla').innerHTML =
      '<p class="muted" style="padding:20px">No se pudo cargar el plan. Abrí la página desde un servidor (GitHub Pages) y no con doble clic en el archivo.</p>';
  }
  await loadHistorial();
});
