'use strict';

/* ════════════════════════════════════════════════════════
   Estado global
   ════════════════════════════════════════════════════════ */
let planData = [];
let correlativas = {};
let customEstados = {};
let customNotas = {};
let historialData = [];
let statusChart = null;
let currentUser = null;          // objeto user de Supabase

const STORE_THEME = 'plan.theme.v1';

const CICLO    = ['no cursada', 'cursando', 'pendiente de final', 'aprobada'];
const HABILITA = new Set(['aprobada', 'pendiente de final']);

/* ════════════════════════════════════════════════════════
   Persistencia en Supabase (nube, por usuario)
   ════════════════════════════════════════════════════════ */
// ¿El error indica que falta la tabla user_data en Supabase?
function esTablaFaltante(error) {
  if (!error) return false;
  const txt = `${error.code || ''} ${error.message || ''}`.toLowerCase();
  return error.code === '42P01'           // Postgres: relation does not exist
      || error.code === 'PGRST205'        // PostgREST: tabla no encontrada en el schema
      || txt.includes('user_data')
      || txt.includes('does not exist')
      || txt.includes('could not find the table');
}

function manejarErrorNube(error, contexto) {
  console.error(`Error ${contexto}:`, error);
  if (esTablaFaltante(error)) {
    mostrarBanner(
      '⚠️ Falta crear la tabla en Supabase. Tus cambios NO se están guardando. ' +
      'Corré el archivo supabase-setup.sql en Supabase → SQL Editor (una sola vez).',
      'error'
    );
  } else {
    mostrarBanner('⚠️ No se pudieron sincronizar tus datos con la nube. Revisá tu conexión.', 'error');
  }
}

async function loadUserData() {
  customEstados = {};
  customNotas = {};
  historialData = null;
  const { data, error } = await supabaseClient
    .from('user_data').select('key,value').eq('user_id', currentUser.id);
  if (error) { manejarErrorNube(error, 'cargando datos'); return; }
  ocultarBanner();
  for (const row of data || []) {
    if (row.key === 'estados')   customEstados = row.value || {};
    else if (row.key === 'notas')    customNotas = row.value || {};
    else if (row.key === 'historial') historialData = row.value || [];
  }
}

const _saveTimers = {};
function saveData(key, value) {
  // Debounce por clave para no spamear la API en cada tecla
  clearTimeout(_saveTimers[key]);
  _saveTimers[key] = setTimeout(async () => {
    const { error } = await supabaseClient.from('user_data').upsert({
      user_id: currentUser.id, key, value, updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,key' });
    if (error) manejarErrorNube(error, `guardando ${key}`);
    else ocultarBanner();
  }, 500);
}

/* Banner de aviso (arriba de todo) */
function mostrarBanner(msg, tipo) {
  let el = document.getElementById('cloud-banner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'cloud-banner';
    el.className = 'cloud-banner';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.toggle('cloud-banner--error', tipo === 'error');
  el.classList.add('visible');
}
function ocultarBanner() {
  const el = document.getElementById('cloud-banner');
  if (el) el.classList.remove('visible');
}

// Migra datos del localStorage viejo (versión sin nube) a la cuenta, una sola vez
async function migrarLocalStorageSiHace() {
  const oldEstados   = safeParse(localStorage.getItem('plan.customEstados.v2'));
  const oldNotas     = safeParse(localStorage.getItem('plan.customNotas.v1'));
  const oldHistorial = safeParse(localStorage.getItem('plan.historial.v2'));
  const sinDatosEnNube = !Object.keys(customEstados).length
    && !Object.keys(customNotas).length
    && (!historialData || !historialData.length);
  if (!sinDatosEnNube) return;

  let migrado = false;
  if (oldEstados && Object.keys(oldEstados).length)   { customEstados = oldEstados; saveData('estados', customEstados); migrado = true; }
  if (oldNotas && Object.keys(oldNotas).length)       { customNotas = oldNotas; saveData('notas', customNotas); migrado = true; }
  if (oldHistorial && oldHistorial.length)            { historialData = oldHistorial; saveData('historial', historialData); migrado = true; }
  if (migrado) console.info('Datos locales migrados a tu cuenta en la nube.');
}

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

/* ════════════════════════════════════════════════════════
   Autenticación
   ════════════════════════════════════════════════════════ */
let authMode = 'login'; // 'login' | 'register'

function showLogin() {
  document.getElementById('login-screen').classList.add('visible');
  document.getElementById('app').classList.remove('visible');
  setAuthError('');
  setAuthMode('login');
  setTimeout(() => document.getElementById('login-email').focus(), 80);
}

function hideLogin() {
  document.getElementById('login-screen').classList.remove('visible');
  document.getElementById('app').classList.add('visible');
  document.getElementById('user-chip').textContent = currentUser?.email || '';
}

function setAuthMode(mode) {
  authMode = mode;
  document.getElementById('login-title').textContent  = mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta';
  document.getElementById('login-submit').textContent = mode === 'login' ? 'Entrar' : 'Registrarse';
  document.getElementById('switch-text').textContent  = mode === 'login' ? '¿No tenés cuenta?' : '¿Ya tenés cuenta?';
  document.getElementById('switch-btn').textContent   = mode === 'login' ? 'Registrarse' : 'Iniciar sesión';
  setAuthError('');
  setAuthInfo('');
}

function setAuthError(msg) {
  const el = document.getElementById('login-error');
  el.textContent = msg; el.style.display = msg ? 'block' : 'none';
}
function setAuthInfo(msg) {
  const el = document.getElementById('login-info');
  el.textContent = msg; el.style.display = msg ? 'block' : 'none';
}

function initLoginScreen() {
  document.getElementById('switch-btn').addEventListener('click', () =>
    setAuthMode(authMode === 'login' ? 'register' : 'login'));

  document.getElementById('login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const pass  = document.getElementById('login-pass').value;
    const btn   = document.getElementById('login-submit');
    setAuthError(''); setAuthInfo('');

    if (!email) { setAuthError('Ingresá tu email.'); return; }
    if (pass.length < 6) { setAuthError('La contraseña debe tener al menos 6 caracteres.'); return; }

    btn.disabled = true;
    const txtPrev = btn.textContent;
    btn.textContent = '…';

    if (authMode === 'login') {
      const { error } = await supabaseClient.auth.signInWithPassword({ email, password: pass });
      if (error) {
        setAuthError(traducirError(error.message));
        btn.disabled = false; btn.textContent = txtPrev;
      }
      // si OK, onAuthStateChange se encarga de entrar
    } else {
      const { data, error } = await supabaseClient.auth.signUp({ email, password: pass });
      if (error) {
        setAuthError(traducirError(error.message));
        btn.disabled = false; btn.textContent = txtPrev;
      } else if (!data.session) {
        // Falta confirmar email (si la confirmación está activada en Supabase)
        setAuthInfo('Te enviamos un email para confirmar tu cuenta. Confirmalo y volvé a iniciar sesión.');
        setAuthMode('login');
        btn.disabled = false; btn.textContent = 'Entrar';
      }
      // si hay session, onAuthStateChange entra directo
    }
  });
}

function traducirError(msg) {
  if (/invalid login credentials/i.test(msg)) return 'Email o contraseña incorrectos.';
  if (/user already registered/i.test(msg))   return 'Ese email ya está registrado.';
  if (/email/i.test(msg) && /valid/i.test(msg)) return 'Ingresá un email válido.';
  return msg;
}

async function logout() {
  await supabaseClient.auth.signOut();
  // onAuthStateChange muestra el login
}

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
  applyTheme(localStorage.getItem(STORE_THEME) || 'dark');
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const now = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    localStorage.setItem(STORE_THEME, now);
    applyTheme(now);
  });
  document.getElementById('logout-btn').addEventListener('click', () => {
    if (confirm('¿Cerrar sesión?')) logout();
  });
}

/* ════════════════════════════════════════════════════════
   Tabs
   ════════════════════════════════════════════════════════ */
function initTabs() {
  const tabs   = document.querySelectorAll('.tab');
  const panels = document.querySelectorAll('.tabpanel');
  tabs.forEach(t => t.addEventListener('click', () => {
    const target = t.dataset.tab;
    tabs.forEach(x => x.classList.toggle('tab--active', x === t));
    panels.forEach(p => p.classList.toggle('tabpanel--active', p.dataset.panel === target));
  }));
}

/* ════════════════════════════════════════════════════════
   Auto-ocultar el header al bajar (solo pantallas chicas)
   ════════════════════════════════════════════════════════ */
function initTopbarAutohide() {
  const tb = document.querySelector('.topbar');
  if (!tb) return;
  let lastY = window.scrollY, ticking = false;
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const y = window.scrollY;
      const mobile = window.innerWidth <= 720;
      if (mobile && y > lastY && y > 90) tb.classList.add('topbar--hidden');
      else tb.classList.remove('topbar--hidden');
      lastY = y;
      ticking = false;
    });
  }, { passive: true });
}

/* ════════════════════════════════════════════════════════
   Cálculo del plan
   ════════════════════════════════════════════════════════ */
function condicionToEstado(condicion) {
  if (condicion === 'Aprobada') return 'aprobada';
  if (condicion === 'Cursada')  return 'cursando';
  return 'no cursada';
}
function baseEstado(item) { return customEstados[item.codigo] || condicionToEstado(item.condicion); }
function baseNota(item)   { return (item.codigo in customNotas) ? customNotas[item.codigo] : (item.nota || 0); }

function recalcular() {
  const estadoPorCodigo = {};
  planData.forEach(i => { estadoPorCodigo[i.codigo] = i.estado; });
  planData.forEach(item => {
    const prereqs    = correlativas[item.codigo] || [];
    const habilitada = prereqs.every(c => HABILITA.has(estadoPorCodigo[c]));
    item.habilitada  = habilitada;
    item.disponibilidad = (item.estado !== 'no cursada')
      ? 'No disponible'
      : (habilitada ? 'Disponible' : 'No disponible');
  });
}

function displayStatus(item) {
  if (item.estado === 'aprobada')           return 'aprobada';
  if (item.estado === 'cursando')           return 'cursando';
  if (item.estado === 'pendiente de final') return 'pendiente';
  return item.disponibilidad === 'Disponible' ? 'disponible' : 'bloqueada';
}

async function fetchJSON(url) {
  const text = await fetch(url).then(r => r.text());
  return JSON.parse(text.replace(/^﻿/, ''));
}

async function loadPlan() {
  const [plan, corr] = await Promise.all([
    fetchJSON('plan.json'),
    fetchJSON('correlativas.json'),
  ]);
  planData     = plan;
  correlativas = corr;
  planData.forEach(i => { i.estado = baseEstado(i); i.nota = baseNota(i); });
  recalcular();
  renderAll();
}

function setEstado(codigo, nuevo) {
  const item = planData.find(i => i.codigo === codigo);
  if (!item) return;
  item.estado = nuevo;
  if (nuevo === condicionToEstado(item.condicion)) delete customEstados[codigo];
  else customEstados[codigo] = nuevo;
  saveData('estados', customEstados);
  recalcular();
  renderAll();
}

function setNota(codigo, nota) {
  const item = planData.find(i => i.codigo === codigo);
  if (!item) return;
  item.nota = nota;
  if (!nota) delete customNotas[codigo];
  else customNotas[codigo] = nota;
  saveData('notas', customNotas);
  renderAll();
}

/* ════════════════════════════════════════════════════════
   Render
   ════════════════════════════════════════════════════════ */
function renderAll() {
  renderStats();
  renderMalla();
  renderTable();
  renderGrafo();
}

function getStats() {
  const total       = planData.length;
  const aprobadas   = planData.filter(i => i.estado === 'aprobada').length;
  const cursando    = planData.filter(i => i.estado === 'cursando').length;
  const pendientes  = planData.filter(i => i.estado === 'pendiente de final').length;
  const disponibles = planData.filter(i => displayStatus(i) === 'disponible').length;
  const bloqueadas  = planData.filter(i => displayStatus(i) === 'bloqueada').length;
  const restantes   = total - aprobadas;
  const porcentaje  = total ? (aprobadas / total * 100) : 0;
  const notas       = planData.filter(i => i.estado === 'aprobada' && i.nota > 0).map(i => i.nota);
  const promedio    = notas.length ? notas.reduce((a, b) => a + b, 0) / notas.length : null;
  return { total, aprobadas, cursando, pendientes, disponibles, bloqueadas, restantes, porcentaje, promedio };
}

function renderStats() {
  const s = getStats();
  document.getElementById('st-porcentaje').textContent  = s.porcentaje.toFixed(1) + '%';
  document.getElementById('st-progress').style.width    = s.porcentaje + '%';
  document.getElementById('st-aprobadas').textContent   = s.aprobadas;
  document.getElementById('st-total').textContent       = s.total;
  document.getElementById('st-promedio').textContent    = s.promedio !== null ? s.promedio.toFixed(2) : '—';
  document.getElementById('st-disponibles').textContent = s.disponibles;
  document.getElementById('st-cursando').textContent    = s.cursando;
  document.getElementById('st-restantes').textContent   = s.restantes;
  renderChart(s);
}

function renderChart(s) {
  const data = {
    labels: ['Aprobadas', 'Cursando', 'Pendientes', 'Disponibles', 'No disponibles'],
    datasets: [{ data: [s.aprobadas, s.cursando, s.pendientes, s.disponibles, s.bloqueadas],
      backgroundColor: ['#22c55e', '#f59e0b', '#60a5fa', '#22d3ee', '#475569'], borderWidth: 0 }],
  };
  if (statusChart) { statusChart.data = data; statusChart.update(); return; }
  const ctx = document.getElementById('statusChart');
  if (!ctx || typeof Chart === 'undefined') return;
  statusChart = new Chart(ctx, {
    type: 'doughnut', data,
    options: { cutout: '64%', plugins: { legend: { display: false } }, responsive: true, maintainAspectRatio: false },
  });
}

function renderMalla() {
  const cont  = document.getElementById('malla');
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
  const trans = planData.filter(i => i.cuatri === 'Transversal');
  if (trans.length) {
    html += `
      <div class="anio">
        <div class="anio__head">Materias Transversales
          <span class="chip-count">${trans.filter(i => i.estado === 'aprobada').length}/${trans.length} aprobadas</span>
        </div>
        <div class="anio__body" style="grid-template-columns:1fr">
          <div class="cuatri"><div class="cuatri__list">${trans.map(subjectCard).join('')}</div></div>
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
  return `<div class="cuatri">
    <div class="cuatri__title">${titulo}</div>
    <div class="cuatri__list">${list.map(subjectCard).join('')}</div>
  </div>`;
}

function subjectCard(item) {
  const st   = displayStatus(item);
  const nota = (item.estado === 'aprobada' && item.nota > 0)
    ? `<span class="subject__nota">${item.nota}</span>` : '';
  return `<div class="subject subject--${st}" data-codigo="${item.codigo}" title="${escAttr(item.materia)}">
    <span class="subject__st"></span>
    <span class="subject__code">${item.codigo}</span>
    <span class="subject__name">${item.materia}</span>
    ${nota}
  </div>`;
}

/* ════════════════════════════════════════════════════════
   Tabla / listado de materias
   ════════════════════════════════════════════════════════ */
const ESTADO_LABEL = {
  aprobada: 'Aprobada', cursando: 'Cursando',
  'pendiente de final': 'Pendiente de final', 'no cursada': 'No cursada',
};

function renderTable() {
  const body = document.getElementById('subjects-body');
  if (!body) return;
  const q      = (document.getElementById('search-input').value || '').trim().toLowerCase();
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
    const corr     = correlativas[item.codigo] || [];
    const corrHtml = corr.length
      ? corr.map(c => {
          const ok = HABILITA.has((planData.find(p => p.codigo === c) || {}).estado);
          return `<span class="${ok ? 'ok' : 'no'}">${c}</span>`;
        }).join(', ')
      : '—';
    const anioLabel = item.cuatri === 'Transversal' ? 'Trans.' : `${item.anio}º ${item.cuatri}`;
    const notaVal   = item.nota > 0 ? item.nota : '';
    const disNota   = item.estado === 'aprobada' ? '' : 'disabled';
    const sel       = `<select class="state-select" data-codigo="${item.codigo}">
      ${CICLO.map(e => `<option value="${e}" ${item.estado === e ? 'selected' : ''}>${ESTADO_LABEL[e]}</option>`).join('')}
    </select>`;
    return `<tr>
      <td class="code">${item.codigo}</td>
      <td>${item.materia}</td>
      <td>${anioLabel}</td>
      <td>${item.trayecto || '—'}</td>
      <td>${sel}</td>
      <td class="corr-list">${corrHtml}</td>
      <td><input class="nota-input" type="number" min="1" max="10" data-codigo="${item.codigo}" value="${notaVal}" placeholder="—" ${disNota}></td>
    </tr>`;
  }).join('');

  body.querySelectorAll('.state-select').forEach(sel => {
    sel.addEventListener('change', e => setEstado(parseInt(e.target.dataset.codigo, 10), e.target.value));
  });
  body.querySelectorAll('.nota-input').forEach(inp => {
    inp.addEventListener('change', e => {
      const cod = parseInt(e.target.dataset.codigo, 10);
      let v = parseInt(e.target.value, 10);
      if (isNaN(v)) v = 0;
      else v = Math.max(1, Math.min(10, v));
      setNota(cod, v);
    });
  });
}

function initPlanControls() {
  document.getElementById('search-input').addEventListener('input', renderTable);
  document.getElementById('status-filter').addEventListener('change', renderTable);
  document.getElementById('export-plan').addEventListener('click', () => {
    const out = planData.map(i => ({
      codigo: i.codigo, materia: i.materia, trayecto: i.trayecto,
      anio: i.anio, cuatri: i.cuatri, estado: i.estado,
      disponibilidad: i.disponibilidad, nota: i.nota,
    }));
    descargar('plan_actualizado.json', JSON.stringify(out, null, 2));
  });
  document.getElementById('reset-plan').addEventListener('click', resetCarrera);
}

// Reinicia toda la carrera: todas las materias a "no cursada" y sin notas
function resetCarrera() {
  if (!confirm('¿Reiniciar toda la carrera a 0%? Se marcarán TODAS las materias como "no cursada" y se borrarán las notas. Esta acción no se puede deshacer.')) return;
  customEstados = {};
  customNotas = {};
  planData.forEach(i => {
    i.estado = 'no cursada';
    i.nota = 0;
    customEstados[i.codigo] = 'no cursada';   // override explícito sobre el dato del Excel
  });
  saveData('estados', customEstados);
  saveData('notas', customNotas);
  recalcular();
  renderAll();
}

/* ════════════════════════════════════════════════════════
   Modal editor de materia
   ════════════════════════════════════════════════════════ */
let modalCodigo = null;

function openModal(codigo) {
  const item = planData.find(i => i.codigo === codigo);
  if (!item) return;
  modalCodigo = codigo;

  document.getElementById('modal-code').textContent  = `Código ${item.codigo}`;
  document.getElementById('modal-title').textContent = item.materia;
  const anioLabel = item.cuatri === 'Transversal' ? 'Transversal' : `${item.anio}º año · ${item.cuatri}`;
  document.getElementById('modal-meta').textContent  = `${item.trayecto || '—'} · ${anioLabel}`;

  const corr   = correlativas[item.codigo] || [];
  const corrEl = document.getElementById('modal-corr');
  if (!corr.length) {
    corrEl.innerHTML = 'Sin correlativas.';
  } else {
    corrEl.innerHTML = 'Correlativas: ' + corr.map(c => {
      const dep = planData.find(p => p.codigo === c);
      const ok  = dep && HABILITA.has(dep.estado);
      return `<span class="${ok ? 'ok' : 'no'}">${ok ? '✓' : '✗'} ${dep ? dep.materia : c}</span>`;
    }).join(' · ');
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
      const item = planData.find(i => i.codigo === modalCodigo);
      renderModalStates(item.estado);
      renderModalNota(item);
    });
  });
}

function renderModalNota(item) {
  const row   = document.getElementById('modal-nota-row');
  const input = document.getElementById('modal-nota');
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
  document.getElementById('modal-nota').addEventListener('change', commitModalNota);
}

/* ════════════════════════════════════════════════════════
   Historial de Notas
   ════════════════════════════════════════════════════════ */
const COLS = [
  { key: 'primerParcial',  label: '1º Parcial / TP' },
  { key: 'segundoParcial', label: '2º Parcial' },
  { key: 'recuperatorio',  label: 'Recuperatorio' },
  { key: 'notaPromocion',  label: 'Prom. / 1º Final' },
  { key: 'segundoIntento', label: '2º Final' },
  { key: 'tercerIntento',  label: '3º Final' },
];

function nuevaMateria() {
  return { materia: '', primerParcial: '', segundoParcial: '', recuperatorio: '', notaPromocion: '', segundoIntento: '', tercerIntento: '' };
}

async function loadHistorial() {
  // historialData ya viene de loadUserData(); si está vacío, usar la base del Excel
  if (!historialData || !historialData.length) {
    historialData = await fetchHistorialBase();
  }
  renderHistorial();
}

async function fetchHistorialBase() {
  try { return await fetchJSON('historial.json'); }
  catch { return []; }
}

function saveHistorial() { saveData('historial', historialData); }

function notaClase(val) {
  const n = parseFloat(val);
  if (isNaN(n)) return '';
  return n >= 4 ? 'hist-nota-ok' : 'hist-nota-bad';
}

function promedioSemestre(sem) {
  const finals = sem.materias.map(m => {
    const cand = [m.notaPromocion, m.segundoIntento, m.tercerIntento].map(x => parseFloat(x)).filter(x => !isNaN(x));
    return cand.length ? Math.max(...cand) : NaN;
  }).filter(x => !isNaN(x));
  if (!finals.length) return null;
  return finals.reduce((a, b) => a + b, 0) / finals.length;
}

function renderHistorial() {
  const cont = document.getElementById('historial-container');
  if (!historialData.length) {
    cont.innerHTML = `<p class="muted" style="padding:20px">No hay cuatrimestres. Agregá uno con "+ Cuatrimestre".</p>`;
    return;
  }
  cont.innerHTML = historialData.map((sem, si) => {
    const avg      = promedioSemestre(sem);
    const headCols = COLS.map(c => `<th>${c.label}</th>`).join('');
    const rows     = sem.materias.map((m, mi) => {
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
      if (k !== 'materia') e.target.className = `hist-input hist-input--nota ${notaClase(e.target.value)}`;
      saveHistorial();
      const avgEl = cont.querySelectorAll('.semestre__avg')[s];
      if (avgEl) {
        const avg = promedioSemestre(historialData[s]);
        avgEl.innerHTML = avg !== null ? `Promedio: <b>${avg.toFixed(2)}</b>` : '';
      }
    });
  });
  cont.querySelectorAll('.semestre__title').forEach(inp => {
    inp.addEventListener('input', e => { historialData[e.target.dataset.title].semestre = e.target.value; saveHistorial(); });
  });
  cont.querySelectorAll('[data-add-row]').forEach(btn => {
    btn.addEventListener('click', () => { historialData[btn.dataset.addRow].materias.push(nuevaMateria()); saveHistorial(); renderHistorial(); });
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
        historialData.splice(s, 1); saveHistorial(); renderHistorial();
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
      historialData = await fetchHistorialBase(); saveHistorial(); renderHistorial();
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
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = nombre; a.click();
  URL.revokeObjectURL(url);
}

/* ════════════════════════════════════════════════════════
   Árbol / grafo de correlatividades
   ════════════════════════════════════════════════════════ */
const GNODE_W = 210, GNODE_H = 58, GCOL_GAP = 72, GROW_GAP = 16, GMARGIN = 30, GHEAD = 30;
const GNAME_MAXCHARS = 27, GNAME_MAXLINES = 2;

// Parte el nombre en hasta N líneas para que entre completo en el nodo
function wrapName(name, maxChars = GNAME_MAXCHARS, maxLines = GNAME_MAXLINES) {
  const words = String(name).split(/\s+/);
  const lines = [];
  let cur = '';
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const trial = cur ? cur + ' ' + w : w;
    if (trial.length <= maxChars || !cur) {
      cur = trial;
    } else {
      lines.push(cur);
      if (lines.length === maxLines - 1) { cur = words.slice(i).join(' '); break; }
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  const last = lines[lines.length - 1];
  if (last && last.length > maxChars) lines[lines.length - 1] = last.slice(0, maxChars - 1) + '…';
  return lines;
}

let grafoView = { tx: 0, ty: 0, s: 1 };
let grafoFitted = false;
let grafoSel = null;
let grafoLayout = null;
let dependentsOf = null;

function clampNum(v, a, b) { return Math.max(a, Math.min(b, v)); }

// Columna cronológica de cada materia (transversales primero)
function grafoCol(item) {
  if (item.cuatri === 'Transversal') return 0;
  return (item.anio - 1) * 2 + (item.cuatri === '1°C' ? 1 : 2);
}
function grafoColLabel(col) {
  if (col === 0) return 'Transv.';
  const anio = Math.floor((col - 1) / 2) + 1;
  return `${anio}° ${col % 2 === 1 ? '1°C' : '2°C'}`;
}

function buildDependents() {
  dependentsOf = {};
  planData.forEach(it => { dependentsOf[it.codigo] = []; });
  planData.forEach(it => {
    (correlativas[it.codigo] || []).forEach(p => {
      if (dependentsOf[p]) dependentsOf[p].push(it.codigo);
    });
  });
}
function ancestorsOf(cod) {
  const seen = new Set(); const stack = [...(correlativas[cod] || [])];
  while (stack.length) {
    const x = stack.pop();
    if (seen.has(x)) continue; seen.add(x);
    (correlativas[x] || []).forEach(p => stack.push(p));
  }
  return seen;
}
function descendantsOf(cod) {
  const seen = new Set(); const stack = [...((dependentsOf && dependentsOf[cod]) || [])];
  while (stack.length) {
    const x = stack.pop();
    if (seen.has(x)) continue; seen.add(x);
    ((dependentsOf && dependentsOf[x]) || []).forEach(d => stack.push(d));
  }
  return seen;
}

function computeGrafoLayout() {
  const byCol = {};
  planData.forEach(it => { (byCol[grafoCol(it)] = byCol[grafoCol(it)] || []).push(it); });
  const cols = Object.keys(byCol).map(Number).sort((a, b) => a - b);
  const nodes = new Map();
  let maxRows = 0;
  cols.forEach(c => {
    byCol[c].sort((a, b) => a.codigo - b.codigo);
    byCol[c].forEach((it, row) => {
      nodes.set(it.codigo, {
        x: GMARGIN + c * (GNODE_W + GCOL_GAP),
        y: GMARGIN + GHEAD + row * (GNODE_H + GROW_GAP),
        item: it,
      });
    });
    maxRows = Math.max(maxRows, byCol[c].length);
  });
  const lastCol = cols.length ? cols[cols.length - 1] : 0;
  grafoLayout = {
    nodes, cols,
    width:  GMARGIN * 2 + lastCol * (GNODE_W + GCOL_GAP) + GNODE_W,
    height: GMARGIN * 2 + GHEAD + maxRows * (GNODE_H + GROW_GAP),
  };
}

function renderGrafo() {
  const host = document.getElementById('grafo');
  if (!host || !planData.length) return;
  if (!dependentsOf) buildDependents();
  computeGrafoLayout();
  const { nodes, cols } = grafoLayout;

  let edges = '';
  planData.forEach(it => {
    const to = nodes.get(it.codigo); if (!to) return;
    (correlativas[it.codigo] || []).forEach(p => {
      const from = nodes.get(p); if (!from) return;
      const x1 = from.x + GNODE_W, y1 = from.y + GNODE_H / 2;
      const x2 = to.x,            y2 = to.y + GNODE_H / 2;
      const dx = Math.max(36, Math.abs(x2 - x1) * 0.45);
      edges += `<path class="gedge" data-from="${p}" data-to="${it.codigo}" d="M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}"/>`;
    });
  });

  let heads = '';
  cols.forEach(c => {
    const cx = GMARGIN + c * (GNODE_W + GCOL_GAP) + GNODE_W / 2;
    heads += `<text class="gcol-label" x="${cx}" y="${GMARGIN + 12}">${grafoColLabel(c)}</text>`;
  });

  let gnodes = '';
  nodes.forEach(({ x, y, item }) => {
    const st = displayStatus(item);
    const tx = x + 28;
    const lines = wrapName(item.materia);
    const baseY = lines.length === 1 ? y + 39 : y + 34;
    const nameSvg = lines.map((ln, i) =>
      `<text class="gnode-name" x="${tx}" y="${baseY + i * 15}">${escAttr(ln)}</text>`
    ).join('');
    const nota = (item.estado === 'aprobada' && item.nota > 0)
      ? `<text class="gnode-nota" x="${x + GNODE_W - 12}" y="${y + 19}">${item.nota}</text>` : '';
    gnodes += `<g class="gnode gnode--${st}" data-codigo="${item.codigo}">
      <rect x="${x}" y="${y}" width="${GNODE_W}" height="${GNODE_H}" rx="13"/>
      <circle class="gnode-dot" cx="${x + 15}" cy="${y + GNODE_H / 2}" r="4.5"/>
      <text class="gnode-code" x="${tx}" y="${y + 19}">${item.codigo}</text>
      ${nameSvg}
      ${nota}
    </g>`;
  });

  host.innerHTML = `
    <svg id="grafo-svg" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <g id="grafo-viewport">
        <g class="gedges">${edges}</g>
        <g class="gcol-labels">${heads}</g>
        <g class="gnodes">${gnodes}</g>
      </g>
    </svg>`;

  applyGrafoTransform();
  if (grafoSel != null) applyGrafoSelection();
  if (!grafoFitted) fitGrafo();
}

function applyGrafoTransform() {
  const vp = document.getElementById('grafo-viewport');
  if (vp) vp.setAttribute('transform', `translate(${grafoView.tx},${grafoView.ty}) scale(${grafoView.s})`);
}

function fitGrafo() {
  const host = document.getElementById('grafo');
  if (!host || !grafoLayout) return;
  const cw = host.clientWidth, ch = host.clientHeight;
  if (cw < 10 || ch < 10) return;
  const pad = 28;
  const s = clampNum(Math.min((cw - pad * 2) / grafoLayout.width, (ch - pad * 2) / grafoLayout.height), 0.18, 1.4);
  grafoView.s = s;
  grafoView.tx = Math.max(pad, (cw - grafoLayout.width * s) / 2);
  grafoView.ty = pad;
  grafoFitted = true;
  applyGrafoTransform();
}

function zoomAround(factor, mx, my) {
  const s0 = grafoView.s;
  const s = clampNum(s0 * factor, 0.18, 2.6);
  const wx = (mx - grafoView.tx) / s0, wy = (my - grafoView.ty) / s0;
  grafoView.s = s;
  grafoView.tx = mx - wx * s;
  grafoView.ty = my - wy * s;
  applyGrafoTransform();
}
function zoomGrafo(factor) {
  const h = document.getElementById('grafo');
  if (h) zoomAround(factor, h.clientWidth / 2, h.clientHeight / 2);
}

/* Selección: resalta la cadena (ancestros + descendientes) */
function toggleSelectGrafo(cod) { (grafoSel === cod) ? deselectGrafo() : selectGrafo(cod); }

function selectGrafo(cod) {
  const item = planData.find(i => i.codigo === cod);
  if (!item) return;
  grafoSel = cod;
  applyGrafoSelection();
  const anc = ancestorsOf(cod), desc = descendantsOf(cod);
  document.getElementById('grafo-info-title').textContent = `${item.codigo} · ${item.materia}`;
  document.getElementById('grafo-info-meta').innerHTML =
    `Necesitás <b>${anc.size}</b> antes · habilita <b>${desc.size}</b>`;
  document.getElementById('grafo-info').classList.add('visible');
}
function deselectGrafo() {
  grafoSel = null;
  const info = document.getElementById('grafo-info');
  if (info) info.classList.remove('visible');
  applyGrafoSelection();
}
function applyGrafoSelection() {
  const gnodes = document.querySelector('.gnodes');
  const gedges = document.querySelector('.gedges');
  if (!gnodes || !gedges) return;
  gnodes.querySelectorAll('.gnode').forEach(n => n.classList.remove('is-sel', 'is-chain'));
  gedges.querySelectorAll('.gedge').forEach(e => e.classList.remove('is-chain', 'is-blocked'));
  if (grafoSel == null) { gnodes.classList.remove('dim'); gedges.classList.remove('dim'); return; }
  const chain = new Set([grafoSel, ...ancestorsOf(grafoSel), ...descendantsOf(grafoSel)]);
  const bloqueadas = new Set(planData.filter(i => displayStatus(i) === 'bloqueada').map(i => i.codigo));
  gnodes.classList.add('dim'); gedges.classList.add('dim');
  gnodes.querySelectorAll('.gnode').forEach(n => {
    const c = parseInt(n.dataset.codigo, 10);
    if (c === grafoSel) n.classList.add('is-sel');
    else if (chain.has(c)) n.classList.add('is-chain');
  });
  gedges.querySelectorAll('.gedge').forEach(e => {
    const f = parseInt(e.dataset.from, 10), t = parseInt(e.dataset.to, 10);
    if (chain.has(f) && chain.has(t)) {
      e.classList.add('is-chain');
      // Si conecta una materia que todavía no podés cursar, marcarla en rojo
      if (bloqueadas.has(f) || bloqueadas.has(t)) e.classList.add('is-blocked');
    }
  });
}

function initGrafo() {
  const host = document.getElementById('grafo');
  if (!host) return;

  document.getElementById('grafo-zoom-in').addEventListener('click', () => zoomGrafo(1.25));
  document.getElementById('grafo-zoom-out').addEventListener('click', () => zoomGrafo(1 / 1.25));
  document.getElementById('grafo-fit').addEventListener('click', () => { grafoFitted = false; fitGrafo(); });
  document.getElementById('grafo-info-close').addEventListener('click', deselectGrafo);
  document.getElementById('grafo-info-edit').addEventListener('click', () => { if (grafoSel != null) openModal(grafoSel); });

  // Re-render + encuadre al abrir la pestaña (recién ahí el contenedor tiene tamaño)
  const grafoTab = document.querySelector('.tab[data-tab="grafo"]');
  if (grafoTab) grafoTab.addEventListener('click', () => { grafoFitted = false; renderGrafo(); });

  // Doble clic / doble tap → editar
  host.addEventListener('dblclick', e => {
    const g = e.target.closest('.gnode');
    if (g) openModal(parseInt(g.dataset.codigo, 10));
  });

  // Pan + zoom + pinch con pointer events
  const pointers = new Map();
  let last = null, pinchPrev = 0, moved = false, downCod = null;

  host.addEventListener('pointerdown', e => {
    const g = e.target.closest('.gnode');
    downCod = g ? parseInt(g.dataset.codigo, 10) : null;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { host.setPointerCapture(e.pointerId); } catch {}
    moved = false;
    if (pointers.size === 1) last = { x: e.clientX, y: e.clientY };
    else if (pointers.size === 2) pinchPrev = 0;
  });

  host.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1 && last) {
      const dx = e.clientX - last.x, dy = e.clientY - last.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      grafoView.tx += dx; grafoView.ty += dy;
      last = { x: e.clientX, y: e.clientY };
      applyGrafoTransform();
    } else if (pointers.size === 2) {
      const pts = [...pointers.values()];
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const rect = host.getBoundingClientRect();
      const mx = (pts[0].x + pts[1].x) / 2 - rect.left;
      const my = (pts[0].y + pts[1].y) / 2 - rect.top;
      if (pinchPrev) zoomAround(d / pinchPrev, mx, my);
      pinchPrev = d; moved = true;
    }
  });

  function endPointer(e) {
    if (pointers.has(e.pointerId)) pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchPrev = 0;
    if (pointers.size === 0) {
      if (!moved && downCod != null) toggleSelectGrafo(downCod);
      else if (!moved && downCod == null) deselectGrafo();
      last = null;
    }
  }
  host.addEventListener('pointerup', endPointer);
  host.addEventListener('pointercancel', endPointer);

  host.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = host.getBoundingClientRect();
    zoomAround(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - rect.left, e.clientY - rect.top);
  }, { passive: false });
}

/* ════════════════════════════════════════════════════════
   Entrar a la app (tras login)
   ════════════════════════════════════════════════════════ */
let appInicializada = false;

async function enterApp() {
  hideLogin();
  await loadUserData();
  await migrarLocalStorageSiHace();
  try {
    await loadPlan();
  } catch (err) {
    console.error(err);
    document.getElementById('malla').innerHTML =
      '<p class="muted" style="padding:20px">No se pudo cargar el plan. Revisá la conexión.</p>';
  }
  await loadHistorial();
  appInicializada = true;
}

/* ════════════════════════════════════════════════════════
   Init global
   ════════════════════════════════════════════════════════ */
window.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  initTabs();
  initModal();
  initPlanControls();
  initHistorialControls();
  initGrafo();
  initTopbarAutohide();
  initLoginScreen();

  // Reaccionar a cambios de sesión (login, logout, refresh de token)
  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (session?.user) {
      currentUser = session.user;
      if (event === 'SIGNED_IN' || (event === 'INITIAL_SESSION')) enterApp();
    } else {
      currentUser = null;
      appInicializada = false;
      if (statusChart) { statusChart.destroy(); statusChart = null; }
      showLogin();
    }
  });

  // Estado inicial por si onAuthStateChange no dispara INITIAL_SESSION
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session?.user) {
    currentUser = session.user;
    if (!appInicializada) enterApp();
  } else {
    showLogin();
  }
});
