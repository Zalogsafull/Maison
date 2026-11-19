/* Maison · Control de pagos BPS y DGI
   Igual que Mis gastos: los datos se guardan primero en el teléfono (funciona sin conexión)
   y se sincronizan con un archivo JSON en Google Drive (permiso drive.file: la app solo ve ese archivo).
   La otra persona recibe el archivo compartido y lo abre una vez con el Picker de Google. */
'use strict';
const CFG = window.MAISON_CONFIG || {};
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const APP_URL = CFG.APP_URL || (location.origin + location.pathname.replace(/index\.html$/, ''));
const FILE_NAME = 'maison-pagos.json';
const MSG_DEF = 'Hola {nombre}! Te comparto la app de control de pagos de BPS y DGI de Maison. Abrí este link, entrá con esta cuenta de Google y tocá Aceptar:\n\n{link}';

const $ = s => document.querySelector(s);
const nf0 = new Intl.NumberFormat('es-UY', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fUSD = v => 'US$ ' + nf2.format(v);
const fUYU = v => '$ ' + nf0.format(v);
const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const MES3 = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
const num = s => { if (s == null) return NaN; s = String(s).trim().replace(/\s/g, ''); if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.'); return parseFloat(s); };
const hoy = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const fFecha = f => { const [y, m, d] = f.split('-'); return +d + ' ' + MES3[+m - 1]; };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const LS = {
  get(k) { try { return JSON.parse(localStorage.getItem('maison.' + k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem('maison.' + k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem('maison.' + k); } catch (e) {} }
};

/* ================= estado local ================= */
// data.movs: cada movimiento lleva t (hora del último cambio). data.borrados: {id: t} para que un borrado también se sincronice.
// personas y mensaje llevan cfgT. Al juntar dos versiones gana siempre el cambio más nuevo.
let data = norm(LS.get('datos')), movs = [], vista = 'res', puedeEditar = true, editId = null;
let fileId = LS.get('fileId'), fileMeta = LS.get('fileMeta'), userEmail = LS.get('email');
const S = { token: null, exp: 0, pendiente: !!LS.get('pendiente'), sinc: false, toque: false, error: '', timer: null };
try { const t = LS.get('token'); if (t && t.t && t.e > Date.now()) { S.token = t.t; S.exp = t.e; } } catch (e) {}
function norm(d) {
  d = Object.assign({ app: 'maison-pagos', version: 2, movs: [], borrados: {}, personas: [], mensaje: null, cfgT: 0 }, d || {});
  d.movs = (d.movs || []).map(m => ({ ...m, t: m.t || m.creado || 1 }));
  d.borrados = d.borrados || {};
  return d;
}
function aplicar(d) {
  data = norm(d); LS.set('datos', data);
  movs = data.movs.map(m => ({ ...m, monto: +m.monto, cotizacion: m.cotizacion != null ? +m.cotizacion : null }));
  render();
}
// Cambio hecho en este dispositivo: se guarda acá al instante y se sube a Drive enseguida.
function cambiar(fn) {
  const d = JSON.parse(JSON.stringify(data)); fn(d); aplicar(d);
  S.pendiente = true; LS.set('pendiente', true); estadoSinc();
  clearTimeout(S.timer); S.timer = setTimeout(() => sincronizar(), 1200);
}
function fusionar(a, b) {
  a = norm(a); b = norm(b);
  const bor = { ...a.borrados };
  for (const [id, t] of Object.entries(b.borrados)) if (!bor[id] || t > bor[id]) bor[id] = t;
  const map = {};
  for (const m of [...a.movs, ...b.movs]) if (!map[m.id] || m.t > map[m.id].t) map[m.id] = m;
  const movsF = Object.values(map).filter(m => !(bor[m.id] && bor[m.id] >= m.t));
  const cfg = (b.cfgT || 0) > (a.cfgT || 0) ? b : a;
  return norm({ app: 'maison-pagos', version: 2, movs: movsF, borrados: bor, personas: cfg.personas, mensaje: cfg.mensaje, cfgT: cfg.cfgT });
}
const canon = d => JSON.stringify({ m: [...d.movs].sort((x, y) => x.id < y.id ? -1 : 1), b: Object.keys(d.borrados).sort().map(k => [k, d.borrados[k]]), p: d.personas, s: d.mensaje, c: d.cfgT });

/* ================= Google: permiso (igual que Mis gastos) ================= */
const tokenValido = () => !!S.token && Date.now() < S.exp - 60000;
function cargarScript(src) { return new Promise((ok, mal) => { const s = document.createElement('script'); s.src = src; s.async = true; s.onload = ok; s.onerror = () => mal(new Error('No cargó el servicio de Google. Revisá la conexión.')); document.head.appendChild(s); }); }
async function asegurarGIS() { if (!(window.google && google.accounts && google.accounts.oauth2)) await cargarScript('https://accounts.google.com/gsi/client'); }
// Tiene que llamarse desde un toque (Google abre una ventanita).
async function pedirToken(prompt) {
  await asegurarGIS();
  return new Promise((ok, mal) => {
    try {
      google.accounts.oauth2.initTokenClient({
        client_id: CFG.CLIENT_ID, scope: SCOPE, prompt, login_hint: userEmail || undefined,
        callback: r => { if (!r || r.error) return mal(new Error(r && r.error === 'access_denied' ? 'No se dio permiso a Drive.' : 'No se pudo conectar con Google.')); S.token = r.access_token; S.exp = Date.now() + (+r.expires_in || 3600) * 1000; LS.set('token', { t: S.token, e: S.exp }); S.toque = false; ok(); },
        error_callback: e => mal(new Error(e && e.type === 'popup_closed' ? 'Se cerró la ventana de Google.' : e && e.type === 'popup_failed_to_open' ? 'El navegador bloqueó la ventana de Google.' : 'No se pudo conectar con Google.'))
      }).requestAccessToken();
    } catch (e) { mal(e); }
  });
}
async function api(url, opt = {}) {
  if (!tokenValido()) { S.toque = true; const e = new Error('Hay que volver a conectar con Google.'); e.code = 'token'; throw e; }
  const r = await fetch(url, { ...opt, headers: { ...(opt.headers || {}), Authorization: 'Bearer ' + S.token } });
  if (r.status === 401) { S.token = null; S.exp = 0; LS.del('token'); S.toque = true; const e = new Error('Hay que volver a conectar con Google.'); e.code = 'token'; throw e; }
  if (!r.ok) { let m = 'Error ' + r.status; try { const j = await r.json(); m = (j.error && j.error.message) || m; } catch (e) {} const er = new Error(m); er.status = r.status; throw er; }
  return r.status === 204 ? null : r.json();
}
const DRV = 'https://www.googleapis.com/drive/v3/files';
const UPL = 'https://www.googleapis.com/upload/drive/v3/files';

/* ================= Drive ================= */
async function quienSoy() { const j = await api('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)'); userEmail = j.user.emailAddress; LS.set('email', userEmail); return j.user; }
async function leerMeta() {
  fileMeta = await api(DRV + '/' + fileId + '?fields=id,name,trashed,ownedByMe,webViewLink,capabilities(canEdit,canShare),owners(displayName,emailAddress)');
  LS.set('fileMeta', fileMeta); permisos();
}
function permisos() {
  puedeEditar = !fileMeta || !!(fileMeta.capabilities && fileMeta.capabilities.canEdit);
  document.body.classList.toggle('ro', !puedeEditar);
}
async function bajar() { const t = S.token; const r = await fetch(DRV + '/' + fileId + '?alt=media', { headers: { Authorization: 'Bearer ' + t } }); if (r.status === 401) { S.toque = true; throw Object.assign(new Error('Hay que volver a conectar con Google.'), { code: 'token' }); } if (!r.ok) throw Object.assign(new Error('No se pudo leer el archivo (' + r.status + ')'), { status: r.status }); return r.json(); }
async function subir(d) {
  const cuerpo = JSON.stringify({ ...d, actualizado: new Date().toISOString(), actualizadoPor: userEmail || '' });
  await api(UPL + '/' + fileId + '?uploadType=media', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: cuerpo });
}
async function crearArchivo(d) {
  const b = 'mz' + uid(), meta = { name: FILE_NAME, mimeType: 'application/json', description: 'Base de datos de la app Maison · Pagos BPS y DGI. No la edites a mano.' };
  const body = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(norm(d))}\r\n--${b}--`;
  return (await api(UPL + '?uploadType=multipart&fields=id', { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + b }, body })).id;
}
async function buscarPropio() {
  const q = encodeURIComponent(`name='${FILE_NAME}' and trashed=false and 'me' in owners`);
  const j = await api(DRV + '?q=' + q + '&spaces=drive&orderBy=modifiedTime%20desc&fields=files(id)');
  return j.files && j.files[0] ? j.files[0].id : null;
}
// Baja lo de Drive, lo junta con lo de este teléfono y sube el resultado si cambió.
async function sincronizar(manual) {
  if (!fileId || S.sinc) return;
  if (!tokenValido()) { S.toque = true; estadoSinc(); if (manual) await conectarYsinc(); return; }
  S.sinc = true; S.error = ''; estadoSinc();
  try {
    await leerMeta();
    if (fileMeta.trashed) throw new Error('El archivo de datos está en la papelera de Drive.');
    const rem = await bajar();
    if (!rem || rem.app !== 'maison-pagos') throw new Error('El archivo de Drive no es de la app Maison.');
    const fus = puedeEditar ? fusionar(data, rem) : norm(rem);
    if (canon(fus) !== canon(data)) aplicar(fus);
    if (puedeEditar && canon(fus) !== canon(norm(rem))) await subir(fus);
    S.pendiente = false; LS.set('pendiente', false); LS.set('ultima', Date.now());
    if (manual) toast('Sincronizado con Drive');
  } catch (e) { if (e.code !== 'token') S.error = e.message; if (manual && e.code !== 'token') toast(e.message); }
  finally { S.sinc = false; estadoSinc(); }
}
async function conectarYsinc() { try { await pedirToken(''); await sincronizar(); } catch (e) { toast(e.message); } }
function estadoSinc() {
  const b = $('#modo');
  if (!fileId) { b.textContent = 'Sin Drive'; return; }
  if (S.sinc) b.innerHTML = '<span class="spin"></span>Drive';
  else if (S.toque) b.textContent = '↻ Conectar Drive';
  else if (S.error) b.textContent = '⚠ Drive';
  else if (S.pendiente) b.textContent = 'Sin subir';
  else b.textContent = puedeEditar ? '✓ Drive' : 'Solo lectura';
  b.title = S.error || '';
  $('#estado').textContent = S.error ? 'Drive: ' + S.error + ' (tocá el indicador de arriba para reintentar)' : '';
}
$('#modo').style.cursor = 'pointer';
$('#modo').addEventListener('click', () => { if (S.toque || !tokenValido()) conectarYsinc(); else sincronizar(true); });

/* ================= Picker (igual que Mis gastos) ================= */
function cargarPicker() {
  return new Promise((ok, mal) => {
    const listo = () => window.gapi.load('picker', { callback: ok, onerror: () => mal(new Error('No cargó el selector de Google.')) });
    if (window.gapi && window.gapi.load) return listo();
    cargarScript('https://apis.google.com/js/api.js').then(listo, mal);
  });
}
async function elegirArchivo(hint) {
  await cargarPicker();
  return new Promise(ok => {
    const P = google.picker, vista = new P.DocsView(P.ViewId.DOCS).setMode(P.DocsViewMode.LIST);
    if (vista.setFileIds && hint) vista.setFileIds(hint); else vista.setOwnedByMe(false).setMimeTypes('application/json');
    new P.PickerBuilder().addView(vista).setOAuthToken(S.token).setDeveloperKey(CFG.API_KEY).setAppId(CFG.APP_ID).setLocale('es')
      .setTitle('Elegí el archivo de Maison')
      .setCallback(r => { if (r.action === P.Action.PICKED) ok(r.docs && r.docs[0] ? r.docs[0].id : null); else if (r.action === P.Action.CANCEL) ok(null); })
      .build().setVisible(true);
  });
}

/* ================= entrada ================= */
const unirseId = () => { const m = location.hash.match(/unirse=([\w-]+)/); return m ? m[1] : (LS.get('unirse') || null); };
if (/unirse=/.test(location.hash)) { LS.set('unirse', unirseId()); history.replaceState(null, '', location.pathname + location.search); }
const L = { err: t => { $('#lErr').textContent = t || ''; }, msg: t => { $('#lMsg').innerHTML = t || ''; } };
function showLogin(step) {
  $('#login').hidden = false;
  $('#lStep1').hidden = step !== 1; $('#lStep2').hidden = step !== 2;
  const inv = unirseId();
  $('#lShared').textContent = inv ? 'Aceptar invitación' : 'Abrir archivo compartido conmigo';
  if (step === 2 && inv) $('#lShared').classList.remove('ghost');
  L.err(''); L.msg('');
}
async function usarArchivo(id, local) {
  fileId = id; LS.set('fileId', id); LS.del('unirse');
  L.msg('<span class="spin"></span>Abriendo datos…');
  await leerMeta();
  const rem = norm(await bajar());
  if (local && fileMeta.capabilities.canEdit) { const f = fusionar(rem, local); aplicar(f); await subir(f); } else aplicar(rem);
  S.pendiente = false; LS.set('pendiente', false); S.error = '';
  $('#login').hidden = true; L.msg(''); estadoSinc();
}
function start() {
  if (!CFG.CLIENT_ID) { showLogin(1); L.err('Falta configurar config.js'); return; }
  aplicar(data); permisos();
  if (fileId && !unirseId()) { $('#login').hidden = true; estadoSinc(); if (tokenValido()) sincronizar(); else { S.toque = true; estadoSinc(); } }
  else if (userEmail && tokenValido()) { $('#lHola').textContent = '¿Qué datos querés usar?'; showLogin(2); }
  else showLogin(1);
}
$('#lGoogle').onclick = async () => {
  L.err('');
  try {
    await pedirToken(userEmail ? '' : 'select_account');
    const u = await quienSoy();
    if (unirseId()) { $('#lHola').textContent = 'Hola ' + (u.displayName || u.emailAddress) + '. Te invitaron a ver los pagos de Maison.'; showLogin(2); return; }
    if (fileId) { await usarArchivo(fileId); return; }
    const propio = await buscarPropio();
    if (propio) { await usarArchivo(propio); return; }
    $('#lHola').textContent = 'Hola ' + (u.displayName || u.emailAddress) + '. ¿Qué datos querés usar?';
    showLogin(2);
  } catch (e) { L.msg(''); L.err(e.message); }
};
$('#lShared').onclick = async () => {
  L.err('');
  try {
    if (!tokenValido()) await pedirToken('');
    const id = await elegirArchivo(unirseId());
    if (!id) { if (!unirseId()) L.msg('Si no aparece ningún archivo es porque todavía no te lo compartieron. Pedile a quien lleva los pagos que te comparta desde ⚙ Ajustes y abrí el link del mail que te llega.'); return; }
    await usarArchivo(id);
    toast('Listo: ya ves los datos compartidos');
  } catch (e) { L.msg(''); L.err(e.status === 404 ? 'No tenés acceso a ese archivo. Revisá que entraste con el mail invitado.' : e.message); }
};
$('#lNew').onclick = async () => { L.err(''); try { if (!tokenValido()) await pedirToken(''); L.msg('<span class="spin"></span>Creando archivo…'); await usarArchivo(await crearArchivo(norm(null))); } catch (e) { L.msg(''); L.err(e.message); } };
$('#lImport').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return; L.err('');
  try {
    const d = JSON.parse(await f.text()); if (d.app !== 'maison-pagos' || !Array.isArray(d.movs)) throw new Error('El JSON no es de la app Maison.');
    if (!tokenValido()) await pedirToken('');
    L.msg('<span class="spin"></span>Creando archivo…'); await usarArchivo(await crearArchivo(d));
  } catch (er) { L.msg(''); L.err(er.message); }
};
$('#lOut').onclick = () => logout(true);
function logout(otraCuenta) {
  if (S.token && window.google && google.accounts) try { google.accounts.oauth2.revoke(S.token, () => {}); } catch (e) {}
  S.token = null; S.exp = 0; fileId = null; fileMeta = null; if (otraCuenta !== false) userEmail = null;
  ['token', 'fileId', 'fileMeta', 'datos', 'pendiente', 'email'].forEach(k => LS.del(k));
  aplicar(null); puedeEditar = true; document.body.classList.remove('ro');
  $('#ovS').classList.remove('on'); showLogin(1);
}

/* ================= cálculos ================= */
const usdDe = m => m.cotizacion > 0 ? m.monto / m.cotizacion : null;
function totales() {
  const t = { ingUSD: 0, ingUYU: 0, pagUSD: 0, pagUYU: 0, org: { BPS: { uyu: 0, usd: 0, n: 0 }, DGI: { uyu: 0, usd: 0, n: 0 } } };
  for (const m of movs) {
    if (m.tipo === 'ingreso') { if (m.moneda === 'USD') t.ingUSD += m.monto; else t.ingUYU += m.monto; }
    else {
      const o = t.org[m.organismo] || (t.org[m.organismo] = { uyu: 0, usd: 0, n: 0 });
      o.uyu += m.monto; o.n++;
      if (m.cuenta === 'USD') { const u = usdDe(m) || 0; t.pagUSD += u; o.usd += u; } else t.pagUYU += m.monto;
    }
  }
  t.saldoUSD = t.ingUSD - t.pagUSD; t.saldoUYU = t.ingUYU - t.pagUYU;
  return t;
}
function porMes() {
  const g = {};
  for (const m of movs) { if (m.tipo !== 'pago') continue; const k = m.fecha.slice(0, 7); (g[k] || (g[k] = { BPS: 0, DGI: 0, BPSu: 0, DGIu: 0 })); g[k][m.organismo] += m.monto; g[k][m.organismo + 'u'] += usdDe(m) || 0; }
  return Object.keys(g).sort().map(k => ({ k, ...g[k] }));
}

/* ================= render ================= */
function render() {
  const t = totales();
  $('#sUSD').textContent = fUSD(t.saldoUSD);
  $('#sUSD').style.color = t.saldoUSD < 0 ? 'var(--neg)' : '';
  $('#sSub').innerHTML = `Ingresado ${fUSD(t.ingUSD)} · Pagado ${fUSD(t.pagUSD)}` +
    (t.ingUYU || t.pagUYU ? `<br>Pesos disponibles: <b>${fUYU(t.saldoUYU)}</b> (ingresado ${fUYU(t.ingUYU)})` : '');
  for (const o of ['BPS', 'DGI']) {
    const x = t.org[o];
    $('#k' + o).textContent = fUYU(x.uyu);
    $('#k' + o + 'u').textContent = x.n ? `${x.n} pago${x.n > 1 ? 's' : ''} · ${fUSD(x.usd)} desde USD` : 'Sin pagos';
  }
  $('#view').innerHTML = vista === 'res' ? resumen() : lista(vista);
}
function grafico(meses) {
  if (!meses.length) return '<div class="empty">Todavía no hay pagos.</div>';
  const W = 520, H = 190, pl = 44, pb = 26, pt = 10;
  const max = Math.max(...meses.map(m => m.BPS + m.DGI)) * 1.1 || 1;
  const step = Math.pow(10, Math.floor(Math.log10(max))); const tick = [1, 2, 2.5, 5, 10].map(x => x * step).find(x => max / x <= 5);
  const gap = (W - pl - 10) / meses.length, bw = Math.min(46, gap * 0.6);
  const y = v => H - pb - (v / max) * (H - pb - pt);
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Pagos por mes">`;
  for (let v = 0; v <= max; v += tick) s += `<line x1="${pl}" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${pl - 6}" y="${y(v) + 4}" font-size="10" text-anchor="end" fill="var(--muted)">${v >= 1000 ? nf0.format(v / 1000) + 'k' : v}</text>`;
  meses.forEach((m, i) => {
    const x = pl + gap * i + (gap - bw) / 2;
    s += `<rect x="${x}" y="${y(m.BPS)}" width="${bw}" height="${(H - pb) - y(m.BPS)}" fill="var(--bps)" rx="3"><title>BPS ${fUYU(m.BPS)}</title></rect>`;
    if (m.DGI) s += `<rect x="${x}" y="${y(m.BPS + m.DGI)}" width="${bw}" height="${(H - pb) - y(m.DGI)}" fill="var(--dgi)" rx="3"><title>DGI ${fUYU(m.DGI)}</title></rect>`;
    const [yy, mm] = m.k.split('-');
    s += `<text x="${x + bw / 2}" y="${H - 8}" font-size="11" text-anchor="middle" fill="var(--muted)">${MES3[+mm - 1]} ${yy.slice(2)}</text>`;
  });
  return s + '</svg>';
}
function resumen() {
  const meses = porMes();
  const c = {};
  for (const m of movs) { if (m.tipo !== 'pago') continue; const k = m.organismo + '|' + m.concepto; (c[k] || (c[k] = { o: m.organismo, c: m.concepto, uyu: 0, usd: 0 })); c[k].uyu += m.monto; c[k].usd += usdDe(m) || 0; }
  const cs = Object.values(c).sort((a, b) => b.uyu - a.uyu), mx = Math.max(1, ...cs.map(x => x.uyu));
  const pu = movs.filter(m => m.tipo === 'pago' && m.cuenta === 'USD' && m.cotizacion > 0);
  const sp = pu.reduce((a, m) => a + m.monto, 0), su = pu.reduce((a, m) => a + m.monto / m.cotizacion, 0);
  const ult = meses[meses.length - 1];
  return `
  <section class="card"><h2>Pagos por mes (en pesos)</h2>${grafico(meses)}
    <div class="legend"><span><i class="dot" style="background:var(--bps)"></i>BPS</span><span><i class="dot" style="background:var(--dgi)"></i>DGI</span></div></section>
  <section class="card"><h2>Por concepto</h2>
    ${cs.map(x => `<div class="conc"><div class="l">${esc(x.c)} <small style="color:var(--muted)">· ${x.o}</small>
      <div class="bar" style="width:${x.uyu / mx * 100}%;background:var(--${x.o === 'BPS' ? 'bps' : 'dgi'})"></div></div>
      <div class="r">${fUYU(x.uyu)}<small>${x.usd ? fUSD(x.usd) : 'pagado en pesos'}</small></div></div>`).join('') || '<div class="empty">Sin pagos</div>'}
  </section>
  <section class="card"><div class="row">
    <div class="kpi"><div class="t">Cotización promedio</div><div class="v">${su ? nf2.format(sp / su) : '—'}</div><div class="s">ponderada, pagos desde USD</div></div>
    <div class="kpi"><div class="t">Último mes</div><div class="v">${ult ? fUYU(ult.BPS + ult.DGI) : '—'}</div><div class="s">${ult ? MESES[+ult.k.slice(5) - 1] + ' · ' + fUSD(ult.BPSu + ult.DGIu) : ''}</div></div>
  </div></section>`;
}
function lista(f) {
  let ms = movs.slice();
  if (f === 'BPS' || f === 'DGI') ms = ms.filter(m => m.tipo === 'pago' && m.organismo === f);
  if (f === 'ing') ms = ms.filter(m => m.tipo === 'ingreso');
  ms.sort((a, b) => b.fecha.localeCompare(a.fecha) || (b.creado || 0) - (a.creado || 0));
  if (!ms.length) return '<div class="empty">No hay movimientos.</div>';
  const sumMes = {};
  for (const m of ms) { const k = m.fecha.slice(0, 7); if (m.tipo === 'pago') sumMes[k] = (sumMes[k] || 0) + m.monto; }
  let out = '', cur = '';
  for (const m of ms) {
    const k = m.fecha.slice(0, 7);
    if (k !== cur) { cur = k; const [y, mm] = k.split('-'); out += `<div class="mes"><span>${MESES[+mm - 1]} ${y}</span><span>${sumMes[k] ? 'Pagos ' + fUYU(sumMes[k]) : ''}</span></div>`; }
    if (m.tipo === 'ingreso') {
      out += `<div class="mov" data-id="${esc(m.id)}"><div class="ic" style="background:var(--ing)">+</div>
        <div class="tx"><div class="c">${esc(m.obs || 'Ingreso')}</div><div class="d">${fFecha(m.fecha)} · Ingreso en ${m.moneda === 'USD' ? 'dólares' : 'pesos'}</div></div>
        <div class="m"><b class="pos">+ ${m.moneda === 'USD' ? fUSD(m.monto) : fUYU(m.monto)}</b></div></div>`;
    } else {
      const u = usdDe(m);
      out += `<div class="mov" data-id="${esc(m.id)}"><div class="ic" style="background:var(--${m.organismo === 'BPS' ? 'bps' : 'dgi'})">${esc(m.organismo)}</div>
        <div class="tx"><div class="c">${esc(m.concepto)}</div><div class="d">${fFecha(m.fecha)} · ${m.cuenta === 'USD' ? 'desde USD a ' + nf2.format(m.cotizacion) : 'con pesos'}</div></div>
        <div class="m"><b>${fUYU(m.monto)}</b><span>${m.cuenta === 'USD' && u ? '− ' + fUSD(u) : ''}</span></div></div>`;
    }
  }
  return out;
}

/* ================= formulario ================= */
const st = { tipo: 'pago', org: 'BPS', cta: 'USD', mon: 'USD' };
const SEGS = [['#segTipo', 'tipo', 't'], ['#segOrg', 'org', 'o'], ['#segCta', 'cta', 'c'], ['#segMon', 'mon', 'm']];
SEGS.forEach(([id, key, attr]) => $(id).addEventListener('click', e => { const b = e.target.closest('button'); if (!b || b.disabled) return; st[key] = b.dataset[attr]; syncForm(); }));
function syncForm() {
  for (const [id, key, attr] of SEGS) document.querySelectorAll(id + ' button').forEach(b => b.classList.toggle('on', b.dataset[attr] === st[key]));
  $('#bPago').hidden = st.tipo !== 'pago'; $('#bIng').hidden = st.tipo !== 'ingreso';
  $('#cotBox').hidden = st.cta !== 'USD';
  const cs = [...new Set(movs.filter(m => m.tipo === 'pago' && m.organismo === st.org).map(m => m.concepto))];
  $('#chips').innerHTML = puedeEditar ? cs.map(c => `<button type="button" class="chip">${esc(c)}</button>`).join('') : '';
  calcEq();
}
$('#chips').addEventListener('click', e => { const b = e.target.closest('.chip'); if (b) { $('#fCon').value = b.textContent; $('#fMonP').focus(); } });
function calcEq() { const m = num($('#fMonP').value), c = num($('#fCot').value); $('#fEq').textContent = (m > 0 && c > 0) ? '− ' + fUSD(m / c) : 'US$ —'; }
$('#fMonP').addEventListener('input', calcEq); $('#fCot').addEventListener('input', calcEq);
const dec = v => String(v).replace('.', ',');
function abrir(m) {
  editId = m ? m.id : null;
  $('#fErr').textContent = '';
  $('#fTit').textContent = m ? (puedeEditar ? 'Editar movimiento' : 'Detalle') : 'Nuevo movimiento';
  $('#fDel').hidden = !m;
  if (m) {
    st.tipo = m.tipo;
    if (m.tipo === 'pago') { st.org = m.organismo; st.cta = m.cuenta; $('#fCon').value = m.concepto; $('#fMonP').value = dec(m.monto); $('#fCot').value = m.cotizacion ? dec(m.cotizacion) : ''; }
    else { st.mon = m.moneda; $('#fMonI').value = dec(m.monto); $('#fObs').value = m.obs || ''; }
    $('#fFec').value = m.fecha;
  } else {
    st.tipo = 'pago'; st.cta = 'USD';
    $('#fCon').value = ''; $('#fMonP').value = ''; $('#fMonI').value = ''; $('#fObs').value = '';
    const ult = movs.filter(x => x.cotizacion > 0).sort((a, b) => b.fecha.localeCompare(a.fecha))[0];
    $('#fCot').value = ''; $('#fCot').placeholder = ult ? 'Última usada: ' + dec(ult.cotizacion) : 'Ej.: 40,65';
    $('#fFec').value = hoy();
  }
  document.querySelectorAll('#form input').forEach(i => i.disabled = !puedeEditar);
  document.querySelectorAll('#form .seg button').forEach(b => b.disabled = !puedeEditar);
  syncForm();
  $('#ov').classList.add('on');
}
const cerrar = () => $('#ov').classList.remove('on');
$('#fab').onclick = () => abrir(null);
$('#fCan').onclick = cerrar;
$('#ov').addEventListener('click', e => { if (e.target.id === 'ov') cerrar(); });
$('#view').addEventListener('click', e => { const r = e.target.closest('.mov'); if (r) { const m = movs.find(x => x.id === r.dataset.id); if (m) abrir(m); } });

$('#form').addEventListener('submit', async e => {
  e.preventDefault(); if (!puedeEditar) return;
  const err = t => { $('#fErr').textContent = t; };
  const fecha = $('#fFec').value; if (!fecha) return err('Falta la fecha.');
  let d;
  if (st.tipo === 'pago') {
    const concepto = $('#fCon').value.trim(), monto = num($('#fMonP').value);
    if (!concepto) return err('Escribí el concepto.');
    if (!(monto > 0)) return err('El monto en pesos tiene que ser mayor a 0.');
    let cot = null;
    if (st.cta === 'USD') { cot = num($('#fCot').value); if (!(cot > 0)) return err('Pagaste desde la cuenta en dólares: ingresá la cotización de esta operación.'); if (cot < 10 || cot > 200) return err('Revisá la cotización: ' + cot + ' no parece un valor de $ por US$.'); }
    d = { tipo: 'pago', organismo: st.org, concepto, monto, cuenta: st.cta, cotizacion: cot, fecha };
  } else {
    const monto = num($('#fMonI').value); if (!(monto > 0)) return err('El monto tiene que ser mayor a 0.');
    d = { tipo: 'ingreso', moneda: st.mon, monto, obs: $('#fObs').value.trim(), fecha };
  }
  const id = editId, t = Date.now();
  cambiar(D => {
    const i = id ? D.movs.findIndex(x => x.id === id) : -1;
    if (i >= 0) D.movs[i] = { ...D.movs[i], ...d, id, t };
    else D.movs.push({ ...d, id: id || uid(), creado: t, t });
  });
  cerrar(); toast('Guardado');
});
$('#fDel').onclick = () => {
  const m = movs.find(x => x.id === editId); if (!m) return;
  $('#cTxt').textContent = m.tipo === 'pago' ? `${m.organismo} · ${m.concepto} · ${fUYU(m.monto)} (${fFecha(m.fecha)})` : `Ingreso ${m.moneda === 'USD' ? fUSD(m.monto) : fUYU(m.monto)} (${fFecha(m.fecha)})`;
  $('#ovC').classList.add('on');
};
$('#cNo').onclick = () => $('#ovC').classList.remove('on');
$('#cSi').onclick = async () => {
  const id = editId;
  cambiar(D => { D.movs = D.movs.filter(x => x.id !== id); D.borrados[id] = Date.now(); });
  $('#ovC').classList.remove('on'); cerrar(); toast('Eliminado');
};
let toastT;
function toast(t) { const e = $('#toast'); e.textContent = t; e.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => e.classList.remove('on'), 2000); }
$('#tabs').addEventListener('click', e => { const b = e.target.closest('.tab'); if (!b) return; vista = b.dataset.v; document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x === b)); render(); });

/* ================= ajustes: compartir (igual que Mis gastos: Drive comparte el archivo y Google manda el mail) ================= */
let permSel = 'reader', msgTimer = null;
const enlaceUnirse = () => APP_URL + (fileId ? '#unirse=' + fileId : '');
const mensajeDe = p => (data.mensaje || MSG_DEF).replace(/\{nombre\}/g, p.nombre).replace(/\{link\}/g, enlaceUnirse());
const gmailLink = p => 'https://mail.google.com/mail/?view=cm&fs=1&to=' + encodeURIComponent(p.email) + '&su=' + encodeURIComponent('Maison · Control de pagos BPS y DGI') + '&body=' + encodeURIComponent(mensajeDe(p));
const puedoCompartir = () => !!(fileMeta && fileMeta.capabilities && fileMeta.capabilities.canShare && fileMeta.ownedByMe);
function renderPers() {
  const ps = data.personas || [], own = puedoCompartir();
  $('#pers').innerHTML = ps.length ? ps.map((p, i) => `<div class="per"><div class="av">${esc((p.nombre || '?')[0].toUpperCase())}</div>
    <div class="i"><div class="n">${esc(p.nombre)}</div><div class="e">${esc(p.email)}</div></div>
    <select data-role="${i}" ${own ? '' : 'disabled'} aria-label="Permiso"><option value="reader" ${p.permiso !== 'writer' ? 'selected' : ''}>Solo ver</option><option value="writer" ${p.permiso === 'writer' ? 'selected' : ''}>Puede editar</option></select>
    <a class="gm" href="${gmailLink(p)}" target="_blank" rel="noopener" title="Reenviar el link por Gmail">✉</a>
    ${own ? `<button class="mini" data-del="${i}" aria-label="Dejar de compartir">×</button>` : ''}</div>`).join('')
    : '<div class="empty" style="padding:14px">Todavía no compartiste los datos con nadie.</div>';
}
function renderFileInfo() {
  if (!fileMeta) { $('#fileInfo').innerHTML = '<div class="info" style="margin:0 0 8px">Sin archivo de Drive.</div>'; return; }
  const ow = fileMeta.owners && fileMeta.owners[0], ult = LS.get('ultima');
  $('#fileInfo').innerHTML = `<a class="opt" href="${esc(fileMeta.webViewLink)}" target="_blank" rel="noopener"><span>${esc(fileMeta.name)}<small>${fileMeta.ownedByMe ? 'En tu Drive' : 'De ' + esc(ow ? (ow.displayName || ow.emailAddress) : 'otra persona')} · ${puedeEditar ? 'podés editar' : 'solo lectura'}<br>${esc(userEmail || '')}${ult ? ' · sincronizado ' + new Date(ult).toLocaleString('es-UY', { dateStyle: 'short', timeStyle: 'short' }) : ''}</small></span>↗</a>
  <button class="opt" id="oSync" type="button"><span>Sincronizar ahora<small>${S.pendiente ? 'Hay cambios sin subir' : 'Trae lo último de Drive'}</small></span>↻</button>`;
  $('#oSync').onclick = () => sincronizar(true).then(renderFileInfo);
}
$('#gear').onclick = () => {
  $('#sMsg').value = data.mensaje || MSG_DEF; $('#sMsg').disabled = !puedoCompartir();
  $('#pAdd').closest('.card').hidden = !puedoCompartir();
  $('#oImportLbl').hidden = !puedeEditar;
  renderPers(); renderFileInfo(); $('#pErr').textContent = ''; $('#ovS').classList.add('on');
};
$('#sClose').onclick = () => $('#ovS').classList.remove('on');
$('#ovS').addEventListener('click', e => { if (e.target.id === 'ovS') $('#ovS').classList.remove('on'); });
$('#segPerm').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; permSel = b.dataset.p; document.querySelectorAll('#segPerm button').forEach(x => x.classList.toggle('on', x === b)); });
async function conToken(fn) { if (!tokenValido()) await pedirToken(''); return fn(); }
$('#pAdd').onclick = async () => {
  const nombre = $('#pNom').value.trim(), email = $('#pMail').value.trim().toLowerCase(), perr = t => { $('#pErr').textContent = t; };
  if (!nombre) return perr('Falta el nombre.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return perr('Revisá el mail.');
  if ((data.personas || []).some(p => p.email === email)) return perr('Ese mail ya está en la lista.');
  const btn = $('#pAdd'); btn.disabled = true; btn.textContent = 'Compartiendo…'; perr('');
  try {
    const p = { nombre, email, permiso: permSel };
    const perm = await conToken(() => api(DRV + '/' + fileId + '/permissions?sendNotificationEmail=true&fields=id&emailMessage=' + encodeURIComponent(mensajeDe(p)),
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'user', role: permSel, emailAddress: email }) }));
    cambiar(D => { D.personas = [...(D.personas || []).filter(x => x.email !== email), { ...p, permId: perm.id, compartido: hoy() }]; D.cfgT = Date.now(); });
    $('#pNom').value = ''; $('#pMail').value = ''; renderPers(); toast('Compartido: Google le mandó la invitación');
  } catch (x) { perr('No se pudo compartir: ' + x.message); }
  finally { btn.disabled = false; btn.textContent = 'Compartir y enviar invitación'; }
};
$('#pers').addEventListener('change', async e => {
  const s = e.target.closest('[data-role]'); if (!s) return;
  const p = data.personas[+s.dataset.role], role = s.value;
  try {
    if (p.permId) await conToken(() => api(DRV + '/' + fileId + '/permissions/' + p.permId, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }) }));
    cambiar(D => { D.personas = D.personas.map(x => x.email === p.email ? { ...x, permiso: role } : x); D.cfgT = Date.now(); });
    toast('Permiso actualizado');
  } catch (x) { toast('No se pudo cambiar: ' + x.message); renderPers(); }
});
$('#pers').addEventListener('click', async e => {
  const d = e.target.closest('[data-del]'); if (!d) return;
  const p = data.personas[+d.dataset.del];
  try {
    if (p.permId) await conToken(() => api(DRV + '/' + fileId + '/permissions/' + p.permId, { method: 'DELETE' })).catch(x => { if (x.status !== 404) throw x; });
    cambiar(D => { D.personas = (D.personas || []).filter(x => x.email !== p.email); D.cfgT = Date.now(); });
    renderPers(); toast('Ya no se comparte con ' + p.nombre);
  } catch (x) { toast('No se pudo quitar: ' + x.message); }
});
$('#sMsg').addEventListener('input', () => {
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => { const v = $('#sMsg').value; cambiar(D => { D.mensaje = v; D.cfgT = Date.now(); }); renderPers(); }, 900);
});

/* ================= ajustes: archivo ================= */
$('#oExport').onclick = () => {
  const b = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'maison-pagos-' + hoy() + '.json'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
let importData = null;
$('#oImport').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try { const d = JSON.parse(await f.text()); if (d.app !== 'maison-pagos' || !Array.isArray(d.movs)) throw new Error('El JSON no es de la app Maison.'); importData = d; $('#iTxt').textContent = `Se van a reemplazar los ${movs.length} movimientos actuales por los ${d.movs.length} del archivo. La lista de personas compartidas no cambia.`; $('#ovI').classList.add('on'); }
  catch (x) { toast(x.message); }
};
$('#iNo').onclick = () => { importData = null; $('#ovI').classList.remove('on'); };
$('#iSi').onclick = () => {
  const d = importData; if (!d) return; const t = Date.now();
  cambiar(D => { for (const m of D.movs) D.borrados[m.id] = t; D.movs = d.movs.map((m, i) => ({ ...m, t: t + 1 + i })); });
  $('#ovI').classList.remove('on'); toast('Datos importados');
};
$('#oSwitch').onclick = () => {
  if (S.pendiente) { toast('Hay cambios sin subir: tocá "Sincronizar ahora" primero'); return; }
  $('#ovS').classList.remove('on'); fileId = null; fileMeta = null; ['fileId', 'fileMeta', 'datos', 'pendiente'].forEach(k => LS.del(k));
  aplicar(null); puedeEditar = true; document.body.classList.remove('ro'); $('#lHola').textContent = '¿Qué datos querés usar?'; showLogin(tokenValido() ? 2 : 1);
};
$('#oLogout').onclick = () => { if (S.pendiente) { toast('Hay cambios sin subir: tocá "Sincronizar ahora" primero'); return; } logout(); };

/* ================= refresco y PWA ================= */
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && fileId && tokenValido()) sincronizar(); });
window.addEventListener('online', () => { if (fileId && tokenValido() && S.pendiente) sincronizar(); });
if ('serviceWorker' in navigator && location.protocol === 'https:') window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));

start();
