import '../style.css';
import { onAuthStateChanged } from 'firebase/auth';
import { ref, onValue, update, remove, get } from 'firebase/database';
import { auth, db } from '../modules/firebase.js';
import * as XLSX from 'xlsx';
import { clusterSimilar, similarity } from './text-match.js';

const ALLOWED_EMAILS = [
  'nicomastras@gmail.com',
  'dianagasull2@gmail.com',
  'fedemastra22@gmail.com',
  'jorgemastrascusa@gmail.com'
];
const DEFAULT_CATEGORIAS = ['Amigos', 'Familia', 'Trabajo', 'Amigos-Flia'];

// ---------- Arquitectura de datos (simplificada) ----------
// Ya no hay padrón ni importación de listas: la ÚNICA fuente de la lista de
// invitados son las confirmaciones que van llegando por el link público
// (`rsvps/{key}`, nunca se edita ni se borra desde acá) más la capa editable
// `conciliacion/{key}` (etiquetas de lado/categoría, y un flag `archivado`
// que reemplaza al borrado real). "Lista de invitados confirmados" se arma
// sola, una fila por RSVP, a medida que la gente confirma.
//
// Columnas fijas (no se pueden ocultar), en este orden exacto pedido: # →
// Fecha de carga → Nombre → Apellido → Estado → (COLUMNS, ocultables) →
// Acciones → Usuario → Conteo.
const COLUMNS = [
  { key: 'asiste', label: 'Asiste' },
  { key: 'acompanado', label: 'Acompañado' },
  { key: 'restricciones', label: 'Restricciones' },
  { key: 'cancion', label: 'Música' },
  { key: 'lado', label: 'De parte de' },
  { key: 'categoria', label: 'Categoría' },
];

let rawRsvps = [];      // [{key, data}] tal cual sale de 'rsvps'
let conciliacion = {};  // { [key]: {tagLado, tagCategoria, archivado, usuario, fechaCarga} }
let confirmados = [];   // una fila por RSVP, ver computeConfirmados()
let totalInvitados = 300;

let colVisibles = new Set(['nombre', 'apellido', 'asiste', 'acompanado', 'restricciones', 'cancion', 'lado', 'categoria']);
let agruparPor = ['lado', 'categoria'];
let ordenarPor = [];
let gruposColapsados = new Set();
let filtro = { texto: '', lado: '', categoria: '', kpi: '', soloDuplicados: false, mostrarArchivados: false };
// Filas con acompañante: colapsada por default (1 fila, conteo 2); acá se
// guarda qué keys están desplegadas mostrando al acompañante como fila
// aparte (conteo 1 + 1).
let expandidosAcomp = new Set();

let mensajes = [];
let filtroMuro = '';

function estadoBadge(r) {
  if (r.esDuplicado) return '<span class="dash-tag badge-dup">⚠ Posible duplicado</span>';
  return '<span class="dash-tag badge-ok">✓ OK</span>';
}

const ICON_EYE_CLOSED = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12c3.2-2.8 6.4-4.2 9.5-4.2s6.3 1.4 9.5 4.2"/></svg>';
const ICON_EYE_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.7-7 10-7 10 7 10 7-3.7 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';

// El ícono refleja el ESTADO DE LOS DATOS (¿hay algún duplicado detectado en
// toda la tabla, sin filtrar?), no si el filtro está prendido — se pidió así
// a propósito: es un indicador pasivo, avisa aunque el admin no esté
// filtrando en ese momento. El click (ver setupDuplicadosToggle) sólo
// prende/apaga el filtro que muestra esas filas.
function actualizarIconoDuplicados() {
  const btn = document.getElementById('toggleDuplicados');
  if (!btn) return;
  const hay = confirmados.some((r) => !r.archivado && (r.esDuplicado || r.acompanante?.esDuplicado));
  btn.innerHTML = hay ? ICON_EYE_OPEN : ICON_EYE_CLOSED;
  btn.classList.toggle('tiene-duplicados', hay);
}

// El checkbox "Solo posibles duplicados" del popover de filtro y el ícono
// ojo controlan el mismo filtro.soloDuplicados — cualquiera de los dos que
// se toque, el otro se sincroniza acá para que no queden desalineados.
function syncDuplicadosUI() {
  const chk = document.getElementById('filterDuplicadosConf');
  if (chk) chk.checked = filtro.soloDuplicados;
  document.getElementById('toggleDuplicados')?.classList.toggle('is-active', filtro.soloDuplicados);
}

function setupDuplicadosToggle() {
  document.getElementById('toggleDuplicados')?.addEventListener('click', () => {
    filtro.soloDuplicados = !filtro.soloDuplicados;
    syncDuplicadosUI();
    render();
  });
}

const ORDEN_GRUPO = {
  lado: ['nico', 'diana'],
  categoria: DEFAULT_CATEGORIAS,
};
function compararValorGrupo(key, a, b) {
  const orden = ORDEN_GRUPO[key];
  if (!orden) return a.localeCompare(b, 'es', { sensitivity: 'base' });
  const ia = orden.indexOf(a), ib = orden.indexOf(b);
  if (ia === -1 && ib === -1) return a.localeCompare(b, 'es', { sensitivity: 'base' });
  if (ia === -1) return 1;
  if (ib === -1) return -1;
  return ia - ib;
}

// ---------- Popovers de la barra de herramientas ----------
// backdrop-filter en un ancestro (.dash-card) convierte a position:fixed de
// cualquier descendiente en "fixed respecto de ESE ancestro" en vez de la
// ventana — por eso viven sueltos al final del <body> (ver admin.html) y la
// posición la calcula acá contra getBoundingClientRect() del botón. Se
// pidió centrados en pantalla, no pegados al botón.
const popoversToolbar = [];
function registrarPopover(btn, pop) {
  popoversToolbar.push({ btn, pop });
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const estabaAbierto = !pop.classList.contains('hidden');
    cerrarPopovers();
    if (!estabaAbierto) abrirPopover(btn, pop);
  });
}

function abrirPopover(btn, pop) {
  // inset:0 + margin:auto en vez de top/left:50%+translate: la animación
  // .pop-in también anima `transform`, y su 100% pone `transform: none` —
  // eso pisaría un translate hecho a mano apenas termina la entrada.
  pop.style.inset = '0';
  pop.style.margin = 'auto';
  pop.classList.remove('hidden');
  document.getElementById('popoverBackdrop')?.classList.remove('hidden');
}

function cerrarPopovers() {
  popoversToolbar.forEach(({ pop }) => pop.classList.add('hidden'));
  document.getElementById('popoverBackdrop')?.classList.add('hidden');
}

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-popover-close]')) { cerrarPopovers(); return; }
  if (e.target.closest('[data-popover-apply]')) {
    render();
    renderMuro();
    cerrarPopovers();
  }
});

document.getElementById('popoverBackdrop')?.addEventListener('click', cerrarPopovers);
document.addEventListener('click', (e) => {
  const dentroDeAlguno = popoversToolbar.some(({ btn, pop }) => btn.contains(e.target) || pop.contains(e.target));
  if (!dentroDeAlguno) cerrarPopovers();
});

document.addEventListener('DOMContentLoaded', () => {
  const loader = document.getElementById('loader');
  const dashboard = document.getElementById('dashboard');

  onAuthStateChanged(auth, (user) => {
    if (user && ALLOWED_EMAILS.includes(user.email)) {
      loader.classList.add('hidden');
      dashboard.classList.remove('hidden');
      setupTotalInvitados();
      setupRealtimeData();
      setupFiltros();
      setupKpiFilters();
      setupEditModal();
      setupCategoriaPopover();
      setupExport();
      setupColumnas();
      setupAgrupar();
      setupOrdenar();
      setupWidgetNav();
      setupDuplicadosToggle();
      setupMuro();
      try { filtro.kpi = sessionStorage.getItem('adminFiltroKpi') || ''; } catch { /* noop */ }
      syncKpiActiveState();
      refrescarDesdeServidor();
    } else {
      alert('No tienes acceso a esta página.');
      window.location.href = '/';
    }
  });
});

// ---------- Nombre y apellido ----------
function splitNombreApellido(full) {
  const cap = (w) => w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : ''
  const partes = String(full || '').trim().split(/\s+/).filter(Boolean)
  if (partes.length === 0) return { nombre: '', apellido: '' }
  if (partes.length === 1) return { nombre: cap(partes[0]), apellido: '' }
  return { nombre: cap(partes[0]), apellido: partes.slice(1).map(cap).join(' ') }
}

function numPersonas(tipoAcompanante) {
  return tipoAcompanante === 'pareja' ? 2 : 1
}

function fmtFecha(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// ---------- KPI: total de invitados (editable) ----------
function setupTotalInvitados() {
  onValue(ref(db, 'meta/totalInvitados'), (snap) => {
    totalInvitados = snap.exists() ? Number(snap.val()) : 300;
    document.getElementById('kpiTotal').textContent = totalInvitados;
    recalcularKpis();
  });

  document.getElementById('kpiEdit').addEventListener('click', (e) => {
    e.stopPropagation();
    const nuevo = prompt('Total de invitados (personas):', totalInvitados);
    if (nuevo === null) return;
    const n = parseInt(nuevo, 10);
    if (!Number.isFinite(n) || n < 0) return alert('Ingresá un número válido.');
    update(ref(db, 'meta'), { totalInvitados: n });
  });
}

// ---------- RSVPs ----------
function setupRealtimeData() {
  onValue(ref(db, 'rsvps'), () => refrescarDesdeServidor(), (error) => {
    console.error('Error obteniendo datos en tiempo real: ', error);
  });
  onValue(ref(db, 'conciliacion'), () => refrescarDesdeServidor());
}

let refrescando = false;
let refrescoPendiente = false;

async function refrescarDesdeServidor(reintento = 0) {
  if (refrescando) { refrescoPendiente = true; return; }
  refrescando = true;
  try {
    const [rRsvps, rConc] = await Promise.allSettled([
      get(ref(db, 'rsvps')), get(ref(db, 'conciliacion')),
    ]);

    const fallos = [];
    if (rRsvps.status === 'rejected') fallos.push('rsvps');
    if (rConc.status === 'rejected') fallos.push('conciliacion');

    // "Permission denied" justo después de loguearse (no en uso normal): el
    // token de Firebase Auth recién emitido a veces tarda una fracción de
    // segundo en propagarse al cliente de Realtime Database. Un reintento
    // corto alcanza; si a la segunda vuelve a fallar, ahí sí es un problema
    // real y se muestra el aviso.
    if (fallos.length && reintento === 0) {
      refrescando = false;
      await new Promise((r) => setTimeout(r, 800));
      return refrescarDesdeServidor(1);
    }
    if (fallos.length) console.error('No se pudieron leer estas colecciones:', fallos.join(', '), rRsvps.reason || rConc.reason);

    rawRsvps = [];
    // OJO: snapshot.forEach corta la enumeración si el callback devuelve
    // algo truthy — Array.push() devuelve el nuevo largo, siempre truthy.
    // Por eso el callback va en llaves, sin devolver nada (ver Gabi.md).
    if (rRsvps.status === 'fulfilled' && rRsvps.value.exists()) rRsvps.value.forEach((child) => { rawRsvps.push({ key: child.key, data: child.val() }); });
    conciliacion = (rConc.status === 'fulfilled' && rConc.value.exists()) ? rConc.value.val() : {};

    computeConfirmados();
    actualizarCategoriasConocidas();
    recalcularKpis();
    renderRanking();
    actualizarIconoDuplicados();
    render();

    const chip = document.getElementById('activeFilterChip');
    if (fallos.length && chip) {
      chip.textContent = `⚠ No se pudo leer: ${fallos.join(', ')} — revisá las Reglas de Firebase o tu conexión.`;
      chip.classList.remove('hidden');
    }
  } finally {
    refrescando = false;
    if (refrescoPendiente) { refrescoPendiente = false; refrescarDesdeServidor(); }
  }
}

// Una fila por RSVP. Si vino "En Pareja" con nombre de acompañante cargado,
// esa persona queda anidada en r.acompanante (no es una fila aparte en
// Firebase) — filaHtml() decide si se muestra colapsada (1 fila, conteo 2)
// o desplegada (2 filas, conteo 1 + 1), ver expandidosAcomp.
function computeConfirmados() {
  try {
    const base = rawRsvps.map(({ key, data }) => {
      const { nombre, apellido } = splitNombreApellido(data.nombre || '');
      const conc = conciliacion[key] || {};
      const asiste = data.asistencia === 'Sí';
      const personas = numPersonas(data.tipoAcompanante);

      let acompanante = null;
      if (data.tipoAcompanante === 'pareja' && data.nombreAcompanante?.trim()) {
        const partesAcomp = splitNombreApellido(data.nombreAcompanante);
        acompanante = {
          nombre: partesAcomp.nombre,
          apellido: partesAcomp.apellido,
          restricciones: data.restriccionesAcompanante || '',
        };
      }

      return {
        key,
        nombre,
        apellido,
        nombreCompleto: `${nombre} ${apellido}`.trim(),
        asiste,
        acompanado: data.tipoAcompanante === 'pareja' ? 'En pareja' : 'Voy solo',
        conteo: asiste ? personas : 0,
        personasRespondieron: personas,
        restricciones: data.restricciones || '',
        cancion: data.cancion || data.mensaje || '',
        // Autocompletado: en cuanto el invitado entra por el link "de parte
        // de Nico/Diana" ese lado queda guardado en el RSVP (data.lado,
        // capturado del selector de la landing) — acá se usa tal cual salvo
        // que un admin lo haya pisado a mano en conciliación.
        lado: conc.tagLado || data.lado || '',
        categoria: conc.tagCategoria || '',
        usuario: conc.usuario || '',
        // Fecha real de cuando confirmó (server timestamp del propio RSVP),
        // no la de una edición posterior del admin.
        fechaCarga: data.createdAt || data.fechaCarga || null,
        archivado: !!conc.archivado,
        acompanante,
      };
    });

    // Duplicados por similitud de texto (mismo algoritmo que matchea nombres
    // contra el padrón en otras partes del proyecto), no por igualdad
    // exacta: agarra "Ana Torres" == "Torres Ana" (orden invertido) y
    // "Fede Mastra" == "Federico Mastrascusa" (nombre abreviado). Se compara
    // contra TODAS las identidades activas — invitados Y acompañantes por
    // igual, cruzados entre sí — no sólo invitado contra invitado.
    base.forEach((r) => { r.esDuplicado = false; if (r.acompanante) r.acompanante.esDuplicado = false; });
    const identidades = [];
    base.filter((r) => !r.archivado).forEach((r) => {
      if (r.nombreCompleto) identidades.push({ nombre: r.nombreCompleto, marcar: () => { r.esDuplicado = true; } });
      if (r.acompanante) {
        const nombreAcomp = `${r.acompanante.nombre} ${r.acompanante.apellido}`.trim();
        if (nombreAcomp) identidades.push({ nombre: nombreAcomp, marcar: () => { r.acompanante.esDuplicado = true; } });
      }
    });
    for (let i = 0; i < identidades.length; i++) {
      for (let j = i + 1; j < identidades.length; j++) {
        if (similarity(identidades[i].nombre, identidades[j].nombre) >= 0.72) {
          identidades[i].marcar();
          identidades[j].marcar();
        }
      }
    }

    confirmados = base;
  } catch (e) {
    console.error('computeConfirmados falló:', e);
  }
}

function recalcularKpis() {
  const activos = confirmados.filter((r) => !r.archivado);
  const asisten = activos.filter((r) => r.asiste === true).reduce((s, r) => s + r.personasRespondieron, 0);
  const noAsisten = activos.filter((r) => r.asiste === false).reduce((s, r) => s + r.personasRespondieron, 0);
  const conRestricciones = activos.filter((r) => (r.restricciones && r.restricciones !== 'Ninguna') || (r.acompanante?.restricciones && r.acompanante.restricciones !== 'Ninguna')).length;

  document.getElementById('kpiAsisten').textContent = asisten;
  document.getElementById('kpiNoAsisten').textContent = noAsisten;
  document.getElementById('kpiRestricciones').textContent = conRestricciones;
}

// ---------- Ranking de temas musicales ----------
function renderRanking() {
  const ol = document.getElementById('songRanking');
  const clusters = clusterSimilar(confirmados.filter((r) => !r.archivado).map((r) => r.cancion)).slice(0, 10);
  if (!clusters.length) {
    ol.innerHTML = '<li class="dash-tag-empty">Todavía nadie pidió un tema.</li>';
    return;
  }
  ol.innerHTML = clusters.map((c, i) => `
    <li class="song-rank-item">
      <span class="song-rank-pos">${i + 1}</span>
      <span class="song-rank-label truncate">${escapeHtml(c.label)}</span>
      <span class="song-rank-count">${c.count}</span>
    </li>
  `).join('');
}

// ---------- Filtro por click en KPI ----------
function setupKpiFilters() {
  document.querySelectorAll('[data-kpi]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const val = btn.dataset.kpi;
      filtro.kpi = filtro.kpi === val ? '' : val;
      filtro.texto = ''; filtro.lado = ''; filtro.categoria = ''; filtro.soloDuplicados = false; filtro.mostrarArchivados = false;
      document.getElementById('filterNombreConf').value = '';
      document.getElementById('filterLadoConf').value = '';
      document.getElementById('filterCategoriaConf').value = '';
      document.getElementById('filterArchivadosConf').checked = false;
      syncDuplicadosUI();
      syncKpiActiveState();
      render();
    });
  });
}

function syncKpiActiveState() {
  try { sessionStorage.setItem('adminFiltroKpi', filtro.kpi || ''); } catch { /* Storage puede estar bloqueado (modo privado); no es crítico. */ }
  document.querySelectorAll('[data-kpi]').forEach((btn) => {
    btn.classList.toggle('is-active', !!filtro.kpi && btn.dataset.kpi === filtro.kpi);
  });
  const chip = document.getElementById('activeFilterChip');
  const etiquetas = { asisten: 'Confirmados', no_asisten: 'No asisten', restricciones: 'Con restricciones' };
  if (filtro.kpi && etiquetas[filtro.kpi]) {
    chip.textContent = `Filtrando por: ${etiquetas[filtro.kpi]} — click en el KPI de nuevo para quitar el filtro`;
    chip.classList.remove('hidden');
  } else {
    chip.classList.add('hidden');
  }
}

// ---------- Filtro inteligente (popover glass) ----------
function setupFiltros() {
  const toggle = document.getElementById('toggleFiltersConf');
  const popover = document.getElementById('filterPopoverConf');
  const input = document.getElementById('filterNombreConf');
  const suggestions = document.getElementById('filterSuggestionsConf');
  const selLado = document.getElementById('filterLadoConf');
  const selCategoria = document.getElementById('filterCategoriaConf');

  registrarPopover(toggle, popover);

  input.addEventListener('input', () => {
    filtro.texto = input.value.trim().toLowerCase();
    renderSugerencias();
    render();
  });
  input.addEventListener('focus', renderSugerencias);

  function renderSugerencias() {
    if (!filtro.texto) return suggestions.classList.add('hidden');
    const matches = confirmados.filter((r) => r.nombreCompleto.toLowerCase().includes(filtro.texto)).slice(0, 8);
    if (!matches.length) return suggestions.classList.add('hidden');

    suggestions.innerHTML = matches.map((r) => `
      <li data-name="${escapeHtml(r.nombreCompleto)}" class="px-4 py-2 text-sm text-dash-cream/80 hover:bg-white/10 cursor-pointer">
        ${escapeHtml(r.nombreCompleto)}
      </li>`).join('');
    suggestions.classList.remove('hidden');

    suggestions.querySelectorAll('li').forEach((li) => {
      li.addEventListener('click', () => {
        input.value = li.dataset.name;
        filtro.texto = li.dataset.name.toLowerCase();
        suggestions.classList.add('hidden');
        render();
      });
    });
  }

  selLado.addEventListener('change', () => { filtro.lado = selLado.value; render(); });
  selCategoria.addEventListener('change', () => { filtro.categoria = selCategoria.value; render(); });

  const chkDuplicados = document.getElementById('filterDuplicadosConf');
  chkDuplicados.addEventListener('change', () => {
    filtro.soloDuplicados = chkDuplicados.checked;
    document.getElementById('toggleDuplicados')?.classList.toggle('is-active', filtro.soloDuplicados);
    render();
  });

  const chkArchivados = document.getElementById('filterArchivadosConf');
  chkArchivados.addEventListener('change', () => { filtro.mostrarArchivados = chkArchivados.checked; render(); });

  document.getElementById('clearFiltersConf').addEventListener('click', () => {
    filtro = { texto: '', lado: '', categoria: '', kpi: filtro.kpi, soloDuplicados: false, mostrarArchivados: false };
    input.value = ''; selLado.value = ''; selCategoria.value = ''; chkArchivados.checked = false;
    syncDuplicadosUI();
    suggestions.classList.add('hidden');
    render();
  });
}

function actualizarCategoriasConocidas() {
  const sel = document.getElementById('filterCategoriaConf');
  if (!sel) return;
  const usadas = new Set(confirmados.map((r) => r.categoria).filter(Boolean));
  const todas = [...new Set([...DEFAULT_CATEGORIAS, ...usadas])];
  const actual = sel.value;
  sel.innerHTML = '<option value="">Categoría: todas</option>' +
    todas.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  sel.value = actual;
}

// ---------- Popover rápido de categoría (celdas "sin etiqueta") ----------
let popoverEntryCategoria = null;
function setupCategoriaPopover() {
  const pop = document.getElementById('categoriaPopover');
  const lista = document.getElementById('categoriaPopoverLista');
  const inputNueva = document.getElementById('categoriaPopoverNueva');

  // Se registra con un `btn` mutable (el trigger real es un botón por fila,
  // que se recrea en cada render) — abrirCategoriaPopover actualiza esta
  // misma entrada con el botón clickeado, así el listener de "click afuera"
  // lo reconoce como "adentro" y no lo cierra apenas se abre.
  popoverEntryCategoria = { btn: document.createElement('button'), pop };
  popoversToolbar.push(popoverEntryCategoria);

  lista.addEventListener('click', (e) => {
    const editBtn = e.target.closest('[data-cat-edit]');
    if (editBtn) return renombrarCategoria(editBtn.dataset.catEdit);
    const delBtn = e.target.closest('[data-cat-delete]');
    if (delBtn) return borrarCategoria(delBtn.dataset.catDelete);
    const chip = e.target.closest('[data-cat]');
    if (!chip) return;
    guardarCategoriaPopover(chip.dataset.cat);
  });
  document.getElementById('categoriaPopoverGuardar').addEventListener('click', () => {
    if (inputNueva.value.trim()) guardarCategoriaPopover(inputNueva.value.trim());
  });
  pop.addEventListener('click', (e) => { if (e.target.closest('[data-popover-close]')) inputNueva.value = ''; });
}

let categoriaPopoverKey = null;
function abrirCategoriaPopover(btn) {
  categoriaPopoverKey = btn.dataset.key;
  const pop = document.getElementById('categoriaPopover');
  const lista = document.getElementById('categoriaPopoverLista');
  renderCategoriaPopoverLista();
  document.getElementById('categoriaPopoverNueva').value = '';
  popoverEntryCategoria.btn = btn;
  abrirPopover(btn, pop);
}

function renderCategoriaPopoverLista() {
  const lista = document.getElementById('categoriaPopoverLista');
  const usadas = new Set(confirmados.map((r) => r.categoria).filter(Boolean));
  const todas = [...new Set([...DEFAULT_CATEGORIAS, ...usadas])];
  lista.innerHTML = todas.map((c) => `
    <div class="dash-tag dash-tag-cat !py-1 !pl-3 !pr-1.5 inline-flex items-center gap-1">
      <button type="button" data-cat="${escapeHtml(c)}" class="hover:opacity-75 transition">${escapeHtml(c)}</button>
      <button type="button" data-cat-edit="${escapeHtml(c)}" title="Renombrar categoría" class="row-icon-btn !p-0.5 [&_svg]:w-3 [&_svg]:h-3">${ICON_EDIT}</button>
      <button type="button" data-cat-delete="${escapeHtml(c)}" title="Eliminar categoría" class="row-icon-btn danger !p-0.5 [&_svg]:w-3 [&_svg]:h-3">${ICON_DELETE}</button>
    </div>`).join('');
}

// Renombrar/eliminar actúa sobre TODAS las filas que ya tienen esa
// categoría asignada (conciliacion.tagCategoria), no sólo sobre la fila
// que abrió el popover — es una acción global sobre la etiqueta.
async function renombrarCategoria(categoriaVieja) {
  const nueva = prompt(`Nuevo nombre para "${categoriaVieja}":`, categoriaVieja);
  if (!nueva || !nueva.trim() || nueva.trim() === categoriaVieja) return;
  const afectados = confirmados.filter((r) => r.categoria === categoriaVieja);
  const updates = {};
  afectados.forEach((r) => { updates[`conciliacion/${r.key}/tagCategoria`] = nueva.trim(); });
  if (Object.keys(updates).length) await update(ref(db), updates);
  renderCategoriaPopoverLista();
  refrescarDesdeServidor();
}

async function borrarCategoria(categoria) {
  const afectados = confirmados.filter((r) => r.categoria === categoria);
  if (!confirm(`¿Eliminar la categoría "${categoria}"? Se le va a sacar la etiqueta a ${afectados.length} invitado(s).`)) return;
  const updates = {};
  afectados.forEach((r) => { updates[`conciliacion/${r.key}/tagCategoria`] = ''; });
  if (Object.keys(updates).length) await update(ref(db), updates);
  renderCategoriaPopoverLista();
  refrescarDesdeServidor();
}

async function guardarCategoriaPopover(categoria) {
  if (!categoriaPopoverKey) return;
  await update(ref(db, `conciliacion/${categoriaPopoverKey}`), {
    tagCategoria: categoria,
    usuario: auth.currentUser?.email || '',
    fechaCarga: Date.now(),
  });
  cerrarPopovers();
  refrescarDesdeServidor();
}

// ---------- Columnas: valor crudo (orden/agrupado) y celda (HTML) ----------
function celdaValor(r, key) {
  if (key === 'asiste') return r.asiste ? 'Sí' : 'No';
  if (key === 'fechaCarga') return r.fechaCarga || 0;
  if (key === 'conteo') return r.conteo;
  return r[key] ?? '';
}

function celdaHtml(r, key) {
  switch (key) {
    case 'nombre': return `<span class="max-w-[100px] sm:max-w-[150px] md:max-w-[200px] truncate inline-block align-middle" title="${escapeHtml(r.nombre)}">${escapeHtml(r.nombre) || '—'}</span>`;
    case 'apellido': return `<span class="max-w-[100px] sm:max-w-[150px] md:max-w-[200px] truncate inline-block align-middle" title="${escapeHtml(r.apellido)}">${escapeHtml(r.apellido) || '—'}</span>`;
    case 'asiste':
      return `<span class="dash-tag" style="${r.asiste ? 'background:rgba(234,76,147,.15);color:var(--color-dash-pink);border:1px solid rgba(234,76,147,.35)' : 'background:rgba(255,255,255,.06);color:rgba(243,233,221,.5)'}">${r.asiste ? 'Sí' : 'No'}</span>`;
    case 'acompanado': {
      if (!r.acompanante) return `<span class="text-dash-cream/70 whitespace-nowrap">${r.acompanado}</span>`;
      const expandido = expandidosAcomp.has(r.key);
      return `<button type="button" data-action="toggle-acomp" data-key="${r.key}" class="inline-flex items-center gap-1.5 text-dash-cream/85 hover:text-dash-pink transition whitespace-nowrap">
        <span>${r.acompanado}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" style="transition:transform .25s var(--ease-apple);transform:rotate(${expandido ? '90' : '0'}deg)"><path d="m9 18 6-6-6-6"/></svg>
      </button>`;
    }
    case 'restricciones':
      return `<span class="text-dash-cream/70 max-w-[120px] md:max-w-[180px] truncate inline-block align-middle" title="${escapeHtml(r.restricciones)}">${escapeHtml(r.restricciones) || '<span class="dash-tag-empty">ninguna</span>'}</span>`;
    case 'cancion':
      return `<span class="text-dash-cream/70 max-w-[120px] md:max-w-[180px] truncate italic inline-block align-middle" title="${escapeHtml(r.cancion)}">${escapeHtml(r.cancion) || '<span class="dash-tag-empty">—</span>'}</span>`;
    case 'lado': return tagLado(r.lado);
    case 'categoria':
      return r.categoria
        ? `<span class="dash-tag dash-tag-cat max-w-[100px] md:max-w-[150px] truncate" title="${escapeHtml(r.categoria)}">${escapeHtml(r.categoria)}</span>`
        : `<button type="button" data-action="pick-categoria" data-key="${r.key}" class="dash-tag-empty hover:text-dash-pink transition underline decoration-dotted underline-offset-2">sin etiqueta</button>`;
    case 'usuario': return `<span class="text-dash-cream/50 text-xs max-w-[100px] md:max-w-[150px] truncate inline-block align-middle" title="${escapeHtml(r.usuario)}">${escapeHtml(r.usuario) || '—'}</span>`;
    default: return '';
  }
}

function etiquetaGrupo(key, valor) {
  if (key === 'lado') return tagLado(valor);
  if (key === 'categoria') return valor ? `<span class="dash-tag dash-tag-cat">${escapeHtml(valor)}</span>` : '<span class="dash-tag-empty">sin etiqueta</span>';
  return escapeHtml(String(valor)) || '<span class="dash-tag-empty">(vacío)</span>';
}

function compararFilas(a, b) {
  for (const { key, dir } of ordenarPor) {
    const va = celdaValor(a, key), vb = celdaValor(b, key);
    const cmp = (typeof va === 'number' && typeof vb === 'number')
      ? va - vb
      : String(va).localeCompare(String(vb), 'es', { sensitivity: 'base' });
    if (cmp) return dir === 'desc' ? -cmp : cmp;
  }
  return 0;
}

function renderThead() {
  const tr = document.getElementById('confTableHead');
  if (!tr) return;
  const ths = [
    '<th class="py-3 px-4 font-normal w-10">#</th>',
    '<th class="py-3 px-4 font-normal">Fecha de carga</th>',
    '<th class="py-3 px-4 font-normal">Nombre</th>',
    '<th class="py-3 px-4 font-normal">Apellido</th>',
    '<th class="py-3 px-4 font-normal">Estado</th>',
  ];
  COLUMNS.forEach((c) => { if (colVisibles.has(c.key)) ths.push(`<th class="py-3 px-4 font-normal">${c.label}</th>`); });
  ths.push(
    '<th class="py-3 px-4 font-normal">Acciones</th>',
    '<th class="py-3 px-4 font-normal">Usuario</th>',
    '<th class="py-3 px-4 font-normal dash-th-conteo">Conteo</th>',
  );
  tr.innerHTML = ths.join('');
}

function accionesHtml(r) {
  return r.archivado
    ? `<button data-action="restaurar" data-key="${r.key}" title="Restaurar" class="row-icon-btn">${ICON_RESTORE}</button>`
    : `
      <button data-action="edit" data-key="${r.key}" title="Editar etiquetas" class="row-icon-btn">${ICON_EDIT}</button>
      <button data-action="archivar" data-key="${r.key}" title="Archivar (no se borra el dato, sólo se oculta)" class="row-icon-btn">${ICON_ARCHIVE}</button>
      ${r.esDuplicado ? `<button data-action="eliminar-duplicado" data-key="${r.key}" title="Borrar de verdad — sólo para duplicados" class="row-icon-btn danger">${ICON_DELETE}</button>` : ''}
    `;
}

// Columnas que se pidió COMBINAR (rowspan=2, una sola celda para las dos
// filas) cuando el acompañante está desplegado — todas menos Nombre,
// Apellido, Restricciones, Acompañado y Conteo, que sí difieren entre
// titular y acompañante y quedan una por fila.
const MERGE_COLS_ACOMP = new Set(['asiste', 'cancion', 'lado', 'categoria']);

// `numero` es la posición en la lista ya ordenada/filtrada (ver numeroMap en
// render()). Si la fila tiene acompañante y está desplegada, se devuelven
// DOS <tr> pegados (padre + acompañante) para garantizar que queden
// adyacentes sin importar el agrupado/orden activo — ver agruparYRenderizar.
function filaHtml(r, numero) {
  const nombreCols = COLUMNS.filter((c) => colVisibles.has(c.key));
  const tituloDup = r.esDuplicado ? 'title="Posible duplicado: hay otro RSVP activo con el mismo nombre y apellido"' : '';
  const expandido = !!r.acompanante && expandidosAcomp.has(r.key);
  const conteoPadre = r.acompanante ? (expandido ? (r.asiste ? 1 : 0) : r.conteo) : r.conteo;
  // Estado combinado cuando está desplegado: si cualquiera de los dos
  // (titular o acompañante) es un posible duplicado, la celda compartida lo
  // muestra — es una sola celda, no puede mostrar dos insignias distintas.
  const estadoCompartido = expandido && r.acompanante?.esDuplicado && !r.esDuplicado
    ? estadoBadge({ esDuplicado: true })
    : estadoBadge(r);
  const rs = expandido ? ' rowspan="2"' : '';

  const celdasPadre = nombreCols.map((c) => {
    const merge = expandido && MERGE_COLS_ACOMP.has(c.key);
    return `<td class="py-3 px-4"${merge ? ' rowspan="2"' : ''}>${celdaHtml(r, c.key)}</td>`;
  }).join('');

  const filaPadre = `
    <tr class="guest-row ${r.esDuplicado ? 'row-duplicado' : ''} ${r.archivado ? 'opacity-50' : ''}" ${tituloDup}>
      <td class="py-3 px-4 text-xs opacity-50">${numero ?? ''}</td>
      <td class="py-3 px-4 text-xs whitespace-nowrap opacity-70"${rs}>${fmtFecha(r.fechaCarga)}</td>
      <td class="py-3 px-4">${celdaHtml(r, 'nombre')}</td>
      <td class="py-3 px-4">${celdaHtml(r, 'apellido')}</td>
      <td class="py-3 px-4 whitespace-nowrap"${rs}>${estadoCompartido}</td>
      ${celdasPadre}
      <td class="py-3 px-4 whitespace-nowrap"${rs}>${accionesHtml(r)}</td>
      <td class="py-3 px-4"${rs}>${celdaHtml(r, 'usuario')}</td>
      <td class="py-3 px-4 dash-td-conteo">${conteoPadre}</td>
    </tr>`;

  if (!expandido) return filaPadre;

  // Fila del acompañante: sólo lleva las columnas que NO se combinaron
  // arriba (Nombre, Apellido, Restricciones, Acompañado, Conteo) — el resto
  // ya está cubierto por el rowspan de la fila del titular. No es un
  // registro propio en Firebase, así que no lleva acciones ni usuario.
  const acomp = r.acompanante;
  const celdasAcomp = nombreCols.map((c) => {
    if (MERGE_COLS_ACOMP.has(c.key)) return ''; // cubierta por el rowspan de arriba
    if (c.key === 'restricciones') return `<td class="py-3 px-4">${acomp.restricciones ? `<span class="text-dash-cream/70">${escapeHtml(acomp.restricciones)}</span>` : '<span class="dash-tag-empty">ninguna</span>'}</td>`;
    if (c.key === 'acompanado') return `<td class="py-3 px-4"><span class="dash-tag-empty">acompañante</span></td>`;
    return '';
  }).join('');

  const filaAcomp = `
    <tr class="guest-row guest-row-acomp ${acomp.esDuplicado ? 'row-duplicado' : ''} ${r.archivado ? 'opacity-50' : ''}">
      <td class="py-3 px-4 text-xs opacity-50">${numero != null ? `${numero}B` : ''}</td>
      <td class="py-3 px-4">${escapeHtml(acomp.nombre) || '—'}</td>
      <td class="py-3 px-4">${escapeHtml(acomp.apellido) || '—'}</td>
      ${celdasAcomp}
      <td class="py-3 px-4 dash-td-conteo">${r.asiste ? 1 : 0}</td>
    </tr>`;

  return filaPadre + filaAcomp;
}

const ICON_CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="chevron-icon"><path d="m9 18 6-6-6-6"/></svg>';

// Agrupado recursivo: un nivel por columna elegida, en el orden en que se
// clickearon. Cada grupo muestra un renglón separador plegable con
// subtotal; colapsado no renderiza sus filas/subgrupos.
function agruparYRenderizar(filas, niveles, depth, colspan, rutaPadre, numeroMap, gruposColapsadosSet, filaFn) {
  if (!niveles.length) return filas.map((r) => filaFn(r, numeroMap.get(r.key))).join('');

  const [key, ...resto] = niveles;
  const grupos = new Map();
  filas.forEach((r) => {
    const k = String(celdaValor(r, key));
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(r);
  });

  const valoresOrdenados = [...grupos.keys()].sort((a, b) => compararValorGrupo(key, a, b));

  let html = '';
  for (const valor of valoresOrdenados) {
    const filasGrupo = grupos.get(valor);
    const ruta = `${rutaPadre}${key}:${valor}>`;
    const colapsado = gruposColapsadosSet.has(ruta);
    const subtotalConteo = filasGrupo.reduce((s, r) => s + (r.conteo || 0), 0);
    html += `
      <tr class="group-header-row cursor-pointer" data-group-path="${escapeHtml(ruta)}">
        <td colspan="${colspan}" class="py-3 px-4" style="padding-left:${20 + depth * 22}px">
          <span class="inline-flex items-center gap-2">
            ${ICON_CHEVRON.replace('chevron-icon', `chevron-icon ${colapsado ? '' : 'is-open'}`)}
            <span class="font-display text-base">${etiquetaGrupo(key, valor)}</span>
          </span>
          <span class="group-subtotal">${filasGrupo.length} inv. · conteo ${subtotalConteo}</span>
        </td>
      </tr>`;
    if (!colapsado) html += agruparYRenderizar(filasGrupo, resto, depth + 1, colspan, ruta, numeroMap, gruposColapsadosSet, filaFn);
  }
  return html;
}

function render() {
  const tbody = document.getElementById('confTable');
  if (!tbody) return;
  renderThead();

  const kpiPred = {
    asisten: (r) => r.asiste === true,
    no_asisten: (r) => r.asiste === false,
    restricciones: (r) => (r.restricciones && r.restricciones !== 'Ninguna') || (r.acompanante?.restricciones && r.acompanante.restricciones !== 'Ninguna'),
  }[filtro.kpi];

  let filtrados = confirmados.filter((r) => {
    if (filtro.mostrarArchivados) { if (!r.archivado) return false; }
    else if (r.archivado) return false;
    if (kpiPred && !kpiPred(r)) return false;
    if (filtro.soloDuplicados && !r.esDuplicado && !r.acompanante?.esDuplicado) return false;
    if (filtro.texto && !r.nombreCompleto.toLowerCase().includes(filtro.texto)) return false;
    if (filtro.lado && r.lado !== filtro.lado) return false;
    if (filtro.categoria && r.categoria !== filtro.categoria) return false;
    return true;
  });

  const colspan = 8 + colVisibles.size; // # + fecha + nombre + apellido + estado + acciones + usuario + conteo

  if (!filtrados.length) {
    tbody.innerHTML = `<tr><td colspan="${colspan}" class="py-8 px-4 text-center text-dash-cream/30 italic">${confirmados.length ? 'Nadie con ese filtro' : 'Todavía no hay confirmaciones — compartí el link para que empiecen a llegar.'}</td></tr>`;
    return;
  }

  filtrados = [...filtrados].sort(compararFilas);
  const numeroMap = new Map(filtrados.map((r, i) => [r.key, i + 1]));

  if (agruparPor.length) {
    const totalConteo = filtrados.reduce((s, r) => s + (r.conteo || 0), 0);
    tbody.innerHTML = agruparYRenderizar(filtrados, agruparPor, 0, colspan, '', numeroMap, gruposColapsados, filaHtml) + `
      <tr class="group-total-row">
        <td colspan="${colspan}" class="py-3.5 px-4 font-display text-lg">TOTAL — ${filtrados.length} invitados · conteo ${totalConteo}</td>
      </tr>`;
  } else {
    tbody.innerHTML = filtrados.map((r) => filaHtml(r, numeroMap.get(r.key))).join('');
  }

  tbody.querySelectorAll('[data-action="edit"]').forEach((btn) => btn.addEventListener('click', () => abrirEdicion(btn.dataset.key)));
  tbody.querySelectorAll('[data-action="pick-categoria"]').forEach((btn) => btn.addEventListener('click', () => abrirCategoriaPopover(btn)));
  tbody.querySelectorAll('[data-action="archivar"]').forEach((btn) => btn.addEventListener('click', () => archivarRegistro(btn.dataset.key)));
  tbody.querySelectorAll('[data-action="restaurar"]').forEach((btn) => btn.addEventListener('click', () => restaurarRegistro(btn.dataset.key)));
  tbody.querySelectorAll('[data-action="eliminar-duplicado"]').forEach((btn) => btn.addEventListener('click', () => eliminarDuplicado(btn.dataset.key)));
  tbody.querySelectorAll('[data-action="toggle-acomp"]').forEach((btn) => btn.addEventListener('click', () => {
    const key = btn.dataset.key;
    if (expandidosAcomp.has(key)) expandidosAcomp.delete(key);
    else expandidosAcomp.add(key);
    render();
  }));
  tbody.querySelectorAll('.group-header-row').forEach((tr) => tr.addEventListener('click', () => {
    const ruta = tr.dataset.groupPath;
    if (gruposColapsados.has(ruta)) gruposColapsados.delete(ruta);
    else gruposColapsados.add(ruta);
    render();
  }));
}

// ---------- Popover: columnas visibles ----------
function setupColumnas() {
  const btn = document.getElementById('toggleColumnsConf');
  const pop = document.getElementById('columnsPopoverConf');
  const list = document.getElementById('columnsListConf');

  list.innerHTML = COLUMNS.map((c) => `
    <li>
      <label class="flex items-center gap-2 text-sm text-dash-cream/80 cursor-pointer px-2 py-1.5 rounded-lg hover:bg-white/5">
        <input type="checkbox" data-col="${c.key}" ${colVisibles.has(c.key) ? 'checked' : ''}>
        ${c.label}
      </label>
    </li>`).join('');

  list.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.checked) colVisibles.add(cb.dataset.col);
      else colVisibles.delete(cb.dataset.col);
      render();
    });
  });

  registrarPopover(btn, pop);
}

// ---------- Popover: agrupar (multi-columna, en orden de click) ----------
function setupAgrupar() {
  const btn = document.getElementById('toggleGroupConf');
  const pop = document.getElementById('groupPopoverConf');
  const list = document.getElementById('groupListConf');

  const pintar = () => {
    list.innerHTML = COLUMNS.map((c) => {
      const idx = agruparPor.indexOf(c.key);
      const activo = idx >= 0;
      return `<li>
        <button type="button" data-col="${c.key}" class="w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm text-left transition ${activo ? 'bg-[rgba(234,76,147,.15)] text-dash-pink' : 'hover:bg-white/5 text-dash-cream/75'}">
          <span>${c.label}</span>
          ${activo ? `<span class="dash-tag dash-tag-cat">${idx + 1}</span>` : ''}
        </button>
      </li>`;
    }).join('');

    list.querySelectorAll('button').forEach((b) => b.addEventListener('click', (e) => {
      // stopPropagation es necesario, no cosmético: pintar() reconstruye
      // el <ul> con innerHTML, así que el botón clickeado deja de existir
      // en el DOM antes de que el click termine de burbujear — el cierre
      // "click afuera" del popover lo veía como afuera y lo cerraba solo.
      e.stopPropagation();
      const key = b.dataset.col;
      const idx = agruparPor.indexOf(key);
      if (idx >= 0) agruparPor.splice(idx, 1);
      else agruparPor.push(key);
      pintar();
      render();
    }));
  };
  pintar();

  document.getElementById('clearGroupConf').addEventListener('click', () => { agruparPor = []; gruposColapsados.clear(); pintar(); render(); });
  registrarPopover(btn, pop);
}

// ---------- Popover: ordenar (multi-columna, ciclo asc → desc → afuera) ----------
function setupOrdenar() {
  const btn = document.getElementById('toggleSortConf');
  const pop = document.getElementById('sortPopoverConf');
  const list = document.getElementById('sortListConf');

  const pintar = () => {
    list.innerHTML = COLUMNS.map((c) => {
      const idx = ordenarPor.findIndex((o) => o.key === c.key);
      const activo = idx >= 0;
      const flecha = activo ? (ordenarPor[idx].dir === 'asc' ? '↑' : '↓') : '';
      return `<li>
        <button type="button" data-col="${c.key}" class="w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm text-left transition ${activo ? 'bg-[rgba(234,76,147,.15)] text-dash-pink' : 'hover:bg-white/5 text-dash-cream/75'}">
          <span>${c.label}</span>
          ${activo ? `<span class="dash-tag dash-tag-cat">${idx + 1} ${flecha}</span>` : ''}
        </button>
      </li>`;
    }).join('');

    list.querySelectorAll('button').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = b.dataset.col;
      const idx = ordenarPor.findIndex((o) => o.key === key);
      if (idx < 0) ordenarPor.push({ key, dir: 'asc' });
      else if (ordenarPor[idx].dir === 'asc') ordenarPor[idx].dir = 'desc';
      else ordenarPor.splice(idx, 1);
      pintar();
      render();
    }));
  };
  pintar();

  document.getElementById('clearSortConf').addEventListener('click', () => { ordenarPor = []; pintar(); render(); });
  registrarPopover(btn, pop);
}

// ---------- Navegador de widgets (Lista de invitados / Ranking / Muro) ----------
function setupWidgetNav() {
  const panels = {
    confirmados: document.getElementById('widgetConfirmados'),
    ranking: document.getElementById('widgetRanking'),
    muro: document.getElementById('widgetMuro'),
  };
  document.querySelectorAll('#widgetNav [data-widget]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.widget;
      document.querySelectorAll('#widgetNav [data-widget]').forEach((b) => b.classList.toggle('is-active', b === btn));
      Object.entries(panels).forEach(([key, el]) => el?.classList.toggle('hidden', key !== target));
    });
  });
}

// ---------- Muro de mensajes ----------
function setupMuro() {
  onValue(ref(db, 'mensajes'), () => cargarMensajes(), (error) => {
    console.error('Error obteniendo mensajes del muro: ', error);
  });

  const toggleBtn = document.getElementById('toggleMuroFilter');
  const pop = document.getElementById('muroFilterPopover');
  registrarPopover(toggleBtn, pop);

  document.getElementById('filterMuro').addEventListener('input', (e) => {
    filtroMuro = e.target.value.trim().toLowerCase();
    renderMuro();
  });
  document.getElementById('clearMuroFilter').addEventListener('click', () => {
    filtroMuro = '';
    document.getElementById('filterMuro').value = '';
    renderMuro();
  });
}

async function cargarMensajes() {
  try {
    const snap = await get(ref(db, 'mensajes'));
    mensajes = [];
    if (snap.exists()) snap.forEach((child) => { mensajes.push({ key: child.key, ...child.val() }); });
    mensajes.sort((a, b) => (b?.createdAt ?? 0) - (a?.createdAt ?? 0));
    renderMuro();
  } catch (e) {
    console.error('Error cargando mensajes del muro:', e);
  }
}

function renderMuro() {
  const tbody = document.getElementById('muroTable');
  if (!tbody) return;

  const filtrados = mensajes.filter((m) => {
    if (!filtroMuro) return true;
    return `${m.nombre || ''} ${m.mensaje || ''}`.toLowerCase().includes(filtroMuro);
  });

  if (!filtrados.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="py-8 px-4 text-center text-dash-cream/30 italic">${mensajes.length ? 'Nadie con ese filtro' : 'Todavía no hay mensajes en el muro'}</td></tr>`;
    return;
  }

  tbody.innerHTML = filtrados.map((m) => `
    <tr class="border-b border-dash-line/60 align-middle">
      <td class="py-3 px-4 whitespace-nowrap">
        <button data-action="delete-mensaje" data-key="${m.key}" title="Borrar mensaje" class="row-icon-btn danger">${ICON_DELETE}</button>
      </td>
      <td class="py-3 px-4 whitespace-nowrap">${escapeHtml(m.nombre) || '—'}</td>
      <td class="py-3 px-4 max-w-lg">${escapeHtml(m.mensaje) || '—'}</td>
      <td class="py-3 px-4 text-dash-cream/50 text-xs whitespace-nowrap">${fmtFecha(m.createdAt)}</td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-action="delete-mensaje"]').forEach((btn) =>
    btn.addEventListener('click', () => eliminarMensaje(btn.dataset.key)),
  );
}

async function eliminarMensaje(key) {
  const m = mensajes.find((x) => x.key === key);
  if (!confirm(`¿Borrar el mensaje de ${m?.nombre || 'este invitado'}? No se puede deshacer.`)) return;
  await remove(ref(db, `mensajes/${key}`));
}

function tagLado(lado) {
  if (lado === 'nico') return '<span class="dash-tag dash-tag-lado-nico">De parte Nico</span>';
  if (lado === 'diana') return '<span class="dash-tag dash-tag-lado-diana">De parte Diana</span>';
  return '<span class="dash-tag-empty">sin asignar</span>';
}

// ---------- Editar etiquetas ----------
function setupEditModal() {
  const modal = document.getElementById('editModal');
  const form = document.getElementById('editForm');
  const selCategoria = document.getElementById('editCategoria');
  const inputNueva = document.getElementById('editCategoriaNueva');

  selCategoria.addEventListener('change', () => {
    inputNueva.classList.toggle('hidden', selCategoria.value !== '__nueva__');
  });

  document.getElementById('editCancel').addEventListener('click', () => modal.close());
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.close(); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const key = form.dataset.key;
    const tagLado = document.getElementById('editLado').value;
    let tagCategoria = selCategoria.value;
    if (tagCategoria === '__nueva__') tagCategoria = inputNueva.value.trim();

    // A 'conciliacion/{key}', no a 'rsvps/{key}': el RSVP crudo no se toca
    // nunca desde el panel, ver la nota de arquitectura arriba del archivo.
    await update(ref(db, `conciliacion/${key}`), {
      tagLado,
      tagCategoria,
      usuario: auth.currentUser?.email || '',
      fechaCarga: Date.now(),
    });
    modal.close();
    refrescarDesdeServidor();
  });
}

function abrirEdicion(key) {
  const r = confirmados.find((x) => x.key === key);
  if (!r) return;
  const modal = document.getElementById('editModal');
  const form = document.getElementById('editForm');
  form.dataset.key = key;
  document.getElementById('editingName').textContent = r.nombreCompleto || '(sin nombre)';
  document.getElementById('editLado').value = r.lado || '';

  const selCategoria = document.getElementById('editCategoria');
  const inputNueva = document.getElementById('editCategoriaNueva');
  const conocidas = [...selCategoria.options].map((o) => o.value);
  if (r.categoria && !conocidas.includes(r.categoria)) {
    selCategoria.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(r.categoria)}">${escapeHtml(r.categoria)}</option>`);
  }
  selCategoria.value = r.categoria || '';
  inputNueva.value = '';
  inputNueva.classList.add('hidden');

  modal.showModal();
}

// "Eliminar" en el sentido de uso diario, pero técnicamente es un archivado:
// el RSVP original queda intacto en Firebase, sólo se marca para que no
// aparezca en la tabla ni cuente en los KPIs. Reversible desde "Mostrar
// archivados" en el filtro.
async function archivarRegistro(key) {
  const r = confirmados.find((x) => x.key === key);
  if (!confirm(`¿Sacar de la lista a ${r?.nombreCompleto || 'este invitado'}? No se borra el dato — se puede restaurar después desde "Mostrar archivados" en el filtro.`)) return;
  await update(ref(db, `conciliacion/${key}`), {
    archivado: true,
    usuario: auth.currentUser?.email || '',
    fechaCarga: Date.now(),
  });
  refrescarDesdeServidor();
}

async function restaurarRegistro(key) {
  await update(ref(db, `conciliacion/${key}`), { archivado: false });
  refrescarDesdeServidor();
}

// El único borrado real y permanente: sólo disponible en filas que la propia
// app marcó como posible duplicado, para no perder confirmaciones reales
// por error. Borra las dos mitades del par (el crudo y su conciliación).
async function eliminarDuplicado(key) {
  const r = confirmados.find((x) => x.key === key);
  if (!r?.esDuplicado) return;
  if (!confirm(`Esto borra PARA SIEMPRE el RSVP duplicado de ${r.nombreCompleto}. No se puede deshacer. ¿Seguro?`)) return;
  await remove(ref(db, `rsvps/${key}`));
  await remove(ref(db, `conciliacion/${key}`));
  refrescarDesdeServidor();
}

// ---------- Exportar a Excel ----------
function setupExport() {
  const exportXlsxBtn = document.getElementById('exportXlsxBtn');
  exportXlsxBtn?.addEventListener('click', () => exportarTodoXlsx(exportXlsxBtn));
}

async function exportarTodoXlsx(btn) {
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.style.opacity = '.5';

  try {
    const snapMensajes = await get(ref(db, 'mensajes'));
    const mensajesExport = [];
    if (snapMensajes.exists()) snapMensajes.forEach((child) => { mensajesExport.push({ key: child.key, ...child.val() }); });

    const wb = XLSX.utils.book_new();

    const activos = confirmados.filter((r) => !r.archivado);
    const asisten = activos.filter((r) => r.asiste).reduce((acc, r) => acc + r.conteo, 0);
    const noAsisten = activos.filter((r) => !r.asiste).length;
    const conRestricciones = activos.filter((r) => r.restricciones && r.restricciones !== 'Ninguna').length;
    const wsResumen = XLSX.utils.json_to_sheet([
      { KPI: 'Total invitados', Valor: totalInvitados },
      { KPI: 'Confirmados (personas)', Valor: asisten },
      { KPI: 'No asisten (filas)', Valor: noAsisten },
      { KPI: 'Con restricciones alimenticias', Valor: conRestricciones },
      { KPI: 'Posibles duplicados activos', Valor: activos.filter((r) => r.esDuplicado).length },
      { KPI: 'Archivados', Valor: confirmados.filter((r) => r.archivado).length },
      { KPI: 'Exportado', Valor: new Date().toLocaleString('es-AR') },
    ]);
    XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen');

    // A diferencia de la tabla en pantalla (que combina en una sola celda
    // con rowspan las columnas compartidas entre titular y acompañante), el
    // xlsx no soporta celdas combinadas de forma práctica al filtrar/ordenar
    // — se pidió explícitamente que acá vayan como dos filas apiladas, con
    // esos valores compartidos duplicados en ambas.
    const filasInvitados = [];
    confirmados.forEach((r) => {
      const compartido = {
        Asiste: r.asiste ? 'Sí' : 'No',
        Música: r.cancion,
        'De parte de': r.lado === 'nico' ? 'Nico' : r.lado === 'diana' ? 'Diana' : '',
        Categoría: r.categoria,
        Usuario: r.usuario,
        'Fecha de carga': r.fechaCarga ? new Date(r.fechaCarga).toLocaleString('es-AR') : '',
        Archivado: r.archivado ? 'Sí' : '',
      };
      // Conteo: acá ya va desglosado en dos filas cuando hay acompañante, así
      // que cada una cuenta 1 (no r.conteo, que trae el total de la pareja).
      filasInvitados.push({
        Nombre: r.nombre,
        Apellido: r.apellido,
        Restricciones: r.restricciones,
        Acompañado: r.acompanado,
        Conteo: r.acompanante ? (r.asiste ? 1 : 0) : r.conteo,
        ...compartido,
        'Posible duplicado': r.esDuplicado ? 'Sí' : '',
      });
      if (r.acompanante) {
        filasInvitados.push({
          Nombre: r.acompanante.nombre,
          Apellido: r.acompanante.apellido,
          Restricciones: r.acompanante.restricciones || '',
          Acompañado: 'acompañante',
          Conteo: r.asiste ? 1 : 0,
          ...compartido,
          'Posible duplicado': r.acompanante.esDuplicado ? 'Sí' : '',
        });
      }
    });
    const wsInvitados = XLSX.utils.json_to_sheet(filasInvitados);
    XLSX.utils.book_append_sheet(wb, wsInvitados, 'Invitados');

    const wsMensajes = XLSX.utils.json_to_sheet(mensajesExport.map((m) => ({
      Nombre: m.nombre || '',
      Mensaje: m.mensaje || '',
      'Creado (ts)': m.createdAt || '',
    })));
    XLSX.utils.book_append_sheet(wb, wsMensajes, 'Mensajes');

    XLSX.writeFile(wb, `invitados-completo-${new Date().toISOString().slice(0, 10)}.xlsx`);
  } finally {
    btn.disabled = false;
    btn.style.opacity = '';
    btn.innerHTML = original;
  }
}

// ---------- Utilidades ----------
const ICON_EDIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
// Reservado sólo para el borrado real de un duplicado confirmado — en
// cualquier otro lugar de la tabla, "sacar una fila" es archivar (ICON_ARCHIVE).
const ICON_DELETE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>';
const ICON_ARCHIVE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9"/><path d="M10 13h4"/></svg>';
const ICON_RESTORE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>';

function escapeHtml(unsafe) {
  if (!unsafe) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
