/* Türkiye 2026 · trip companion v2
   Personal content arrives encrypted from ./vault and is decrypted in the browser.
   Everything added on a phone is encrypted with the same key, kept in IndexedDB and synced to the repo's 'cloud' branch.
   QA: ?today=YYYY-MM-DD&time=HH:MM pretends it is that day and time. */
import { ICONS } from './icons-v2.js';   // new name: the v1 service worker kept icons.js cache-first
import * as AS from './assistant.js';
import { makePdf, deliver, preload, isIOS } from './pdfgen.js';
const { answer, pdfSpec, dateLabel, nextStep } = AS;
// older assistant builds had no to-do states; the fallback keeps the app working
const todoState = AS.todoState || ((t, { today, nowMin: nm, done }) => done ? 'done' : t.due < today || (t.due === today && t.time && nm > parseHM(t.time)) ? 'overdue' : t.due === today ? 'soon' : 'later');
const aiMod = () => import('./ai.js');          // the smart chat (online): only loaded when it is used
const intakeMod = () => import('./intake.js');  // reading an added document
const voiceMod = () => import('./voice.js');    // voice notes and reading answers aloud
const CAN_REC = !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const ico = (n, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ICONS.info}</svg>`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
const nf0 = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });
const pad = (n) => String(n).padStart(2, '0');
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isoToDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (iso, n) => { const d = isoToDate(iso); return isoOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)); };
const daysBetween = (a, b) => Math.round((isoToDate(b) - isoToDate(a)) / 86400000);
const parseHM = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : null; };
const fmtAed = (n) => `AED ${nf0.format(Math.round(n))}`;
const fmtTry = (n) => `₺${nf0.format(Math.round(n))}`;
const tel = (n) => `tel:${String(n).replace(/[^\d+]/g, '')}`;

/* simulated clock for testing */
const QS = new URLSearchParams(location.search);
const SIM = /^\d{4}-\d{2}-\d{2}$/.test(QS.get('today') || '') ? QS.get('today') : null;
const SIM_T = /^\d{1,2}:\d{2}$/.test(QS.get('time') || '') ? QS.get('time') : null;
function now() {
  const n = new Date(); if (!SIM) return n;
  const [y, m, d] = SIM.split('-').map(Number); const [h, mi] = SIM_T ? SIM_T.split(':').map(Number) : [n.getHours(), n.getMinutes()];
  return new Date(y, m - 1, d, h, mi);
}
const todayISO = () => isoOf(now());
const nowMin = () => { const d = now(); return d.getHours() * 60 + d.getMinutes(); };

const state = {
  manifest: null, key: null, content: null, rate: 13.34, expenses: [], todosDone: {}, chat: [], version: null,
  foodKind: 'all', foodDay: null, deferredInstall: null, navDepth: 0, viewerBlob: null, updating: false,
  udocs: [], notes: {}, progress: {}, ai: null, aiHistory: [], aiBusy: null,
};
const C = () => state.content;
const dayBy = (iso) => C().days.find(d => d.date === iso);
const bookingBy = (id) => C().bookings.find(b => b.id === id);
const venueBy = (id) => C().venues.find(v => v.id === id);
const KIND = { meal: 'Main meal', coffee: 'Coffee', shisha: 'Shisha', breakfast: 'Breakfast' };
const MODE = { taxi_out: 'Taxi from hotel', taxi: 'Taxi', taxi_home: 'Taxi to hotel', walk: 'Walk', ferry: 'Ferry', tram: 'Tram', shuttle: 'Paid shuttle', flight: 'Flight', ebus: 'E-bus' };
const TAXI = new Set(['taxi_out', 'taxi', 'taxi_home']);

/* ───────────── small UI helpers ───────────── */
let toastTimer;
function toast(msg, ms = 2200) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms); }
async function copyText(txt, label = 'Copied') {
  try { await navigator.clipboard.writeText(txt); toast(label); }
  catch { const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); toast(label); } catch { toast('Could not copy'); } ta.remove(); }
}
const linkify = (s) => String(s ?? '').split(/(https?:\/\/[^\s]+)/g).map((part, i) => i % 2
  ? `<a href="${esc(part)}" target="_blank" rel="noopener">link</a>`
  : esc(part).replace(/(\+\d[\d ]{7,}\d)/g, (m) => `<a href="${tel(m)}">${m}</a>`).replace(/(^|[\s(])(112|153)(?![\d,.])/g, (m, a, n) => `${a}<a href="tel:${n}">${n}</a>`)).join('');
const copyable = (v) => `<span class="copyable" data-copy="${esc(v)}">${esc(v)}</span>`;
const badge = (text, tone = '') => `<span class="badge ${tone}">${esc(text)}</span>`;
const section = (title, right = '') => `<div class="section"><h2>${esc(title)}</h2>${right}</div>`;
const pdfBtn = (key, label = 'PDF', cls = 'btn sm ghost') => `<button class="${cls}" data-pdf="${esc(key)}">${ico('download', 'sm')} ${esc(label)}</button>`;

/* ───────────── IndexedDB (remembered key) ───────────── */
function idb() {
  return new Promise((res, rej) => { const r = indexedDB.open('tr26', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
// iOS 17.4-18 can lose the IndexedDB connection after time in the background: every call gets one retry
const idbTry = async (f) => { try { return await f(); } catch { return f(); } };
async function idbGet(k) { try { return await idbTry(async () => { const db = await idb(); return new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); }); } catch { return undefined; } }
async function idbSet(k, v) { try { const db = await idb(); await new Promise((res, rej) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); } catch {} }
async function idbDel(k) { try { const db = await idb(); await new Promise((res) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').delete(k); tx.oncomplete = res; tx.onerror = res; }); } catch {} }

/* ───────────── vault ───────────── */
const b64d = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function loadManifest() {
  if (state.manifest) return state.manifest;
  const r = await fetch('./vault/vault.json', { cache: 'no-store' });
  if (!r.ok) throw new Error('vault');
  state.manifest = await r.json();
  return state.manifest;
}
async function deriveKey(pass) {
  const m = await loadManifest();
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  // encrypt too: everything added on a phone (and its keys) is sealed with the same key
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64d(m.kdf.salt), iterations: m.kdf.iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function fetchEnc(path) { const r = await fetch(path); if (!r.ok) throw new Error('fetch ' + path); return new Uint8Array(await r.arrayBuffer()); }
async function decryptBytes(key, buf) { return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(0, 12) }, key, buf.slice(12))); }
const canSeal = () => !!state.key?.usages?.includes('encrypt');
async function sealBytes(bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, state.key, bytes));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12); return out;
}
const sealJSON = (v) => sealBytes(new TextEncoder().encode(JSON.stringify(v)));
async function openJSON(buf, d) { if (!buf) return d; try { return JSON.parse(new TextDecoder().decode(await decryptBytes(state.key, buf))); } catch { return d; } }
async function keyWorks(key) {
  try { const m = await loadManifest(); const p = await decryptBytes(key, await fetchEnc('./' + m.probe)); return new TextDecoder().decode(p) === 'turkiye-2026-ok'; }
  catch { return false; }
}
/* which vault file is which is only known after unlocking: the index sits inside the encrypted content */
// ids 'u:<id>' are documents added on this phone (IndexedDB), everything else comes from the vault
const isUser = (id) => String(id).startsWith('u:');
const udocBy = (id) => state.udocs.find(d => d.id === id) || null;
const vaultFile = (id) => isUser(id) ? ((u) => u && { mime: u.mime, name: u.name, user: true })(udocBy(id.slice(2))) : C()?.vault?.[id] || null;
const bytesCache = new Map(), urlCache = new Map();
async function fileBytes(id) {
  const f = vaultFile(id); if (!f) throw new Error('missing ' + id);
  if (!bytesCache.has(id)) bytesCache.set(id, f.user ? userBytes(id.slice(2)) : fetchEnc('./' + f.path).then(b => decryptBytes(state.key, b)));
  try { return await bytesCache.get(id); } catch (e) { bytesCache.delete(id); throw e; }
}
async function userBytes(id) {
  const b = await idbGet('udoc:' + id); if (b) return decryptBytes(state.key, b);
  const c = await cloudApi(); if (!c) throw new Error('This document is not on this phone');
  const bytes = await c.getFile(id);                                    // added on the other phone: fetch it once
  try { await idbPut('udoc:' + id, await sealBytes(bytes)); } catch {}
  return bytes;
}
async function fileBlob(id) { return new Blob([await fileBytes(id)], { type: vaultFile(id).mime }); }
async function fileUrl(id) { if (!urlCache.has(id)) urlCache.set(id, URL.createObjectURL(await fileBlob(id))); return urlCache.get(id); }
async function fileDataUrl(id) {
  const blob = await fileBlob(id);
  return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(fr.error); fr.readAsDataURL(blob); });
}

/* ───────────── your things: this phone + the cloud ───────────── */
// Everything added on a phone (documents, notes, own to-dos, spending, ticks, "Done" on trips, settings and keys) is one
// object, encrypted with the passcode key, kept in IndexedDB and synced to the repo's 'cloud' branch by cloud.js.
// Each entry carries t (last change, ms); deleting leaves a tombstone, so two phones merge without losing anything.
async function idbPut(k, v) { await idbTry(async () => { const db = await idb(); await new Promise((res, rej) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error('Storage is full')); }); }); }
const uid = (p) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const b64e = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const COLS = ['docs', 'notes', 'todos', 'expenses', 'done', 'progress', 'settings'];
const blankMine = () => ({ v: 1, updated: 0, ...Object.fromEntries(COLS.map(c => [c, {}])) });
const stamp = () => Date.now();
const setting = (k) => state.mine.settings?.[k]?.v ?? null;
const alive = (c) => Object.values(state.mine[c] || {}).filter(x => x && !x.del);
// the rest of the app reads plain lists and maps: rebuild them after every change or merge
function derive() {
  const M = state.mine;
  state.udocs = alive('docs');
  state.notes = {};
  for (const n of alive('notes').sort((a, b) => String(a.added).localeCompare(String(b.added)))) (state.notes[n.iso] ||= []).push(n);
  C().todos = [...C().todos.filter(t => !t.user), ...alive('todos').map(t => ({ ...t, user: true }))];
  state.expenses = alive('expenses').filter(e => +e.amount > 0 && e.date);
  state.todosDone = Object.fromEntries(Object.entries(M.done || {}).map(([k, v]) => [k, !!v?.v]));
  state.progress = Object.fromEntries(Object.entries(M.progress || {}).filter(([, v]) => v?.n > 0).map(([k, v]) => [k, v.n]));
  state.rate = +setting('rate') || C().money.rates.tryPerAed;
  state.ai = setting('aiKey') ? { key: setting('aiKey'), model: setting('aiModel'), on: setting('aiOn') !== false, web: setting('aiWeb') === true } : null;
}
// one change = one stamp; saved on the phone at once, sent to the cloud a moment later
function change(col, id, val) {
  state.mine[col] ||= {};
  state.mine[col][id] = val === null ? { id, del: true, t: stamp() } : { ...val, t: stamp() };
  state.mine.updated = stamp();
  derive(); persist();
}
const setSetting = (k, v) => change('settings', k, { v });
let persistQ = Promise.resolve();
function persist() {
  persistQ = persistQ.then(async () => {
    if (!canSeal() && !(await ensureWriteKey())) return;
    await idbPut('mine', await sealJSON(state.mine));
    syncSoon();
  }).catch(e => { console.error(e); toast('Could not save on this phone: ' + (e.message || e), 4000); });
  return persistQ;
}
const udocsFor = (iso, n) => state.udocs.filter(u => u.dayIso === iso && (n === undefined || (u.tripN ?? null) === n));
// a phone opened by an older build only kept a key that can decrypt: the passcode is needed once to save
function ensureWriteKey() {
  if (canSeal()) return Promise.resolve(true);
  return new Promise((resolve) => {
    openSheet(`<h3>${ico('lock')} One more step</h3><p class="sub">To save things, type the passcode once more. It stays on this phone.</p>
      <form id="rekeyForm" autocomplete="off" style="margin-top:12px"><input id="rekeyPass" type="password" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="Your passphrase" required aria-label="Passphrase">
      <p id="rekeyMsg" class="small" style="margin-top:6px"></p><button class="btn primary wide" style="margin-top:8px">Continue</button></form>`);
    state.writeKeyWait = resolve;
    setTimeout(() => $('#rekeyPass')?.focus(), 60);
  });
}
async function rekey(pass) {
  const key = await deriveKey(pass.trim());
  if (!(await keyWorks(key))) { $('#rekeyMsg').textContent = 'That passphrase is not right.'; return; }
  state.key = key; bytesCache.clear();
  if (await idbGet('key')) await idbSet('key', key);   // remembered phones keep the stronger key
  const r = state.writeKeyWait; state.writeKeyWait = null; closeSheet(); r?.(true);
}
// the first time a phone opens this version, what the old version kept (spending, ticks, rate) moves in
function migrateOld(m) {
  const t = stamp();
  for (const e of store.get('tr26.expenses', []) || []) if (e && e.id && +e.amount > 0 && e.date) m.expenses[e.id] = { ...e, t };
  for (const [k, v] of Object.entries(store.get('tr26.todos', {}) || {})) m.done[k] = { v: !!v, t };
  if (store.get('tr26.rate_v', 0) === 2 && +store.get('tr26.rate', 0)) m.settings.rate = { v: +store.get('tr26.rate', 0), t };
  for (const [o, n] of Object.entries(C().config?.todoMigrate || {})) if (m.done[o]?.v && !m.done[n]) m.done[n] = { v: true, t };
  return m;
}
async function loadMine() {
  const local = await openJSON(await idbGet('mine'), null);
  state.mine = local && local.v ? { ...blankMine(), ...local } : migrateOld(blankMine());
  derive();
  if (!local) await persist();
}

/* documents: bytes stay encrypted on the phone and go to the cloud once; another phone fetches them when opened */
const pendingFiles = () => new Set(store.get('tr26.pendingFiles', []) || []);
const setPending = (s) => store.set('tr26.pendingFiles', [...s]);
async function addUserDoc(rec, bytes) {
  await idbPut('udoc:' + rec.id, await sealBytes(bytes));
  const p = pendingFiles(); p.add(rec.id); setPending(p);
  change('docs', rec.id, rec);
  try { await navigator.storage?.persist?.(); } catch {}
}
function putDoc(rec) { change('docs', rec.id, rec); }
async function deleteUserDoc(id) {
  change('docs', id, null);
  await idbDel('udoc:' + id); const p = pendingFiles(); p.delete(id); setPending(p);
  bytesCache.delete('u:' + id); const u = urlCache.get('u:' + id); if (u) { URL.revokeObjectURL(u); urlCache.delete('u:' + id); }
  cloudApi()?.then(c => c?.deleteFile(id)).catch(() => {});
}
function addUserTodo({ title, due, time, note }) {
  const t = { id: uid('u'), title: String(title || '').trim().slice(0, 140), due: /^\d{4}-\d{2}-\d{2}$/.test(due || '') ? due : todayISO(), time: /^\d{1,2}:\d{2}$/.test(time || '') ? time : null, note: String(note || '').slice(0, 200) };
  if (!t.title) throw new Error('A to-do needs a title');
  change('todos', t.id, t); return t;
}
function delUserTodo(id) { change('todos', id, null); if (state.mine.done[id]) change('done', id, null); }
const setDone = (id, v) => change('done', id, { v: !!v });
function addNote(iso, text) {
  if (!dayBy(iso)) throw new Error('That date is not a trip day');
  const n = { id: uid('n'), iso, text: String(text || '').trim().slice(0, 500), added: new Date().toISOString() };
  if (!n.text) throw new Error('The note is empty');
  change('notes', n.id, n); return n;
}
const delNote = (id) => change('notes', id, null);
const setProgress = (iso, n) => change('progress', iso, n > 0 ? { n } : null);
const FX = { TRY: (a) => a / state.rate, AED: (a) => a, EUR: (a) => a * C().money.rates.tryPerEur / C().money.rates.tryPerAed, USD: (a) => a * 3.6725 };
function addExpense({ amount, currency = 'TRY', category = 'Other', note = '', date }) {
  amount = +amount; if (!(amount > 0) || amount > 1e6) throw new Error('The amount is not valid');
  const cur = String(currency).toUpperCase(), cats = C().money.categories;
  if (!FX[cur]) throw new Error('Currency must be TRY, AED, EUR or USD');
  // the log keeps lira and dirhams; euros and dollars are logged in AED with the original in the note
  const keep = cur === 'TRY' || cur === 'AED';
  const ex = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, date: /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : todayISO(),
    amount: keep ? amount : Math.round(FX[cur](amount) * 100) / 100, cur: keep ? cur : 'AED', cat: cats.includes(category) ? category : 'Other',
    note: (keep ? '' : `${cur === 'EUR' ? '€' : '$'}${amount} · `) + String(note || '').slice(0, 80) };
  ex.aed = FX[cur](amount);
  change('expenses', ex.id, ex); return ex;
}
const delExpense = (id) => change('expenses', String(id), null);

/* cloud sync */
const CLOUD_TEST = () => TEST_BUILD && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(QS.get('ghbase') || '') ? QS.get('ghbase') : null;
let cloudP = null;
function cloudApi() {
  if (cloudP) return cloudP;
  // data lives on the app repo's own 'cloud' branch (Pages builds only from main, so saving never rebuilds the site)
  const cfg = CFG().cloud || (() => { const o = location.hostname.match(/^([\w-]+)\.github\.io$/)?.[1], r = location.pathname.split('/')[1]; return o && r ? { owner: o, repo: r, branch: 'cloud' } : null; })();
  if (!cfg && !CLOUD_TEST()) return null;
  const { owner = 'test', repo = 'test', branch = 'cloud' } = cfg || {};
  cloudP = import('./cloud.js').then(m => {
    state.cloudMod = m;
    const base = CLOUD_TEST();
    return m.createCloud({ owner, repo, branch, seal: sealBytes, open: (b) => decryptBytes(state.key, b), getToken: () => state.tokenTry || setting('ghToken'),
      ...(base ? { apiBase: base, rawBase: base + '/raw' } : {}) });
  }).catch(e => { console.warn('cloud', e); cloudP = null; return null; });
  return cloudP;
}
const sameJSON = (a, b) => JSON.stringify(a) === JSON.stringify(b);
async function adopt(m) {
  if (!m || sameJSON(m, state.mine)) return false;
  state.mine = m; derive(); await idbPut('mine', await sealJSON(state.mine));
  // repaint, but never under the user's fingers (an open sheet, typing, the AI writing)
  const busy = !$('#sheet').hidden || state.aiBusy || state.draft || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  if (busy) state.repaint = true; else render({ keepScroll: true });
  return true;
}
let syncTimer = null, syncing = null;
function syncSoon(ms = 2500) { clearTimeout(syncTimer); syncTimer = setTimeout(() => syncNow(), ms); }
function syncNow() {
  if (syncing) { syncSoon(); return syncing; }
  syncing = (async () => {
    const c = await cloudApi(); if (!c || !state.key) return;
    const setSync = (s, msg = '') => { state.sync = { s, msg, at: Date.now() }; const el = $('#syncLine'); if (el) el.innerHTML = syncLineHtml(); };
    try {
      setSync('busy');
      const r = await c.pull();
      if (r.data) await adopt(state.cloudMod.merge(state.mine, r.data));
      if (setting('ghToken') && canSeal()) {
        const p = pendingFiles();
        for (const id of p) {
          const b = await idbGet('udoc:' + id);
          if (b && state.mine.docs[id] && !state.mine.docs[id].del) await c.putFile(id, await decryptBytes(state.key, b));
          p.delete(id); setPending(p);
        }
        const out = await c.push(state.mine);
        if (out?.data) await adopt(state.cloudMod.merge(state.mine, out.data));
        setSync('ok');
      } else setSync(r.data ? 'read' : 'local');
    } catch (e) {
      console.warn('sync', e);
      const fe = state.cloudMod?.friendlyCloudError?.(e) || { code: 'other', message: String(e.message || e) };
      setSync(fe.code === 'offline' ? 'offline' : 'error', fe.message);
    } finally { syncing = null; }
  })();
  return syncing;
}
function syncLineHtml() {
  const s = state.sync || {}, ago = s.at ? Math.max(0, Math.round((Date.now() - s.at) / 60000)) : null, when = ago == null ? '' : ago < 1 ? 'just now' : `${ago} min ago`;
  const T = { busy: 'Syncing…', ok: `Synced with the cloud · ${when}`, read: `Read from the cloud · add the GitHub token below to save there too`, local: 'Saved on this phone only · add the GitHub token below', offline: 'Offline · it syncs when you are back online', error: `Cloud problem: ${s.msg || 'try again later'}` };
  return `${ico(s.s === 'ok' ? 'check' : s.s === 'error' ? 'alert' : 'refresh', 'sm')} ${esc(T[s.s] || 'Not synced yet')}`;
}
// encrypted file with everything, as a spare copy (the cloud is the normal way between phones)
async function exportMine(btn) {
  if (!(await ensureWriteKey())) return;
  btn && (btn.disabled = true);
  try {
    const files = {}; for (const u of state.udocs) { const b = await idbGet('udoc:' + u.id); if (b) files[u.id] = b64e(b); }
    const blob = new Blob([JSON.stringify({ app: 'tr26-mine', v: 2, made: new Date().toISOString(), index: b64e(await sealJSON(state.mine)), files })], { type: 'application/json' });
    await saveFile(blob, `Turkiye-2026-my-things-${todayISO()}.json`);
  } catch (e) { console.error(e); toast('Could not make the backup'); }
  finally { btn && (btn.disabled = false); }
}
async function importMine(file) {
  if (!file || !(await ensureWriteKey())) return;
  try {
    const j = JSON.parse(await file.text()); if (j.app !== 'tr26-mine' || j.v !== 2) throw new Error('This is not a backup from this version of the app.');
    const data = await openJSON(b64d(j.index), null); if (!data) throw new Error('This backup was made with a different passphrase.');
    for (const [id, b] of Object.entries(j.files || {})) if (!(await idbGet('udoc:' + id))) { await idbPut('udoc:' + id, b64d(b)); const p = pendingFiles(); p.add(id); setPending(p); }
    const { merge } = await import('./cloud.js');
    await adopt(merge(state.mine, data)); syncSoon(500); toast('Backup restored', 3000);
  } catch (e) { console.error(e); toast(e.message || 'Could not read the backup', 4000); }
}

/* ───────────── lock ───────────── */
const lockMsg = (t, err = false) => { const el = $('#lockMsg'); el.textContent = t; el.classList.toggle('err', err); };
async function unlockWith(pass, remember) {
  const btn = $('#unlockBtn'); btn.disabled = true; lockMsg('Opening the vault…');
  try {
    const key = await deriveKey(pass.trim());
    if (!(await keyWorks(key))) { lockMsg('That passphrase is not right. Check the spelling and try again.', true); btn.disabled = false; return; }
    if (remember) await idbSet('key', key); else await idbDel('key');
    await boot(key);
  } catch (e) { console.error(e); lockMsg('Could not open the vault. Are you online for the first unlock?', true); btn.disabled = false; }
}
async function tryAutoUnlock() {
  const key = await idbGet('key');
  if (!key) return false;
  if (!(await keyWorks(key))) { await idbDel('key'); return false; }
  if (!key.usages?.includes('encrypt')) { lockMsg('The app was updated. Type the passphrase once to finish.'); return false; }
  try { await boot(key); return true; } catch (e) { console.error(e); return false; }
}
async function boot(key) {
  state.key = key;
  const m = await loadManifest();
  const content = JSON.parse(new TextDecoder().decode(await decryptBytes(key, await fetchEnc('./' + m.content))));
  state.content = content;
  if (store.get('tr26.rate_v', 0) !== 2) { store.del('tr26.rate'); store.set('tr26.rate_v', 2); }   // v1 rate was out of date
  await loadMine();
  $('#lock').hidden = true; $('#app').hidden = false;
  if (!location.hash) history.replaceState(null, '', location.pathname + location.search + '#today');
  render();
  takeShared();
  syncNow();   // what the other phone (or this one, earlier) saved in the cloud
  const idle = window.requestIdleCallback || ((f) => setTimeout(f, 1500));
  idle(() => preload());
}
function lockNow(forget = false) {
  if (forget) idbDel('key');
  state.aiBusy?.abort();
  clearTimeout(syncTimer);
  state.key = null; state.content = null; state.chat = []; state.udocs = []; state.ai = null; state.aiHistory = []; state.mine = blankMine(); bytesCache.clear();
  urlCache.forEach(u => URL.revokeObjectURL(u)); urlCache.clear();
  $('#view').innerHTML = ''; $('#app').hidden = true; $('#lock').hidden = false; $('#lock').classList.remove('pending'); $('#pass').value = '';
  lockMsg(forget ? 'This device was forgotten. Type the passphrase to open again.' : 'Locked.');
  $('#unlockBtn').disabled = false; closeAll();
}

/* ───────────── router ───────────── */
function route() {
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  const [a = 'today', ...rest] = h.split('/');
  return { a: a || 'today', b: rest.join('/') || null };
}
const go = (hash) => { if (location.hash === hash) render(); else location.hash = hash; };
window.addEventListener('hashchange', () => { closeAll(); render(); });

function render(opts = {}) {
  if (!state.content) return;
  const { a, b } = route();
  const tab = a === 'day' ? 'days' : ['today', 'days', 'ask', 'docs', 'more'].includes(a) ? a : 'today';
  $$('.tab').forEach(t => { const on = t.dataset.tab === tab; t.classList.toggle('is-active', on); t.setAttribute('aria-current', on ? 'page' : 'false'); });
  let out;
  try {
    if (a === 'day' && b) out = viewDay(b);
    else if (a === 'more' && b) out = viewMorePage(b);
    else out = ({ today: viewToday, days: viewDays, ask: viewAsk, docs: viewDocs, more: viewMore })[tab]();
  } catch (e) { console.error(e); out = { title: 'Oops', html: `<div class="empty">Something went wrong on this page.<br><small>${esc(e.message)}</small></div>` }; }
  $('#viewTitle').textContent = out.title; $('#viewSub').textContent = out.sub || '';
  $('#backBtn').hidden = !out.back; state.back = out.back || null;
  const v = $('#view'); v.className = 'view' + (out.cls ? ' ' + out.cls : ''); v.innerHTML = out.html;
  document.title = `${out.title} · Türkiye 2026`;
  if (!out.keepScroll && !opts.keepScroll) window.scrollTo(0, 0);
  hydrate(v);
  out.after?.();
}
function hydrate(root) {
  $$('img[data-file]', root).forEach(async (img) => {
    if (img.dataset.loaded) return; img.dataset.loaded = '1';
    try { img.src = await fileUrl(img.dataset.file); } catch { img.replaceWith(Object.assign(document.createElement('div'), { className: 'map-missing', textContent: 'Map not available offline yet. Open the app once online.' })); }
  });
}

/* ───────────── shared pieces ───────────── */
function tripsHtml(trips, { nextN = null, iso = null, actions = true } = {}) {
  return `<ol class="trips">${trips.map(t => `<li class="trip ${t.n === nextN ? 'is-next' : ''}">
    <span class="trip-n" style="background:var(--m-${t.mode})">${t.n}</span>
    <div class="grow">
      <div class="trip-mode" style="color:var(--m-${t.mode})">${esc(t.modeText)}${t.n === nextN ? ' · next' : ''}</div>
      <div class="trip-label">${esc(t.label)}</div>
      ${t.dur ? `<div class="trip-meta">${esc(t.dur)}</div>` : ''}
      ${actions ? `<div class="trip-actions">${t.directions ? `<a class="btn sm ghost" href="${esc(t.directions)}" target="_blank" rel="noopener">${ico('navigation', 'sm')} Directions</a>` : ''}${TAXI.has(t.mode) && iso ? `<button class="btn sm ghost" data-drive="${iso}|${t.n}">${ico('taxi', 'sm')} Show driver</button>` : ''}${t.mode === 'flight' && iso && flightFor(iso, t)?.file ? `<button class="btn sm ghost" data-doc="${flightFor(iso, t).file}">${ico('ticket', 'sm')} Ticket</button>` : ''}${iso ? udocsFor(iso, t.n).map(udocBtn).join('') : ''}</div>` : ''}
    </div>
    ${t.time ? `<div class="trip-time">${esc(t.time)}${t.nextDay ? '<small>next day</small>' : ''}</div>` : ''}
  </li>`).join('')}</ol>`;
}
function legendHtml(trips) {
  const modes = [...new Set(trips.map(t => t.mode))];
  return `<div class="legend">${modes.map(m => `<span><i class="mode-dot" style="background:var(--m-${m})"></i>${esc(MODE[m] || m)}</span>`).join('')}</div>`;
}
function venueHtml(v, { showDay = false } = {}) {
  const st = { chosen: badge('Chosen', 'ok'), plan: badge('Planned', 'sea'), option: badge('Option') }[v.status] || '';
  return `<div class="venue">
    <div class="row top"><div class="grow"><div class="venue-name">${esc(v.name)}</div>
      <div class="venue-meta">${showDay ? esc(dateLabel(v.day)) + ' · ' : ''}${esc(KIND[v.kind] || v.kind)} · ${esc(v.area)}${v.view ? ' · ' + esc(v.view) : ''}</div></div>${st}</div>
    <div class="venue-cost">${esc(v.cost)} <span class="small">for two</span></div>
    ${v.book ? `<div class="venue-book">${ico('bell', 'sm')} ${esc(v.book)}</div>` : ''}
    ${v.notes ? `<div class="venue-notes">${esc(v.notes)}</div>` : ''}
    <div class="venue-actions"><a class="btn sm ghost" href="${esc(v.maps)}" target="_blank" rel="noopener">${ico('pin', 'sm')} Map</a>${v.phone ? `<a class="btn sm ghost" href="${tel(v.phone)}">${ico('phone', 'sm')} Call</a>` : ''}${v.whatsapp ? `<a class="btn sm ghost" href="https://wa.me/${v.whatsapp.replace(/\D/g, '')}" target="_blank" rel="noopener">${ico('msgcircle', 'sm')} WhatsApp</a>` : ''}${v.menu ? `<a class="btn sm ghost" href="${esc(v.menu)}" target="_blank" rel="noopener">${ico('filetext', 'sm')} Menu</a>` : ''}</div>
  </div>`;
}
/* documents and notes added on this phone */
const KIND_INFO = { flight: ['Flight ticket', 'plane'], hotel: ['Hotel booking', 'hotel'], transfer: ['Transfer', 'bus'], tour: ['Tour', 'star'], museum: ['Sight ticket', 'ticket'],
  event: ['Event ticket', 'ticket'], restaurant: ['Restaurant booking', 'food'], transport: ['Transport ticket', 'ferry'], receipt: ['Receipt', 'receipt'],
  insurance: ['Insurance', 'shield'], id: ['ID document', 'shield'], other: ['Document', 'filetext'] };
const kindLabel = (k) => (KIND_INFO[k] || KIND_INFO.other)[0], kindIcon = (k) => (KIND_INFO[k] || KIND_INFO.other)[1];
const udocBtn = (u) => `<button class="btn sm ghost" data-doc="u:${esc(u.id)}">${ico('paperclip', 'sm')} ${esc(u.title)}</button>`;
function udocRow(u, { showDay = true } = {}) {
  const tr = u.dayIso && u.tripN ? dayBy(u.dayIso)?.trips.find(t => t.n === u.tripN) : null;
  const meta = [kindLabel(u.kind), showDay && u.dayIso ? dateLabel(u.dayIso) : showDay ? 'Whole trip' : '', tr ? `trip ${tr.n} · ${tr.modeText}` : '', u.time, u.ref].filter(Boolean).join(' · ');
  return `<div class="doc-row" data-doc="u:${esc(u.id)}" role="button" tabindex="0"><span class="doc-ico">${ico(kindIcon(u.kind))}</span>
    <div class="grow"><b>${esc(u.title)}</b><div class="small">${esc(meta)}</div></div><button class="icon-btn sm" data-udoc-edit="${esc(u.id)}" aria-label="Edit or delete">${ico('pencil', 'sm')}</button></div>`;
}
const noteRow = (n) => `<div class="note-row"><span class="doc-ico gold">${ico('note')}</span><div class="grow" dir="auto">${linkify(n.text)}</div><button class="icon-btn sm" data-del-note="${esc(n.id)}" aria-label="Delete note">${ico('trash', 'sm')}</button></div>`;
function mineHtml(iso, today) {
  const docs = udocsFor(iso), notes = state.notes[iso] || [];
  if (today && !docs.length && !notes.length) return '';
  return section(today ? 'Your documents & notes today' : 'Your documents & notes') + `<div class="card">${docs.map(u => udocRow(u, { showDay: false })).join('')}${notes.map(noteRow).join('')}
    ${!docs.length && !notes.length ? '<p class="small">Add a ticket or booking for this day, or a note to remember.</p>' : ''}
    <div class="btn-row" style="margin-top:10px"><button class="btn sm ghost" data-act="add-doc" data-iso="${iso}">${ico('paperclip', 'sm')} Add a document</button><button class="btn sm ghost" data-act="note-add" data-iso="${iso}">${ico('note', 'sm')} Add a note</button></div></div>`;
}
function todoHtml(t) {
  const done = isDone(t), st = tState(t);
  const closes = t.expires && t.expires.slice(0, 10) === todayISO() ? ` · ${/check-?in/i.test(t.title) ? 'closes' : 'until'} ${t.expires.slice(11, 16)}` : '';
  const flag = st === 'overdue' ? '<b class="txt-danger">Overdue · </b>' : st === 'now' ? `<b class="txt-danger">Do it now${esc(closes)} · </b>` : st === 'missed' ? '<b>Past · </b>' : '';
  return `<label class="todo ${done ? 'done' : ''} ${st === 'missed' ? 'missed' : ''}"><input type="checkbox" data-todo="${t.id}" ${done ? 'checked' : ''}>
    <div class="grow"><div class="todo-title">${t.urgent && !done && st !== 'missed' ? `<span class="badge danger">Urgent</span> ` : ''}${t.user ? `<span class="badge sea">Mine</span> ` : ''}${esc(t.title)}</div>
    <div class="small">${flag}${esc(dateLabel(t.due))}${t.time ? ' ' + esc(t.time) : ''}${t.note ? ' · ' + esc(t.note) : ''}</div></div>${t.user ? `<button type="button" class="icon-btn sm" data-del-todo="${esc(t.id)}" aria-label="Delete this to-do">${ico('trash', 'sm')}</button>` : ''}</label>`;
}
const flightFor = (iso, t) => C().bookings.find(b => b.kind === 'flight' && b.dateIso === (t.nextDay ? addDays(iso, 1) : iso));
const byDue = (a, b) => a.due.localeCompare(b.due) || (a.time || '12:00').localeCompare(b.time || '12:00');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const isDone = (t) => Object.prototype.hasOwnProperty.call(state.todosDone, t.id) ? !!state.todosDone[t.id] : !!t.done;
const isCancelled = (b) => b.status === 'cancelled' || (b.status === 'to-cancel' && !!todoForBooking(b.id) && isDone(C().todos.find(t => t.id === todoForBooking(b.id)) || {}));
// done / missed (the moment has passed) / overdue / now (still possible today) / soon / later: shared with the chat
const tState = (t) => todoState(t, { today: todayISO(), nowMin: nowMin(), done: isDone(t), content: C() });
const isOpen = (t) => !['done', 'missed'].includes(tState(t));
const CFG = () => C().config || {};
const todoLink = (id) => (CFG().todoLinks || {})[id] || null;
const todoForBooking = (bid) => Object.entries(CFG().todoLinks || {}).find(([, v]) => v === bid)?.[0] || null;
const hotelCard = (bookingId) => bookingBy(bookingId)?.driverCard || null;
const cityInfo = (city) => (CFG().cities || []).find(c => c.city === city) || { city, code: String(city).slice(0, 3).toUpperCase(), tr: city, label: city };
const tripLen = () => C().days.length;
const deadlineText = (b) => b.deadline ? `Cancel by ${dateLabel(b.deadline.slice(0, 10))} ${b.deadline.slice(11, 16)}` : 'Cancel it';
function alertsHtml() {
  const t = todayISO();
  return C().todos.filter(x => x.urgent && isOpen(x)).sort((a, b) => a.due.localeCompare(b.due)).map(x => {
    const over = tState(x) === 'overdue', left = daysBetween(t, x.due);
    if (over && left < -1) return `<div class="alert mini over">${ico('alert', 'sm')}<div class="grow"><b>${esc(x.title)}</b><span class="alert-when">Deadline was ${esc(dateLabel(x.due))}. Tick it if it is done.</span></div><label class="alert-done"><input type="checkbox" data-todo="${x.id}"> Done</label></div>`;
    const when = over ? 'The deadline has passed' : left === 0 ? `Today${x.time ? ' by ' + x.time : ''}` : `By ${dateLabel(x.due)}${x.time ? ' ' + x.time : ''} · ${left} day${left === 1 ? '' : 's'} left`;
    return `<div class="alert ${over ? 'over' : ''}">${ico('alert')}<div class="grow"><b>${esc(x.title)}</b><div class="alert-when">${esc(when)}</div>${x.note ? `<div class="small">${esc(x.note)}</div>` : ''}
      <div class="alert-actions">${todoLink(x.id) ? `<button class="btn sm light" data-booking="${todoLink(x.id)}">Details</button>` : ''}<label class="alert-done"><input type="checkbox" data-todo="${x.id}"> Done</label></div></div></div>`;
  }).join('');
}
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
function installCardHtml() {
  if (isStandalone() || store.get('tr26.inst_optout', false)) return '';
  return `<div class="card install-card"><div class="row top">${ico('download', 'lg')}<div class="grow"><b>Put the app on your home screen</b>
    <div class="small">${isIOS() ? 'In Safari tap Share, then “Add to Home Screen”. It then works offline, like a real app.' : state.deferredInstall ? 'It opens like a real app and works offline.' : 'In Chrome tap the ⋮ menu, then “Add to Home screen” or “Install app”. It then works offline.'}</div>
    <div class="btn-row" style="margin-top:10px">${state.deferredInstall ? `<button class="btn sm primary" data-act="install">Install</button>` : ''}<button class="btn sm ghost" data-act="install-hide">Not now</button></div></div></div></div>`;
}
const hotelOf = (d) => bookingBy(d.hotel);
const shortHotel = (b) => b ? (b.short || b.title) : '';
const dayTotal = (d) => d.totalAed && d.totalAed[1] > 0 ? `≈ AED ${nf0.format(d.totalAed[0])}–${nf0.format(d.totalAed[1])}` : d.allowAed ? `allow ≈ AED ${d.allowAed[0]}–${d.allowAed[1]}` : 'Included';

/* ───────────── TODAY ───────────── */
function viewToday() {
  const t = todayISO(), days = C().days, first = days[0].date, last = days[days.length - 1].date;
  const d = dayBy(t);
  let html = alertsHtml(), sub = '';
  if (t < first) { html += beforeTrip(t); const n = daysBetween(t, C().meta.departNight); sub = n > 1 ? `${n} days to go` : n === 1 ? 'You fly tomorrow night' : 'You fly tonight'; }
  else if (d) { html += duringTrip(d); sub = `Day ${d.n} of ${tripLen()} · ${d.place || d.city}`; }
  else { html += afterTrip(t); sub = t === addDays(last, 1) ? 'Flying home' : 'Welcome home'; }
  html += installCardHtml();
  return { title: 'Today', sub, html };
}
function beforeTrip(t) {
  const M = C().meta, n = daysBetween(t, M.departNight);
  const fl = bookingBy(CFG().firstFlight) || C().bookings.find(b => b.kind === 'flight');
  // only what must happen before take-off (incl. the online check-in that is due around midnight)
  const open = C().todos.filter(x => isOpen(x) && !x.urgent && (x.due < M.tripStart || (x.due === M.tripStart && x.time && x.time <= '06:00'))).sort(byDue).slice(0, 6);
  return `<div class="hero"><div class="hero-kicker">${esc(M.occasion)} · ${esc(M.travellers.join(' & '))}</div>
      <div class="hero-title">${n > 1 ? `${n} days to go` : n === 1 ? 'You fly tomorrow night' : 'You fly tonight'}</div>
      <div class="hero-sub">${esc(CFG().departText || M.subtitle)}</div>
      <div class="hero-stats">${(CFG().heroStats || [[tripLen(), 'days']]).map(([v, l]) => `<div><b>${esc(v)}</b>${esc(l)}</div>`).join('')}</div>
      <div class="btn-row"><a class="btn light" href="#ask">${ico('chat', 'sm')} Ask anything</a><button class="btn light" data-pdf="trip">${ico('download', 'sm')} Whole trip PDF</button></div></div>
    ${section('Before you fly', '<a href="#more/todos">All</a>')}
    <div class="card">${open.map(todoHtml).join('') || '<div class="empty">All done!</div>'}</div>
    ${section('First flight', `<button data-booking="${fl.id}">Details</button>`)}
    <div class="card">${flightLegs(fl)}<div class="kv-inline">PNR ${copyable(fl.confirmation)} · ${esc(fl.bags)}</div>
      <div class="btn-row" style="margin-top:10px"><button class="btn sm ghost" data-doc="${fl.file}">${ico('ticket', 'sm')} Open ticket</button>${pdfBtn('booking:' + fl.id)}</div></div>
    ${section(`Your ${tripLen()} days`, '<a href="#days">Open</a>')}
    ${dayStrip()}`;
}
function flightLegs(b) {
  return `<div class="legs">${(b.legs || []).map(l => { const [fc, ft] = (l.from || '').split(' '); const [tc, ...tt] = (l.to || '').split(' ');
    return `<div class="leg"><div class="leg-end"><b>${esc(fc)}</b><span>${esc(ft || '')}</span></div><div class="leg-mid">${ico('plane', 'sm')}<span>${esc(l.flight)}</span><small>${esc(l.seats || '')}</small></div><div class="leg-end r"><b>${esc(tc)}</b><span>${esc(tt.join(' '))}</span></div></div>`; }).join('')}</div>`;
}
function dayStrip() {
  const t = todayISO();
  return `<div class="strip">${C().days.map(d => `<a class="strip-day ${d.date === t ? 'is-today' : ''} ${d.date < t ? 'is-past' : ''}" href="#day/${d.date}"><span>${esc(d.dow)}</span><b>${isoToDate(d.date).getDate()}</b><small>${esc(cityInfo(d.city).code)}</small></a>`).join('')}</div>`;
}
function duringTrip(d) {
  const nm = nowMin(), trips = d.trips || [];
  const st = nextStep(d, nm, { doneN: state.progress[d.date] || 0, content: C() }), next = st.first;
  const h = hotelOf(d), card = hotelCard(d.hotel);
  const vs = C().venues.filter(v => v.day === d.date && v.status !== 'option');
  const tomorrow = dayBy(addDays(d.date, 1));
  let html = `<div class="hero"><div class="hero-kicker">${esc(dateLabel(d.date))} · Day ${d.n} of ${tripLen()} · ${esc(d.place || d.city)}</div>
      <div class="hero-title">${esc(d.title)}</div><div class="hero-sub">${esc(d.intro)}</div>
      <div class="hero-stats"><div><b>${esc(d.sunset)}</b>sunset</div><div><b>${esc(dayTotal(d).replace('≈ ', ''))}</b>today</div><div><b>${trips.length}</b>${trips.length === 1 ? 'trip' : 'trips'}</div></div>
      <div class="btn-row"><button class="btn light" data-pdf="day:${d.date}">${ico('download', 'sm')} Today as PDF</button>${card ? `<button class="btn light" data-driver="${card}">${ico('taxi', 'sm')} Hotel for the driver</button>` : ''}</div></div>`;
  if (next) {
    // the whole day in order (incl. the departure-night flights), so "Then" follows what really comes next
    const seq = (st.timeline || trips).map(x => x.trip || x), k = seq.indexOf(next);
    const then = (k >= 0 ? seq.slice(k + 1) : trips.slice(trips.indexOf(next) + 1)).slice(0, 3);
    const fb = next.pseudo ? bookingBy(next.bookingId) : next.mode === 'flight' ? flightFor(d.date, next) : null;
    const real = typeof next.n === 'number', mine = real ? udocsFor(d.date, next.n) : [];
    const est = (st.timeline || []).find(x => x.trip === next)?.at;
    const when = next.time ? esc(next.time) + (next.nextDay ? ' (after midnight)' : '') : st.guessed && est ? `around ${est} · no fixed time` : 'no fixed time';
    html += `<div class="card next-card"><div class="next-kicker">${ico('clock', 'sm')} Next · ${when}</div>
      <div class="next-title"><span class="trip-n" style="background:var(--m-${next.mode})">${esc(next.n)}</span>${esc(next.modeText)}: ${esc(next.label)}</div>
      ${next.dur ? `<div class="small">${esc(next.dur)}</div>` : ''}
      <div class="btn-row" style="margin-top:10px">${next.directions ? `<a class="btn sm sea" href="${esc(next.directions)}" target="_blank" rel="noopener">${ico('navigation', 'sm')} Directions</a>` : ''}${TAXI.has(next.mode) && real ? `<button class="btn sm ghost" data-drive="${d.date}|${next.n}">${ico('taxi', 'sm')} Show driver</button>` : ''}${fb?.file ? `<button class="btn sm ghost" data-doc="${fb.file}">${ico('ticket', 'sm')} Ticket</button>` : ''}${mine.map(udocBtn).join('')}${real ? `<button class="btn sm ghost" data-act="trip-done" data-iso="${d.date}" data-n="${next.n}">${ico('check', 'sm')} Done</button>` : ''}</div>
      ${then.length ? `<div class="next-then">Then: ${then.map(x => `<span>${esc(x.n)}. ${esc(x.modeText)} · ${esc(x.label)}${x.time ? ' · ' + esc(x.time) : ''}</span>`).join('')}</div>` : ''}
      ${state.progress[d.date] ? `<button class="linkbtn small" data-act="trip-undo" data-iso="${d.date}" style="margin-top:8px">${ico('undo', 'sm')} Undo the last “Done”</button>` : ''}</div>`;
  }
  html += mineHtml(d.date, true);
  // to-dos from the last two days to tomorrow; older open ones are only counted, so Today stays short
  const openTodos = C().todos.filter(x => isOpen(x) && !x.urgent);
  const dueNow = openTodos.filter(x => x.due >= addDays(d.date, -2) && x.due <= addDays(d.date, 1)).sort(byDue);
  const older = openTodos.filter(x => x.due < addDays(d.date, -2)).length;
  if (dueNow.length || older) html += section('To-do today & tomorrow', '<a href="#more/todos">All</a>') + `<div class="card">${dueNow.map(todoHtml).join('')}${older ? `<a class="small more-link" href="#more/todos">${plural(older, 'older item')} still open in the checklist ›</a>` : ''}</div>`;
  if (d.free) html += freeDayHtml(d);
  if (d.map) html += `<div class="card flush"><img class="map-img" data-file="${d.map}" data-zoom="${d.map}" data-title="${esc(dateLabel(d.date))}" alt="Route map"><div class="map-cap">${legendHtml(trips)}</div></div>`;
  if (trips.length) html += section('How you move today') + `<div class="card">${tripsHtml(trips, { nextN: next?.n, iso: d.date })}</div>`;
  if (d.plan?.length) html += section('The plan') + `<div class="card"><ol class="steps">${d.plan.map(p => `<li>${linkify(p)}</li>`).join('')}</ol></div>`;
  if (vs.length) html += section('Food & drink today', `<a href="#day/${d.date}">All options</a>`) + `<div class="card">${vs.map(v => venueHtml(v)).join('')}</div>`;
  if (d.check) html += `<div class="callout ${/BOOK|DO NOT FORGET/i.test(d.check) ? 'red' : ''}">${ico('alert', 'sm')} ${linkify(d.check)}</div>`;
  if (C().insurance) html += `<a class="callout sea help-link" href="#more/emergency">${ico('shield', 'sm')} Something happened? 112, the insurance hotline and what is covered ›</a>`;
  html += section('Your hotel') + `<div class="card"><div class="row top">${ico('hotel', 'lg')}<div class="grow"><b>${esc(h.title)}</b><div class="small">${copyable(h.address)}</div>
      <div class="btn-row" style="margin-top:10px">${card ? `<button class="btn sm ghost" data-driver="${card}">${ico('taxi', 'sm')} Show driver</button>` : ''}<a class="btn sm ghost" href="${tel(h.phone)}">${ico('phone', 'sm')} Call</a><button class="btn sm ghost" data-booking="${h.id}">${ico('ticket', 'sm')} Booking</button></div></div></div></div>`;
  if (tomorrow) html += section('Tomorrow') + dayRow(tomorrow);
  return html;
}
function freeDayHtml(d) {
  return `<div class="card"><h3>${ico('sparkles')} A free day</h3><p class="sub">${d.trips?.length ? 'Only the fixed points below are booked.' : 'Nothing is booked. Decide on the day.'}${d.allowAed ? ` Allow about AED ${d.allowAed[0]}–${d.allowAed[1]} for two.` : ''}</p>
    ${d.fixed?.length ? `<div class="divider"></div><b>Fixed today</b><ol class="steps" style="margin-top:8px">${d.fixed.map(p => `<li>${linkify(p)}</li>`).join('')}</ol>` : ''}
    ${d.ideas?.length ? `<div class="divider"></div><b>Ready-made ideas</b><ol class="steps" style="margin-top:8px">${d.ideas.map(p => `<li>${linkify(p)}</li>`).join('')}</ol>` : ''}
    <div class="btn-row"><a class="btn sm ghost" href="#more/food">${ico('food', 'sm')} Places we know</a>${(d.asks || CFG().freeDayAsks || []).map(q => `<button class="btn sm ghost" data-ask="${esc(q)}">${ico('chat', 'sm')} ${esc(q)}</button>`).join('')}</div></div>`;
}
function afterTrip(t) {
  const last = C().days[C().days.length - 1].date;
  if (t === addDays(last, 1)) {
    const fl = bookingBy(CFG().homeFlight), hh = CFG().homeHero || {};
    if (fl) return `<div class="hero"><div class="hero-kicker">${esc(hh.kicker || dateLabel(t))}</div><div class="hero-title">${esc(hh.title || 'Flying home')}</div><div class="hero-sub">${esc(hh.sub || fl.subtitle || '')} Booking ${esc(fl.confirmation)}.</div>
      <div class="btn-row">${fl.file ? `<button class="btn light" data-doc="${fl.file}">${ico('ticket', 'sm')} Ticket</button>` : ''}<button class="btn light" data-booking="${fl.id}">Details</button></div></div>
      ${hh.warn ? `<div class="callout">${ico('alert', 'sm')} ${esc(hh.warn)}</div>` : ''}`;
  }
  const sp = state.expenses.reduce((s, e) => s + expAed(e), 0);
  return `<div class="hero"><div class="hero-kicker">${esc(C().meta.subtitle)}</div><div class="hero-title">Welcome home</div><div class="hero-sub">Every day, ticket and receipt is still here.</div>
    <div class="hero-stats"><div><b>${fmtAed(sp)}</b>logged spending</div></div><div class="btn-row"><button class="btn light" data-pdf="trip">${ico('download', 'sm')} Whole trip PDF</button><a class="btn light" href="#more/money">Money</a></div></div>`;
}

/* ───────────── DAYS ───────────── */
function dayRow(d) {
  const t = todayISO();
  const special = (CFG().dayBadges || {})[d.date];
  const flight = (d.trips || []).some(x => x.mode === 'flight') || C().bookings.some(b => b.kind === 'flight' && b.dateIso === d.date);
  const badges = [d.date === t && badge('Today', 'red'), d.free && badge('Free day', 'sea'), special ? badge(special) : flight && badge('Flight')].filter(Boolean).join(' ');
  return `<a class="day-row ${d.date === t ? 'is-today' : ''} ${d.date < t ? 'is-past' : ''}" href="#day/${d.date}">
    <div class="day-date"><b>${isoToDate(d.date).getDate()}</b><span>${esc(d.dow)}</span></div>
    <div class="grow"><div class="day-title">${esc(d.title)}</div><div class="day-sub">${esc(d.place || d.city)} · ${d.free ? `free${d.trips.length ? ' · ' + plural(d.trips.length, 'fixed trip') : ''} · ${esc(dayTotal(d))}` : `${d.trips.length ? plural(d.trips.length, 'trip') : 'no transport'} · ${esc(dayTotal(d))}`}</div>${badges ? `<div class="day-badges">${badges}</div>` : ''}</div>
    ${ico('chev', 'muted')}</a>`;
}
function viewDays() {
  const ds = C().days;
  const html = `<div class="btn-row page-actions"><button class="btn primary" data-pdf="trip">${ico('download', 'sm')} Whole trip as PDF</button><a class="btn ghost" href="#ask">${ico('chat', 'sm')} Ask</a></div>
    ${[...new Set(ds.map(d => d.city))].map(city => section(cityInfo(city).label) + ds.filter(d => d.city === city).map(dayRow).join('')).join('')}
    ${CFG().homeLine ? `<p class="small center">${esc(CFG().homeLine)}</p>` : ''}`;
  return { title: 'Days', sub: `${dateLabel(ds[0].date)} – ${dateLabel(ds[ds.length - 1].date)} · ${ds.length} days`, html };
}
function viewDay(iso) {
  const d = dayBy(iso);
  if (!d) return { title: 'Day', html: '<div class="empty">That day is not in the trip.</div>', back: '#days' };
  const ds = C().days, i = ds.indexOf(d), prev = ds[i - 1], next = ds[i + 1];
  const isToday = iso === todayISO(), nm = nowMin();
  const nextTrip = isToday ? nextStep(d, nm, { doneN: state.progress[iso] || 0, content: C() }).first : null;
  const h = hotelOf(d);
  const all = C().venues.filter(v => v.day === iso), vs = all.filter(v => v.status !== 'option'), opts = all.filter(v => v.status === 'option');
  let html = `<div class="day-head"><div class="day-kicker">${esc(dateLabel(iso))} · Day ${d.n} of ${tripLen()} · ${esc(d.place || d.city)}${isToday ? ' ' + badge('Today', 'red') : ''}</div>
    <h2>${esc(d.title)}</h2><p>${esc(d.intro)}</p>
    <div class="facts"><span>${ico('sunset', 'sm')} Sunset ${esc(d.sunset)}</span><span>${ico('hotel', 'sm')} ${esc(shortHotel(h))}</span><span>${ico('wallet', 'sm')} ${esc(dayTotal(d))}</span></div>
    <div class="btn-row"><button class="btn primary" data-pdf="day:${iso}">${ico('download', 'sm')} Day as PDF</button><button class="btn ghost" data-ask="Plan for ${esc(dateLabel(iso))}">${ico('chat', 'sm')} Ask</button></div></div>`;
  if (d.free) html += freeDayHtml(d);
  if (d.map) html += `<div class="card flush"><img class="map-img" data-file="${d.map}" data-zoom="${d.map}" data-title="${esc(dateLabel(iso))}" alt="Route map for ${esc(dateLabel(iso))}"><div class="map-cap">${legendHtml(d.trips)}<span class="small">Tap the map to zoom</span></div></div>`;
  if (d.trips.length) html += section('How you move') + `<div class="card">${tripsHtml(d.trips, { nextN: nextTrip?.n, iso })}</div>`;
  if (d.plan?.length) html += section('Day plan') + `<div class="card"><ol class="steps">${d.plan.map(p => `<li>${linkify(p)}</li>`).join('')}</ol></div>`;
  html += mineHtml(iso, false);
  if (vs.length) html += section('Food & drink') + `<div class="card">${vs.map(v => venueHtml(v)).join('')}</div>`;
  if (opts.length) html += `<details class="card fold"><summary>${ico('food', 'sm')} All dining options for the day (${opts.length}) ${ico('chev', 'chev')}</summary>${opts.map(v => venueHtml(v)).join('')}</details>`;
  if (d.costs?.length) html += section('Estimated costs for two') + `<div class="card"><table class="tbl">${d.costs.map(c => `<tr><td>${esc(c.label)}</td><td class="num">${esc(c.value)}</td></tr>`).join('')}</table>${d.total ? `<div class="total-line"><span>Day total</span><span>${esc(d.total)}</span></div>` : ''}</div>`;
  if (d.check) html += `<div class="callout ${/BOOK|DO NOT FORGET/i.test(d.check) ? 'red' : ''}">${ico('alert', 'sm')} ${linkify(d.check)}</div>`;
  html += `<div class="day-nav">${prev ? `<a class="btn ghost" href="#day/${prev.date}">${ico('chevleft', 'sm')} ${esc(dateLabel(prev.date))}</a>` : '<span></span>'}${next ? `<a class="btn ghost" href="#day/${next.date}">${esc(dateLabel(next.date))} ${ico('chev', 'sm')}</a>` : '<span></span>'}</div>`;
  return { title: dateLabel(iso), sub: d.title, html, back: '#days' };
}

/* ───────────── ASK (chat) ───────────── */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const ctx = () => {
  const t = todayISO(), ds = C().days;
  return { content: C(), today: t, todayInTrip: t >= ds[0].date && t <= ds[ds.length - 1].date ? t : null, nowMin: nowMin(), expenses: state.expenses, rate: state.rate,
           todosDone: Object.fromEntries(C().todos.map(x => [x.id, isDone(x)])),
           userDocs: state.udocs.map(({ text, ...u }) => u), userNotes: state.notes, progress: state.progress };
};
function viewAsk() {
  if (!state.chat.length) state.chat.push({ res: answer('hi', ctx()) });
  const on = aiReady(), hasKey = !!state.ai?.key;
  const mode = hasKey ? `<button class="mode-pill ${on ? 'on' : ''}" data-act="ai-toggle">${ico('sparkles', 'sm')} ${on ? `${AI_NAME} · online` : state.ai.on === false ? `Built-in helper · tap for ${AI_NAME}` : 'No internet · built-in helper'}</button>`
    : `<a class="mode-pill" href="#more/settings">${ico('sparkles', 'sm')} Turn on the free smart chat</a>`;
  return {
    title: 'Ask', sub: on ? `${AI_NAME} · every answer can be a PDF` : 'Every answer can be a PDF', cls: 'has-chat', keepScroll: true,
    html: `<div class="chat-mode">${mode}</div><div class="chat" id="chat">${chatHtml()}</div>
      <div class="chat-input"><div class="rec-bar" id="recBar" ${state.rec ? '' : 'hidden'}><i class="rec-dot"></i><span id="recTime">0:00</span><span class="grow">Recording · tap the red button to send</span><button type="button" class="linkbtn" id="recCancel">Cancel</button></div><form id="chatForm" autocomplete="off"><button type="button" class="mic" id="attachBtn" aria-label="Add a ticket or document">${ico('paperclip')}</button>${(on && CAN_REC) || (SR && !state.noMic && !(isIOS() && isStandalone())) ? `<button type="button" class="mic ${state.rec ? 'on' : ''}" id="micBtn" aria-label="${state.rec ? 'Send the voice note' : 'Speak'}">${ico(state.rec ? 'send' : 'mic')}</button>` : ''}
        <input id="chatInput" type="text" placeholder="${on ? 'Ask anything…' : 'Ask about your trip…'}" enterkeyhint="send" aria-label="Your question" maxlength="${on ? 2000 : 300}" dir="auto">
        <button class="send" id="sendBtn" aria-label="${state.aiBusy ? 'Stop' : 'Send'}">${ico(state.aiBusy ? 'stop' : 'send')}</button></form></div>`,
    after: () => scrollChat(false),
  };
}
function chatHtml() { return state.chat.map((m, i) => msgHtml(m, i)).join(''); }
function msgHtml(m, i) {
  if (m.me) return `<div class="msg me" dir="auto">${esc(m.text)}</div>`;
  if (m.typing) return `<div class="msg bot"><span class="typing"><i></i><i></i><i></i></span></div>`;
  if (m.ai) return aiMsgHtml(m, i);
  if (m.doc) return docMsgHtml(m, i);
  const r = m.res;
  const venues = (r.venues || []).map(venueBy).filter(Boolean);
  const phr = (r.phrases || []).length && r.phrases.length < 6 ? r.phrases : [];
  const blocks = venues.length || phr.length ? r.blocks.filter(b => b.t !== 'table') : r.blocks;
  const acts = (r.actions || []).map(a => actionBtn(a, i)).join('') + ('speechSynthesis' in window && i > 0 ? `<button class="btn sm ghost" data-speak="${i}" aria-label="Read aloud">${ico('volume', 'sm')}</button>` : '');
  const last = i === state.chat.length - 1;
  const sugg = last ? (r.suggestions || []).map(s => `<button class="chip" data-ask="${esc(s)}">${esc(s)}</button>`).join('') : '';
  return `<div class="msg bot"><h4>${esc(r.title)}</h4>${blocksHtml(blocks)}${venues.length ? `<div class="venues">${venues.slice(0, 24).map(v => venueHtml(v, { showDay: true })).join('')}${venues.length > 24 ? `<p class="small">…and ${venues.length - 24} more in the PDF.</p>` : ''}</div>` : ''}${phr.map(pi => phraseHtml(C().phrases[pi], pi)).join('')}${acts ? `<div class="msg-actions">${acts}</div>` : ''}</div>${sugg ? `<div class="chips suggest">${sugg}</div>` : ''}`;
}
function actionBtn(a, i) {
  const ic = ico(a.icon || 'arrow', 'sm'), L = esc(a.label);
  switch (a.act) {
    case 'pdf': return `<button class="btn sm primary" data-chatpdf="${i}">${ic} ${state.chat[i]?.autoDone ? 'Saved · download again' : L}</button>`;
    case 'doc': return `<button class="btn sm ghost" data-doc="${esc(a.id)}">${ic} ${L}</button>`;
    case 'day': return `<a class="btn sm ghost" href="#day/${esc(a.date)}">${ic} ${L}</a>`;
    case 'tab': return `<a class="btn sm ghost" href="${a.tab === 'docs' ? '#docs' : '#more/' + esc(a.tab)}">${ic} ${L}</a>`;
    case 'driver': return `<button class="btn sm ghost" data-driver="${esc(a.id)}">${ic} ${L}</button>`;
    case 'venue': return `<button class="btn sm ghost" data-venue="${esc(a.id)}">${ic} ${L}</button>`;
    case 'url': return /^tel:/.test(a.href) ? `<a class="btn sm ghost" href="${esc(a.href)}">${ic} ${L}</a>` : `<a class="btn sm ghost" href="${esc(a.href)}" target="_blank" rel="noopener">${ic} ${L}</a>`;
    default: return '';
  }
}
function blocksHtml(blocks) {
  return blocks.map(b => {
    if (!b) return '';
    switch (b.t) {
      case 'h': return `<h5 class="b-h">${esc(b.text)}</h5>`;
      case 'h3': return `<h6 class="b-h3">${esc(b.text)}</h6>`;
      case 'p': return `<p class="b-p ${b.muted ? 'small' : ''}">${linkify(b.text)}</p>`;
      case 'list': return `<${b.ordered ? 'ol' : 'ul'} class="b-list">${b.items.map(x => `<li>${linkify(x)}</li>`).join('')}</${b.ordered ? 'ol' : 'ul'}>`;
      case 'kv': return `<dl class="kv b-kv">${b.rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${/^(Confirmation|PIN|Tickets|Skywards|Address|Phone|PNR)/.test(k) ? copyable(v) : linkify(v)}</dd>`).join('')}</dl>`;
      case 'table': return `<div class="tbl-wrap"><table class="tbl sm">${b.head ? `<tr>${b.head.map(x => `<th>${esc(x)}</th>`).join('')}</tr>` : ''}${b.rows.map((r, j) => `<tr class="${b.boldLast && j === b.rows.length - 1 ? 'total' : ''}">${r.map(c => `<td>${esc(c).replace(/\n/g, '<br>')}</td>`).join('')}</tr>`).join('')}</table></div>`;
      case 'trips': return tripsHtml(b.trips, { actions: false });
      case 'image': return `<img class="map-img b-img" data-file="${esc(b.file)}" data-zoom="${esc(b.file)}" alt="Route map">`;
      case 'callout': return `<div class="callout ${esc(b.tone || '')}">${b.label ? `<b>${esc(b.label)}:</b> ` : ''}${linkify(b.text)}</div>`;
      case 'total': return `<div class="total-line"><span>${esc(b.label)}</span><span>${esc(b.value)}</span></div>`;
      case 'big': return `<p class="b-big">${esc(b.text)}</p>`;
      default: return '';
    }
  }).join('');
}
function renderChat(scrollToAnswer = true) {
  const box = $('#chat'); if (!box) return;
  box.innerHTML = chatHtml(); hydrate(box); scrollChat(scrollToAnswer);
}
function scrollChat(toAnswerTop) {
  const msgs = $$('#chat .msg'); if (!msgs.length) return;
  const last = msgs[msgs.length - 1];
  const top = toAnswerTop && msgs.length > 1 ? msgs[msgs.length - 2] : last;   // show the question and the start of the answer
  requestAnimationFrame(() => window.scrollTo({ top: Math.max(0, top.getBoundingClientRect().top + window.scrollY - 70), behavior: toAnswerTop ? 'smooth' : 'auto' }));
}
async function send(text) {
  const q = String(text || '').trim(); if (!q) return;
  if (route().a !== 'ask') { state.pendingAsk = q; go('#ask'); return; }
  if (state.aiBusy) return;
  if (aiReady()) return sendAi(q);
  state.chat.push({ me: true, text: q }, { typing: true });
  if (state.chat.length > 60) state.chat.splice(0, state.chat.length - 60);
  renderChat();
  await new Promise(r => setTimeout(r, 300));
  let res;
  try { res = answer(q, ctx()); } catch (e) { console.error(e); res = { title: 'Sorry, I got confused', blocks: [{ t: 'p', text: 'Try asking another way, for example “plan for tomorrow” or “ferry times”.' }] }; }
  state.chat[state.chat.length - 1] = { res };
  renderChat();
  if (res.autoPdf && res.pdf) { const i = state.chat.length - 1; await exportPdf(res.pdf, $(`[data-chatpdf="${i}"]`)); if (state.chat[i]) { state.chat[i].autoDone = true; renderChat(false); } }
}
function startMic() {
  if (!SR) return;
  const rec = new SR(); rec.lang = 'en-US'; rec.interimResults = false; rec.maxAlternatives = 1;
  const btn = $('#micBtn'); btn?.classList.add('on'); toast('Listening…', 4000);
  rec.onresult = (e) => { const txt = e.results[0][0].transcript; $('#chatInput').value = txt; send(txt); $('#chatInput').value = ''; };
  rec.onerror = (e) => {
    const blocked = /not-allowed|service-not-allowed/.test(e?.error || '');
    toast(blocked ? 'Voice input is not available here. Use the microphone on the keyboard instead.' : 'Could not hear that. Try typing.', 3500);
    if (blocked) { state.noMic = true; $('#micBtn')?.remove(); }
  };
  rec.onend = () => btn?.classList.remove('on');
  try { rec.start(); } catch { btn?.classList.remove('on'); }
}

/* ───────────── smart chat (Google Gemini, free key) ───────────── */
// the phone talks to the AI directly with the user's own free key; nothing goes through any other server
const TEST_BUILD = document.querySelector('meta[name="app-test"]')?.content === '1';
const AI_NAME = 'Gemini';   // free Google AI Studio key; the chat code does not depend on the provider
const aiReady = () => !!(state.ai?.key && state.ai.on !== false && navigator.onLine !== false);
async function aiApi() {
  const m = await aiMod();
  if (TEST_BUILD && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(QS.get('aibase') || '')) m.setBaseURL(QS.get('aibase'));   // QA mock, test builds only
  if (!state.aiModels) state.aiModels = m.MODELS;
  return m;
}
function trackUsage(usd, usage) {
  const u = store.get('tr26.ai_usage', null) || { usd: 0, calls: 0, since: new Date().toISOString() };
  u.usd += +usd || 0; u.calls += usage?.calls || 1; store.set('tr26.ai_usage', u);
}
const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function liveInfo() {
  const t = todayISO(), ds = C().days, d = dayBy(t), nm = nowMin();
  const st = d ? nextStep(d, nm, { doneN: state.progress[t] || 0, content: C() }) : null;
  const spentAed = state.expenses.reduce((s, e) => s + expAed(e), 0), spentTry = state.expenses.filter(e => e.cur === 'TRY').reduce((s, e) => s + +e.amount, 0);
  return {
    today: t, weekday: WEEKDAY[isoToDate(t).getDay()], time: `${pad(Math.floor(nm / 60))}:${pad(nm % 60)}`,
    phase: t < ds[0].date ? 'before' : t > ds[ds.length - 1].date ? 'after' : 'during', dayN: d?.n || null, dayTitle: d?.title || null, city: d?.place || d?.city || null,
    next: st?.first ? { n: st.first.n, time: st.first.time || null, guessed: !!st.guessed, what: `${st.first.modeText}: ${st.first.label}` } : null,
    todos: C().todos.map(x => ({ id: x.id, title: x.title, due: x.due, time: x.time || null, state: tState(x), mine: !!x.user })).filter(x => !['done', 'missed'].includes(x.state)),
    spent: { aed: Math.round(spentAed), try: Math.round(spentTry), entries: state.expenses.length, rate: state.rate },
    recentExpenses: state.expenses.slice(-12).map(e => ({ id: e.id, date: e.date, amount: e.amount, cur: e.cur, cat: e.cat, note: e.note })),
    userDocs: state.udocs.map(({ text, ...u }) => u), notes: state.notes, progress: state.progress,
  };
}
const tripLite = (t) => ({ n: t.n, mode: t.mode, modeText: t.modeText, from: t.from, to: t.to, label: t.label, time: t.time || null, nextDay: !!t.nextDay, dur: t.dur || null });
function dayForAi(date) {
  const d = dayBy(String(date || '').slice(0, 10)); if (!d) throw new Error(`Not a trip day. Trip days are ${C().days[0].date} to ${C().days[C().days.length - 1].date}.`);
  const { map, trips, venues, ...day } = d;
  return { ...day, trips: (trips || []).map(tripLite), hotel: shortHotel(hotelOf(d)),
    venues: C().venues.filter(v => v.day === d.date).map(({ id, name, kind, area, cost, status, phone, book, notes }) => ({ id, name, kind, area, cost, status, phone, book, notes })),
    myDocs: udocsFor(d.date).map(({ text, ...u }) => u), myNotes: state.notes[d.date] || [], doneUpTo: state.progress[d.date] || 0 };
}
function blocksText(r) {
  const out = [r.title];
  for (const b of r.blocks || []) switch (b?.t) {
    case 'h': case 'h3': out.push('## ' + b.text); break;
    case 'p': case 'big': out.push(b.text); break;
    case 'list': out.push(...b.items.map(x => '- ' + x)); break;
    case 'kv': out.push(...b.rows.map(([k, v]) => `${k}: ${v}`)); break;
    case 'table': out.push(...[b.head, ...b.rows].filter(Boolean).map(x => x.join(' | '))); break;
    case 'callout': out.push((b.label ? b.label + ': ' : '') + b.text); break;
    case 'total': out.push(`${b.label}: ${b.value}`); break;
    case 'trips': out.push(...b.trips.map(t => `${t.n}. ${t.time || ''} ${t.modeText}: ${t.label}${t.dur ? ' (' + t.dur + ')' : ''}`)); break;
  }
  if (r.venues?.length) out.push('Places: ' + r.venues.map(id => venueBy(id)).filter(Boolean).map(v => `${v.name} (${v.area}, ${v.cost}${v.phone ? ', ' + v.phone : ''})`).join('; '));
  return out.join('\n').slice(0, 6000);
}
// what the AI may do inside the app; every change can be undone from the answer
function aiHandlers() {
  const u = (id) => { const x = udocBy(String(id || '').replace(/^u:/, '')); if (!x) throw new Error('No added document with that id'); return x; };
  return {
    get_day: ({ date }) => dayForAi(date),
    search_trip: ({ query }) => blocksText(answer(String(query || '').slice(0, 300), ctx())),
    create_pdf: () => 'The PDF is ready: the user sees a download button under your answer.',
    add_todo: (x) => { const t = addUserTodo(x || {}); return { ok: true, id: t.id, title: t.title, due: t.due, time: t.time }; },
    add_expense: (x) => { const e = addExpense(x || {}); return { ok: true, id: e.id, logged: `${e.cur === 'TRY' ? fmtTry(e.amount) : fmtAed(e.amount)} · ${e.cat}`, aed: Math.round(e.aed) }; },
    add_day_note: ({ date, text } = {}) => { const n = addNote(String(date || '').slice(0, 10), text); return { ok: true, id: n.id }; },
    update_document: async ({ id, ...p } = {}) => {
      const x = u(id);
      if (p.dayIso !== undefined) { if (p.dayIso && !dayBy(p.dayIso)) throw new Error('dayIso must be a trip day'); x.dayIso = p.dayIso || null; x.tripN = null; }
      if (p.tripN !== undefined) { if (p.tripN != null && !dayBy(x.dayIso)?.trips.some(t => t.n === +p.tripN)) throw new Error('That trip does not exist on that day'); x.tripN = p.tripN == null ? null : +p.tripN; }
      if (p.title) x.title = String(p.title).slice(0, 80);
      if (p.kind && KIND_INFO[p.kind]) x.kind = p.kind;
      if (Array.isArray(p.notes)) x.notes = p.notes.slice(0, 6).map(String);
      putDoc(x); return { ok: true, id: x.id };
    },
    read_document: ({ id } = {}) => { const x = u(id); return { ...x, text: x.text || '(a photo: no text was extracted on the phone)' }; },
    list_documents: () => state.udocs.map(({ text, ...x }) => x),
  };
}
function setSendMode(busy) { const b = $('#sendBtn'); if (b) { b.innerHTML = ico(busy ? 'stop' : 'send'); b.setAttribute('aria-label', busy ? 'Stop' : 'Send'); b.classList.toggle('stop', busy); } }
const trimChat = () => { if (state.chat.length > 60) state.chat.splice(0, state.chat.length - 60); };
let paintTimer = null;
function paintMsg(m) {
  if (paintTimer) return;
  paintTimer = requestAnimationFrame(() => {
    paintTimer = null;
    const i = state.chat.indexOf(m), el = $(`#chat [data-msg="${i}"]`); if (i < 0 || !el) return;
    const nearBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 160;
    el.outerHTML = msgHtml(m, i);
    if (nearBottom) window.scrollTo(0, document.documentElement.scrollHeight);
  });
}
async function sendAi(q, { voice = false } = {}) {
  const msg = { ai: true, text: '', status: 'Thinking…', streaming: true };
  state.chat.push({ me: true, text: (voice ? '🎤 ' : '') + q }, msg); trimChat(); renderChat();
  const ctrl = new AbortController(); state.aiBusy = ctrl; setSendMode(true);
  let api, lock = null;
  try { lock = await navigator.wakeLock?.request('screen'); } catch {}   // a locked screen kills the stream on iPhone
  const H = aiHandlers();
  for (const k of ['add_todo', 'add_expense', 'add_day_note', 'update_document']) { const f = H[k]; H[k] = async (x) => { msg.changed = true; return f(x); }; }
  try {
    api = await aiApi();
    const res = await api.chatTurn({ apiKey: state.ai.key, model: state.ai.model, webSearch: !!state.ai.web, history: state.aiHistory, user: { text: q, attachments: [] },
      content: C(), live: liveInfo(), handlers: H, signal: ctrl.signal,
      onText: (dt) => { msg.text += dt; msg.status = null; paintMsg(msg); }, onStatus: (s) => { msg.status = s; paintMsg(msg); } });
    if (res.text) msg.text = res.text;
    const slug = (t) => String(t || 'answer').replace(/ı/g, 'i').normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-').slice(0, 50) || 'answer';
    msg.pdfs = (res.pdfs || []).map(p => ({ ...p, filename: /\.pdf$/i.test(p.filename || '') ? p.filename : `Turkiye-2026-${slug(p.title)}.pdf` }));
    msg.citations = res.citations || [];
    msg.sugg = (res.searchSuggestions || []).slice(0, 5).map(x => x.html).filter(Boolean);
    // which model answered when the best one could not (busy, slow or out of free requests)
    const fbs = (res.actions || []).filter(a => a.type === 'model_fallback'), fb = fbs[fbs.length - 1];
    if (fb) msg.note = `Answered by ${fb.label}${fbs.length === 1 ? ` · ${fbs[0].fromLabel || 'the first model'} ${fbs[0].reason === 'daily' ? 'reached its free daily limit (back at 10:00 Türkiye time)' : fbs[0].reason === 'slow' ? 'was too slow' : 'was busy'}` : ' · the faster models above it were busy or slow'}.`;
    msg.undo = (res.actions || []).filter(a => ['todo', 'expense', 'note'].includes(a.type) && a.id);
    if ((res.actions || []).some(a => a.type === 'web_off')) { setSetting('aiWeb', false); msg.note = 'Google Search could not be used with this key, so it was switched off.'; }
    state.aiHistory = res.history || state.aiHistory;
    try { trackUsage(api.estimateCost(state.ai.model, res.usage || {}), res.usage); } catch {}
  } catch (e) {
    console.warn(e);
    if (ctrl.signal.aborted) msg.note = 'Stopped.';
    else {
      const fe = api ? api.friendlyError(e) : { code: 'network', message: 'The AI could not be loaded.' };
      msg.error = fe.message; if (!msg.changed) msg.retry = q;
      // no internet or the AI unreachable: answer with the built-in helper instead
      if (['network', 'overloaded', 'rate', 'other'].includes(fe.code)) { try { state.chat.push({ res: answer(q, ctx()), fallback: true }); } catch {} }
    }
  } finally {
    msg.streaming = false; msg.status = null; state.aiBusy = null; setSendMode(false); try { await lock?.release(); } catch {}
    renderChat(false);
    if (voice && msg.text && !msg.error) { try { (await voiceMod()).speak(msg.text); } catch {} }
    if (msg.pdfs?.length && !msg.autoDone) { const i = state.chat.indexOf(msg); await exportPdf(msg.pdfs[0], $(`[data-aipdf="${i}:0"]`)); msg.autoDone = true; renderChat(false); }
  }
}
function aiMsgHtml(m, i) {
  const pdfs = (m.pdfs || []).map((p, j) => `<button class="btn sm primary" data-aipdf="${i}:${j}">${ico('download', 'sm')} ${m.autoDone && j === 0 ? 'Saved · download again' : esc('PDF · ' + (p.title || 'download'))}</button>`).join('');
  const undo = (m.undo || []).map(a => `<button class="btn sm ghost" data-undo="${esc(a.type)}|${esc(a.id)}">${ico('undo', 'sm')} Undo ${esc(a.label || a.type)}</button>`).join('');
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'source'; } };
  return `<div class="msg bot ai" data-msg="${i}"><div class="ai-tag">${ico('sparkles', 'sm')} ${AI_NAME}${m.streaming ? ' <span class="typing"><i></i><i></i><i></i></span>' : ''}</div>
    ${m.text ? `<div class="md">${md(m.text)}</div>` : ''}
    ${m.status && m.streaming ? `<div class="ai-status">${esc(m.status)}</div>` : ''}
    ${m.error ? `<div class="callout red">${esc(m.error)}</div>` : ''}${m.note ? `<p class="small">${esc(m.note)}</p>` : ''}
    ${m.retry && !m.streaming ? `<div class="msg-actions"><button class="btn sm ghost" data-ask="${esc(m.retry)}">${ico('refresh', 'sm')} Try again</button></div>` : ''}
    ${pdfs || undo || (m.text && !m.streaming) ? `<div class="msg-actions">${pdfs}${undo}${m.text && !m.streaming && 'speechSynthesis' in window ? `<button class="btn sm ghost" data-speak="${i}" aria-label="Read aloud">${ico('volume', 'sm')}</button>` : ''}</div>` : ''}
    ${(m.sugg || []).map(h => `<iframe class="gsugg" title="Google Search suggestions" sandbox="allow-popups allow-popups-to-escape-sandbox" srcdoc="${esc('<base target="_blank">' + h)}"></iframe>`).join('')}
    ${(m.citations || []).length ? `<div class="cites">${m.citations.slice(0, 6).map(c => /^https:\/\//.test(c.url || '') ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">${ico('globe', 'sm')} ${esc(c.title ? c.title.slice(0, 48) : host(c.url))}</a>` : '').join('')}</div>` : ''}</div>`;
}

/* safe, small markdown for the AI's answers; links become app buttons only for known targets */
function mdLink(label, url) {
  const L = label;   // already escaped
  let m;
  if ((m = /^#day\/(\d{4}-\d{2}-\d{2})$/.exec(url)) && dayBy(m[1])) return `<a class="btn sm ghost md-btn" href="#day/${m[1]}">${ico('days', 'sm')} ${L}</a>`;
  if (/^#(docs|today|days|more\/[a-z]+)$/.test(url)) return `<a class="btn sm ghost md-btn" href="${url}">${ico('arrow', 'sm')} ${L}</a>`;
  if ((m = /^app:doc\/(u:[\w-]+|[\w-]+)$/.exec(url)) && vaultFile(m[1])) return `<button class="btn sm ghost md-btn" data-doc="${esc(m[1])}">${ico('filetext', 'sm')} ${L}</button>`;
  if ((m = /^app:booking\/([\w-]+)$/.exec(url)) && bookingBy(m[1])) return `<button class="btn sm ghost md-btn" data-booking="${esc(m[1])}">${ico('ticket', 'sm')} ${L}</button>`;
  if ((m = /^app:driver\/([\w-]+)$/.exec(url)) && C().driverCards.some(c => c.id === m[1])) return `<button class="btn sm ghost md-btn" data-driver="${esc(m[1])}">${ico('taxi', 'sm')} ${L}</button>`;
  if ((m = /^app:venue\/([\w-]+)$/.exec(url)) && venueBy(m[1])) return `<button class="btn sm ghost md-btn" data-venue="${esc(m[1])}">${ico('food', 'sm')} ${L}</button>`;
  if (/^tel:\+?[\d\s()-]{5,}$/.test(url)) return `<a href="tel:${url.slice(4).replace(/[^\d+]/g, '')}">${L}</a>`;
  if (/^https:\/\/[^\s"'<>]+$/.test(url)) return `<a href="${esc(url)}" target="_blank" rel="noopener">${L}</a>`;
  return L;
}
function mdInline(s) {
  return String(s).split(/(\[[^\]\n]{1,160}\]\([^)\s]{1,800}\))/g).map((part, k) => {
    if (k % 2) { const m = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part); return mdLink(esc(m[1]).replace(/\*\*([^*]+)\*\*/g, '$1'), m[2]); }
    return esc(part).replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,!?:;]|$)/g, '$1<i>$2</i>').replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/(\+\d[\d ]{7,}\d)/g, (n) => `<a href="${tel(n)}">${n}</a>`).replace(/(^|[\s(])(112)(?![\d,.])/g, '$1<a href="tel:112">112</a>');
  }).join('');
}
function md(src) {
  const lines = String(src || '').replace(/\r/g, '').split('\n');
  let out = '', i = 0; const para = [];
  const flush = () => { if (para.length) { out += `<p dir="auto">${para.map(mdInline).join('<br>')}</p>`; para.length = 0; } };
  const isRow = (l) => /^\s*\|.*\|\s*$/.test(l);
  const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
  while (i < lines.length) {
    const l = lines[i]; let m;
    if (!l.trim()) { flush(); i++; continue; }
    if ((m = /^\s*(#{1,4})\s+(.*)$/.exec(l))) { flush(); out += `<h5 class="md-h md-h${m[1].length}" dir="auto">${mdInline(m[2].replace(/\s*#+\s*$/, ''))}</h5>`; i++; continue; }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(l)) { flush(); out += '<hr>'; i++; continue; }
    if (isRow(l) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      flush(); const head = cells(l); i += 2; const rows = [];
      while (i < lines.length && isRow(lines[i])) rows.push(cells(lines[i++]));
      out += `<div class="tbl-wrap"><table class="tbl sm"><tr>${head.map(h => `<th>${mdInline(h)}</th>`).join('')}</tr>${rows.map(r => `<tr>${r.map(c => `<td>${mdInline(c)}</td>`).join('')}</tr>`).join('')}</table></div>`;
      continue;
    }
    if ((m = /^\s*([-*•]|\d{1,2}[.)])\s+/.exec(l))) {
      flush(); const ordered = /\d/.test(m[1]), items = [];
      while (i < lines.length && /^\s*([-*•]|\d{1,2}[.)])\s+/.test(lines[i]) && /\d/.test(/^\s*([-*•]|\d{1,2}[.)])/.exec(lines[i])[1]) === ordered) {
        items.push(lines[i].replace(/^\s*([-*•]|\d{1,2}[.)])\s+/, '')); i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*•]|\d{1,2}[.)])\s+/.test(lines[i])) items[items.length - 1] += ' ' + lines[i++].trim();
      }
      out += `<${ordered ? 'ol' : 'ul'} class="b-list" dir="auto">${items.map(x => `<li>${mdInline(x)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`;
      continue;
    }
    if (/^\s*>\s?/.test(l)) { flush(); const q = []; while (i < lines.length && /^\s*>\s?/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, '')); out += `<div class="callout" dir="auto">${q.map(mdInline).join('<br>')}</div>`; continue; }
    para.push(l); i++;
  }
  flush(); return out;
}

/* ───────────── adding a document ───────────── */
// Android: "Share → Türkiye" puts files in an inbox (sw.js); they are read one by one after unlocking
async function takeShared() {
  try {
    const box = await idbGet('inbox'); if (!Array.isArray(box) || !box.length) return;
    await idbDel('inbox'); state.inbox = box; nextShared();
  } catch (e) { console.warn('inbox', e); }
}
function nextShared() {
  const it = state.inbox?.shift(); if (!it) return;
  if (route().a !== 'docs') history.replaceState(null, '', location.pathname + location.search + '#docs'), render();
  ingestFile(new File([it.bytes], it.name || 'shared.pdf', { type: it.type || 'application/pdf' }), { from: 'docs' });
}
/* voice: tap the mic to record, tap again to send; the AI writes down what was said and answers it */
async function micTap() {
  if (state.rec) return finishVoice(false);
  try { if ('speechSynthesis' in window) speechSynthesis.speak(new SpeechSynthesisUtterance(' ')); } catch {}   // iPhone: allow the spoken answer later
  if (aiReady() && CAN_REC) return startVoice();
  if (SR && !(isIOS() && isStandalone())) return startMic();
  toast(state.ai?.key ? 'No internet: use the microphone on the keyboard to dictate.' : 'Turn on the smart chat in Settings to talk to it, or use the microphone on the keyboard.', 4500);
}
const mmss = (ms) => `${Math.floor(ms / 60000)}:${pad(Math.floor(ms / 1000) % 60)}`;
async function startVoice() {
  try {
    const V = await voiceMod();
    state.rec = await V.startRecording({ maxMs: 120000, onTick: (ms) => { const t = $('#recTime'); if (t) t.textContent = mmss(ms); if (ms >= 120000) finishVoice(false); } });
    const b = $('#micBtn'); if (b) { b.classList.add('on'); b.innerHTML = ico('send'); b.setAttribute('aria-label', 'Send the voice note'); }
    $('#recBar').hidden = false;
  } catch (e) {
    console.warn(e); state.rec = null;
    toast(/NotAllowed|Permission/i.test(e?.name || e?.message || '') ? 'The microphone is blocked for this app. Allow it in the phone settings, or type.' : 'Could not start the microphone.', 4500);
  }
}
async function finishVoice(cancel) {
  const r = state.rec; if (!r) return; state.rec = null;
  const bar = $('#recBar'); if (bar) bar.hidden = true;
  const b = $('#micBtn'); if (b) { b.classList.remove('on'); b.innerHTML = ico('mic'); b.setAttribute('aria-label', 'Speak'); }
  if (cancel) { r.cancel(); return; }
  const out = await r.stop();
  if (!out || out.ms < 800 || out.blob.size < 1500) { toast('That was too short. Tap the mic and speak a little longer.'); return; }
  return sendVoice(out.blob, `Voice note · ${mmss(out.ms)}`);
}
async function sendVoice(blob, label) {
  if (state.aiBusy) { toast('Wait for the answer to finish first.'); return; }
  const work = { doc: true, working: true, name: '🎤 ' + label, status: 'Listening…' };
  state.chat.push(work); trimChat(); renderChat();
  try {
    const V = await voiceMod(), api = await aiApi();
    const ext = (blob.name || '').split('.').pop().toLowerCase();
    let { bytes, mime } = await V.toWav(blob);
    if (!mime || mime === 'application/octet-stream') mime = { opus: 'audio/ogg', ogg: 'audio/ogg', oga: 'audio/ogg', m4a: 'audio/mp4', mp3: 'audio/mpeg', aac: 'audio/aac', wav: 'audio/wav' }[ext] || 'audio/mp4';
    if (bytes.length > 18 * 1024 * 1024) throw new Error('That voice note is too long. Keep it under about 5 minutes.');
    const r = await api.transcribe({ apiKey: state.ai.key, model: state.ai.model, audio: { mime, bytes } });
    state.chat.splice(state.chat.indexOf(work), 1);
    const text = String(r?.text || '').trim();
    if (!text) { state.chat.push({ doc: true, error: 'I could not hear any words. Try again a bit closer to the phone.', name: '🎤 ' + label }); renderChat(false); return; }
    renderChat(false);
    return sendAi(text, { voice: true });
  } catch (e) {
    console.warn(e);
    let m = e.message; try { m = (await aiApi()).friendlyError(e).message || m; } catch {}
    work.working = false; work.error = m || 'Could not understand the voice note.'; renderChat(false);
  }
}
async function speakMsg(i) {
  const V = await voiceMod(); if (V.speaking()) { V.stopSpeaking(); return; }
  const m = state.chat[i]; if (!m) return;
  V.speak(m.ai ? m.text : m.res ? blocksText(m.res) : '');
}
function pickFile(from, dayHint = null) { state.pick = { from, dayHint }; const i = $('#docInput'); i.value = ''; i.click(); }
function docMsgHtml(m, i) {
  if (m.working) return `<div class="msg bot" data-msg="${i}"><div class="ai-tag">${ico('paperclip', 'sm')} ${esc(m.name)}</div><div class="ai-status">${esc(m.status || 'Reading…')} <span class="typing"><i></i><i></i><i></i></span></div></div>`;
  if (m.error) return `<div class="msg bot" data-msg="${i}"><div class="ai-tag">${ico('paperclip', 'sm')} ${esc(m.name)}</div><div class="callout red">${esc(m.error)}</div></div>`;
  const u = m.saved && udocBy(m.saved);
  if (!u) return `<div class="msg bot" data-msg="${i}"><div class="ai-tag">${ico('paperclip', 'sm')} ${esc(m.name)}</div><p class="small">${m.saved ? 'This document was deleted.' : 'Not saved.'}</p></div>`;
  const tr = u.dayIso && u.tripN ? dayBy(u.dayIso)?.trips.find(t => t.n === u.tripN) : null;
  const where = u.dayIso ? `Filed under ${dateLabel(u.dayIso)}${tr ? `, trip ${tr.n}: ${tr.modeText} · ${tr.label}` : ''}.` : 'Filed under the whole trip.';
  return `<div class="msg bot" data-msg="${i}"><h4>${ico(kindIcon(u.kind), 'sm')} Saved: ${esc(u.title)}</h4><p class="b-p">${esc(where)}</p>${u.summary ? `<p class="small" dir="auto">${esc(u.summary)}</p>` : ''}${m.extra ? `<p class="small">${esc(m.extra)}</p>` : ''}
    <div class="msg-actions"><button class="btn sm primary" data-doc="u:${esc(u.id)}">${ico('filetext', 'sm')} Open</button>${u.dayIso ? `<a class="btn sm ghost" href="#day/${u.dayIso}">${ico('days', 'sm')} ${esc(dateLabel(u.dayIso))}</a>` : ''}<button class="btn sm ghost" data-udoc-edit="${esc(u.id)}">${ico('pencil', 'sm')} Change</button></div></div>`;
}
const PROP_KEYS = ['kind', 'title', 'summary', 'date', 'endDate', 'time', 'dayIso', 'tripN', 'bookingId', 'ref', 'place', 'price', 'people', 'notes', 'confidence', 'isIdDocument', 'source', 'todoId'];
const pickProp = (p) => Object.fromEntries(PROP_KEYS.map(k => [k, p[k] ?? null]));
const isAudio = (f) => /^audio\//.test(f.type || '') || /\.(opus|ogg|oga|m4a|mp3|wav|aac|amr|caf)$/i.test(f.name || '');
async function ingestFile(file, { from = 'docs', dayHint = null } = {}) {
  if (!file) return;
  if (isAudio(file)) {
    if (!aiReady()) { toast('Voice notes need the smart chat: turn it on in Settings (and be online).', 4000); return; }
    if (route().a !== 'ask') { go('#ask'); await new Promise(r => setTimeout(r, 200)); }
    return sendVoice(file, file.name);
  }
  if (file.size > 25 * 1024 * 1024) { toast('That file is over 25 MB. Try a smaller copy or a screenshot.', 3500); return; }
  if (file.size < 1024) { toast('That file looks empty. Pick it again, or take a screenshot.', 3500); return; }
  if (!(await ensureWriteKey())) return;
  let chat = null;
  if (from === 'chat' && route().a === 'ask') { chat = { doc: true, working: true, name: file.name, status: 'Opening the file…' }; state.chat.push({ me: true, text: `📎 ${file.name}` }, chat); trimChat(); renderChat(); }
  else openSheet(`<h3>${ico('paperclip')} ${esc(file.name)}</h3><div class="spinner"></div><p class="small center" id="intakeStatus">Opening the file…</p>`);
  const status = (t) => { if (chat) { chat.status = t; paintMsg(chat); } else { const s = $('#intakeStatus'); if (s) s.textContent = t; } };
  try {
    const I = await intakeMod();
    let f = await I.readFile(file);
    if (f.type === 'other') throw new Error('Only PDFs and photos or screenshots can be added.');
    if (f.type === 'image') {
      status('Preparing the photo…');
      const n = await I.normalizeImage(f.bytes, f.mime);
      if (!n.unreadable) f = { ...f, bytes: n.bytes, mime: n.mime, size: n.bytes.length, name: f.name.replace(/\.[a-z0-9]{2,5}$/i, '') + '.jpg' };
      else { f.unreadable = true; if (!/^image\/(jpeg|png|gif|webp)$/.test(f.mime)) throw new Error('This phone cannot open that photo format. Take a screenshot of it, or send the PDF.'); }
    }
    let text = '';
    if (f.type === 'pdf') { status('Reading the text…'); try { text = await I.pdfText(f.bytes, { pdfjs: await loadPdfjs() }); } catch (e) { console.warn('pdf text', e); } }
    let prop = null, why = '';
    if (aiReady() && !f.unreadable) {
      status(`${AI_NAME} is reading it…`);
      try {
        const api = await aiApi();
        prop = await api.classifyDocument({ apiKey: state.ai.key, model: state.ai.model, file: { mime: f.mime, base64: I.toBase64(f.bytes), name: f.name, text }, content: C(), today: todayISO(), live: liveInfo() });
        if (prop?.usage) { try { trackUsage(api.estimateCost(state.ai.model, prop.usage), prop.usage); } catch {} }
      } catch (e) { console.warn(e); prop = null; try { why = (await aiApi()).friendlyError(e).message; } catch { why = 'The AI could not read it.'; } }
    }
    if (!prop) prop = I.classifyText(text, C(), { filename: file.name, today: todayISO() });
    prop = { ...pickProp(prop), todos: Array.isArray(prop.todos) ? prop.todos.slice(0, 4) : [], expense: prop.expense || null };
    if (!prop.dayIso && dayHint && !['insurance', 'id'].includes(prop.kind)) { prop.dayIso = dayHint; prop.tripN = null; }
    if (!prop.title) prop.title = kindLabel(prop.kind);
    state.draft = { prop, file: f, text, why, from, chat };
    openProposal();
  } catch (e) {
    console.error(e);
    if (chat) { chat.working = false; chat.error = e.message || 'Could not read that file.'; renderChat(false); } else { closeSheet(); toast(e.message || 'Could not read that file.', 3500); }
  }
}
function tripOpts(iso, sel) {
  const trips = iso ? (dayBy(iso)?.trips || []) : [];
  return `<option value="">The whole day</option>` + trips.map(t => `<option value="${t.n}" ${sel === t.n ? 'selected' : ''}>${t.n}. ${esc(t.modeText)} · ${esc(t.label)}${t.time ? ' · ' + esc(t.time) : ''}</option>`).join('');
}
function openProposal() {
  const d = state.draft, p = d.prop, edit = !!d.edit;
  const todo = !edit && p.todoId ? C().todos.find(t => t.id === p.todoId && !isDone(t)) : null;
  const bk = p.bookingId ? bookingBy(p.bookingId) : null;
  const sure = p.confidence == null ? '' : p.confidence >= 0.75 ? ' · sure' : p.confidence >= 0.45 ? ' · fairly sure' : ' · please check the day';
  const ex = p.expense, exText = ex ? `${ex.currency === 'TRY' ? fmtTry(ex.amount) : ex.currency === 'AED' ? fmtAed(ex.amount) : `${ex.currency} ${ex.amount}`} as ${ex.category}` : '';
  openSheet(`<h3>${ico(kindIcon(p.kind))} ${edit ? 'Change this document' : 'Here is what I found'}</h3>
    <p class="sub">${edit ? esc(d.name || '') : (['claude', 'ai'].includes(p.source) ? `✨ Read by ${AI_NAME}` : 'Read on this phone') + sure}${d.why ? ` · the AI was not available: ${esc(d.why)}` : ''}</p>
    ${p.isIdDocument ? `<div class="callout red" style="margin-top:10px">This looks like a passport, ID or visa. The app keeps those out on purpose. Save it only if you are sure.</div>` : ''}
    ${bk ? `<div class="callout sea" style="margin-top:10px">This matches “${esc(bk.title)}”. It will be kept as an extra copy.</div>` : ''}
    ${p.summary ? `<p class="b-p" dir="auto" style="margin-top:10px">${esc(p.summary)}</p>` : ''}
    ${(p.notes || []).length ? `<ul class="b-list small">${p.notes.slice(0, 4).map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    <form id="propForm" class="form-grid" style="margin-top:12px" autocomplete="off">
      <label class="full"><span class="field-label">Name</span><input id="pTitle" maxlength="80" value="${esc(p.title || '')}"></label>
      <label><span class="field-label">Type</span><select id="pKind">${Object.keys(KIND_INFO).map(k => `<option value="${k}" ${p.kind === k ? 'selected' : ''}>${esc(kindLabel(k))}</option>`).join('')}</select></label>
      <label><span class="field-label">Time</span><input id="pTime" type="time" value="${esc(p.time || '')}"></label>
      <label class="full"><span class="field-label">Day</span><select id="pDay"><option value="">Whole trip, not one day</option>${C().days.map(x => `<option value="${x.date}" ${p.dayIso === x.date ? 'selected' : ''}>${esc(dateLabel(x.date))} · ${esc(x.title)}</option>`).join('')}</select></label>
      <label class="full"><span class="field-label">For which trip</span><select id="pTrip">${tripOpts(p.dayIso, p.tripN)}</select></label>
      <label class="full"><span class="field-label">Reference</span><input id="pRef" maxlength="60" value="${esc(p.ref || '')}" placeholder="Booking or ticket number"></label>
      ${todo ? `<label class="check full"><input type="checkbox" id="pTodo" checked> <span>Tick “${esc(todo.title)}”</span></label>` : ''}
      ${ex && !edit ? `<label class="check full"><input type="checkbox" id="pExp" checked> <span>Add ${esc(exText)} to the spending log</span></label>` : ''}
      ${!edit ? (p.todos || []).map((t, k) => `<label class="check full"><input type="checkbox" data-ptodo="${k}" checked> <span>Remind me: ${esc(t.title)}${t.due ? ' · ' + esc(dateLabel(t.due)) : ''}</span></label>`).join('') : ''}
      <div class="full"><button class="btn primary wide" id="pSave">${ico('check', 'sm')} ${edit ? 'Save changes' : 'Save it'}</button></div>
      ${edit ? `<div class="full btn-row"><button type="button" class="btn ghost" data-doc="u:${esc(d.edit)}">${ico('filetext', 'sm')} Open</button><button type="button" class="btn ghost danger" data-act="udoc-del">${ico('trash', 'sm')} Delete</button></div>` : ''}
    </form>`);
  $('#pTrip').disabled = !p.dayIso;
}
function editUserDoc(id) {
  const u = udocBy(id); if (!u) return;
  state.draft = { prop: { ...u }, edit: id, name: u.name };
  openProposal();
}
async function saveDraft() {
  const d = state.draft; if (!d) return;
  const p = d.prop, btn = $('#pSave');
  p.title = $('#pTitle').value.trim() || kindLabel($('#pKind').value); p.kind = $('#pKind').value; p.time = $('#pTime').value || null;
  p.dayIso = $('#pDay').value || null; p.tripN = p.dayIso && $('#pTrip').value ? +$('#pTrip').value : null; p.ref = $('#pRef').value.trim() || null;
  btn.disabled = true;
  try {
    if (d.edit) { putDoc({ ...udocBy(d.edit), ...pickProp(p) }); state.draft = null; closeSheet(); toast('Saved'); render({ keepScroll: true }); return; }
    const rec = { ...pickProp(p), id: uid('d'), name: d.file.name, mime: d.file.mime, size: d.file.size, added: new Date().toISOString(), text: String(d.text || '').slice(0, 6000) };
    await addUserDoc(rec, d.file.bytes);
    const extra = [];
    if ($('#pTodo')?.checked && p.todoId) { setDone(p.todoId, true); extra.push('ticked the to-do'); }
    if ($('#pExp')?.checked && p.expense) { try { addExpense(p.expense); extra.push('added it to spending'); } catch (e) { console.warn(e); } }
    $$('[data-ptodo]').forEach(cb => { if (cb.checked) { try { addUserTodo(p.todos[+cb.dataset.ptodo]); extra.push('added a reminder'); } catch {} } });
    if (d.chat) { d.chat.working = false; d.chat.saved = rec.id; d.chat.extra = extra.length ? 'Also ' + extra.join(', ') + '.' : ''; }
    state.draft = null; closeSheet();
    toast(`Saved${rec.dayIso ? ' to ' + dateLabel(rec.dayIso) : ''}`);
    if (route().a === 'ask') renderChat(false); else render({ keepScroll: true });
  } catch (e) { console.error(e); toast('Could not save it: ' + (e.message || e), 4000); btn.disabled = false; }
}
function openNoteSheet(iso) {
  openSheet(`<h3>${ico('note')} Note for ${esc(dateLabel(iso))}</h3><form id="noteForm" data-iso="${iso}" style="margin-top:10px"><textarea id="noteText" rows="4" maxlength="500" dir="auto" placeholder="e.g. Buy water and snacks for the ferry"></textarea><button class="btn primary wide" style="margin-top:10px">${ico('check', 'sm')} Save note</button></form>`);
  setTimeout(() => $('#noteText')?.focus(), 60);
}
function openTodoSheet() {
  openSheet(`<h3>${ico('calcheck')} Add a to-do</h3><form id="todoForm" class="form-grid" style="margin-top:10px" autocomplete="off">
    <label class="full"><span class="field-label">What</span><input id="tdTitle" maxlength="140" required dir="auto"></label>
    <label><span class="field-label">Day</span><input id="tdDue" type="date" value="${todayISO()}"></label><label><span class="field-label">Time</span><input id="tdTime" type="time"></label>
    <div class="full"><button class="btn primary wide">${ico('plus', 'sm')} Add</button></div></form>`);
  setTimeout(() => $('#tdTitle')?.focus(), 60);
}

/* ───────────── PDFs ───────────── */
async function resolveBlocks(blocks) {
  const out = [];
  for (const b of blocks) {
    if (b && b.t === 'image' && b.file && !b.src) { try { out.push({ ...b, src: await fileDataUrl(b.file) }); } catch { /* map unavailable: skip it */ } }
    else out.push(b);
  }
  return out;
}
async function exportPdf(spec, btn) {
  if (!spec) { toast('Nothing to put in a PDF yet'); return; }
  const old = btn?.innerHTML; if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin-sm"></span> Making PDF…'; }
  try {
    const blob = await makePdf({ ...spec, blocks: await resolveBlocks(spec.blocks), deliverIt: false });
    await saveFile(blob, spec.filename);
  } catch (e) { console.error(e); toast('Could not make the PDF. Try again.'); }
  finally { if (btn) { btn.disabled = false; btn.innerHTML = old; } }
}
async function saveFile(blob, filename) {
  try {
    const how = await deliver(blob, filename, true);
    if (how === 'downloaded') toast(`Saved: ${filename}`, 2600);
  } catch (e) {
    // iPhone needs a fresh tap to open the share sheet after a slow job
    state.readyFile = { blob, filename };
    openSheet(`<h3>${ico('check')} Your PDF is ready</h3><p class="sub">${esc(filename)} · ${Math.max(1, Math.round(blob.size / 1024))} KB</p>
      <div class="btn-row" style="margin-top:14px"><button class="btn primary wide" data-act="ready-save">${ico('share', 'sm')} Save or share</button></div>`);
  }
}

/* ───────────── DOCS ───────────── */
function bookingRow(b) {
  const icon = { flight: 'plane', hotel: 'hotel', transfer: 'bus', insurance: 'shield' }[b.kind] || 'ticket';
  const st = isCancelled(b) ? badge('Cancelled ✓', 'ok') : b.status === 'to-cancel' ? badge(deadlineText(b), 'danger') : b.status === 'active' ? badge('Active', 'ok') : badge('Paid', 'ok');
  return `<div class="doc-row" data-booking="${b.id}" role="button" tabindex="0"><span class="doc-ico ${b.status === 'to-cancel' && !isCancelled(b) ? 'red' : ''}">${ico(icon)}</span>
    <div class="grow"><b>${esc(b.title)}</b><div class="small">${esc(b.dates || b.subtitle || '')}${b.confirmation ? ' · ' + esc(b.confirmation) : ''}</div></div>${st}</div>`;
}
function viewDocs() {
  const Cn = C(), bk = Cn.bookings;
  const plan = Cn.files.filter(f => f.group === 'plan');
  const order = (u) => u.dayIso || '9999';
  const mine = state.udocs.slice().sort((a, b) => order(a).localeCompare(order(b)) || String(a.time || '').localeCompare(String(b.time || '')));
  const ins = bk.filter(b => b.kind === 'insurance');
  const html = `<div class="card add-card"><div class="row top">${ico('paperclip', 'lg')}<div class="grow"><b>Add a ticket or document</b>
      <div class="small">A PDF, screenshot or photo. ${aiReady() ? `${AI_NAME} reads it` : 'The app reads it'}, finds the day and the trip it belongs to and files it there.</div></div></div>
      <div class="btn-row" style="margin-top:10px"><button class="btn primary" data-act="add-doc">${ico('upload', 'sm')} Add a document</button></div></div>
    ${mine.length ? section(`Added by you (${mine.length})`) + `<div class="card">${mine.map(u => udocRow(u)).join('')}</div>` : ''}
    ${section('Trip plan')}<div class="card">${plan.map(f => `<div class="doc-row" data-doc="${f.id}" role="button" tabindex="0"><span class="doc-ico gold">${ico('filetext')}</span><div class="grow"><b>${esc(f.title)}</b><div class="small">${esc(f.note || '')}</div></div>${ico('chev', 'muted')}</div>`).join('')}</div>
    ${section('Flights')}<div class="card">${bk.filter(b => b.kind === 'flight').map(bookingRow).join('')}</div>
    ${section('Hotels')}<div class="card">${bk.filter(b => b.kind === 'hotel' && b.group !== 'archive').map(bookingRow).join('')}</div>
    ${section('Airport shuttles')}<div class="card">${bk.filter(b => b.kind === 'transfer').map(bookingRow).join('')}</div>
    ${ins.length ? section('Travel insurance', '<a href="#more/emergency">If something happens</a>') + `<div class="card">${ins.map(bookingRow).join('')}<div class="btn-row" style="margin-top:10px"><button class="btn sm ghost" data-ask="What does our insurance cover?">${ico('chat', 'sm')} What is covered?</button>${pdfBtn('insurance', 'Insurance PDF')}</div></div>` : ''}
    ${bk.some(b => b.group === 'archive') ? section(bk.filter(b => b.group === 'archive').every(isCancelled) ? 'Cancelled booking' : 'Backup booking to cancel') + `<div class="card">${bk.filter(b => b.group === 'archive').map(bookingRow).join('')}</div>` : ''}
    ${section('Route maps')}<div class="card">${Cn.days.filter(d => d.map).map(d => `<div class="doc-row" data-zoom="${d.map}" data-title="${esc(dateLabel(d.date))}" role="button" tabindex="0"><span class="doc-ico">${ico('map')}</span><div class="grow"><b>${esc(dateLabel(d.date))}</b><div class="small">${esc(d.title)}</div></div>${ico('maximize', 'muted')}</div>`).join('')}</div>
    ${section('Make a PDF')}<div class="pdf-grid">${[['trip', 'Whole trip', 'days'], ['budget', 'Budget', 'wallet'], ['food', 'Food & drink', 'food'], ['transport', 'Ferries & taxis', 'ferry'], ['phrases', 'Phrases & driver cards', 'languages'], ['driver', 'Driver cards', 'taxi'], ...(C().topics || []).map(tp => ['topic:' + tp.id, tp.title, 'star']), ['emergency', 'Emergency', 'shield'], ['todos', 'To-do list', 'calcheck'], ['tips', 'Tips & rules', 'bulb']]
      .map(([k, l, i]) => `<button class="pdf-tile" data-pdf="${k}">${ico(i)}<span>${esc(l)}</span>${ico('download', 'sm')}</button>`).join('')}</div>
    <p class="small center">Passports, Emirates IDs and visas are not stored in this app on purpose.</p>`;
  return { title: 'Documents', sub: 'Tickets, bookings, maps and PDFs', html };
}
function openBooking(id) {
  const b = bookingBy(id); if (!b) return;
  const cancelled = isCancelled(b);
  const rows = [['Status', cancelled ? (b.status === 'cancelled' ? 'Cancelled' : 'Cancelled (you ticked it)') : b.status === 'to-cancel' ? 'Cancel before the deadline' : 'Paid'], ['Dates', b.dates], ['When', b.kind === 'transfer' ? b.subtitle : null], ['Confirmation', b.confirmation], ['PIN', b.pin], ['Booked via', b.via],
    ['Room', b.room], ['Board', b.board], ['Check-in', b.checkin], ['Check-out', b.checkout], ['Cabin', b.cabin], ['Bags', b.bags], ['Tickets', b.tickets], ['Skywards', b.loyalty], ['Guests', b.guests], ['Price', b.price], ['Address', b.address], ['Phone', b.phone]].filter(r => r[1]);
  const copyKeys = new Set(['Confirmation', 'PIN', 'Skywards', 'Address', 'Phone']);
  const cell = (k, v) => k === 'Tickets' ? String(v).split(' · ').map(x => copyable(x.replace(/\s*\(.*\)$/, '')) + (/(\(.*\))$/.exec(x)?.[1] ? ` <span class="small">${esc(/(\(.*\))$/.exec(x)[1])}</span>` : '')).join('<br>') : copyKeys.has(k) ? copyable(v) : esc(v);
  const card = b.driverCard || null, cancelTodo = todoForBooking(b.id) || 'cancel-' + b.id;
  openSheet(`<h3>${esc(b.title)}</h3><p class="sub">${esc(b.subtitle || '')}</p>
    ${b.status === 'to-cancel' && !cancelled ? `<div class="callout red" style="margin-top:12px">${esc(b.cancel)}</div>` : ''}
    ${b.legs ? flightLegs(b) : ''}
    <dl class="kv" style="margin-top:14px">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${cell(k, v)}</dd>`).join('')}</dl>
    ${b.cancel && (b.status !== 'to-cancel' || cancelled) ? `<div class="callout ${cancelled ? 'ok' : ''}" style="margin-top:12px">${esc(b.cancel)}</div>` : ''}
    ${Array.isArray(b.notes) ? `<ul class="b-list">${b.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : b.notes ? `<p class="b-p">${esc(b.notes)}</p>` : ''}
    <div class="btn-row" style="margin-top:14px">${b.file ? `<button class="btn primary" data-doc="${b.file}">${ico('filetext', 'sm')} Open document</button>` : ''}${card ? `<button class="btn ghost" data-driver="${card}">${ico('taxi', 'sm')} Show driver</button>` : ''}${(b.more || []).map(m => `<button class="btn ghost" data-doc="${esc(m.file)}">${ico('receipt', 'sm')} ${esc(m.label)}</button>`).join('')}${b.phone ? `<a class="btn ghost" href="${tel(b.phone)}">${ico('phone', 'sm')} Call</a>` : ''}${b.whatsapp ? `<a class="btn ghost" href="https://wa.me/${b.whatsapp.replace(/\D/g, '')}" target="_blank" rel="noopener">${ico('msgcircle', 'sm')} WhatsApp</a>` : ''}${b.maps ? `<a class="btn ghost" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b.maps)}" target="_blank" rel="noopener">${ico('pin', 'sm')} Map</a>` : ''}${pdfBtn('booking:' + b.id, 'Summary PDF', 'btn ghost')}</div>
    ${b.status === 'to-cancel' ? `<label class="todo" style="margin-top:12px"><input type="checkbox" data-todo="${cancelTodo}" ${cancelled ? 'checked' : ''}><div class="grow"><div class="todo-title">I have cancelled it and got the e-mail</div></div></label>` : ''}`);
}

/* document viewer */
let pdfjsLib = null;
async function loadPdfjs() {
  if (!pdfjsLib) { pdfjsLib = await import('./vendor/pdf.min.mjs'); pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.mjs'; }
  return pdfjsLib;
}
async function openDoc(id) {
  const f = vaultFile(id); const meta = C().files.find(x => x.id === id) || (isUser(id) ? { title: udocBy(id.slice(2))?.title } : null);
  if (!f) { toast('Document missing'); return; }
  if (f.mime.startsWith('image/')) { openZoom(id, meta?.title || ''); return; }
  closeSheet();
  const v = $('#viewer'), body = $('#viewerBody');
  $('#viewerTitle').textContent = meta?.title || f.name; body.innerHTML = '<div class="spinner"></div>'; v.hidden = false; document.body.classList.add('noscroll');
  state.viewerFile = null;
  try {
    const bytes = await fileBytes(id);
    state.viewerFile = { blob: new Blob([bytes], { type: f.mime }), name: f.name };
    if (f.mime !== 'application/pdf') {
      const word = /wordprocessingml/.test(f.mime);
      body.innerHTML = `<div class="viewer-msg"><p><b>${esc(f.name)}</b></p><p style="margin-top:8px">${word ? 'This is a Word file. Save it with the button below, then open it in Word or Pages.' : 'This file cannot be shown here. Save it with the button below to open it.'}</p><button class="btn primary" style="margin-top:16px" data-act="viewer-save">${ico('download', 'sm')} Save the file</button></div>`;
      return;
    }
    const doc = await (await loadPdfjs()).getDocument({ data: bytes.slice(0) }).promise;
    const n = doc.numPages;
    $('#viewerTitle').textContent = `${meta?.title || f.name} · ${n} page${n > 1 ? 's' : ''}`;
    body.innerHTML = `<p class="viewer-msg small" id="viewerStatus">Loading page 1 of ${n}… you can already save it with the button at the top.</p>`;
    const width = Math.min(body.clientWidth - 20, 900), dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (let i = 1; i <= n; i++) {
      if ($('#viewer').hidden) return;
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 }); const vp = page.getViewport({ scale: (width / base.width) * dpr });
      const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height; c.style.width = `${Math.round(vp.width / dpr)}px`;
      body.insertBefore(c, $('#viewerStatus'));
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      const st = $('#viewerStatus'); if (st) { if (i < n) st.textContent = `Loading page ${i + 1} of ${n}…`; else st.remove(); }
    }
  } catch (e) { console.error(e); body.innerHTML = `<div class="viewer-msg">Could not open this document.<br><span class="small">${esc(e.message || e)}</span></div>`; }
}
function closeViewer() { $('#viewer').hidden = true; $('#viewerBody').innerHTML = ''; state.viewerFile = null; document.body.classList.remove('noscroll'); }
async function openZoom(id, title) {
  $('#zoomTitle').textContent = title || 'Route map'; $('#zoomImg').removeAttribute('src'); $('#zoomImg').classList.remove('big'); $('#zoom').hidden = false; document.body.classList.add('noscroll');
  try { $('#zoomImg').src = await fileUrl(id); } catch { toast('Map not available offline yet'); closeZoom(); }
}
function closeZoom() { $('#zoom').hidden = true; document.body.classList.remove('noscroll'); }
function openDriver(card, title = 'Show the driver') {
  $('#driver .overlay-title').textContent = title; $('#driverTr').textContent = card.tr; $('#driverEn').textContent = card.en || ''; $('#driver').hidden = false; document.body.classList.add('noscroll');
}
function closeDriver() { $('#driver').hidden = true; document.body.classList.remove('noscroll'); }
function driverForTrip(iso, n) {
  const d = dayBy(iso); const t = d?.trips.find(x => x.n === +n); if (!t) return null;
  const cards = C().driverCards, by = (id) => cards.find(c => c.id === id);
  if (t.mode === 'taxi_home' && hotelCard(d.hotel)) return by(hotelCard(d.hotel));
  const to = t.to || '';
  const nz = (s) => ' ' + String(s).replace(/İ/g, 'i').replace(/ı/g, 'i').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
  const hit = cards.find(c => (c.aliases || []).some(a => nz(to).includes(nz(a))));
  if (hit) return hit;
  const key = (name) => name.split(' (')[0].replace(/^(the|old)\s+/i, '').split(' ')[0].toLowerCase();
  const v = C().venues.find(x => x.day === iso && key(x.name).length >= 4 && to.toLowerCase().includes(key(x.name)));
  const city = cityInfo(d.city).tr;
  return { tr: `Lütfen bizi buraya götürün:\n${v ? v.name.split(' (')[0] + '\n' + v.area : to}\n${city}\nTaksimetre ile lütfen.`, en: `${to}${v ? ' · ' + v.area : ''}` };
}

/* ───────────── MORE ───────────── */
const TILES = [
  ['money', 'wallet', 'Money', 'Budget, spending log, converter'], ['food', 'food', 'Food & drink', 'Every place with prices'],
  ['transport', 'ferry', 'Getting around', 'Ferries, taxis, transport card'], ['phrases', 'languages', 'Phrases & driver', 'Turkish you can show'],
  ['todos', 'calcheck', 'Checklist', ''], ['tips', 'bulb', 'Tips & rules', 'Bills, fish, shisha, mosques'],
  ['emergency', 'shield', 'Emergency', '112, insurance, contacts'], ['settings', 'settings', 'Settings', 'Smart chat, cloud, lock'],
];
function viewMore() {
  const open = C().todos.filter(isOpen).length;
  return { title: 'More', sub: 'Money, food, transport and help', html: `<div class="tiles">${TILES.map(([k, i, t, s]) => `<a class="tile" href="#more/${k}"><span class="tile-ico">${ico(i)}</span><b>${esc(t)}</b><span>${esc(k === 'todos' ? `${open} open` : s)}</span></a>`).join('')}</div>` };
}
function viewMorePage(p) {
  const pages = { money: pageMoney, food: pageFood, transport: pageTransport, phrases: pagePhrases, todos: pageTodos, tips: pageTips, emergency: pageEmergency, settings: pageSettings };
  const f = pages[p]; if (!f) return viewMore();
  return { ...f(), back: '#more' };
}

const expAed = (e) => e.cur === 'TRY' ? e.amount / state.rate : +e.amount;
function pageMoney() {
  const M = C().money, ex = state.expenses.slice().sort((a, b) => b.date.localeCompare(a.date) || String(b.id).localeCompare(String(a.id)));
  const total = ex.reduce((s, e) => s + expAed(e), 0);
  const tr = ex.filter(e => e.cur === 'TRY').reduce((s, e) => s + +e.amount, 0), ae = ex.filter(e => e.cur !== 'TRY').reduce((s, e) => s + +e.amount, 0);
  const byCat = {}; ex.forEach(e => { byCat[e.cat] = (byCat[e.cat] || 0) + expAed(e); });
  const maxCat = Math.max(1, ...Object.values(byCat));
  // whole-trip spending plan = planned days + the free days, extras and SIM rows of the budget check
  const extraRows = M.budgetCheck.rows.filter(r => !/^(Planned|Total)/.test(r.label)).map(r => (r.aed.match(/[\d,]+/g) || []).map(x => +x.replace(/,/g, '')));
  const plannedLow = M.spendPlan?.aed[0] ?? M.plannedTotal.aed[0] + extraRows.reduce((s, r) => s + (r[0] || 0), 0);
  const plannedHigh = M.spendPlan?.aed[1] ?? M.plannedTotal.aed[1] + extraRows.reduce((s, r) => s + (r[1] || r[0] || 0), 0);
  const t = todayISO(), ds = C().days, defDate = t >= ds[0].date && t <= ds[ds.length - 1].date ? t : ds[0].date;
  const html = `<div class="hero slim"><div class="hero-kicker">Logged on this phone</div><div class="hero-title">${fmtAed(total)}</div>
      <div class="hero-sub">${fmtTry(tr)} + ${fmtAed(ae)} · ${ex.length} expense${ex.length === 1 ? '' : 's'}</div>
      <div class="progress light" style="margin-top:12px"><i style="width:${Math.min(100, total / plannedHigh * 100).toFixed(1)}%"></i></div>
      <div class="small light">Whole-trip spending plan ≈ AED ${nf0.format(plannedLow)}–${nf0.format(plannedHigh)}: food, taxis, tickets, free days, extras and SIM. Hotels and flights are already paid.</div></div>
    <form id="expForm" class="card"><h3>Log a spend</h3>
      <div class="form-grid" style="margin-top:12px">
        <label class="full"><span class="field-label">Amount</span><span class="field-row"><input id="expAmt" type="number" inputmode="decimal" min="0" step="any" placeholder="0" required>
          <span class="seg" id="expCur"><button type="button" data-cur="TRY" class="is-active">₺</button><button type="button" data-cur="AED">AED</button></span></span></label>
        <label><span class="field-label">Category</span><select id="expCat">${M.categories.map(c => `<option>${esc(c)}</option>`).join('')}</select></label>
        <label><span class="field-label">Date</span><input id="expDate" type="date" value="${defDate}" min="${C().meta.departNight}" max="${C().meta.tripEnd}"></label>
        <label class="full"><span class="field-label">Note</span><input id="expNote" type="text" placeholder="e.g. lunch, taxi, SIM" maxlength="80"></label>
      </div><button class="btn primary wide" style="margin-top:12px">${ico('plus', 'sm')} Add</button></form>
    <div class="card"><h3>Converter</h3><div class="form-grid" style="margin-top:10px">
      <label><span class="field-label">Turkish lira ₺</span><input id="cvTry" type="number" inputmode="decimal" placeholder="1000"></label>
      <label><span class="field-label">UAE dirham</span><input id="cvAed" type="number" inputmode="decimal" placeholder="${(1000 / state.rate).toFixed(0)}"></label></div>
      <p class="small" style="margin-top:8px">AED 1 ≈ ₺${state.rate} · €1 ≈ ₺${M.rates.tryPerEur}. Change it in Settings. Plan figures stay at the planning rate ₺${M.rates.tryPerAed}.</p></div>
    ${ex.length ? section('By category') + `<div class="card">${Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="hbar"><span class="lbl">${esc(k)}</span><span class="track"><i style="width:${(v / maxCat * 100).toFixed(1)}%"></i></span><span class="val mono">${fmtAed(v)}</span></div>`).join('')}</div>` : ''}
    ${section('Expenses', ex.length ? pdfBtn('spent', 'PDF', 'linkbtn') : '')}
    <div class="card">${ex.length ? ex.map(e => `<div class="exp"><div class="grow"><b>${esc(e.note || e.cat)}</b><div class="small">${esc(dateLabel(e.date))} · ${esc(e.cat)}</div></div><div class="exp-amt mono">${e.cur === 'TRY' ? fmtTry(e.amount) : fmtAed(e.amount)}${e.cur === 'TRY' ? `<small>${fmtAed(expAed(e))}</small>` : ''}</div><button class="icon-btn sm" data-del-exp="${esc(e.id)}" aria-label="Delete this expense">${ico('trash', 'sm')}</button></div>`).join('') : '<div class="empty">Nothing logged yet. Add your first spend above.</div>'}</div>
    ${section('The budget', pdfBtn('budget', 'PDF', 'linkbtn'))}
    <div class="callout ok"><b>${esc(M.budgetCheck.title)}</b> ${esc(M.budgetCheck.answer)}</div>
    <div class="card" style="margin-top:12px"><table class="tbl">${M.budgetCheck.rows.map((r, i, a) => `<tr class="${i === a.length - 1 ? 'total' : ''}"><td>${esc(r.label)}</td><td class="num">${esc(r.aed)}</td></tr>`).join('')}</table>
      <ul class="b-list" style="margin-top:10px">${M.budgetCheck.risks.map(r => `<li>${esc(r)}</li>`).join('')}</ul></div>
    <details class="card fold"><summary>${ico('days', 'sm')} Planned spending by day ${ico('chev', 'chev')}</summary><table class="tbl">${M.variable.map(r => `<tr><td><b>${esc(r.date)}</b><div class="small">${esc(r.plan)}</div></td><td class="num">${esc(r.totalAed)}</td></tr>`).join('')}</table>
      <div class="total-line"><span>${esc(M.plannedTotal.label)}</span><span>AED ${nf0.format(M.plannedTotal.aed[0])}–${nf0.format(M.plannedTotal.aed[1])}</span></div></details>
    <details class="card fold"><summary>${ico('check', 'sm')} Already paid · ${fmtAed(M.settledTotalAed)} ${ico('chev', 'chev')}</summary><table class="tbl">${M.settled.map(s => `<tr><td>${esc(s.label)}</td><td class="num">${s.aed ? fmtAed(s.aed) : esc(s.note || '—')}</td></tr>`).join('')}</table>
      <div class="total-line"><span>${esc(M.tripTotal.label)}</span><span>AED ${nf0.format(M.tripTotal.aed[0])}–${nf0.format(M.tripTotal.aed[1])}</span></div></details>`;
  return { title: 'Money', sub: `AED 1 ≈ ₺${state.rate}`, html };
}

function pageFood() {
  const V = C().venues;
  const days = [...new Set(V.map(v => v.day))].sort();
  const fd = state.foodDay ?? (days.includes(todayISO()) ? todayISO() : 'all');   // during the trip it opens on today
  let vs = V.filter(v => (state.foodKind === 'all' || v.kind === state.foodKind || (state.foodKind === 'meal' && v.kind === 'breakfast')) && (fd === 'all' || v.day === fd));
  const kinds = [['all', 'All'], ['meal', 'Meals'], ['coffee', 'Coffee'], ['shisha', 'Shisha']];
  const groups = days.filter(d => vs.some(v => v.day === d));
  const html = `<div class="chips">${kinds.map(([k, l]) => `<button class="chip ${state.foodKind === k ? 'on' : ''}" data-food-kind="${k}">${esc(l)}</button>`).join('')}</div>
    <div class="row" style="margin:6px 0 4px"><select id="foodDay" aria-label="Day"><option value="all">Every day</option>${days.map(d => `<option value="${d}" ${fd === d ? 'selected' : ''}>${esc(dateLabel(d))}</option>`).join('')}</select>${pdfBtn(fd === 'all' ? 'food' : 'food:' + fd)}</div>
    <p class="small" style="margin:6px 2px 10px">Prices for two. Main meal: 2 mains, 1 appetizer, 2 soft drinks. Shisha: 1 shisha, a Turkish coffee and a tea with mint.</p>
    ${groups.map(d => { const list = vs.filter(v => v.day === d); const main = list.filter(v => v.status !== 'option'), opt = list.filter(v => v.status === 'option');
      return section(`${dateLabel(d)} · ${dayBy(d)?.title || ''}`) + `<div class="card">${main.map(v => venueHtml(v)).join('')}${opt.length ? `${main.length ? '<div class="divider"></div>' : ''}<div class="small" style="font-weight:700;margin-bottom:4px">Options</div>${opt.map(v => venueHtml(v)).join('')}` : ''}</div>`; }).join('') || '<div class="empty">No places match.</div>'}`;
  return { title: 'Food & drink', sub: vs.length === V.length ? `${V.length} places` : `${vs.length} of ${V.length} places`, html };
}

function pageTransport() {
  const T = C().transport;
  const html = `<div class="btn-row page-actions">${pdfBtn('transport', 'Ferries & taxis PDF', 'btn primary')}</div>
    ${section('Ferries')}${T.ferries.map(f => `<div class="card"><div class="row top"><span class="doc-ico">${ico('ferry')}</span><div class="grow"><b>${esc(f.line)}</b><div class="small">${esc(f.from_)} → ${esc(f.to)} · ${esc(f.fare)}</div></div>${badge(f.used, /Oct/.test(f.used) ? 'sea' : '')}</div>
      ${f.times?.length ? `<div class="times"><span class="small">Out</span>${f.times.map(x => `<div>${esc(x)}</div>`).join('')}</div>` : ''}
      ${f.back?.length ? `<div class="times"><span class="small">Back</span>${f.back.map(x => `<div>${esc(x)}</div>`).join('')}</div>` : ''}
      ${f.note ? `<p class="small" style="margin-top:8px">${esc(f.note)}</p>` : ''}</div>`).join('')}
    ${section('Taxis')}<div class="card"><ul class="b-list">${T.taxi.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
      <div class="btn-row" style="margin-top:10px">${C().driverCards.filter(c => c.kind === 'hotel').map(c => `<button class="btn sm ghost" data-driver="${c.id}">${ico('taxi', 'sm')} ${esc(shortHotel(bookingBy(c.hotel)) || c.title)} card</button>`).join('')}<a class="btn sm ghost" href="#more/phrases">All cards</a></div></div>
    ${section(T.cardTitle || 'Transport card')}<div class="card"><ul class="b-list">${T.card.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
  return { title: 'Getting around', sub: `Ferries, taxis, ${T.cardTitle || 'transport card'}`, html };
}

function phraseHtml(p, i) { return `<div class="phrase" data-phrase="${i}" role="button" tabindex="0"><div class="phrase-tr">${esc(p.tr)}</div><div class="phrase-say">${esc(p.say)}</div><div class="phrase-en">${esc(p.en)}</div></div>`; }
function pagePhrases() {
  const html = `<div class="btn-row page-actions">${pdfBtn('phrases', 'Phrases & cards PDF', 'btn primary')}</div>
    ${section('Show the driver')}<div class="driver-grid">${C().driverCards.map(c => `<button class="driver-tile" data-driver="${c.id}">${ico('taxi')}<b>${esc(c.title)}</b><span>${esc(c.tr.split('\n').slice(0, 2).join(' · '))}</span></button>`).join('')}</div>
    ${section('Phrases', '<span class="small">Tap one to show it big</span>')}<div class="card">${C().phrases.map((p, i) => phraseHtml(p, i)).join('')}</div>`;
  return { title: 'Phrases & driver', sub: 'Tap to show it big', html };
}

function pageTodos() {
  const T = C().todos.slice().sort(byDue);
  const done = T.filter(t => isDone(t)), open = T.filter(isOpen), past = T.filter(t => tState(t) === 'missed');
  const html = `<div class="card"><div class="row"><div class="grow"><b>${done.length} of ${T.length} done</b></div>${pdfBtn('todos')}</div><div class="progress" style="margin-top:10px"><i style="width:${(done.length / T.length * 100).toFixed(1)}%"></i></div></div>
    ${section('To do', '<button data-act="todo-add">+ Add</button>')}<div class="card">${open.map(todoHtml).join('') || '<div class="empty">All done!</div>'}</div>
    ${past.length ? `<details class="card fold"><summary>${ico('clock', 'sm')} Past, not ticked (${past.length}) ${ico('chev', 'chev')}</summary>${past.map(todoHtml).join('')}</details>` : ''}
    ${done.length ? `<details class="card fold"><summary>${ico('check', 'sm')} Done (${done.length}) ${ico('chev', 'chev')}</summary>${done.map(todoHtml).join('')}</details>` : ''}`;
  return { title: 'Checklist', sub: `${open.length} open`, html };
}

function pageTips() {
  const html = `<div class="callout sea">${ico('clock', 'sm')} ${esc(C().meta.timezoneNote)}</div>
    <div class="btn-row page-actions" style="margin-top:12px">${pdfBtn('tips', 'Tips PDF', 'btn primary')}</div>
    ${C().tips.sections.map((s, i) => `<details class="card fold" ${i < 2 ? 'open' : ''}><summary>${ico(s.icon || 'info', 'sm')} ${esc(s.title)} ${ico('chev', 'chev')}</summary><ul class="b-list">${s.items.map(x => `<li>${linkify(x)}</li>`).join('')}</ul></details>`).join('')}`;
  return { title: 'Tips & rules', sub: 'Read once, then trust it', html };
}

function pageEmergency() {
  const E = C().emergency, hs = C().bookings.filter(b => b.kind === 'hotel' && !['to-cancel', 'cancelled'].includes(b.status));
  const I = C().insurance;
  const insCard = I ? `<div class="card ins-card"><div class="row top">${ico('shield', 'lg')}<div class="grow"><b>Travel insurance · call them first</b>
      <div class="small">${esc(I.insurer)} · ${esc(I.valid?.territory || 'Türkiye only')}. Life in danger: 112 first. Then call the insurer before paying for a doctor or hospital.</div>
      <dl class="kv" style="margin-top:8px">${(I.policies || []).map(p => `<dt>${esc(p.who)}</dt><dd>${copyable(p.policyNo)}</dd>`).join('')}</dl>
      <div class="btn-row" style="margin-top:10px"><a class="btn sm primary" href="${tel(I.hotline.call)}">${ico('phone', 'sm')} Call ${esc(I.hotline.call)}</a><a class="btn sm ghost" href="https://wa.me/${I.hotline.whatsapp.replace(/\D/g, '')}" target="_blank" rel="noopener">${ico('msgcircle', 'sm')} WhatsApp</a>
      <button class="btn sm ghost" data-ask="What does our insurance cover?">${ico('chat', 'sm')} What is covered?</button>${pdfBtn('insurance', 'PDF')}</div>
      <p class="small" style="margin-top:8px">Tell the chat what happened (for example “food poisoning” or “my phone was stolen”) and it says whether the insurance applies and what to do.</p></div></div></div>` : '';
  const html = `<a class="sos" href="tel:112">${ico('phone', 'lg')}<span><b>Call 112</b><small>Police · ambulance · fire · free</small></span></a>
    ${insCard}
    ${section('Numbers', pdfBtn('emergency', 'PDF', 'linkbtn'))}<div class="card">${E.map(e => `<div class="doc-row"><span class="doc-ico red">${ico('phone')}</span><div class="grow"><b>${esc(e.label)}</b>${e.note ? `<div class="small">${esc(e.note)}</div>` : ''}</div>${e.number ? `<a class="btn sm ghost" href="${tel(e.number)}">${esc(e.number)}</a>` : ''}</div>`).join('')}</div>
    ${section('Your hotels')}${hs.map(h => `<div class="card"><b>${esc(h.title)}</b><div class="small" style="margin-top:4px">${copyable(h.address)}</div><div class="btn-row" style="margin-top:10px"><a class="btn sm ghost" href="${tel(h.phone)}">${ico('phone', 'sm')} ${esc(h.phone)}</a>${h.driverCard ? `<button class="btn sm ghost" data-driver="${h.driverCard}">${ico('taxi', 'sm')} Show driver</button>` : ''}</div></div>`).join('')}`;
  return { title: 'Emergency', sub: '112 works everywhere', html };
}

const modelLabel = (id) => (state.aiModels || []).find(x => x.id === id)?.label || id || AI_NAME;
const modelOptions = (sel) => (state.aiModels || []).map(x => `<option value="${esc(x.id)}" ${x.id === sel ? 'selected' : ''}>${esc(x.label)}${x.note ? ' · ' + esc(x.note) : ''}</option>`).join('') || '<option value="">Default</option>';
function aiCardHtml() {
  if (!state.aiModels) aiApi().then(() => { if (route().b === 'settings') render({ keepScroll: true }); }).catch(() => {});
  const a = state.ai;
  if (!a?.key) return `<div class="card ai-card"><h3>${ico('sparkles')} Smart chat (free)</h3>
    <p class="sub">Turn the chat into a real AI (Google ${AI_NAME}, free): it knows your whole plan, answers anything, reads the tickets you add, makes PDFs, logs spending and tells you if the insurance covers something. It runs over the internet, so your computer can be off. Offline, the built-in helper still answers.</p>
    <ol class="steps small" style="margin-top:12px"><li>Open <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a> with your Google account.</li><li>Tap “Create API key” and copy it (it starts with AQ. or AIza). Do not set up billing: without billing it is free and can never charge you.</li><li>Paste it here once. It is saved encrypted in your cloud, so every phone that opens the app gets it.</li></ol>
    <form id="aiForm" autocomplete="off" style="margin-top:12px"><input id="aiKey" type="password" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="AQ.… or AIza…" aria-label="Google AI Studio API key">
      <button class="btn primary wide" id="aiSave" style="margin-top:12px">${ico('key', 'sm')} Save and test</button><p id="aiMsg" class="small" style="margin-top:6px"></p></form>
    <p class="small" style="margin-top:6px">On the free tier Google may use what you send to improve its products. Your questions, the trip plan and documents you add are sent to Google to answer; passports and IDs are not in the app.</p></div>`;
  const u = store.get('tr26.ai_usage', null);
  return `<div class="card ai-card"><h3>${ico('sparkles')} Smart chat (free)</h3>
    <p class="sub">${a.on === false ? 'Off: the chat uses the built-in helper.' : `On: the chat uses Google ${AI_NAME} whenever you are online.`}</p>
    <label class="check" style="margin-top:10px"><input type="checkbox" id="aiOn" ${a.on !== false ? 'checked' : ''}> <span>Use the AI in the chat</span></label>
    <label class="check" style="margin-top:6px"><input type="checkbox" id="aiWeb" ${a.web ? 'checked' : ''}> <span>Try Google Search for live questions (weather, news). Free keys often cannot use it; the app switches it off by itself if so.</span></label>
    ${(state.aiModels || []).length > 1 ? `<label style="display:block;margin-top:10px"><span class="field-label">Model</span><select id="aiModelSel">${modelOptions(a.model)}</select></label>` : ''}
    ${u ? `<p class="small" style="margin-top:8px">This phone: ${plural(u.calls, 'request')} since ${esc(dateLabel(String(u.since).slice(0, 10)))} · free</p>` : ''}
    <div class="btn-row" style="margin-top:10px"><button class="btn ghost" data-act="ai-test">${ico('check', 'sm')} Test</button><button class="btn ghost danger" data-act="ai-remove">${ico('trash', 'sm')} Remove key</button></div></div>`;
}
async function aiConnect() {
  const key = ($('#aiKey')?.value || '').trim(), msg = $('#aiMsg'), btn = $('#aiSave');
  if (!/^(AIza[\w-]{30,}|AQ\.[\w.-]{20,})$/.test(key)) { msg.textContent = 'That does not look like a Google AI Studio key (it starts with AQ. or AIza).'; return; }
  if (!(await ensureWriteKey())) return;
  btn.disabled = true; msg.textContent = 'Asking the AI…';
  try {
    const api = await aiApi(); const r = await api.testKey({ apiKey: key, model: null });
    if (!r.ok) { msg.textContent = r.message; btn.disabled = false; return; }
    change('settings', 'aiKey', { v: key }); setSetting('aiModel', r.model || null); setSetting('aiOn', true); setSetting('aiWeb', false);
    try { await navigator.storage?.persist?.(); } catch {}
    toast(`${AI_NAME} is on ✓`, 3000); render({ keepScroll: true });
  } catch (e) { console.error(e); msg.textContent = 'Could not reach the AI. Check the internet and try again.'; btn.disabled = false; }
}
function cloudCardHtml() {
  const has = !!setting('ghToken');
  return `<div class="card cloud-card"><h3>${ico('cloud')} Cloud sync</h3>
    <p class="sub">Everything you add here (documents, notes, to-dos, spending, ticks, the AI key) is encrypted with your passcode and saved in your GitHub repo. Any phone or computer that opens the app with the passcode gets it all.</p>
    <p class="small sync-line" id="syncLine" style="margin-top:8px">${syncLineHtml()}</p>
    ${has ? `<div class="btn-row" style="margin-top:10px"><button class="btn ghost" data-act="sync-now">${ico('refresh', 'sm')} Sync now</button><button class="btn ghost danger" data-act="gh-remove">${ico('trash', 'sm')} Remove token</button></div>`
      : `<ol class="steps small" style="margin-top:12px"><li>On github.com open Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token.</li><li>Only select repositories: this app's repository. Permissions → Contents: Read and write. Expiration: after the trip.</li><li>Copy the token (github_pat_…) and paste it here once. Other phones get it through the cloud after the passcode.</li></ol>
      <form id="ghForm" autocomplete="off" style="margin-top:12px"><input id="ghToken" type="password" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="github_pat_…" aria-label="GitHub token">
        <button class="btn primary wide" id="ghSave" style="margin-top:12px">${ico('key', 'sm')} Save and check</button><p id="ghMsg" class="small" style="margin-top:6px"></p></form>`}</div>`;
}
async function ghConnect() {
  const tok = ($('#ghToken')?.value || '').trim(), msg = $('#ghMsg'), btn = $('#ghSave');
  if (!/^(github_pat_|ghp_)\w{6,}$/.test(tok)) { msg.textContent = 'That does not look like a GitHub token (it starts with github_pat_).'; return; }
  if (!(await ensureWriteKey())) return;
  btn.disabled = true; msg.textContent = 'Checking with GitHub…';
  try {
    const c = await cloudApi(); if (!c) throw new Error('Cloud sync works on the published app only.');
    state.tokenTry = tok;
    const r = await c.check();
    if (!r.ok || !r.canWrite) { msg.textContent = r.message || 'This token cannot save to the repository. Check “Contents: Read and write”.'; btn.disabled = false; return; }
    setSetting('ghToken', tok);
    await syncNow(); toast('Cloud sync is on ✓', 3000); render({ keepScroll: true });
  } catch (e) { console.error(e); msg.textContent = state.cloudMod?.friendlyCloudError?.(e)?.message || e.message || 'Could not reach GitHub.'; btn.disabled = false; }
  finally { state.tokenTry = null; }
}
function pageSettings() {
  const m = state.manifest, M = C().meta;
  const mine = state.udocs.length + Object.values(state.notes).flat().length + C().todos.filter(t => t.user).length;
  const html = `${aiCardHtml()}
    ${cloudCardHtml()}
    <div class="card"><h3>${ico('paperclip')} Things you added</h3><p class="sub">${plural(state.udocs.length, 'document')}, ${plural(Object.values(state.notes).flat().length, 'note')}, ${plural(C().todos.filter(t => t.user).length, 'own to-do')} and ${plural(state.expenses.length, 'expense')}. The cloud keeps them; a backup file is a spare copy that only opens with the same passphrase.</p>
      <div class="btn-row" style="margin-top:10px"><button class="btn ghost" data-act="export-mine" ${mine || state.expenses.length ? '' : 'disabled'}>${ico('download', 'sm')} Save a backup</button><button class="btn ghost" data-act="import-mine">${ico('upload', 'sm')} Restore a backup</button></div></div>
    <div class="card"><h3>Exchange rate</h3><p class="sub">Used for your logged expenses and the converter. Plan figures stay at the planning rate.</p>
      <div class="field-row" style="margin-top:10px"><span class="pre">AED 1 = ₺</span><input id="rateInput" type="number" inputmode="decimal" step="0.01" min="5" max="40" value="${state.rate}"><button class="btn ghost" data-act="rate-reset">Reset</button></div>
      <p class="small" style="margin-top:6px">Plan rate ${C().money.rates.tryPerAed} on ${esc(C().money.rates.date)}.</p></div>
    <div class="card"><h3>App on this phone</h3>
      <div class="btn-row" style="margin-top:10px">${!isStandalone() && state.deferredInstall ? `<button class="btn primary" data-act="install">${ico('download', 'sm')} Install</button>` : ''}<button class="btn ghost" data-act="check-update">${ico('refresh', 'sm')} Check for updates</button></div>
      ${!isStandalone() ? `<p class="small" style="margin-top:8px">${isIOS() ? 'iPhone: in Safari tap Share, then “Add to Home Screen”.' : 'Android: in Chrome tap the ⋮ menu, then “Add to Home screen” or “Install app”.'}</p>` : ''}
      ${isStandalone() ? '<p class="small" style="margin-top:8px">Installed. It works offline after the first open.</p>' : ''}</div>
    <div class="card"><h3>Privacy</h3><p class="sub">Everything is encrypted. The passphrase never leaves this phone. “Lock now” hides the trip until the app is opened again; on a remembered phone it then opens by itself. To ask for the passphrase every time, use “Forget this device”.</p>
      <div class="btn-row" style="margin-top:10px"><button class="btn ghost" data-act="lock">${ico('lock', 'sm')} Lock now</button><button class="btn ghost" data-act="forget">${ico('eyeoff', 'sm')} Forget this device</button></div></div>
    <div class="card"><h3>Reset</h3><div class="btn-row" style="margin-top:10px"><button class="btn ghost" data-act="reset-todos">Untick the checklist</button><button class="btn ghost danger" data-act="reset-exp">Delete all expenses</button><button class="btn ghost" data-act="reset-chat">Clear the chat</button></div></div>
    <p class="small center">App ${esc(M.version)} · plan ${esc(M.planVersion)} · build ${esc(state.version || m?.built || '')}${SIM ? ` · TEST DATE ${esc(SIM)} ${esc(SIM_T || '')}` : ''}</p>`;
  return { title: 'Settings', html };
}

/* ───────────── sheet ───────────── */
function openSheet(html) { $('#sheetBody').innerHTML = html; $('#sheet').hidden = false; document.body.classList.add('noscroll'); hydrate($('#sheetBody')); }
function closeSheet() {
  $('#sheet').hidden = true; document.body.classList.remove('noscroll');
  if (state.writeKeyWait) { const r = state.writeKeyWait; state.writeKeyWait = null; r(false); }
  if (state.draft) { const d = state.draft; state.draft = null; if (d.chat) { d.chat.working = false; renderChat(false); } }
  if (state.inbox?.length) setTimeout(nextShared, 300);
}
function closeAll() { closeSheet(); closeViewer(); closeZoom(); closeDriver(); }

/* ───────────── events ───────────── */
function wire() {
  $('#lockForm').addEventListener('submit', (e) => { e.preventDefault(); unlockWith($('#pass').value, $('#remember').checked); });
  $('#togglePass').addEventListener('click', () => { const i = $('#pass'); i.type = i.type === 'password' ? 'text' : 'password'; $('#togglePass').textContent = i.type === 'password' ? 'Show' : 'Hide'; });
  $('#backBtn').addEventListener('click', () => go(state.back || '#today'));
  $('#settingsBtn').addEventListener('click', () => go('#more/settings'));
  $('#viewerClose').addEventListener('click', closeViewer);
  $('#zoomClose').addEventListener('click', closeZoom);
  $('#driverClose').addEventListener('click', closeDriver);
  $('#zoomImg').addEventListener('click', (e) => { const img = e.currentTarget, body = img.parentElement; const r = img.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height; img.classList.toggle('big');
    if (img.classList.contains('big')) requestAnimationFrame(() => { body.scrollLeft = fx * img.scrollWidth - body.clientWidth / 2; body.scrollTop = fy * img.scrollHeight - body.clientHeight / 2; }); });
  $('#viewerDownload').addEventListener('click', (e) => { e.preventDefault(); if (state.viewerFile) saveFile(state.viewerFile.blob, state.viewerFile.name); });
  $('#updateNow').addEventListener('click', applyUpdate);
  $$('.tab').forEach(t => t.addEventListener('click', () => { const h = '#' + t.dataset.tab; if (location.hash === h) window.scrollTo({ top: 0, behavior: 'smooth' }); else go(h); }));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role=button]')) { e.preventDefault(); e.target.click(); } });

  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-udoc-edit],[data-del-note],[data-del-todo],[data-aipdf],[data-undo],[data-pdf],[data-chatpdf],[data-doc],[data-booking],[data-zoom],[data-driver],[data-drive],[data-copy],[data-ask],[data-del-exp],[data-cur],[data-food-kind],[data-phrase],[data-venue],[data-act],[data-close-sheet]');
    if (!el || !state.content) return;
    const ds = el.dataset;
    if (ds.closeSheet !== undefined) { closeSheet(); return; }
    if (ds.pdf) { e.preventDefault(); exportPdf(pdfSpec(ds.pdf, ctx()), el); return; }
    if (ds.chatpdf) { const m = state.chat[+ds.chatpdf]; exportPdf(m?.res?.pdf, el); return; }
    if (ds.doc) { openDoc(ds.doc); return; }
    if (ds.booking) { openBooking(ds.booking); return; }
    if (ds.zoom) { openZoom(ds.zoom, ds.title || ''); return; }
    if (ds.driver) { const c = C().driverCards.find(x => x.id === ds.driver); if (c) openDriver(c); return; }
    if (ds.drive) { const [iso, n] = ds.drive.split('|'); const c = driverForTrip(iso, n); if (c) openDriver(c); return; }
    if (ds.copy) { copyText(ds.copy, 'Copied'); return; }
    if (ds.ask) { send(ds.ask); return; }
    if (ds.venue) { const v = venueBy(ds.venue); if (v) openSheet(`<h3>${esc(v.name)}</h3>${venueHtml(v, { showDay: true })}`); return; }
    if (ds.phrase) { const p = C().phrases[+ds.phrase]; if (p) openDriver({ tr: p.tr, en: `${p.say} · ${p.en}` }, 'Show this'); return; }
    if (ds.delExp) { if (confirm('Delete this expense?')) { delExpense(ds.delExp); render({ keepScroll: true }); } return; }
    if (ds.cur) { $$('#expCur button').forEach(b => b.classList.toggle('is-active', b === el)); return; }
    if (ds.foodKind) { state.foodKind = ds.foodKind; render({ keepScroll: true }); return; }
    if (ds.udocEdit) { e.preventDefault(); e.stopPropagation(); editUserDoc(ds.udocEdit); return; }
    if (ds.delNote) { if (confirm('Delete this note?')) { delNote(ds.delNote); render({ keepScroll: true }); } return; }
    if (ds.delTodo) { e.preventDefault(); if (confirm('Delete this to-do?')) { delUserTodo(ds.delTodo); render({ keepScroll: true }); } return; }
    if (ds.aipdf) { const [i, j] = ds.aipdf.split(':').map(Number); exportPdf(state.chat[i]?.pdfs?.[j], el); return; }
    if (ds.undo) {
      const [type, id] = ds.undo.split('|');
      if (type === 'expense') delExpense(id); else if (type === 'todo') delUserTodo(id); else if (type === 'note') delNote(id);
      state.chat.forEach(m => { if (m.undo) m.undo = m.undo.filter(a => !(a.type === type && String(a.id) === id)); });
      renderChat(false); toast('Undone'); return;
    }
    if (ds.act) return act(ds.act, el);
  });
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('[data-todo]')) {
      setDone(t.dataset.todo, t.checked);
      if (t.closest('.alert') || t.closest('#sheet')) { closeSheet(); render(); }
      else { t.closest('.todo')?.classList.toggle('done', t.checked); if (route().b === 'todos') render({ keepScroll: true }); }
      if (t.checked) toast('Done ✓');
      return;
    }
    if (t.id === 'foodDay') { state.foodDay = t.value; render({ keepScroll: true }); return; }
    if (t.id === 'docInput') { const f = t.files?.[0]; const pk = state.pick || {}; state.pick = null; if (f) ingestFile(f, pk); return; }
    if (t.id === 'restoreInput') { const f = t.files?.[0]; if (f) importMine(f); return; }
    if (t.id === 'pDay') { const tr = $('#pTrip'); tr.innerHTML = tripOpts(t.value || null, null); tr.disabled = !t.value; return; }
    if (t.id === 'aiOn' || t.id === 'aiWeb' || t.id === 'aiModelSel') {
      if (!state.ai) return;
      if (t.id === 'aiOn') setSetting('aiOn', t.checked); else if (t.id === 'aiWeb') setSetting('aiWeb', t.checked); else setSetting('aiModel', t.value || null);
      toast('Saved'); render({ keepScroll: true }); return;
    }
    if (t.id === 'rateInput') { const v = parseFloat(t.value); if (v >= 5 && v <= 40) { setSetting('rate', v); toast(`AED 1 = ₺${v}`); } else toast('Enter a rate between 5 and 40'); }
  });
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'cvTry') { const v = parseFloat(t.value); $('#cvAed').value = v > 0 ? (v / state.rate).toFixed(2) : ''; }
    if (t.id === 'cvAed') { const v = parseFloat(t.value); $('#cvTry').value = v > 0 ? (v * state.rate).toFixed(0) : ''; }
  });
  document.addEventListener('submit', (e) => {
    if (e.target.id === 'chatForm') { e.preventDefault(); if (state.aiBusy) { state.aiBusy.abort(); return; } const i = $('#chatInput'); const q = i.value; i.value = ''; send(q); return; }
    if (e.target.id === 'rekeyForm') { e.preventDefault(); rekey($('#rekeyPass').value).catch(err => { $('#rekeyMsg').textContent = 'Could not check it. Are you online?'; console.error(err); }); return; }
    if (e.target.id === 'propForm') { e.preventDefault(); saveDraft(); return; }
    if (e.target.id === 'noteForm') { e.preventDefault(); try { addNote(e.target.dataset.iso, $('#noteText').value); closeSheet(); render({ keepScroll: true }); toast('Note saved'); } catch (err) { toast(err.message); } return; }
    if (e.target.id === 'todoForm') { e.preventDefault(); try { addUserTodo({ title: $('#tdTitle').value, due: $('#tdDue').value, time: $('#tdTime').value }); closeSheet(); render({ keepScroll: true }); toast('Added'); } catch (err) { toast(err.message); } return; }
    if (e.target.id === 'aiForm') { e.preventDefault(); aiConnect(); return; }
    if (e.target.id === 'ghForm') { e.preventDefault(); ghConnect(); return; }
    if (e.target.id === 'expForm') {
      e.preventDefault();
      const amount = parseFloat($('#expAmt').value); if (!(amount > 0)) { toast('Enter an amount'); return; }
      const cur = $('#expCur .is-active')?.dataset.cur || 'TRY';
      const ex = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, date: $('#expDate').value || todayISO(), amount, cur, cat: $('#expCat').value, note: $('#expNote').value.trim() };
      ex.aed = cur === 'TRY' ? amount / state.rate : amount;
      change('expenses', ex.id, ex);
      render(); toast(`Added ${cur === 'TRY' ? fmtTry(amount) : fmtAed(amount)}`);
    }
  });
  document.addEventListener('click', (e) => {
    if (e.target.closest('#micBtn')) micTap();
    if (e.target.closest('#recCancel')) finishVoice(true);
    if (e.target.closest('#attachBtn')) pickFile('chat');
    const sp = e.target.closest('[data-speak]'); if (sp) speakMsg(+sp.dataset.speak);
  });
  const netChange = () => { if (state.content && route().a === 'ask' && !state.aiBusy) render({ keepScroll: true }); };
  window.addEventListener('online', netChange); window.addEventListener('offline', netChange);
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); state.deferredInstall = e; });
  window.addEventListener('appinstalled', () => { store.set('tr26.inst_optout', true); state.deferredInstall = null; toast('Installed. Find it on your home screen.'); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { checkVersion(); if (state.content && ['today'].includes(route().a)) render(); } });
}
async function act(a, el) {
  switch (a) {
    case 'install': if (state.deferredInstall) { const ev = state.deferredInstall; state.deferredInstall = null; ev.prompt(); try { const r = await ev.userChoice; if (r.outcome === 'accepted') store.set('tr26.inst_optout', true); } catch {} render(); } break;
    case 'install-hide': store.set('tr26.inst_optout', true); render(); break;
    case 'lock': lockNow(false); break;
    case 'forget': if (confirm('Forget the passphrase on this phone? You will need to type it again.')) lockNow(true); break;
    case 'reset-todos': if (confirm('Untick every to-do, on every phone?')) { for (const t of C().todos) if (isDone(t)) setDone(t.id, false); render(); } break;
    case 'reset-exp': if (confirm('Delete every logged expense, on every phone? This cannot be undone.')) { for (const e of state.expenses) delExpense(e.id); render(); } break;
    case 'reset-chat': state.chat = []; state.aiHistory = []; toast('Chat cleared'); break;
    case 'add-doc': pickFile(route().a === 'ask' ? 'chat' : 'docs', el.dataset.iso || null); break;
    case 'note-add': if (await ensureWriteKey()) openNoteSheet(el.dataset.iso); break;
    case 'todo-add': openTodoSheet(); break;
    case 'trip-done': setProgress(el.dataset.iso, +el.dataset.n); render({ keepScroll: true }); toast('Done ✓'); break;
    case 'trip-undo': setProgress(el.dataset.iso, (state.progress[el.dataset.iso] || 0) - 1); render({ keepScroll: true }); break;
    case 'udoc-del': { const id = state.draft?.edit; if (id && confirm('Delete this document from this phone?')) { state.draft = null; closeSheet(); await deleteUserDoc(id); render({ keepScroll: true }); toast('Deleted'); } break; }
    case 'ai-toggle': if (state.ai) { setSetting('aiOn', state.ai.on === false); render({ keepScroll: true }); toast(state.ai.on ? (navigator.onLine === false ? `${AI_NAME} is on (when you are online)` : `${AI_NAME} is on`) : 'Built-in helper'); } break;
    case 'ai-test': { el.disabled = true; try { const api = await aiApi(); const r = await api.testKey({ apiKey: state.ai.key, model: state.ai.model }); toast(r.ok ? `${AI_NAME} answered ✓` : r.message, 4000); } catch (err) { toast('Could not reach the AI', 3500); } el.disabled = false; break; }
    case 'ai-remove': if (confirm('Remove the AI key from every phone?')) { setSetting('aiKey', null); state.aiHistory = []; render({ keepScroll: true }); toast('Key removed'); } break;
    case 'sync-now': { el.disabled = true; await syncNow(); el.disabled = false; toast(state.sync?.s === 'ok' ? 'Synced ✓' : (state.sync?.msg || 'Not synced'), 3000); break; }
    case 'gh-remove': if (confirm('Remove the GitHub token from every phone? Cloud saving stops until a token is added again. (To be safe, also delete the token on github.com.)')) {
      state.tokenTry = setting('ghToken'); setSetting('ghToken', null); try { await syncNow(); } finally { state.tokenTry = null; } render({ keepScroll: true }); toast('Token removed'); } break;
    case 'export-mine': exportMine(el); break;
    case 'import-mine': { const i = $('#restoreInput'); i.value = ''; i.click(); break; }
    case 'rate-reset': setSetting('rate', null); render(); toast(`AED 1 = ₺${state.rate}`); break;
    case 'check-update': { el.disabled = true; const changed = await checkVersion(true); el.disabled = false; if (!changed) toast('You have the latest version'); break; }
    case 'viewer-save': if (state.viewerFile) saveFile(state.viewerFile.blob, state.viewerFile.name); break;
    case 'ready-save': if (state.readyFile) { const f = state.readyFile; try { await deliver(f.blob, f.filename, true); closeSheet(); } catch { const u = URL.createObjectURL(f.blob); window.open(u, '_blank'); } } break;
  }
}

/* ───────────── updates ───────────── */
/* index.html carries the build it belongs to; version.json on the server says what is live */
const SHELL_BUILD = document.querySelector('meta[name="app-build"]')?.content || 'dev';
async function checkVersion(manual = false) {
  try {
    const r = await fetch('./version.json?t=' + Date.now(), { cache: 'no-store' }); if (!r.ok) return false;
    const v = (await r.json()).version;
    state.version = SHELL_BUILD !== 'dev' ? SHELL_BUILD : (state.version || v);
    if (v && v !== state.version) { $('#updateBar').hidden = false; if (manual) toast('A new version is ready'); return true; }
  } catch {}
  return false;
}
async function applyUpdate() {
  state.updating = true; $('#updateNow').disabled = true; $('#updateNow').textContent = 'Updating…';
  try { const reg = await navigator.serviceWorker?.getRegistration(); await reg?.update(); } catch {}
  try { const ks = await caches.keys(); await Promise.all(ks.filter(k => k.startsWith('tr26-')).map(k => caches.delete(k))); } catch {}
  location.reload();
}
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', async () => {
    // the shell is always fetched fresh, so a new worker needs no reload; checkVersion shows the bar if this page is older than the server
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (state.updating) location.reload(); else checkVersion(); });
    try { const reg = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }); reg.update().catch(() => {}); } catch (e) { console.warn('sw', e); }
  });
  setInterval(() => { if (!document.hidden) checkVersion(); }, 10 * 60 * 1000);
}

/* ───────────── start ───────────── */
wire();
$('#settingsBtn').innerHTML = ico('settings'); $('#backBtn').innerHTML = ico('chevleft');
$('#viewerClose').innerHTML = ico('close'); $('#viewerDownload').innerHTML = ico('download'); $('#zoomClose').innerHTML = ico('close'); $('#driverClose').innerHTML = ico('close');
const TAB_ICO = { today: 'today', days: 'days', ask: 'chat', docs: 'ticket', more: 'grid' };
$$('.tab').forEach(t => { t.querySelector('.tab-ico').innerHTML = ico(TAB_ICO[t.dataset.tab]); t.setAttribute('aria-label', t.textContent.trim()); });
if (SIM) window.__tr26 = { state, pdfSpec, ctx, resolveBlocks, makePdf, answer, fileDataUrl };   // QA hook, only with ?today=
new MutationObserver(() => { if (state.pendingAsk && $('#chat')) { const q = state.pendingAsk; state.pendingAsk = null; send(q); } }).observe($('#view'), { childList: true });
(async () => {
  checkVersion();
  const showLock = () => $('#lock').classList.remove('pending');
  try { await loadManifest(); } catch { showLock(); lockMsg('Cannot reach the vault. Check your connection.', true); return; }
  if (!(await tryAutoUnlock())) { showLock(); $('#pass').focus(); }
})();
