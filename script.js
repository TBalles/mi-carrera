'use strict';

/* ════════════════════════════════════════════════════════
   Estado global
   ════════════════════════════════════════════════════════ */
let planData = [];
let correlativas = {};
let customEstados = {};         // override por código -> estado
let statusChart = null;

const STORE_ESTADOS = 'plan.customEstados.v2';
const STORE_HISTORIAL = 'plan.historial.v2';

// Estados que el usuario puede asignar (en orden de ciclo al hacer clic)
const CICLO = ['no cursada', 'cursando', 'pendiente de final', 'aprobada'];

// Una correlativa se considera cumplida (para CURSAR) si está regularizada o mejor
const CUMPLE = new Set(['aprobada', 'cursando', 'pendiente de final']);

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
function loadCustomEstados() {
  try { customEstados = JSON.parse(localStorage.getItem(STORE_ESTADOS)) || {}; }
  catch { customEstados = {}; }
}
function saveCustomEstados() {
  localStorage.setItem(STORE_ESTADOS, JSON.stringify(customEstados));
}

function condicionToEstado(condicion) {
  if (condicion === 'Aprobada') return 'aprobada';
  if (condicion === 'Cursada') return 'cursando';
  return 'no cursada';
}

function baseEstado(item) {
  if (customEstados[item.codigo]) return customEstados[item.codigo];
  return condicionToEstado(item.condicion);
}

// Recalcula disponibilidad: una materia "no cursada" está Disponible si
// TODAS sus correlativas están al menos cursadas (regularizadas).
function recalcular() {
  const estadoPorCodigo = {};
  planData.forEach(i => { estadoPorCodigo[i.codigo] = i.estado; });

  planData.forEach(item => {
    const prereqs = correlativas[item.codigo] || [];
    const habilitada = prereqs.every(c => CUMPLE.has(estadoPorCodigo[c]));
    item.habilitada = habilitada;            // ¿cumple correlativas?
    if (CUMPLE.has(item.estado)) {
      item.disponibilidad = 'No disponible'; // ya cursada/aprobada => no "para cursar"
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
  planData.forEach(i => { i.estado = baseEstado(i); });
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

/* ════════════════════════════════════════════════════════
   Render
   ════════════════════════════════════════════════════════ */
function renderAll() {
  renderStats();
  renderMalla();
  renderTable();
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
      backgroundColor: ['#16a34a', '#d97706', '#2563eb', '#0891b2', '#cbd5e1'],
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

const ROMANO = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V' };

function renderMalla() {
  const cont = document.getElementById('malla');
  // Agrupar por año
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
    el.addEventListener('click', () => {
      const cod = parseInt(el.dataset.codigo, 10);
      const item = planData.find(i => i.codigo === cod);
      const idx = CICLO.indexOf(item.estado);
      const next = CICLO[(idx + 1) % CICLO.length];
      setEstado(cod, next);
    });
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
    <div class="subject subject--${st}" data-codigo="${item.codigo}" title="${item.materia}">
      <span class="subject__st"></span>
      <span class="subject__code">${item.codigo}</span>
      <span class="subject__name">${item.materia}</span>
      ${nota}
    </div>`;
}

const ESTADO_LABEL = {
  aprobada: 'Aprobada', cursando: 'Cursando',
  'pendiente de final': 'Pendiente de final', 'no cursada': 'No cursada',
};

function renderTable() {
  const body = document.getElementById('subjects-body');
  const q = (document.getElementById('search-input').value || '').trim().toLowerCase();
  const filtro = document.getElementById('status-filter').value;

  const rows = planData.filter(item => {
    const matchText = item.materia.toLowerCase().includes(q) || String(item.codigo).includes(q);
    let matchStatus = true;
    if (filtro === 'disponible' || filtro === 'bloqueada') matchStatus = displayStatus(item) === filtro;
    else if (filtro !== 'all') matchStatus = item.estado === filtro;
    return matchText && matchStatus;
  });

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:24px">Sin resultados.</td></tr>`;
    return;
  }

  body.innerHTML = rows.map(item => {
    const st = displayStatus(item);
    const badge = `<span class="badge badge--${st}">${ESTADO_LABEL[item.estado] || (st === 'disponible' ? 'Disponible' : 'No disponible')}</span>`;
    const sel = `<select class="state-select" data-codigo="${item.codigo}">
      ${CICLO.map(e => `<option value="${e}" ${item.estado === e ? 'selected' : ''}>${ESTADO_LABEL[e]}</option>`).join('')}
    </select>`;
    const corr = correlativas[item.codigo] || [];
    const corrHtml = corr.length
      ? corr.map(c => {
          const ok = CUMPLE.has((planData.find(p => p.codigo === c) || {}).estado);
          return `<span class="${ok ? 'ok' : 'no'}">${c}</span>`;
        }).join(', ')
      : '—';
    const anioLabel = item.cuatri === 'Transversal' ? 'Trans.' : `${item.anio}º ${item.cuatri}`;
    const notaVal = item.nota > 0 ? item.nota : '';
    return `
      <tr>
        <td class="code">${item.codigo}</td>
        <td>${item.materia}</td>
        <td>${anioLabel}</td>
        <td>${item.trayecto || '—'}</td>
        <td>${sel}</td>
        <td class="corr-list">${corrHtml}</td>
        <td><input class="nota-input" type="number" min="0" max="10" data-codigo="${item.codigo}" value="${notaVal}" placeholder="—"></td>
      </tr>`;
  }).join('');

  body.querySelectorAll('.state-select').forEach(sel => {
    sel.addEventListener('change', e => setEstado(parseInt(e.target.dataset.codigo, 10), e.target.value));
  });
  body.querySelectorAll('.nota-input').forEach(inp => {
    inp.addEventListener('change', e => {
      const cod = parseInt(e.target.dataset.codigo, 10);
      const item = planData.find(i => i.codigo === cod);
      let v = parseInt(e.target.value, 10);
      if (isNaN(v)) v = 0;
      v = Math.max(0, Math.min(10, v));
      item.nota = v;
      renderStats();
      renderMalla();
    });
  });
}

function initPlanControls() {
  document.getElementById('search-input').addEventListener('input', renderTable);
  document.getElementById('status-filter').addEventListener('change', renderTable);
  document.getElementById('export-plan').addEventListener('click', exportPlan);
}

function exportPlan() {
  const out = planData.map(i => ({
    codigo: i.codigo, materia: i.materia, trayecto: i.trayecto,
    anio: i.anio, cuatri: i.cuatri, estado: i.estado,
    disponibilidad: i.disponibilidad, nota: i.nota,
  }));
  descargar('plan_actualizado.json', JSON.stringify(out, null, 2));
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
  // Promedio de la mejor nota final/promoción de cada materia con nota numérica
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
      // refrescar promedio del semestre sin re-render total
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
    // foco en el título nuevo
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
  initTabs();
  initPlanControls();
  initHistorialControls();
  try {
    await loadPlan();
  } catch (err) {
    console.error(err);
    document.getElementById('malla').innerHTML =
      '<p class="muted" style="padding:20px">No se pudo cargar el plan. Abrí la página desde un servidor local (no con doble clic).</p>';
  }
  await loadHistorial();
});
