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
let oferta = {};                 // codigo -> [comisiones] (horarios por materia)
let plannerState = null;         // plan editable del usuario (persistido)

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
  plannerState = null;
  const { data, error } = await supabaseClient
    .from('user_data').select('key,value').eq('user_id', currentUser.id);
  if (error) { manejarErrorNube(error, 'cargando datos'); return; }
  ocultarBanner();
  for (const row of data || []) {
    if (row.key === 'estados')   customEstados = row.value || {};
    else if (row.key === 'notas')    customNotas = row.value || {};
    else if (row.key === 'historial') historialData = row.value || [];
    else if (row.key === 'planner')   plannerState = row.value || null;
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
// Estado inicial para TODOS = 0% (no cursada / sin nota). Lo del Excel solo
// se usa para el seed inicial de la cuenta original (ver seedUsuarioOriginal).
function baseEstado(item) { return customEstados[item.codigo] || 'no cursada'; }
function baseNota(item)   { return (item.codigo in customNotas) ? customNotas[item.codigo] : 0; }

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

/* Seed de una sola vez para la cuenta original: vuelca los datos del Excel
   (condición y notas del plan.json + historial.json) a la nube, sin pisar
   nada que ya esté cargado. Para el resto de los usuarios no hace nada. */
const SEED_EMAIL = 'tomasballesteros12@gmail.com';
const SEED_FLAG  = 'seed_excel_v1';

async function upsertDirecto(key, value) {
  try {
    const { error } = await supabaseClient.from('user_data').upsert({
      user_id: currentUser.id, key, value, updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,key' });
    return !error;
  } catch { return false; }
}

async function seedUsuarioOriginal() {
  if (!currentUser || (currentUser.email || '').toLowerCase() !== SEED_EMAIL) return;
  // ¿ya se hizo el seed?
  try {
    const { data } = await supabaseClient.from('user_data')
      .select('key').eq('user_id', currentUser.id).eq('key', SEED_FLAG).limit(1);
    if (Array.isArray(data) && data.length) return;
  } catch { return; }   // si no se puede verificar, no arriesgar

  // Rellenar SOLO lo que falte (no pisa overrides ya guardados en la nube)
  let nEstados = 0, nNotas = 0;
  planData.forEach(it => {
    if (!(it.codigo in customEstados)) {
      const est = condicionToEstado(it.condicion);
      if (est !== 'no cursada') { customEstados[it.codigo] = est; nEstados++; }
    }
    if (!(it.codigo in customNotas) && it.nota > 0) { customNotas[it.codigo] = it.nota; nNotas++; }
  });
  let histSeed = false;
  if (!Array.isArray(historialData) || !historialData.length) {
    const base = await fetchHistorialBase();
    if (base && base.length) { historialData = base; histSeed = true; }
  }

  // Guardar de forma directa (sin debounce) y recién ahí marcar el flag
  let ok = true;
  if (nEstados) ok = (await upsertDirecto('estados', customEstados)) && ok;
  if (nNotas)   ok = (await upsertDirecto('notas', customNotas)) && ok;
  if (histSeed) ok = (await upsertDirecto('historial', historialData)) && ok;
  if (ok) { await upsertDirecto(SEED_FLAG, true); console.info('Seed inicial de la cuenta completado.'); }
}

async function loadPlan() {
  const [plan, corr, ofe] = await Promise.all([
    fetchJSON('plan.json'),
    fetchJSON('correlativas.json'),
    fetchJSON('oferta.json').catch(() => []),
  ]);
  planData     = plan;
  correlativas = corr;
  oferta = {};
  (ofe || []).forEach(m => { oferta[String(m.codigo_materia)] = m.comisiones || []; });
  await seedUsuarioOriginal();   // una sola vez para la cuenta original
  planData.forEach(i => { i.estado = baseEstado(i); i.nota = baseNota(i); });
  recalcular();
  renderAll();
}

function setEstado(codigo, nuevo) {
  const item = planData.find(i => i.codigo === codigo);
  if (!item) return;
  item.estado = nuevo;
  if (nuevo === 'no cursada') delete customEstados[codigo];   // 'no cursada' es el default → no hace falta guardarlo
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
  renderPlanificador();
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
  // historialData ya viene de loadUserData() (nube). Por defecto, vacío.
  if (!Array.isArray(historialData)) historialData = [];
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
  document.getElementById('reset-historial').addEventListener('click', () => {
    if (confirm('¿Vaciar todo el historial de notas? Esta acción no se puede deshacer.')) {
      historialData = []; saveHistorial(); renderHistorial();
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
   Planificador de cursada (editable + horarios + optimización)
   ════════════════════════════════════════════════════════ */
// Una materia ya "no hay que cursarla" si está aprobada o pendiente de final
function planMateriaHecha(item) { return item.estado === 'aprobada' || item.estado === 'pendiente de final'; }

const DIA_CORTO = { LU: 'Lun', MA: 'Mar', MI: 'Mié', JU: 'Jue', VI: 'Vie', SA: 'Sáb' };
const GRID_DIAS = [['LU', 'Lun'], ['MA', 'Mar'], ['MI', 'Mié'], ['JU', 'Jue'], ['VI', 'Vie'], ['SA', 'Sáb']];
const GRID_TURNOS = [['manana', 'Mañana'], ['tarde', 'Tarde'], ['noche', 'Noche']];

// Una entrada de un cuatri es { c: codigo, k: índice de comisión elegida (o null = auto) }
function planNormEntry(e) { return (typeof e === 'object' && e) ? { c: +e.c, k: (e.k == null ? null : +e.k) } : { c: +e, k: null }; }

function ensurePlanner() {
  if (!plannerState) plannerState = {};
  if (!Array.isArray(plannerState.cuatris)) plannerState.cuatris = [];
  plannerState.cuatris = plannerState.cuatris.map(arr => (arr || []).map(planNormEntry));
  if (!Array.isArray(plannerState.franjas)) plannerState.franjas = ['manana', 'tarde', 'noche'];
  if (!plannerState.perSem) plannerState.perSem = 6;
  if (!plannerState.startCuatri) plannerState.startCuatri = '1°C';
}
// Índice de una comisión dentro de la oferta de la materia
function comIndex(cod, com) { const arr = oferta[String(cod)] || []; const i = arr.indexOf(com); return i >= 0 ? i : null; }
function savePlanner() { ensurePlanner(); saveData('planner', plannerState); }
function franjasSet() { ensurePlanner(); return new Set(plannerState.franjas); }

// Franja de un horario según su hora de inicio
function franjaDeHorario(h) {
  if (!h || !h.inicio) return 'distancia';
  const hh = parseInt(String(h.inicio).slice(0, 2), 10);
  if (hh < 13) return 'manana';
  if (hh < 19) return 'tarde';
  return 'noche';
}
// Comisiones de una materia válidas para las franjas elegidas.
// Sin oferta cargada => comisión "virtual" (sin restricción de horario).
function comisionesValidas(cod, fr) {
  const entry = oferta[String(cod)];
  if (!entry || !entry.length) return [{ _virtual: true, horarios: [] }];
  return entry.filter(com => (com.horarios || []).every(h => {
    const f = franjaDeHorario(h);
    return f === 'distancia' || fr.has(f);
  }));
}
function comisionesSolapan(c1, c2) {
  for (const a of (c1.horarios || [])) {
    for (const b of (c2.horarios || [])) {
      if (!a.inicio || !b.inicio) continue;
      if (a.dia === b.dia && a.inicio < b.fin && b.inicio < a.fin) return true;
    }
  }
  return false;
}
// Intenta asignar una comisión a cada materia sin choques. Devuelve [{cod,com}] o null.
function asignarComisiones(codigos, fr) {
  const opts = codigos.map(c => comisionesValidas(c, fr));
  if (opts.some(o => !o.length)) return null;
  const chosen = [];
  function bt(i) {
    if (i === opts.length) return true;
    for (const com of opts[i]) {
      if (chosen.every(pc => !comisionesSolapan(pc, com))) { chosen.push(com); if (bt(i + 1)) return true; chosen.pop(); }
    }
    return false;
  }
  return bt(0) ? codigos.map((c, i) => ({ cod: c, com: chosen[i] })) : null;
}
function fmtComision(com) {
  if (!com || com._virtual) return '';
  const hs = com.horarios || [];
  if (!hs.length || !hs[0].inicio) return 'a distancia';
  return hs.map(h => `${DIA_CORTO[h.dia] || h.dia} ${String(h.inicio).slice(0, 5)}–${String(h.fin).slice(0, 5)}`).join(' · ');
}

function planCuatriTipo(idx) {
  const s = plannerState.startCuatri;
  return (idx % 2 === 0) ? s : (s === '1°C' ? '2°C' : '1°C');
}
// Materias "ya hechas" antes del cuatri idx = aprobadas/pend.final reales + todas las de cuatris anteriores
function planDoneHasta(idx) {
  const done = new Set(planData.filter(planMateriaHecha).map(i => i.codigo));
  for (let k = 0; k < idx; k++) (plannerState.cuatris[k] || []).forEach(e => done.add(+e.c));
  return done;
}
// Comisión elegida de una entrada: la manual (k) si es válida, si no la primera válida (auto)
function entryComision(entry, fr) {
  const coms = comisionesValidas(entry.c, fr);
  if (!coms.length) return null;
  if (entry.k != null) {
    const all = oferta[String(entry.c)] || [];
    const chosen = all[entry.k];
    if (chosen && coms.includes(chosen)) return chosen;
  }
  return coms[0];
}
// Slots distintos (día + turno) en que se ofrece una materia, según franjas
const TURNO_LBL = { manana: 'mañ', tarde: 'tar', noche: 'noc' };
function slotsMateria(cod, fr) {
  const coms = comisionesValidas(cod, fr);
  if (!coms.length) return [];
  if (coms.some(c => c._virtual)) return ['a distancia'];
  const orden = { LU: 0, MA: 1, MI: 2, JU: 3, VI: 4, SA: 5 };
  const tOrden = { manana: 0, tarde: 1, noche: 2 };
  const set = new Set();
  coms.forEach(c => (c.horarios || []).forEach(h => { if (h.inicio) set.add(h.dia + '|' + franjaDeHorario(h)); }));
  return [...set].sort((a, b) => {
    const [da, ta] = a.split('|'), [db, tb] = b.split('|');
    return (orden[da] - orden[db]) || (tOrden[ta] - tOrden[tb]);
  }).map(k => { const [d, t] = k.split('|'); return `${DIA_CORTO[d]} ${TURNO_LBL[t]}`; });
}

// Comisión de una materia que cae en una celda (día + turno) concreta
function comisionParaCelda(cod, dia, turno, fr) {
  const coms = comisionesValidas(cod, fr);
  for (const com of coms) {
    if (com._virtual) continue;
    if ((com.horarios || []).some(h => h.dia === dia && franjaDeHorario(h) === turno)) {
      return { com, idx: comIndex(cod, com) };
    }
  }
  return null;
}
function planCplFactory() {
  if (!dependentsOf) buildDependents();
  const memo = {};
  return function cpl(cod) {
    if (memo[cod] != null) return memo[cod];
    let best = 1;
    (dependentsOf[cod] || []).forEach(dep => {
      const d = planData.find(i => i.codigo === dep);
      if (d && !planMateriaHecha(d)) best = Math.max(best, 1 + cpl(dep));
    });
    return (memo[cod] = best);
  };
}

// Calcula el conjunto óptimo para el cuatri idx (no escribe estado)
function calcCuatri(idx) {
  ensurePlanner();
  const fr = franjasSet();
  const done = planDoneHasta(idx);
  const tipo = planCuatriTipo(idx);
  const enOtros = new Set();
  plannerState.cuatris.forEach((arr, k) => { if (k !== idx) (arr || []).forEach(e => enOtros.add(+e.c)); });
  const cand = planData.filter(it =>
    !planMateriaHecha(it) && !done.has(it.codigo) && !enOtros.has(it.codigo) &&
    (it.cuatri === tipo || it.cuatri === 'Transversal') &&
    (correlativas[it.codigo] || []).every(p => done.has(p)) &&
    comisionesValidas(it.codigo, fr).length > 0
  );
  const cpl = planCplFactory();
  cand.sort((a, b) => cpl(b.codigo) - cpl(a.codigo) || a.anio - b.anio || a.codigo - b.codigo);
  const eleg = [];
  for (const it of cand) {
    if (eleg.length >= plannerState.perSem) break;
    if (asignarComisiones([...eleg, it.codigo], fr)) eleg.push(it.codigo);
  }
  // Guardar la comisión elegida (índice) para reflejarla en la grilla
  const asign = asignarComisiones(eleg, fr) || [];
  const comPorCod = {}; asign.forEach(a => comPorCod[a.cod] = comIndex(a.cod, a.com));
  return eleg.map(c => ({ c, k: comPorCod[c] != null ? comPorCod[c] : null }));
}

function optimizarCuatri(idx) {
  ensurePlanner();
  plannerState.cuatris[idx] = calcCuatri(idx);
  savePlanner();
  renderPlanificador();
}

function optimizarTodo() {
  ensurePlanner();
  if (!dependentsOf) buildDependents();
  const cursando = planData.filter(i => i.estado === 'cursando').map(i => ({ c: i.codigo, k: null }));
  plannerState.cuatris = cursando.length ? [cursando] : [];
  const colocSet = () => { const s = new Set(); plannerState.cuatris.forEach(a => a.forEach(e => s.add(+e.c))); return s; };
  let guard = 0, vacios = 0;
  while (guard++ < 60) {
    const idx = plannerState.cuatris.length;
    const eleg = calcCuatri(idx);
    if (eleg.length) { plannerState.cuatris.push(eleg); vacios = 0; }
    else {
      const coloc = colocSet();
      if (!planData.filter(i => !planMateriaHecha(i) && !coloc.has(i.codigo)).length) break;
      plannerState.cuatris.push([]); vacios++;
      if (vacios >= 2) { plannerState.cuatris.pop(); plannerState.cuatris.pop(); break; }
    }
    const coloc = colocSet();
    if (!planData.filter(i => !planMateriaHecha(i) && !coloc.has(i.codigo)).length) break;
  }
  while (plannerState.cuatris.length && !plannerState.cuatris[plannerState.cuatris.length - 1].length) plannerState.cuatris.pop();
  savePlanner();
  renderPlanificador();
}

function cuatriHas(idx, cod) { return (plannerState.cuatris[idx] || []).some(e => +e.c === +cod); }

function planAddMateria(idx, cod, k = null) {
  ensurePlanner();
  if (!Array.isArray(plannerState.cuatris[idx])) plannerState.cuatris[idx] = [];
  if (!cuatriHas(idx, cod)) plannerState.cuatris[idx].push({ c: +cod, k });
  else if (k != null) plannerState.cuatris[idx].find(e => +e.c === +cod).k = k;
  savePlanner(); renderPlanificador();
}
function planRemoveMateria(idx, cod) {
  ensurePlanner();
  plannerState.cuatris[idx] = (plannerState.cuatris[idx] || []).filter(e => +e.c !== +cod);
  savePlanner(); renderPlanificador();
}
function planAddCuatri() { ensurePlanner(); plannerState.cuatris.push([]); savePlanner(); renderPlanificador(); }
function planRemoveCuatri(idx) { ensurePlanner(); plannerState.cuatris.splice(idx, 1); savePlanner(); renderPlanificador(); }

// Mueve una materia entre cuatris / paleta. from y to: índice numérico o 'palette'. k = comisión elegida
function planMoveMateria(from, cod, to, k = null) {
  ensurePlanner();
  cod = +cod;
  if (from !== 'palette' && from != null) {
    plannerState.cuatris[from] = (plannerState.cuatris[from] || []).filter(e => +e.c !== cod);
  }
  if (to !== 'palette' && to != null) {
    if (!Array.isArray(plannerState.cuatris[to])) plannerState.cuatris[to] = [];
    if (!cuatriHas(to, cod)) plannerState.cuatris[to].push({ c: cod, k });
    else if (k != null) plannerState.cuatris[to].find(e => +e.c === cod).k = k;
  }
  savePlanner(); renderPlanificador();
}

// Soltar una materia en una celda (día+turno): elige la comisión que cae ahí
function planPlaceInCell(from, cod, toIdx, dia, turno) {
  const fr = franjasSet();
  const match = comisionParaCelda(cod, dia, turno, fr);
  if (!match) return false;                 // esa materia no tiene comisión en esa celda
  planMoveMateria(from, cod, toIdx, match.idx);
  return true;
}

// Conjunto de materias en conflicto dentro de un cuatri (según comisión elegida)
function conflictosCuatri(entries, fr) {
  const chosen = entries.map(e => entryComision(e, fr));
  const set = new Set();
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      if (chosen[i] && chosen[j] && comisionesSolapan(chosen[i], chosen[j])) { set.add(+entries[i].c); set.add(+entries[j].c); }
    }
  }
  return { set, chosen };
}

let dragData = null;       // { cod, from }
let palFilter = '';        // texto del buscador de la paleta

function fmtAnios(n) { const a = n / 2; return a % 1 ? a.toFixed(1) : String(a); }

function syncPlanControles() {
  ensurePlanner();
  const per = document.getElementById('plan-per-sem');
  const start = document.getElementById('plan-start');
  if (per) per.value = plannerState.perSem;
  if (start) start.value = plannerState.startCuatri;
  document.querySelectorAll('.franja-chk').forEach(chk => {
    chk.checked = plannerState.franjas.includes(chk.value);
  });
}

function renderPlanificador() {
  const out = document.getElementById('plan-output');
  const sum = document.getElementById('plan-summary');
  if (!out || !sum || !planData.length) return;
  ensurePlanner();
  if (!dependentsOf) buildDependents();
  syncPlanControles();

  const fr = franjasSet();
  const pend = planData.filter(i => !planMateriaHecha(i));
  const coloc = new Set(); plannerState.cuatris.forEach(a => (a || []).forEach(c => coloc.add(+c)));
  const sinUbicar = pend.filter(i => !coloc.has(i.codigo)).length;
  const nCuatri = plannerState.cuatris.filter(a => a && a.length).length;

  sum.innerHTML = `
    <div class="plan-card-sum">
      <div><span class="plan-big">${pend.length}</span><span class="plan-sub">materias por cursar</span></div>
      <div><span class="plan-big">${nCuatri}</span><span class="plan-sub">cuatrimestres (~${fmtAnios(nCuatri)} años)</span></div>
      <div><span class="plan-big">${sinUbicar}</span><span class="plan-sub">sin ubicar</span></div>
    </div>`;

  const cursandoSet = new Set(planData.filter(i => i.estado === 'cursando').map(i => i.codigo));
  const proxIdx = cursandoSet.size ? 1 : 0;

  // ── Columna izquierda: cuatrimestres como grilla turnos × días ──
  let cols = '';
  if (!plannerState.cuatris.length) {
    cols = `<div class="plan-empty">Arrastrá materias desde la derecha a la grilla, tocá <b>+ Cuatrimestre</b> para sumar uno, o <b>Calcular plan óptimo</b> para generarlo automáticamente.</div>`;
  }
  plannerState.cuatris.forEach((entries, idx) => {
    const tipo = planCuatriTipo(idx);
    const done = planDoneHasta(idx);
    const { set: conflictSet, chosen } = conflictosCuatri(entries, fr);
    const actual = idx === 0 && entries.length && entries.every(e => cursandoSet.has(+e.c));

    // Ubicar cada materia en celdas (día|turno) según su comisión elegida
    const cellMap = {}; const sinHorario = [];
    entries.forEach((entry, i) => {
      const item = planData.find(m => m.codigo === +entry.c); if (!item) return;
      const com = chosen[i];
      const horas = (com && !com._virtual) ? (com.horarios || []).filter(h => h.inicio) : [];
      if (!horas.length) { sinHorario.push({ entry, item }); return; }
      horas.forEach(h => { const key = h.dia + '|' + franjaDeHorario(h); (cellMap[key] = cellMap[key] || []).push({ item, h }); });
    });

    const cuerpo = GRID_TURNOS.map(([t, tl]) => {
      const celdas = GRID_DIAS.map(([d]) => {
        const here = cellMap[d + '|' + t] || [];
        const chips = here.map(({ item, h }) => {
          const conf = conflictSet.has(+item.codigo);
          return `<div class="gchip${conf ? ' gchip--conflict' : ''}" draggable="true" data-codigo="${item.codigo}" data-from="${idx}" title="${escAttr(item.materia)}">
            <span class="gchip__name">${escAttr(item.materia)}</span>
            <span class="gchip__time">${String(h.inicio).slice(0, 5)}–${String(h.fin).slice(0, 5)}</span>
            <button class="gchip__del" data-del="${idx}|${item.codigo}" title="Quitar">✕</button>
          </div>`;
        }).join('');
        return `<td class="gcell" data-cell="${idx}|${d}|${t}">${chips}</td>`;
      }).join('');
      return `<tr><th class="grow">${tl}</th>${celdas}</tr>`;
    }).join('');

    const stripChips = sinHorario.map(({ entry, item }) => {
      const sinComision = comisionesValidas(item.codigo, fr).length === 0;
      const corrOk = (correlativas[item.codigo] || []).every(p => done.has(p));
      const ofreceTipo = item.cuatri === tipo || item.cuatri === 'Transversal';
      const motivos = [];
      if (sinComision) motivos.push('sin comisión en esas franjas');
      if (!corrOk) motivos.push('correlativas pendientes');
      if (!ofreceTipo) motivos.push('no se ofrece en ' + tipo);
      const cls = sinComision ? ' plan-chip--conflict' : (motivos.length ? ' plan-chip--warn' : '');
      const ce = entryComision(entry, fr);
      const etq = (ce && ce._virtual) ? 'a distancia / sin horario' : (sinComision ? 'sin franja' : 'a distancia');
      return `<div class="plan-chip${cls}" draggable="true" data-codigo="${item.codigo}" data-from="${idx}" title="${escAttr(item.materia)}${motivos.length ? ' — ' + motivos.join(', ') : ''}">
        <span class="plan-chip__name">${escAttr(item.materia)}</span>
        <span class="plan-chip__hor">${etq}</span>
        <button class="plan-chip__del" data-del="${idx}|${item.codigo}" title="Quitar">✕</button>
      </div>`;
    }).join('');

    let cls = '';
    if (actual) cls = ' plan-sem--actual';
    else if (idx === proxIdx) cls = ' plan-sem--next';
    if (conflictSet.size) cls += ' plan-sem--choque';

    cols += `
      <div class="plan-sem${cls}" data-drop="${idx}">
        <div class="plan-sem__head">
          <span class="plan-sem__n">Cuatrimestre ${idx + 1}${actual ? ' · en curso' : (idx === proxIdx ? ' · próximo' : '')} <span class="plan-sem__cuatri">${tipo}</span></span>
          <div class="plan-sem__actions">
            <button class="btn btn--ghost btn--sm" data-opt="${idx}">Optimizar</button>
            <button class="icon-btn" data-delcuatri="${idx}" title="Eliminar cuatrimestre">✕</button>
          </div>
        </div>
        ${conflictSet.size ? `<div class="plan-choque">⚠️ Hay materias que se superponen en día/horario (en rojo).</div>` : ''}
        <div class="grid-wrap">
          <table class="cuatri-grid">
            <thead><tr><th></th>${GRID_DIAS.map(([, l]) => `<th>${l}</th>`).join('')}</tr></thead>
            <tbody>${cuerpo}</tbody>
          </table>
        </div>
        ${sinHorario.length ? `<div class="plan-sinhorario" data-drop="${idx}"><span class="plan-sinhorario__lbl">Sin horario fijo:</span>${stripChips}</div>` : ''}
      </div>`;
  });

  // ── Columna derecha: paleta de materias disponibles ──
  const f = palFilter.trim().toLowerCase();
  const disponibles = pend.filter(i => !coloc.has(i.codigo))
    .filter(i => !f || i.materia.toLowerCase().includes(f) || String(i.codigo).includes(f))
    .sort((a, b) => a.anio - b.anio || a.codigo - b.codigo);
  const palItems = disponibles.map(it => {
    const sinComision = comisionesValidas(it.codigo, fr).length === 0;
    const st = displayStatus(it);
    const slots = slotsMateria(it.codigo, fr);
    const slotsHtml = slots.length
      ? `<span class="pal-materia__slots">${slots.map(s => `<span class="pal-slot">${s}</span>`).join('')}</span>`
      : (sinComision ? `<span class="pal-materia__slots"><span class="pal-slot pal-slot--no">sin franja</span></span>` : '');
    return `<div class="pal-materia pal-materia--${st}${sinComision ? ' pal-materia--nofranja' : ''}" draggable="true" data-codigo="${it.codigo}" data-from="palette" title="${escAttr(it.materia)} — ${ESTADO_LABEL[it.estado] || st}${sinComision ? ' · sin comisión en esas franjas' : ''}">
      <span class="pal-materia__top"><i class="pal-dot"></i><span class="pal-materia__name">${escAttr(it.materia)}</span></span>
      <span class="pal-materia__meta">${it.codigo} · ${it.cuatri === 'Transversal' ? 'Trans.' : it.anio + '° ' + it.cuatri}</span>
      ${slotsHtml}
    </div>`;
  }).join('');

  out.innerHTML = `
    <div class="plan-board">
      <div class="plan-cols" id="plan-cols">${cols}</div>
      <aside class="plan-palette" data-drop="palette">
        <div class="plan-palette__head">
          <span>Materias disponibles <b>${disponibles.length}</b></span>
          <input id="plan-pal-search" class="pal-search" type="search" placeholder="Buscar…" value="${escAttr(palFilter)}">
        </div>
        <div class="pal-list" id="pal-list">${palItems || '<span class="plan-drop-hint" style="padding:10px">No quedan materias disponibles. Arrastrá una acá para sacarla de un cuatrimestre.</span>'}</div>
      </aside>
    </div>`;
  bindPlanEvents();
}

function bindPlanEvents() {
  const out = document.getElementById('plan-output');

  out.querySelectorAll('[data-opt]').forEach(b => b.addEventListener('click', () => optimizarCuatri(+b.dataset.opt)));
  out.querySelectorAll('[data-delcuatri]').forEach(b => b.addEventListener('click', () => planRemoveCuatri(+b.dataset.delcuatri)));
  out.querySelectorAll('.gchip__del, .plan-chip__del').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    const [idx, cod] = b.dataset.del.split('|');
    planRemoveMateria(+idx, +cod);
  }));
  out.querySelectorAll('.gchip, .plan-chip, .pal-materia').forEach(el => el.addEventListener('click', e => {
    if (e.target.closest('.gchip__del, .plan-chip__del')) return;
    openModal(parseInt(el.dataset.codigo, 10));
  }));

  // Drag & drop
  out.querySelectorAll('[draggable="true"]').forEach(el => {
    el.addEventListener('dragstart', e => {
      const from = el.dataset.from === 'palette' ? 'palette' : +el.dataset.from;
      dragData = { cod: +el.dataset.codigo, from };
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', String(el.dataset.codigo)); } catch {}
    });
    el.addEventListener('dragend', () => { el.classList.remove('dragging'); dragData = null; });
  });

  // Celdas de la grilla: ubican la materia en ese día+turno (eligen comisión)
  out.querySelectorAll('.gcell').forEach(cell => {
    cell.addEventListener('dragover', e => { e.preventDefault(); cell.classList.add('drag-over'); });
    cell.addEventListener('dragleave', () => cell.classList.remove('drag-over'));
    cell.addEventListener('drop', e => {
      e.preventDefault(); e.stopPropagation(); cell.classList.remove('drag-over');
      if (!dragData) return;
      const [idx, dia, turno] = cell.dataset.cell.split('|');
      const ok = planPlaceInCell(dragData.from, dragData.cod, +idx, dia, turno);
      if (!ok) { cell.classList.add('cell-reject'); setTimeout(() => cell.classList.remove('cell-reject'), 350); }
      dragData = null;
    });
  });

  // Zonas genéricas (paleta, "sin horario") con asignación automática / quitar
  out.querySelectorAll('[data-drop]').forEach(zone => {
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
      e.preventDefault(); e.stopPropagation();
      zone.classList.remove('drag-over');
      if (!dragData) return;
      const dest = zone.dataset.drop === 'palette' ? 'palette' : +zone.dataset.drop;
      if (dragData.from === dest && dest === 'palette') return;
      planMoveMateria(dragData.from, dragData.cod, dest);
      dragData = null;
    });
  });

  const search = document.getElementById('plan-pal-search');
  if (search) {
    search.addEventListener('input', e => {
      palFilter = e.target.value;
      const ff = palFilter.trim().toLowerCase();
      document.querySelectorAll('#pal-list .pal-materia').forEach(el => {
        const txt = el.textContent.toLowerCase();
        el.style.display = (!ff || txt.includes(ff)) ? '' : 'none';
      });
    });
  }
}

function initPlanificador() {
  const per = document.getElementById('plan-per-sem');
  const start = document.getElementById('plan-start');
  const calc = document.getElementById('plan-calc');
  const addC = document.getElementById('plan-add-cuatri');
  if (per) per.addEventListener('change', () => { ensurePlanner(); plannerState.perSem = Math.max(1, Math.min(12, parseInt(per.value, 10) || 6)); savePlanner(); });
  if (start) start.addEventListener('change', () => { ensurePlanner(); plannerState.startCuatri = start.value === '2°C' ? '2°C' : '1°C'; savePlanner(); renderPlanificador(); });
  if (calc) calc.addEventListener('click', optimizarTodo);
  if (addC) addC.addEventListener('click', planAddCuatri);
  document.querySelectorAll('.franja-chk').forEach(chk => chk.addEventListener('change', () => {
    ensurePlanner();
    plannerState.franjas = [...document.querySelectorAll('.franja-chk')].filter(c => c.checked).map(c => c.value);
    if (!plannerState.franjas.length) plannerState.franjas = ['manana', 'tarde', 'noche'];
    savePlanner(); renderPlanificador();
  }));
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
  initPlanificador();
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
