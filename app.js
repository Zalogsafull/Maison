/* Maison · Control de pagos BPS y DGI
   Datos: un archivo JSON en Google Drive del dueño, compartido con lectores.
   Auth: Google Identity Services (scope drive.file) + Google Picker para abrir archivos compartidos. */
'use strict';
const CFG = window.MAISON_CONFIG || {};
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const APP_URL = CFG.APP_URL || (location.origin + location.pathname.replace(/index\.html$/, ''));
const FILE_NAME = 'Maison - Pagos BPS y DGI.json';
const MSG_DEF = 'Hola {nombre}! Te comparto la app de control de pagos de BPS y DGI de Maison. Entrá con esta cuenta de Google y elegí el archivo "' + FILE_NAME + '":\n\n{link}';

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

/* ================= estado ================= */
let data = emptyData(), movs = [], vista = 'res', puedeEditar = true, editId = null;
let fileId = LS.get('fileId'), fileMeta = null, token = null, tokenExp = 0, tokenClient = null, userEmail = LS.get('email');
function emptyData() { return { app: 'maison-pagos', version: 1, movs: [], personas: [], mensaje: null }; }
function setData(d) {
  data = Object.assign(emptyData(), d || {});
  movs = (data.movs || []).map(m => ({ ...m, monto: +m.monto, cotizacion: m.cotizacion != null ? +m.cotizacion : null }));
  LS.set('cache', data);
  render();
}

/* ================= Google auth ================= */
function waitFor(test, ms = 15000) {
  return new Promise((res, rej) => { const t0 = Date.now(); (function p() { if (test()) return res(); if (Date.now() - t0 > ms) return rej(new Error('No cargó el servicio de Google. Revisá la conexión.')); setTimeout(p, 100); })(); });
}
async function initAuth() {
  if (!CFG.CLIENT_ID || CFG.CLIENT_ID.startsWith('PEGAR')) throw new Error('Falta configurar CLIENT_ID en config.js');
  await waitFor(() => window.google && google.accounts && google.accounts.oauth2);
  if (!tokenClient) tokenClient = google.accounts.oauth2.initTokenClient({ client_id: CFG.CLIENT_ID, scope: SCOPE, callback: () => {} });
}
function getToken(interactive) {
  if (token && Date.now() < tokenExp - 60000) return Promise.resolve(token);
  return new Promise(async (res, rej) => {
    try { await initAuth(); } catch (e) { return rej(e); }
    tokenClient.callback = r => {
      if (r.error) return rej(new Error(r.error === 'access_denied' ? 'No se dio permiso a Drive.' : r.error));
      token = r.access_token; tokenExp = Date.now() + (r.expires_in || 3600) * 1000; res(token);
    };
    tokenClient.error_callback = e => rej(new Error(e && e.type === 'popup_closed' ? 'Se cerró la ventana de Google.' : 'No se pudo iniciar sesión.'));
    tokenClient.requestAccessToken({ prompt: interactive ? 'select_account' : '', login_hint: userEmail || undefined });
  });
}
async function api(url, opt = {}, retry = true) {
  const t = await getToken(false);
  const r = await fetch(url, { ...opt, headers: { ...(opt.headers || {}), Authorization: 'Bearer ' + t } });
  if (r.status === 401 && retry) { token = null; return api(url, opt, false); }
  if (!r.ok) { let m = r.status + ''; try { const j = await r.json(); m = (j.error && j.error.message) || m; } catch (e) {} const er = new Error(m); er.status = r.status; throw er; }
  return r.status === 204 ? null : r.json();
}
const DRV = 'https://www.googleapis.com/drive/v3/files';
const UPL = 'https://www.googleapis.com/upload/drive/v3/files';

/* ================= Drive ================= */
async function whoAmI() {
  const j = await api('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)');
  userEmail = j.user.emailAddress; LS.set('email', userEmail); return j.user;
}
async function loadMeta() {
  fileMeta = await api(DRV + '/' + fileId + '?fields=id,name,ownedByMe,modifiedTime,webViewLink,capabilities(canEdit,canShare),owners(displayName,emailAddress)');
  puedeEditar = !!fileMeta.capabilities.canEdit;
  document.body.classList.toggle('ro', !puedeEditar);
  $('#modo').textContent = puedeEditar ? (fileMeta.ownedByMe ? 'Edición' : 'Edición compartida') : 'Solo lectura';
}
async function readFile() {
  const t = await getToken(false);
  const r = await fetch(DRV + '/' + fileId + '?alt=media&_=' + Date.now(), { headers: { Authorization: 'Bearer ' + t } });
  if (!r.ok) { const e = new Error('No se pudo leer el archivo (' + r.status + ')'); e.status = r.status; throw e; }
  const j = await r.json();
  if (!j || j.app !== 'maison-pagos') throw new Error('Ese archivo no es de la app Maison.');
  return j;
}
async function writeFile(d) {
  d.actualizado = new Date().toISOString(); d.actualizadoPor = userEmail || '';
  await api(UPL + '/' + fileId + '?uploadType=media', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d, null, 1) });
}
async function createFile(d) {
  const boundary = 'mz' + uid();
  const meta = { name: FILE_NAME, mimeType: 'application/json', description: 'Datos de la app Maison · Pagos BPS y DGI (' + APP_URL + ')' };
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(d, null, 1)}\r\n--${boundary}--`;
  const j = await api(UPL + '?uploadType=multipart&fields=id', { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body });
  return j.id;
}
/* Guarda aplicando el cambio sobre la última versión del archivo (por si otra persona editó). */
let saving = Promise.resolve();
function mutate(fn) {
  saving = saving.then(async () => {
    const fresh = await readFile();
    const d = Object.assign(emptyData(), fresh);
    fn(d);
    await writeFile(d);
    setData(d);
  });
  return saving.catch(e => { saving = Promise.resolve(); throw e; });
}

/* ================= Picker (archivos compartidos) ================= */
async function pickShared() {
  if (!CFG.API_KEY || !CFG.APP_ID || CFG.API_KEY.startsWith('PEGAR')) throw new Error('Falta configurar API_KEY y APP_ID en config.js');
  await waitFor(() => window.gapi);
  await new Promise(r => gapi.load('picker', r));
  const t = await getToken(false);
  return new Promise(res => {
    const hint = new URLSearchParams(location.search).get('f');
    const view = new google.picker.DocsView(google.picker.ViewId.DOCS).setMimeTypes('application/json').setIncludeFolders(false).setMode(google.picker.DocsViewMode.LIST);
    if (hint && view.setFileIds) view.setFileIds(hint); else view.setQuery(FILE_NAME);
    const p = new google.picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(t).setDeveloperKey(CFG.API_KEY).setAppId(CFG.APP_ID)
      .setTitle('Elegí el archivo de Maison').setLocale('es')
      .setCallback(d => { if (d.action === google.picker.Action.PICKED) res(d.docs[0].id); else if (d.action === google.picker.Action.CANCEL) res(null); })
      .build();
    p.setVisible(true);
  });
}

/* ================= arranque ================= */
const L = { err: t => { $('#lErr').textContent = t || ''; }, msg: t => { $('#lMsg').innerHTML = t || ''; } };
function showLogin(step) {
  $('#login').hidden = false;
  $('#lStep1').hidden = step !== 1; $('#lStep2').hidden = step !== 2;
  L.err(''); L.msg('');
}
async function openFile(id) {
  fileId = id; LS.set('fileId', id);
  L.msg('<span class="spin"></span>Abriendo datos…');
  await loadMeta();
  setData(await readFile());
  $('#login').hidden = true; $('#estado').textContent = '';
}
async function start() {
  const cache = LS.get('cache');
  if (cache && fileId) { setData(cache); $('#login').hidden = true; $('#modo').textContent = 'Conectando…'; }
  if (!fileId || !userEmail) { showLogin(1); return; }
  try {
    await getToken(false);
    await openFile(fileId);
  } catch (e) {
    if (cache) { $('#estado').textContent = 'Sin conexión con Drive: mostrando la última copia. Tocá aquí para reconectar.'; $('#modo').textContent = 'Sin conexión'; puedeEditar = false; document.body.classList.add('ro'); }
    else showLogin(1);
  }
}
$('#estado').addEventListener('click', async () => { if (!/reconectar/.test($('#estado').textContent)) return; try { await getToken(true); await openFile(fileId); } catch (e) { toast(e.message); } });

$('#lGoogle').onclick = async () => {
  L.err('');
  try {
    await getToken(true);
    const u = await whoAmI();
    if (fileId) { try { await openFile(fileId); return; } catch (e) { fileId = null; LS.del('fileId'); } }
    // ¿ya tiene un archivo creado por la app en su Drive?
    const q = encodeURIComponent(`name='${FILE_NAME}' and trashed=false and 'me' in owners`);
    const l = await api(DRV + '?q=' + q + '&fields=files(id)&spaces=drive');
    if (l.files && l.files.length) { await openFile(l.files[0].id); return; }
    $('#lHola').textContent = 'Hola ' + (u.displayName || u.emailAddress) + '. ¿Qué datos querés usar?';
    showLogin(2);
    if (new URLSearchParams(location.search).get('f')) $('#lShared').focus();
  } catch (e) { L.err(e.message); }
};
$('#lShared').onclick = async () => {
  L.err('');
  try { const id = await pickShared(); if (id) await openFile(id); } catch (e) { L.msg(''); L.err(e.status === 404 ? 'No tenés acceso a ese archivo.' : e.message); }
};
$('#lNew').onclick = async () => { L.err(''); try { L.msg('<span class="spin"></span>Creando archivo…'); await openFile(await createFile(emptyData())); } catch (e) { L.msg(''); L.err(e.message); } };
$('#lImport').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return; L.err('');
  try { const d = JSON.parse(await f.text()); if (d.app !== 'maison-pagos' || !Array.isArray(d.movs)) throw new Error('El JSON no es de la app Maison.'); L.msg('<span class="spin"></span>Creando archivo…'); await openFile(await createFile(d)); }
  catch (er) { L.msg(''); L.err(er.message); }
};
$('#lOut').onclick = () => logout();
function logout() {
  if (token && window.google) try { google.accounts.oauth2.revoke(token, () => {}); } catch (e) {}
  token = null; fileId = null; userEmail = null; LS.del('fileId'); LS.del('email'); LS.del('cache');
  setData(emptyData()); $('#ovS').classList.remove('on'); showLogin(1);
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
  $('#fSave').disabled = true; $('#fSave').textContent = 'Guardando…';
  const id = editId;
  try {
    await mutate(D => {
      if (id) { const i = D.movs.findIndex(x => x.id === id); if (i >= 0) D.movs[i] = { ...D.movs[i], ...d, id }; else D.movs.push({ ...d, id, creado: Date.now() }); }
      else D.movs.push({ ...d, id: uid(), creado: Date.now() });
    });
    cerrar(); toast('Guardado en Drive');
  } catch (x) { err(x.status === 403 ? 'No tenés permiso para editar este archivo.' : 'No se pudo guardar: ' + x.message); }
  finally { $('#fSave').disabled = false; $('#fSave').textContent = 'Guardar'; }
});
$('#fDel').onclick = () => {
  const m = movs.find(x => x.id === editId); if (!m) return;
  $('#cTxt').textContent = m.tipo === 'pago' ? `${m.organismo} · ${m.concepto} · ${fUYU(m.monto)} (${fFecha(m.fecha)})` : `Ingreso ${m.moneda === 'USD' ? fUSD(m.monto) : fUYU(m.monto)} (${fFecha(m.fecha)})`;
  $('#ovC').classList.add('on');
};
$('#cNo').onclick = () => $('#ovC').classList.remove('on');
$('#cSi').onclick = async () => {
  const id = editId; $('#cSi').disabled = true;
  try { await mutate(D => { D.movs = D.movs.filter(x => x.id !== id); }); $('#ovC').classList.remove('on'); cerrar(); toast('Eliminado'); }
  catch (x) { $('#ovC').classList.remove('on'); $('#fErr').textContent = 'No se pudo eliminar: ' + x.message; }
  finally { $('#cSi').disabled = false; }
};
let toastT;
function toast(t) { const e = $('#toast'); e.textContent = t; e.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => e.classList.remove('on'), 2000); }
$('#tabs').addEventListener('click', e => { const b = e.target.closest('.tab'); if (!b) return; vista = b.dataset.v; document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x === b)); render(); });

/* ================= ajustes: compartir ================= */
let permSel = 'reader', msgTimer = null;
const linkApp = () => APP_URL + (fileId ? '?f=' + encodeURIComponent(fileId) : '');
const mensajeDe = p => (data.mensaje || MSG_DEF).replace(/\{nombre\}/g, p.nombre).replace(/\{link\}/g, linkApp());
const gmailLink = p => 'https://mail.google.com/mail/?view=cm&fs=1&to=' + encodeURIComponent(p.email) + '&su=' + encodeURIComponent('Maison · Control de pagos BPS y DGI') + '&body=' + encodeURIComponent(mensajeDe(p));
function renderPers() {
  const ps = data.personas || [], own = fileMeta && fileMeta.capabilities && fileMeta.capabilities.canShare;
  $('#pers').innerHTML = ps.length ? ps.map((p, i) => `<div class="per"><div class="av">${esc((p.nombre || '?')[0].toUpperCase())}</div>
    <div class="i"><div class="n">${esc(p.nombre)}</div><div class="e">${esc(p.email)}</div></div>
    <select data-role="${i}" ${own ? '' : 'disabled'} aria-label="Permiso"><option value="reader" ${p.permiso !== 'writer' ? 'selected' : ''}>Solo ver</option><option value="writer" ${p.permiso === 'writer' ? 'selected' : ''}>Puede editar</option></select>
    <a class="gm" href="${gmailLink(p)}" target="_blank" rel="noopener" title="Reenviar link por Gmail">✉</a>
    ${own ? `<button class="mini" data-del="${i}" aria-label="Dejar de compartir">×</button>` : ''}</div>`).join('')
    : '<div class="empty" style="padding:14px">Todavía no compartiste los datos con nadie.</div>';
}
function renderFileInfo() {
  if (!fileMeta) { $('#fileInfo').innerHTML = ''; return; }
  const ow = fileMeta.owners && fileMeta.owners[0];
  $('#fileInfo').innerHTML = `<a class="opt" href="${esc(fileMeta.webViewLink)}" target="_blank" rel="noopener"><span>${esc(fileMeta.name)}<small>${fileMeta.ownedByMe ? 'En tu Drive' : 'De ' + esc(ow ? (ow.displayName || ow.emailAddress) : 'otra persona')} · ${puedeEditar ? 'podés editar' : 'solo lectura'} · sesión: ${esc(userEmail || '')}</small></span>↗</a>`;
}
$('#gear').onclick = () => {
  $('#sMsg').value = data.mensaje || MSG_DEF; $('#sMsg').disabled = !puedeEditar;
  const own = fileMeta && fileMeta.capabilities && fileMeta.capabilities.canShare;
  $('#pAdd').closest('.card').hidden = !own;
  $('#oImportLbl').hidden = !puedeEditar;
  renderPers(); renderFileInfo(); $('#pErr').textContent = ''; $('#ovS').classList.add('on');
};
$('#sClose').onclick = () => $('#ovS').classList.remove('on');
$('#ovS').addEventListener('click', e => { if (e.target.id === 'ovS') $('#ovS').classList.remove('on'); });
$('#segPerm').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; permSel = b.dataset.p; document.querySelectorAll('#segPerm button').forEach(x => x.classList.toggle('on', x === b)); });
$('#pAdd').onclick = async () => {
  const nombre = $('#pNom').value.trim(), email = $('#pMail').value.trim().toLowerCase(), perr = t => { $('#pErr').textContent = t; };
  if (!nombre) return perr('Falta el nombre.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return perr('Revisá el mail.');
  if ((data.personas || []).some(p => p.email === email)) return perr('Ese mail ya está en la lista.');
  const btn = $('#pAdd'); btn.disabled = true; btn.textContent = 'Compartiendo…'; perr('');
  try {
    const p = { nombre, email, permiso: permSel };
    const qs = '?sendNotificationEmail=true&fields=id&emailMessage=' + encodeURIComponent(mensajeDe(p));
    const perm = await api(DRV + '/' + fileId + '/permissions' + qs, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'user', role: permSel, emailAddress: email }) });
    await mutate(D => { D.personas = [...(D.personas || []).filter(x => x.email !== email), { ...p, permId: perm.id, compartido: hoy() }]; });
    $('#pNom').value = ''; $('#pMail').value = ''; renderPers(); toast('Compartido: Google le envió la invitación');
  } catch (x) { perr('No se pudo compartir: ' + x.message); }
  finally { btn.disabled = false; btn.textContent = 'Compartir y enviar invitación'; }
};
$('#pers').addEventListener('change', async e => {
  const s = e.target.closest('[data-role]'); if (!s) return;
  const p = data.personas[+s.dataset.role], role = s.value;
  try {
    if (p.permId) await api(DRV + '/' + fileId + '/permissions/' + p.permId, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }) });
    await mutate(D => { D.personas = D.personas.map(x => x.email === p.email ? { ...x, permiso: role } : x); });
    toast('Permiso actualizado');
  } catch (x) { toast('No se pudo cambiar: ' + x.message); renderPers(); }
});
$('#pers').addEventListener('click', async e => {
  const d = e.target.closest('[data-del]'); if (!d) return;
  const p = data.personas[+d.dataset.del];
  try {
    if (p.permId) await api(DRV + '/' + fileId + '/permissions/' + p.permId, { method: 'DELETE' }).catch(x => { if (x.status !== 404) throw x; });
    await mutate(D => { D.personas = (D.personas || []).filter(x => x.email !== p.email); });
    renderPers(); toast('Ya no se comparte con ' + p.nombre);
  } catch (x) { toast('No se pudo quitar: ' + x.message); }
});
$('#sMsg').addEventListener('input', () => {
  clearTimeout(msgTimer);
  msgTimer = setTimeout(async () => { const v = $('#sMsg').value; try { await mutate(D => { D.mensaje = v; }); renderPers(); } catch (x) { toast('No se pudo guardar el mensaje'); } }, 900);
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
$('#iSi').onclick = async () => {
  const d = importData; if (!d) return;
  try { await mutate(D => { D.movs = d.movs; }); $('#ovI').classList.remove('on'); toast('Datos importados'); } catch (x) { toast('No se pudo importar: ' + x.message); }
};
$('#oSwitch').onclick = () => { $('#ovS').classList.remove('on'); fileId = null; fileMeta = null; LS.del('fileId'); LS.del('cache'); setData(emptyData()); $('#lHola').textContent = '¿Qué datos querés usar?'; showLogin(2); };
$('#oLogout').onclick = logout;

/* ================= refresco y PWA ================= */
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !fileId || !token || Date.now() > tokenExp - 60000 || $('#login').hidden === false) return;
  try { const d = await readFile(); if (d.actualizado !== data.actualizado) setData(d); } catch (e) {}
});
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));

render();
start();
