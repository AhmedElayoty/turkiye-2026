/* Türkiye 2026 · trip companion
   All personal content arrives encrypted from ./vault and is decrypted in the browser. */

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const state = {
  manifest: null, key: null, content: null,
  rate: 12.22, tab: 'today', dayId: null,
  expenses: [], todosDone: {}, deferredInstall: null, blobUrls: [],
};

/* ───────────────────────── icons ───────────────────────── */
const P = {
  today: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="M8 14h3v3H8z"/>',
  days:  '<path d="M9 18l-6 3V6l6-3 6 3 6-3v15l-6 3-6-3z"/><path d="M9 3v15M15 6v15"/>',
  ticket:'<path d="M3 9a2 2 0 0 0 2-2V5h14v2a2 2 0 0 0 0 4v2a2 2 0 0 0 0 4v2H5v-2a2 2 0 0 0-2-2z"/><path d="M13 5v14" stroke-dasharray="2 3"/>',
  wallet:'<rect x="2" y="6" width="20" height="14" rx="2"/><path d="M2 10h20"/><path d="M16 15h2"/>',
  bulb:  '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 1 4 10.5c-.7.6-1 1.3-1 2.5H9c0-1.2-.3-1.9-1-2.5A6 6 0 0 1 12 3z"/>',
  settings:'<path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  pin:   '<path d="M12 21s-7-7.6-7-12a7 7 0 0 1 14 0c0 4.4-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.1 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.9.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
  copy:  '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  taxi:  '<path d="M5 17H3v-5l2-5h14l2 5v5h-2"/><path d="M5 12h14"/><circle cx="7.5" cy="17" r="2"/><circle cx="16.5" cy="17" r="2"/><path d="M9 7V4h6v3"/>',
  ferry: '<path d="M3 18c1.5 1 3 1 4.5 0s3-1 4.5 0 3 1 4.5 0 3-1 4.5 0"/><path d="M4 15l1.5-4h13L20 15"/><path d="M7 11V7h10v4"/><path d="M11 7V4h2v3"/>',
  walk:  '<circle cx="13" cy="4" r="1.6"/><path d="M8 21l3-7 2 2v5"/><path d="M11 14l-1-4 3-2 2 3 3 1"/><path d="M10 10l-3 3"/>',
  plane: '<path d="M2 12l20-8-8 20-2-9z"/>',
  bus:   '<rect x="4" y="3" width="16" height="15" rx="2"/><path d="M4 10h16M8 18v3M16 18v3"/><circle cx="8" cy="14" r="1"/><circle cx="16" cy="14" r="1"/>',
  food:  '<path d="M4 3v7a3 3 0 0 0 6 0V3M7 3v18"/><path d="M17 3c-2 0-3 3-3 6s1 4 3 4v8"/>',
  bed:   '<path d="M3 18v-7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v7"/><path d="M3 18h18M5 9V6a1 1 0 0 1 1-1h5v4M13 9V5h5a1 1 0 0 1 1 1v3"/>',
  camera:'<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/>',
  smoke: '<path d="M4 20h10"/><path d="M9 20v-6"/><path d="M6 14h6"/><path d="M9 14V9"/><path d="M15 8c1-1 1-2 0-3s-1-2 0-3M19 10c1-1 1-2 0-3s-1-2 0-3"/>',
  bag:   '<path d="M6 7h12l1 14H5z"/><path d="M9 7V5a3 3 0 0 1 6 0v2"/>',
  sun:   '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  info:  '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h0"/>',
  alert: '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h0"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  lock:  '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  download:'<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  external:'<path d="M14 3h7v7"/><path d="M21 3l-9 9"/><path d="M19 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6"/>',
  close: '<path d="M18 6L6 18M6 6l12 12"/>',
  chev:  '<path d="M9 6l6 6-6 6"/>',
  receipt:'<path d="M5 3h14v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L7 21l-2-1.5z"/><path d="M9 8h6M9 12h6M9 16h4"/>',
  fish:  '<path d="M3 12c3-4 7-6 11-6 3 0 5 2 7 6-2 4-4 6-7 6-4 0-8-2-11-6z"/><path d="M3 12l-1-4M3 12l-1 4"/><circle cx="16" cy="11" r="1"/>',
  mosque:'<path d="M4 21V12a8 8 0 0 1 16 0v9"/><path d="M2 21h20M12 4V2M9 12h6v9H9z"/>',
  chat:  '<path d="M21 12a8 8 0 0 1-8 8H8l-5 3 1.5-4.5A8 8 0 1 1 21 12z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  home:  '<path d="M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1z"/>',
  plus:  '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  route: '<circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h6a4 4 0 0 0 0-8H9a4 4 0 0 1 0-8h7"/>',
};
const ico = (n, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[n] || P.info}</svg>`;

/* ───────────────────────── utils ───────────────────────── */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k)    { try { localStorage.removeItem(k); } catch {} },
};
const nf0 = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });
const fmtAed = (n) => `AED ${nf0.format(Math.round(n))}`;
const fmtTry = (n) => `₺${nf0.format(Math.round(n))}`;
const toAed  = (t) => t / state.rate;
const pad = (n) => String(n).padStart(2, '0');
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const isoToDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
const daysBetween = (a, b) => Math.round((isoToDate(b) - isoToDate(a)) / 86400000);
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dateLabel = (iso, withDow = true) => { const d = isoToDate(iso); return `${withDow ? DOW[d.getDay()] + ' ' : ''}${d.getDate()} ${MON[d.getMonth()]}`; };
const parseHM = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ''); return m ? (+m[1]) * 60 + (+m[2]) : null; };
const nowMinutes = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const cityFor = (day) => /Antalya/.test(day.city) && !/Istanbul/.test(day.title) ? 'Antalya' : 'Istanbul';
const mapsSearch = (q, city) => {
  const hasCity = /istanbul|antalya|dubai|abu dhabi/i.test(q);
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(hasCity ? q : `${q}, ${city}`)}`;
};
const mapsDir = (from, to, mode, city) => {
  const tm = mode === 'walk' ? 'walking' : mode === 'ferry' || mode === 'bus' || mode === 'tram' ? 'transit' : 'driving';
  const fix = (q) => /istanbul|antalya|dubai|abu dhabi|airport/i.test(q) ? q : `${q}, ${city}`;
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(fix(from))}&destination=${encodeURIComponent(fix(to))}&travelmode=${tm}`;
};
const costText = (c) => {
  if (!c) return '';
  if (c.cur === 'AED') return c.low === c.high ? fmtAed(c.low) : `${fmtAed(c.low)}–${nf0.format(c.high)}`;
  const t = c.low === c.high ? fmtTry(c.low) : `${fmtTry(c.low)}–${nf0.format(c.high)}`;
  const a = c.low === c.high ? fmtAed(toAed(c.low)) : `AED ${nf0.format(toAed(c.low))}–${nf0.format(toAed(c.high))}`;
  return `${t} · ${a}`;
};
let toastTimer;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, 1800); }
async function copyText(txt, label = 'Copied') {
  try { await navigator.clipboard.writeText(txt); toast(label); }
  catch { const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); toast(label); } catch { toast('Could not copy'); } ta.remove(); }
}

/* ───────────────────────── IndexedDB (CryptoKey) ───────────────────────── */
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('tr26', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function idbGet(k) { try { const db = await idb(); return await new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); } catch { return undefined; } }
async function idbSet(k, v) { try { const db = await idb(); await new Promise((res, rej) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); } catch {} }
async function idbDel(k) { try { const db = await idb(); await new Promise((res) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').delete(k); tx.oncomplete = res; tx.onerror = res; }); } catch {} }

/* ───────────────────────── crypto ───────────────────────── */
const b64d = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function loadManifest() {
  if (state.manifest) return state.manifest;
  const r = await fetch('./vault/manifest.json', { cache: 'no-cache' });
  if (!r.ok) throw new Error('manifest');
  state.manifest = await r.json();
  return state.manifest;
}
async function deriveKey(pass) {
  const m = await loadManifest();
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: b64d(m.kdf.salt), iterations: m.kdf.iterations, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
}
async function fetchEnc(path) { const r = await fetch(path); if (!r.ok) throw new Error(path); return new Uint8Array(await r.arrayBuffer()); }
async function decryptBytes(key, buf) {
  const iv = buf.slice(0, 12), ct = buf.slice(12);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct));
}
async function keyWorks(key) {
  try { const m = await loadManifest(); const p = await decryptBytes(key, await fetchEnc('./' + m.files.probe.path)); return new TextDecoder().decode(p) === 'turkiye-2026-ok'; }
  catch { return false; }
}
async function loadContent(key) {
  const m = await loadManifest();
  const plain = await decryptBytes(key, await fetchEnc('./' + m.files.content.path));
  return JSON.parse(new TextDecoder().decode(plain));
}

/* ───────────────────────── lock flow ───────────────────────── */
const lockMsg = (t, err = false) => { const el = $('#lockMsg'); el.textContent = t; el.classList.toggle('err', err); };
async function unlockWith(pass, remember) {
  const btn = $('#unlockBtn'); btn.disabled = true; lockMsg('Deriving key…');
  try {
    const key = await deriveKey(pass.trim());
    lockMsg('Checking…');
    if (!(await keyWorks(key))) { lockMsg('That passphrase is not right.', true); btn.disabled = false; return; }
    if (remember) await idbSet('key', key); else await idbDel('key');
    lockMsg('Opening…');
    await boot(key);
  } catch (e) { console.error(e); lockMsg('Something went wrong. Are you online for the first unlock?', true); btn.disabled = false; }
}
async function tryAutoUnlock() {
  const key = await idbGet('key');
  if (!key) return false;
  if (!(await keyWorks(key))) { await idbDel('key'); return false; }
  await boot(key);
  return true;
}
async function boot(key) {
  state.key = key;
  state.content = await loadContent(key);
  state.rate = store.get('tr26.rate', state.content.meta.tryPerAed);
  state.expenses = store.get('tr26.expenses', []);
  state.todosDone = store.get('tr26.todos', {});
  const t = todayISO();
  const inTrip = state.content.days.find(d => d.date === t);
  state.dayId = inTrip ? inTrip.id : (t > state.content.meta.tripEnd ? state.content.days.at(-1).id : state.content.days[0].id);
  $('#lock').hidden = true; $('#app').hidden = false;
  renderAll();
}
function lockNow(forget = false) {
  if (forget) idbDel('key');
  state.key = null; state.content = null;
  $('#app').hidden = true; $('#lock').hidden = false; $('#pass').value = ''; lockMsg(forget ? 'This device was forgotten.' : 'Locked.');
  $('#unlockBtn').disabled = false; closeSheet();
}

/* ───────────────────────── render: shared ───────────────────────── */
const C = () => state.content;
const dayByDate = (iso) => C().days.find(d => d.date === iso);
const dayIndex = (id) => C().days.findIndex(d => d.id === id);
const bookingById = (id) => C().bookings.find(b => b.id === id);
function tripStatus() {
  const t = todayISO(), m = C().meta;
  if (t < m.tripStart) return { phase: 'before', days: daysBetween(t, m.tripStart) };
  if (t > m.tripEnd) return { phase: 'after' };
  const idx = dayIndex(dayByDate(t)?.id);
  return { phase: 'during', idx, dayNum: idx };  // d10 is 0 = departure night, d11 = Day 1
}
function hotelForDate(iso) {
  if (iso >= '2026-10-11' && iso <= '2026-10-14') return bookingById('hotel-antalya-concorde');
  if (iso >= '2026-10-15' && iso <= '2026-10-24') return bookingById('hotel-istanbul-arise');
  return null;
}
function nextFlight(iso) {
  if (iso <= '2026-10-10') return bookingById('flight-auh-ayt');
  if (iso <= '2026-10-14') return bookingById('flight-ayt-ist');
  if (iso <= '2026-10-25') return bookingById('flight-ist-dxb');
  return null;
}
const stopIcon = (s) => s.type === 'transport' && s.transport ? (P[s.transport.mode] ? s.transport.mode : 'route')
  : ({ flight: 'plane', hotel: 'bed', food: 'food', sight: 'camera', shisha: 'smoke', shop: 'bag', free: 'sun', note: 'info' }[s.type] || 'info');
const stopDotClass = (s) => s.type === 'transport' && s.transport ? s.transport.mode : s.type;

function copyRow(lbl, val) {
  return `<div class="copyrow"><div><div class="lbl">${esc(lbl)}</div><div class="val mono">${esc(val)}</div></div>
    <button type="button" data-copy="${esc(val)}">${ico('copy')} Copy</button></div>`;
}
function todoRow(t) {
  const done = !!state.todosDone[t.id], today = todayISO();
  const overdue = !done && t.due < today;
  return `<label class="todo ${done ? 'done' : ''} ${overdue ? 'overdue' : ''} ${t.critical ? 'critical' : ''}">
    <input type="checkbox" data-todo="${t.id}" ${done ? 'checked' : ''}>
    <div><div class="t">${esc(t.title)}</div>
      <div class="d">${overdue ? 'Overdue · was ' : 'Due '}${dateLabel(t.due)}${t.note ? ' · ' + esc(t.note) : ''}</div></div></label>`;
}

/* ───────────────────────── render: today ───────────────────────── */
function renderToday() {
  const t = todayISO(), st = tripStatus(), m = C().meta;
  const day = dayByDate(t);
  let hero;
  if (st.phase === 'before') {
    hero = `<div class="hero-kicker">${st.days === 1 ? 'Tomorrow' : `${st.days} days to go`}</div>
      <div class="hero-title">${esc(m.subtitle)}</div>
      <div class="hero-sub">${esc(m.occasion)} · ${C().meta.travellers.join(' & ')}</div>
      <div class="hero-row"><span class="chip onhero">${ico('plane')} Sat 10 Oct · leave home 22:30</span><span class="chip onhero">${ico('clock')} TR is 1 h behind UAE</span></div>`;
  } else if (st.phase === 'after') {
    hero = `<div class="hero-kicker">Welcome home</div><div class="hero-title">Türkiye 2026</div><div class="hero-sub">Log the last expenses while you remember them.</div>`;
  } else {
    hero = `<div class="hero-kicker">${st.dayNum === 0 ? 'Departure night' : `Day ${st.dayNum} of 15`} · ${esc(day.city)}</div>
      <div class="hero-title">${esc(day.title)}</div><div class="hero-sub">${esc(day.vibe || '')}</div>
      <div class="hero-row">${day.sunset ? `<span class="chip onhero">${ico('sun')} Sunset ${day.sunset}</span>` : ''}${day.weather ? `<span class="chip onhero">${esc(day.weather)}</span>` : ''}
        <span class="chip onhero">${ico('wallet')} ${fmtAed(day.estAed[0])}–${nf0.format(day.estAed[1])} today</span></div>`;
  }

  // next up
  let next = '';
  if (day) {
    const now = nowMinutes();
    const timed = day.stops.filter(s => parseHM(s.time) != null);
    const up = timed.find(s => parseHM(s.time) >= now - 10) || null;
    if (up) {
      next = `<div class="card"><div class="card-title">${ico('clock')} Next up</div>
        <div class="nextup"><div class="nextup-time">${esc(up.time)}</div>
        <div><div class="nextup-title">${esc(up.title)}</div>${up.place ? `<a class="place" href="${mapsSearch(up.place, cityFor(day))}" target="_blank" rel="noopener">${ico('pin')} ${esc(up.place)}</a>` : ''}
        ${up.transport ? `<div class="small muted" style="margin-top:4px">${esc(up.transport.from)} → ${esc(up.transport.to)}${up.transport.mins ? ` · ${esc(up.transport.mins)} min` : ''}</div>` : ''}</div></div>
        <div class="row" style="margin-top:12px"><button class="linkbtn teal" data-goto-day="${day.id}">${ico('days')} Open today's plan</button></div></div>`;
    } else {
      const nxt = C().days[dayIndex(day.id) + 1];
      next = `<div class="card"><div class="card-title">${ico('clock')} Today is done</div>
        <p>${nxt ? `Tomorrow: <b>${esc(nxt.title)}</b>. First stop ${esc(nxt.stops[0].time)} · ${esc(nxt.stops[0].title)}.` : 'Safe travels home.'}</p>
        ${nxt ? `<div class="row" style="margin-top:10px"><button class="linkbtn" data-goto-day="${nxt.id}">${ico('arrow')} Preview tomorrow</button></div>` : ''}</div>`;
    }
  } else if (st.phase === 'before') {
    const d0 = C().days[0];
    next = `<div class="card"><div class="card-title">${ico('clock')} First move</div>
      <div class="nextup"><div class="nextup-time">${esc(d0.stops[1].time)}</div><div><div class="nextup-title">${esc(d0.stops[1].title)}</div><div class="small muted">Sat 10 Oct · TK869 departs 01:30</div></div></div>
      <div class="row" style="margin-top:12px"><button class="linkbtn teal" data-goto-day="d11">${ico('days')} Open day one</button></div></div>`;
  }

  // hotel tonight
  const h = hotelForDate(t) || (st.phase === 'before' ? bookingById('hotel-antalya-concorde') : null);
  const hotel = h ? `<div class="card"><div class="card-title">${ico('bed')} ${hotelForDate(t) ? 'Tonight' : 'First hotel'}</div>
      <h3>${esc(h.title)}</h3><div class="bk-sub">${esc(h.dates)} · check-in ${esc(h.checkin)}</div>
      <div class="stack" style="margin-top:10px">${copyRow('Confirmation', h.confirmation)}${copyRow('PIN', h.pin)}</div>
      <div class="bk-actions"><a class="linkbtn" href="tel:${h.phone.replace(/\s/g, '')}">${ico('phone')} Call</a>
        <a class="linkbtn" href="${mapsSearch(h.maps, '')}" target="_blank" rel="noopener">${ico('pin')} Directions</a>
        <button class="linkbtn" data-open-doc="${h.id}">${ico('ticket')} Confirmation</button></div></div>` : '';

  // next flight
  const f = nextFlight(t);
  const flight = f ? `<div class="card"><div class="card-title">${ico('plane')} Next flight</div>
      <h3>${esc(f.title)}</h3><div class="bk-sub">${esc(f.subtitle)} · ${esc(f.dates)}</div>
      <div class="legs">${f.legs.map(l => `<div class="legrow"><div class="fl">${esc(l.flight)}</div><div class="times">${esc(l.from)} → ${esc(l.to)}</div><div class="seat">${esc(l.seats)}</div></div>`).join('')}</div>
      <div class="stack" style="margin-top:10px">${copyRow('Booking reference', f.confirmation)}</div>
      <div class="bk-actions"><button class="linkbtn" data-open-doc="${f.id}">${ico('ticket')} Ticket</button></div></div>` : '';

  // to-dos due within 7 days or overdue
  const openTodos = C().todos.filter(x => !state.todosDone[x.id]).sort((a, b) => a.due.localeCompare(b.due));
  const soon = openTodos.filter(x => daysBetween(t, x.due) <= 10);
  const due = (soon.length ? soon : openTodos).slice(0, 6);
  const todos = due.length ? `<div class="card"><div class="card-title">${ico('check')} ${soon.length ? 'Coming up' : 'Next to book'}</div>${due.map(todoRow).join('')}
      <div class="row" style="margin-top:10px"><button class="linkbtn" data-tab-go="bookings" data-scroll="todos">${ico('arrow')} All to-dos</button></div></div>` : '';

  // deadline card for Swissôtel
  const sw = bookingById('hotel-istanbul-swissotel');
  let dl = '';
  if (sw && sw.status === 'to-cancel' && !state.todosDone['t-swiss']) {
    const hrs = Math.round((new Date(sw.deadline) - Date.now()) / 3600000);
    dl = `<div class="card" style="border:1px solid var(--red)"><div class="deadline">${ico('alert')} ${hrs > 0 ? `Swissôtel refund deadline in ${hrs > 48 ? Math.floor(hrs / 24) + ' days' : hrs + ' h'}` : 'Swissôtel refund deadline has PASSED'}</div>
      <p class="small" style="margin-top:8px">Full refund only before 23:59 on 11 Oct. You are holding both Istanbul hotels until then.</p>
      <div class="row" style="margin-top:10px"><button class="linkbtn" data-open-doc="hotel-istanbul-swissotel">${ico('ticket')} Swissôtel booking</button></div></div>`;
  }

  // spend so far
  const spent = state.expenses.reduce((a, e) => a + e.aed, 0);
  const money = state.expenses.length ? `<div class="card"><div class="card-title">${ico('wallet')} Spent so far</div>
      <div class="row between"><div class="big">${fmtAed(spent)}</div><div class="small muted" style="text-align:right">of ${fmtAed(C().money.variable.low)}–${nf0.format(C().money.variable.high)}<br>planned for extras</div></div>
      <div class="bar" style="margin-top:8px"><i style="width:${Math.min(100, spent / C().money.variable.high * 100)}%"></i><b class="low" style="left:${C().money.variable.low / C().money.variable.high * 100}%"></b></div>
      <div class="row" style="margin-top:10px"><button class="linkbtn" data-tab-go="money">${ico('plus')} Add expense</button></div></div>` : '';

  $('#view-today').innerHTML = `<div class="card hero">${hero}</div>${next}${dl}${hotel}${flight}${todos}${money}`;
}

/* ───────────────────────── render: days ───────────────────────── */
function renderDays() {
  const t = todayISO();
  const strip = `<div class="strip" id="strip">${C().days.map(d => {
    const dt = isoToDate(d.date);
    return `<button class="daychip ${d.id === state.dayId ? 'is-active' : ''} ${d.date === t ? 'is-today' : ''}" data-day="${d.id}" data-phase="${esc(d.phase)}">
      <div class="dow">${DOW[dt.getDay()]}</div><div class="num">${dt.getDate()}</div><span class="dot"></span></button>`; }).join('')}</div>`;
  const d = C().days.find(x => x.id === state.dayId) || C().days[0];
  const idx = dayIndex(d.id), city = cityFor(d);
  const head = `<div class="card dayhead"><div class="kicker">${idx === 0 ? 'Departure' : idx === 15 ? 'Home' : `Day ${idx}`} · ${dateLabel(d.date)} · ${esc(d.city)}</div>
    <h2>${esc(d.title)}</h2>${d.vibe ? `<p class="vibe">${esc(d.vibe)}</p>` : ''}
    <div class="meta">${d.sunset ? `<span class="chip">${ico('sun')} Sunset ${d.sunset}</span>` : ''}${d.weather ? `<span class="chip">${esc(d.weather)}</span>` : ''}
      <span class="chip gold">${ico('wallet')} ${d.estAed[1] ? `${fmtAed(d.estAed[0])}–${nf0.format(d.estAed[1])}` : 'Nothing to pay'}</span></div>
    ${d.fixes?.length ? `<details class="fold" style="margin-top:12px"><summary>${ico('chev', 'chev')} What changed and why (${d.fixes.length})</summary>
      ${d.fixes.map(f => `<div class="notebox"><b>${esc(f.what)}</b><br><span class="muted">${esc(f.why)}</span></div>`).join('')}</details>` : ''}</div>`;

  const items = d.stops.map(s => {
    const small = parseHM(s.time) == null;
    const tr = s.transport;
    const leg = tr ? `<div class="leg">${ico(P[tr.mode] ? tr.mode : 'route')}<div><div class="route">${esc(tr.from)}<span class="arr">→</span>${esc(tr.to)}</div>
        <div class="sub">${[tr.mins ? `${esc(tr.mins)} min` : '', tr.cost ? costText(tr.cost) : '', tr.note ? esc(tr.note) : ''].filter(Boolean).join(' · ')}</div></div>
        <a href="${mapsDir(tr.from, tr.to, tr.mode, city)}" target="_blank" rel="noopener">Route ${ico('external')}</a></div>` : '';
    const tags = [
      s.cost ? `<span class="chip">${ico('wallet')} ${costText(s.cost)}</span>` : '',
      s.book?.needed ? `<span class="chip violet">${ico('ticket')} Book${s.book.note ? ' · ' + esc(s.book.note) : ''}</span>` : '',
      s.booking ? `<button class="chip teal" data-open-doc="${s.booking}">${ico('ticket')} Open booking</button>` : '',
    ].filter(Boolean).join('');
    return `<li class="tl-item"><div class="tl-time ${small ? 'small' : ''} mono">${esc(s.time)}</div>
      <div class="tl-rail"><div class="tl-dot ${stopDotClass(s)}">${ico(stopIcon(s))}</div></div>
      <div class="tl-card"><div class="title">${esc(s.title)}</div>
        ${s.place ? `<a class="place" href="${mapsSearch(s.place, city)}" target="_blank" rel="noopener">${ico('pin')} ${esc(s.place)}</a>` : ''}
        ${s.detail ? `<p class="detail">${esc(s.detail)}</p>` : ''}${leg}
        ${tags ? `<div class="tags">${tags}</div>` : ''}
        ${(s.warn || []).map(w => `<div class="warn"><b>Watch out.</b> ${esc(w)}</div>`).join('')}
        ${s.tips?.length ? `<details class="fold"><summary>${ico('chev', 'chev')} Tips (${s.tips.length})</summary>${s.tips.map(x => `<div class="tipbox">${esc(x)}</div>`).join('')}</details>` : ''}
      </div></li>`;
  }).join('');
  const prev = C().days[idx - 1], nxt = C().days[idx + 1];
  const nav = `<div class="daynav">${prev ? `<button class="ghost" data-day="${prev.id}">← ${dateLabel(prev.date, false)}</button>` : '<span></span>'}${nxt ? `<button class="ghost" data-day="${nxt.id}">${dateLabel(nxt.date, false)} →</button>` : '<span></span>'}</div>`;
  $('#view-days').innerHTML = `${strip}${head}<ul class="tl">${items}</ul>${nav}`;
  const act = $('#strip .is-active'); if (act) act.scrollIntoView({ inline: 'center', block: 'nearest' });
}

/* ───────────────────────── render: bookings ───────────────────────── */
function bookingCard(b) {
  const pill = b.status === 'confirmed' ? '<span class="pill green">Confirmed</span>' : b.status === 'to-cancel' ? '<span class="pill red">To cancel</span>' : '<span class="pill grey">Reference</span>';
  const kv = [];
  if (b.dates) kv.push(['Dates', b.dates]);
  if (b.checkin) kv.push(['Check-in', b.checkin]); if (b.checkout) kv.push(['Check-out', b.checkout]);
  if (b.room) kv.push(['Room', b.room]); if (b.board) kv.push(['Included', b.board]);
  if (b.cabin) kv.push(['Cabin', b.cabin]); if (b.bags) kv.push(['Bags', b.bags]);
  if (b.price) kv.push(['Paid', b.price]); if (b.guests) kv.push(['Guests', b.guests]); if (b.tickets) kv.push(['Tickets', b.tickets]);
  let deadline = '';
  if (b.deadline) { const hrs = Math.round((new Date(b.deadline) - Date.now()) / 3600000); deadline = `<div class="deadline" style="margin-top:10px">${ico('alert')} ${hrs > 0 ? `Free cancellation ends in ${hrs > 48 ? Math.floor(hrs / 24) + ' days' : hrs + ' h'}` : 'Free-cancellation window has passed'}</div>`; }
  return `<div class="card" id="bk-${b.id}">
    <div class="bk-head"><div><h3>${esc(b.title)}</h3><div class="bk-sub">${esc(b.subtitle || '')}</div></div>${pill}</div>
    ${b.legs ? `<div class="legs">${b.legs.map(l => `<div class="legrow"><div class="fl">${esc(l.flight)}</div><div><div class="times">${esc(l.from)} → ${esc(l.to)}</div><div class="small muted">${esc(l.aircraft || '')}</div></div><div class="seat">${esc(l.seats || '')}</div></div>`).join('')}</div>` : ''}
    ${b.confirmation ? `<div class="stack" style="margin-top:12px">${copyRow(b.kind === 'flight' ? 'Booking reference' : 'Confirmation number', b.confirmation)}${b.pin ? copyRow('PIN', b.pin) : ''}</div>` : ''}
    ${kv.length ? `<div class="kv" style="margin-top:12px">${kv.map(([k, v]) => `<div class="k">${esc(k)}</div><div class="v">${esc(v)}</div>`).join('')}</div>` : ''}
    ${b.address ? `<p class="small" style="margin-top:10px">${ico('pin')} ${esc(b.address)}${b.gps ? ` <span class="muted mono">(${esc(b.gps)})</span>` : ''}</p>` : ''}
    ${b.cancel ? `<div class="${b.status === 'to-cancel' ? 'warn' : 'notebox'}" style="margin-top:10px"><b>Cancellation.</b> ${esc(b.cancel)}</div>` : ''}${deadline}
    ${b.notes?.length ? `<div class="stack" style="margin-top:10px">${b.notes.map(n => `<div class="tipbox">${esc(n)}</div>`).join('')}</div>` : ''}
    ${b.detail ? `<p class="detail small" style="margin-top:8px">${esc(b.detail)}</p>` : ''}
    <div class="bk-actions">
      ${b.file ? `<button class="linkbtn teal" data-open-doc="${b.id}">${ico('ticket')} ${b.kind === 'document' ? 'Download' : 'Open PDF'}</button>` : ''}
      ${b.phone ? `<a class="linkbtn" href="tel:${b.phone.replace(/\s/g, '')}">${ico('phone')} Call</a>` : ''}
      ${b.maps ? `<a class="linkbtn" href="${mapsSearch(b.maps, '')}" target="_blank" rel="noopener">${ico('pin')} Map</a>` : ''}
      ${b.via ? `<span class="chip">${esc(b.via)}</span>` : ''}
    </div></div>`;
}
function renderBookings() {
  const B = C().bookings;
  const grp = (title, icon, list) => list.length ? `<div class="card-title" style="margin-top:6px">${ico(icon)} ${title}</div>${list.map(bookingCard).join('')}` : '';
  const todosAll = [...C().todos].sort((a, b) => a.due.localeCompare(b.due));
  const open = todosAll.filter(t => !state.todosDone[t.id]), done = todosAll.filter(t => state.todosDone[t.id]);
  $('#view-bookings').innerHTML =
    grp('Hotels', 'bed', B.filter(b => b.kind === 'hotel')) +
    grp('Flights', 'plane', B.filter(b => b.kind === 'flight')) +
    grp('Documents', 'ticket', B.filter(b => b.kind === 'document')) +
    `<div class="card" id="todos"><div class="card-title">${ico('check')} To-dos · ${open.length} open</div>${open.map(todoRow).join('') || '<p class="muted">All done.</p>'}
      ${done.length ? `<details class="fold" style="margin-top:10px"><summary>${ico('chev', 'chev')} Done (${done.length})</summary>${done.map(todoRow).join('')}</details>` : ''}</div>`;
}

/* ───────────────────────── render: money ───────────────────────── */
function renderMoney() {
  const M = C().money, v = M.variable;
  const spent = state.expenses.reduce((a, e) => a + e.aed, 0);
  const byCat = {}; state.expenses.forEach(e => byCat[e.cat] = (byCat[e.cat] || 0) + e.aed);
  const byDay = {}; state.expenses.forEach(e => (byDay[e.date] ||= []).push(e));
  const daysSorted = Object.keys(byDay).sort().reverse();
  const maxEst = Math.max(...C().days.map(d => d.estAed[1]));

  $('#view-money').innerHTML = `
    <div class="card hero"><div class="hero-kicker">Plan for</div><div class="hero-title">${fmtAed(M.planTotal)}</div>
      <div class="hero-sub">Locked ${fmtAed(M.settledTotal)} + everything else ${fmtAed(v.low)}–${nf0.format(v.high)}</div>
      <div class="hero-row"><span class="chip onhero">${ico('info')} ₺${state.rate} per AED</span><span class="chip onhero">Live rate ≈ 8 % kinder</span></div></div>

    <div class="card"><div class="card-title">${ico('wallet')} Spent so far · extras only</div>
      <div class="row between"><div class="big">${fmtAed(spent)}</div><div class="small muted" style="text-align:right">low plan ${fmtAed(v.low)}<br>high plan ${fmtAed(v.high)}</div></div>
      <div class="bar" style="margin-top:8px"><i style="width:${Math.min(100, spent / v.high * 100)}%"></i><b class="low" style="left:${v.low / v.high * 100}%"></b></div>
      ${Object.keys(byCat).length ? `<div class="row wrap" style="margin-top:10px">${Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<span class="chip">${esc(k)} · ${fmtAed(n)}</span>`).join('')}</div>` : ''}
      <div class="divider"></div>
      <form id="expForm" class="expense-form">
        <label class="field"><span class="field-label">Amount</span><input id="expAmt" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0" required></label>
        <label class="field"><span class="field-label">Currency</span><span class="seg" id="expCur"><button type="button" data-cur="TRY" class="is-active">₺ TRY</button><button type="button" data-cur="AED">AED</button></span></label>
        <label class="field"><span class="field-label">Category</span><select id="expCat">${M.categories.map(c => `<option>${esc(c)}</option>`).join('')}</select></label>
        <label class="field"><span class="field-label">Date</span><input id="expDate" type="date" value="${todayISO()}"></label>
        <label class="field full"><span class="field-label">Note (optional)</span><input id="expNote" type="text" maxlength="60" placeholder="e.g. Taxi to Kabataş"></label>
        <button class="primary full" type="submit">${ico('plus')} Add expense</button>
      </form>
      ${daysSorted.map(d => `<div class="exp-day">${dateLabel(d)} · ${fmtAed(byDay[d].reduce((a, e) => a + e.aed, 0))}</div>${byDay[d].map(e => `<div class="exp"><div><div class="cat">${esc(e.cat)}</div><div>${esc(e.note || '')}</div></div>
        <div class="row"><div class="amt mono">${e.cur === 'TRY' ? fmtTry(e.amount) + ' · ' : ''}${fmtAed(e.aed)}</div><button type="button" data-del-exp="${e.id}" aria-label="Delete">${ico('trash')}</button></div></div>`).join('')}`).join('')}
    </div>

    <div class="card"><div class="card-title">${ico('alert')} Where the money goes</div>
      <p class="small muted" style="margin-bottom:8px">${esc(M.bigThreeNote)}</p>
      ${M.bigThree.map(b => `<div class="hbar"><div class="lbl">${esc(b.label.split(' · ')[0])}</div><div class="track"><i style="left:${b.low / 1800 * 100}%;width:${(b.high - b.low) / 1800 * 100}%"></i></div><div class="val mono">${fmtAed(b.low)}–${nf0.format(b.high)}</div></div>`).join('')}
      <div class="warn" style="margin-top:10px"><b>Held twice.</b> ${esc(M.held)}</div></div>

    <div class="card"><div class="card-title">${ico('days')} Estimate by day</div>
      ${C().days.filter(d => d.estAed[1] > 0).map(d => `<div class="hbar"><div class="lbl">${dateLabel(d.date, false)}</div><div class="track"><i style="left:${d.estAed[0] / maxEst * 100}%;width:${Math.max(2, (d.estAed[1] - d.estAed[0]) / maxEst * 100)}%"></i></div><div class="val mono">${nf0.format(d.estAed[0])}–${nf0.format(d.estAed[1])}</div></div>`).join('')}
      <p class="tiny muted" style="margin-top:8px">AED, for two, excluding shopping. Bars show low to high.</p></div>

    <details class="card fold"><summary>${ico('chev', 'chev')} Locked costs · ${fmtAed(M.settledTotal)}</summary>
      <div class="kv">${M.settled.map(s => `<div class="k">${esc(s.label)}</div><div class="v mono">${fmtAed(s.aed)}</div>`).join('')}</div></details>`;
}

/* ───────────────────────── render: tips ───────────────────────── */
function renderTips() {
  const linkify = (s) => esc(s).replace(/(\+?\d[\d ]{7,}\d)/g, (m) => `<a href="tel:${m.replace(/\s/g, '')}">${m}</a>`).replace(/\b(112)\b/g, '<a href="tel:112">112</a>');
  $('#view-tips').innerHTML = `<div class="card hero"><div class="hero-kicker">Survival kit</div><div class="hero-title">Read once, then trust it</div>
    <div class="hero-sub">${esc(C().meta.timezoneNote)}</div></div>` +
    C().tips.sections.map((s, i) => `<details class="card tipsec" style="padding:0" ${i < 2 ? 'open' : ''}><summary><span class="lead">${ico(s.icon)}</span>${esc(s.title)}${ico('chev', 'chev')}</summary>
      <ul>${s.items.map(it => `<li>${s.id === 'emergency' ? linkify(it) : esc(it)}</li>`).join('')}</ul></details>`).join('');
}

/* ───────────────────────── render: all + tabs ───────────────────────── */
function renderAll() {
  $('#topbarSub').textContent = (() => { const st = tripStatus(); if (st.phase === 'before') return `${st.days} days to go`; if (st.phase === 'after') return 'Welcome home'; const d = dayByDate(todayISO()); return `${st.dayNum === 0 ? 'Departure night' : 'Day ' + st.dayNum} · ${d.city}`; })();
  renderToday(); renderDays(); renderBookings(); renderMoney(); renderTips();
  showTab(state.tab);
  $('#settingsBtn').innerHTML = ico('settings');
  $$('.tab-ico').forEach(el => el.innerHTML = ico(el.dataset.ico));
  $('#viewerClose').innerHTML = ico('close'); $('#viewerDownload').innerHTML = ico('download'); $('#viewerOpen').innerHTML = ico('external');
  $('#versionLine').textContent = `Content v${C().meta.version} · generated ${C().meta.generated} · vault built ${state.manifest?.built || ''}`;
  $('#rateInput').value = state.rate;
}
function showTab(tab) {
  state.tab = tab;
  $$('.view').forEach(v => v.hidden = v.dataset.view !== tab);
  $$('.tab').forEach(b => b.classList.toggle('is-active', b.dataset.tab === tab));
  window.scrollTo({ top: 0 });
}

/* ───────────────────────── PDF viewer ───────────────────────── */
let pdfjsLib = null;
async function openDoc(id) {
  const b = bookingById(id); const f = state.manifest.files[b.file];
  if (!f) return toast('Document missing');
  const v = $('#viewer'), body = $('#viewerBody');
  $('#viewerTitle').textContent = b.title; body.innerHTML = '<div class="spinner"></div>'; v.hidden = false; document.body.style.overflow = 'hidden';
  try {
    const plain = await decryptBytes(state.key, await fetchEnc('./' + f.path));
    const blob = new Blob([plain], { type: f.mime });
    const url = URL.createObjectURL(blob); state.blobUrls.push(url);
    const dl = $('#viewerDownload'); dl.href = url; dl.download = f.name; $('#viewerOpen').href = url;
    if (f.mime !== 'application/pdf') {
      body.innerHTML = `<div class="viewer-msg"><p><b>${esc(f.name)}</b></p><p style="margin-top:8px">This is a Word document. Use the save button above to download it, then open it in Word or Pages.</p></div>`;
      return;
    }
    if (!pdfjsLib) { pdfjsLib = await import('./vendor/pdf.min.mjs'); pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.mjs'; }
    const doc = await pdfjsLib.getDocument({ data: plain.slice(0) }).promise;
    const n = doc.numPages;
    $('#viewerTitle').textContent = `${b.title} · ${n} page${n > 1 ? 's' : ''}`;
    body.innerHTML = `<p class="viewer-msg small" id="viewerStatus">Rendering page 1 of ${n}… you can already save or open the file above.</p>`;
    const width = Math.min(body.clientWidth - 16, 900), dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (let i = 1; i <= n; i++) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 }); const scale = width / base.width; const vp = page.getViewport({ scale: scale * dpr });
      const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height; c.style.width = `${Math.round(vp.width / dpr)}px`;
      body.insertBefore(c, $('#viewerStatus'));
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      const st = $('#viewerStatus'); if (st) st.textContent = i < n ? `Rendering page ${i + 1} of ${n}…` : '';
      if (i === n) st?.remove();
    }
  } catch (e) { console.error(e); body.innerHTML = `<div class="viewer-msg">Could not open this document.<br><span class="small">${esc(e.message || e)}</span></div>`; }
}
function closeViewer() { $('#viewer').hidden = true; document.body.style.overflow = ''; $('#viewerBody').innerHTML = ''; state.blobUrls.forEach(u => URL.revokeObjectURL(u)); state.blobUrls = []; }

/* ───────────────────────── settings sheet & install ───────────────────────── */
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
function renderInstallBox() {
  const box = $('#installBox');
  if (isStandalone()) { box.innerHTML = `<p class="small">${ico('check')} Installed on this device. Works offline.</p>`; return; }
  if (state.deferredInstall) { box.innerHTML = `<button id="installBtn" class="primary wide">${ico('download')} Install on home screen</button>`; return; }
  if (isIOS()) { box.innerHTML = `<p class="small"><b>Add to your iPhone home screen</b></p><ol class="steps"><li>Tap the Share button in Safari (the square with the arrow).</li><li>Scroll and tap <b>Add to Home Screen</b>.</li><li>Tap <b>Add</b>. The passphrase is remembered inside the app.</li></ol>`; return; }
  box.innerHTML = `<p class="small"><b>Add to home screen</b></p><ol class="steps"><li>Open the browser menu (⋮).</li><li>Tap <b>Add to Home screen</b> or <b>Install app</b>.</li></ol>`;
}
function openSheet() { renderInstallBox(); $('#sheet').hidden = false; }
function closeSheet() { $('#sheet').hidden = true; }

/* ───────────────────────── events ───────────────────────── */
function wire() {
  $('#lockForm').addEventListener('submit', (e) => { e.preventDefault(); unlockWith($('#pass').value, $('#remember').checked); });
  $('#togglePass').addEventListener('click', () => { const i = $('#pass'); i.type = i.type === 'password' ? 'text' : 'password'; $('#togglePass').textContent = i.type === 'password' ? 'Show' : 'Hide'; });
  $$('.tab').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $('#settingsBtn').addEventListener('click', openSheet);
  $('#sheet').addEventListener('click', (e) => { if (e.target.dataset.close != null) closeSheet(); });
  $('#lockNow').addEventListener('click', () => lockNow(false));
  $('#forgetDevice').addEventListener('click', () => { if (confirm('Forget the passphrase on this device? You will need to type it again.')) lockNow(true); });
  $('#resetTodos').addEventListener('click', () => { if (confirm('Untick every to-do?')) { state.todosDone = {}; store.del('tr26.todos'); renderAll(); closeSheet(); } });
  $('#resetExpenses').addEventListener('click', () => { if (confirm('Delete every logged expense? This cannot be undone.')) { state.expenses = []; store.del('tr26.expenses'); renderAll(); closeSheet(); } });
  $('#rateInput').addEventListener('change', () => { const v = parseFloat($('#rateInput').value); if (v > 5 && v < 30) { state.rate = v; store.set('tr26.rate', v); renderAll(); toast(`Rate set to ₺${v}`); } });
  $('#rateLive').addEventListener('click', () => { state.rate = C().meta.tryPerAedLive; store.set('tr26.rate', state.rate); renderAll(); toast(`Rate set to ₺${state.rate}`); });
  $('#viewerClose').addEventListener('click', closeViewer);
  $('#installBox').addEventListener('click', async (e) => { if (e.target.closest('#installBtn') && state.deferredInstall) { state.deferredInstall.prompt(); await state.deferredInstall.userChoice; state.deferredInstall = null; renderInstallBox(); } });

  // delegated clicks inside the views
  $('#main').addEventListener('click', (e) => {
    const c = e.target.closest('[data-copy]'); if (c) { copyText(c.dataset.copy); return; }
    const d = e.target.closest('[data-day]'); if (d) { state.dayId = d.dataset.day; renderDays(); showTab('days'); return; }
    const g = e.target.closest('[data-goto-day]'); if (g) { state.dayId = g.dataset.gotoDay; renderDays(); showTab('days'); return; }
    const o = e.target.closest('[data-open-doc]'); if (o) { openDoc(o.dataset.openDoc); return; }
    const tg = e.target.closest('[data-tab-go]'); if (tg) { showTab(tg.dataset.tabGo); if (tg.dataset.scroll) setTimeout(() => $('#' + tg.dataset.scroll)?.scrollIntoView({ behavior: 'smooth' }), 50); return; }
    const del = e.target.closest('[data-del-exp]'); if (del) { state.expenses = state.expenses.filter(x => x.id !== del.dataset.delExp); store.set('tr26.expenses', state.expenses); renderMoney(); renderToday(); return; }
    const cur = e.target.closest('#expCur button'); if (cur) { $$('#expCur button').forEach(b => b.classList.toggle('is-active', b === cur)); return; }
  });
  $('#main').addEventListener('change', (e) => {
    const t = e.target.closest('[data-todo]');
    if (t) { if (t.checked) state.todosDone[t.dataset.todo] = true; else delete state.todosDone[t.dataset.todo]; store.set('tr26.todos', state.todosDone); renderToday(); renderBookings(); }
  });
  $('#main').addEventListener('submit', (e) => {
    if (e.target.id !== 'expForm') return; e.preventDefault();
    const amount = parseFloat($('#expAmt').value); if (!(amount > 0)) return;
    const cur = $('#expCur .is-active').dataset.cur;
    const ex = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, date: $('#expDate').value || todayISO(), amount, cur, cat: $('#expCat').value, note: $('#expNote').value.trim(), aed: cur === 'TRY' ? amount / state.rate : amount };
    state.expenses.push(ex); store.set('tr26.expenses', state.expenses); renderMoney(); renderToday(); toast(`Added ${fmtAed(ex.aed)}`);
  });

  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); state.deferredInstall = e; });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && state.content) { renderToday(); } });
}

/* ───────────────────────── service worker ───────────────────────── */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      let had = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (had) location.reload(); had = true; });
      await navigator.serviceWorker.register('./sw.js');
    } catch (e) { console.warn('sw', e); }
  });
}

/* ───────────────────────── start ───────────────────────── */
wire();
$('#settingsBtn').innerHTML = ico('settings');
$$('.tab-ico').forEach(el => el.innerHTML = ico(el.dataset.ico));
(async () => {
  try { await loadManifest(); } catch { lockMsg('Cannot reach the vault. Check your connection.', true); }
  if (!(await tryAutoUnlock())) { $('#pass').focus(); }
})();
