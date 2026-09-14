/* Türkiye 2026 · trip companion
   All personal content arrives encrypted from ./vault and is decrypted in the browser. */
import { ICONS } from './icons.js';

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const state = {
  manifest: null, key: null, content: null,
  rate: 12.22, tab: 'today', dayId: null,
  expenses: [], todosDone: {}, deferredInstall: null, blobUrls: [],
};
const ico = (n, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ICONS.info}</svg>`;

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
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(hasCity || !city ? q : `${q}, ${city}`)}`;
};
const mapsDir = (from, to, mode, city) => {
  const tm = mode === 'walk' ? 'walking' : (mode === 'ferry' || mode === 'bus' || mode === 'tram') ? 'transit' : 'driving';
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
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64d(m.kdf.salt), iterations: m.kdf.iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
}
async function fetchEnc(path) { const r = await fetch(path); if (!r.ok) throw new Error(path); return new Uint8Array(await r.arrayBuffer()); }
async function decryptBytes(key, buf) { const iv = buf.slice(0, 12), ct = buf.slice(12); return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)); }
async function keyWorks(key) {
  try { const m = await loadManifest(); const p = await decryptBytes(key, await fetchEnc('./' + m.files.probe.path)); return new TextDecoder().decode(p) === 'turkiye-2026-ok'; }
  catch { return false; }
}
async function loadContent(key) { const m = await loadManifest(); const plain = await decryptBytes(key, await fetchEnc('./' + m.files.content.path)); return JSON.parse(new TextDecoder().decode(plain)); }

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
  await boot(key); return true;
}
async function boot(key) {
  state.key = key;
  state.content = await loadContent(key);
  state.rate = store.get('tr26.rate', state.content.meta.tryPerAed);
  state.expenses = store.get('tr26.expenses', []);
  state.todosDone = store.get('tr26.todos', {});
  const t = todayISO();
  const inTrip = state.content.days.find(d => d.date === t);
  state.dayId = inTrip ? inTrip.id : (t > state.content.meta.tripEnd ? state.content.days.at(-1).id : state.content.days[1].id);
  $('#lock').hidden = true; $('#app').hidden = false;
  renderAll();
}
function lockNow(forget = false) {
  if (forget) idbDel('key');
  state.key = null; state.content = null;
  $('#app').hidden = true; $('#lock').hidden = false; $('#pass').value = ''; lockMsg(forget ? 'This device was forgotten.' : 'Locked.');
  $('#unlockBtn').disabled = false; closeSheet();
}

/* ───────────────────────── shared ───────────────────────── */
const C = () => state.content;
const dayByDate = (iso) => C().days.find(d => d.date === iso);
const dayIndex = (id) => C().days.findIndex(d => d.id === id);
const bookingById = (id) => C().bookings.find(b => b.id === id);
function tripStatus() {
  const t = todayISO(), m = C().meta;
  if (t < m.tripStart) return { phase: 'before', days: daysBetween(t, m.tripStart) };
  if (t > m.tripEnd) return { phase: 'after' };
  const idx = dayIndex(dayByDate(t)?.id);
  return { phase: 'during', idx, dayNum: idx };
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
const stopIcon = (s) => s.type === 'transport' && s.transport ? (ICONS[s.transport.mode] ? s.transport.mode : 'route')
  : ({ flight: 'plane', hotel: 'bed', food: 'food', sight: 'camera', shisha: 'smoke', shop: 'bag', free: 'sun', note: 'info' }[s.type] || 'info');
const stopDotClass = (s) => s.type === 'transport' && s.transport ? s.transport.mode : s.type;
const dayLabel = (idx) => idx === 0 ? 'Departure night' : idx === 15 ? 'Home' : `Day ${idx}`;

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
function placeLink(place, city) {
  return `<a class="place" href="${mapsSearch(place, city)}" target="_blank" rel="noopener">${ico('pin')}<span>${esc(place)}</span></a>`;
}

/* ───────────────────────── today ───────────────────────── */
function renderToday() {
  const t = todayISO(), st = tripStatus(), m = C().meta;
  const day = dayByDate(t);
  let hero;
  if (st.phase === 'before') {
    hero = `<div class="hero-kicker">${st.days === 1 ? 'Tomorrow' : `${st.days} days to go`}</div>
      <div class="hero-title">Antalya &amp; Istanbul</div>
      <div class="hero-sub">11 – 25 October 2026 · ${esc(m.occasion)}</div>
      <div class="hero-row"><span class="chip onhero">${ico('plane')} Leave home Sat 10 Oct, 22:30</span><span class="chip onhero">${ico('clock')} Türkiye is 1 h behind</span></div>`;
  } else if (st.phase === 'after') {
    hero = `<div class="hero-kicker">Welcome home</div><div class="hero-title">Antalya &amp; Istanbul</div><div class="hero-sub">Log the last expenses while you remember them.</div>`;
  } else {
    hero = `<div class="hero-kicker">${dayLabel(st.dayNum)} · ${esc(day.city)}</div>
      <div class="hero-title">${esc(day.title)}</div><div class="hero-sub">${esc(day.vibe || '')}</div>
      <div class="hero-row">${day.sunset ? `<span class="chip onhero">${ico('sunset')} Sunset ${day.sunset}</span>` : ''}
        ${day.estAed?.[1] ? `<span class="chip onhero">${ico('wallet')} ${fmtAed(day.estAed[0])}–${nf0.format(day.estAed[1])} today</span>` : ''}</div>`;
  }

  // next up
  let next = '';
  if (day) {
    const now = nowMinutes();
    const up = day.stops.filter(s => parseHM(s.time) != null).find(s => parseHM(s.time) >= now - 10) || null;
    if (up) {
      next = `<div class="card"><div class="card-title">${ico('clock')} Next up</div>
        <div class="nextup"><div class="nextup-time">${esc(up.time)}</div>
        <div><div class="nextup-title">${esc(up.title)}</div>${up.place ? placeLink(up.place, cityFor(day)) : ''}
        ${up.transport ? `<div class="small muted" style="margin-top:4px">${esc(up.transport.from)} → ${esc(up.transport.to)}${up.transport.mins ? ` · ${esc(up.transport.mins)} min` : ''}</div>` : ''}</div></div>
        <div class="row" style="margin-top:14px"><button class="btn teal" data-goto-day="${day.id}">${ico('days')} Open today's plan</button></div></div>`;
    } else {
      const nxt = C().days[dayIndex(day.id) + 1];
      next = `<div class="card"><div class="card-title">${ico('check')} Today is done</div>
        <p>${nxt ? `Tomorrow: <b>${esc(nxt.title)}</b>. First stop ${esc(nxt.stops[0].time)}, ${esc(nxt.stops[0].title)}.` : 'Safe travels home.'}</p>
        ${nxt ? `<div class="row" style="margin-top:12px"><button class="btn" data-goto-day="${nxt.id}">${ico('arrow')} Preview tomorrow</button></div>` : ''}</div>`;
    }
  } else if (st.phase === 'before') {
    const d0 = C().days[0], s = d0.stops[1];
    next = `<div class="card"><div class="card-title">${ico('clock')} First move</div>
      <div class="nextup"><div class="nextup-time">${esc(s.time)}</div><div><div class="nextup-title">${esc(s.title)}</div><div class="small muted" style="margin-top:3px">Saturday 10 October · TK869 departs 01:30</div></div></div>
      <div class="row" style="margin-top:14px"><button class="btn teal" data-goto-day="d11">${ico('days')} Open day one</button><button class="btn" data-goto-day="d10">Departure night</button></div></div>`;
  }

  // deadline strip (Swissôtel)
  const sw = bookingById('hotel-istanbul-swissotel');
  let dl = '';
  if (sw && sw.status === 'to-cancel' && !state.todosDone['t-swiss']) {
    const hrs = Math.round((new Date(sw.deadline) - Date.now()) / 3600000), dys = Math.floor(hrs / 24);
    const when = hrs <= 0 ? 'has passed' : dys >= 2 ? `in ${dys} days` : `in ${hrs} h`;
    dl = `<div class="strip-alert ${dys < 4 ? 'red' : ''}">${ico('bell')}<span>Cancel the Swissôtel · full refund ends ${when}</span><button data-open-doc="hotel-istanbul-swissotel">Open</button></div>`;
  }

  // hotel tonight
  const h = hotelForDate(t) || (st.phase === 'before' ? bookingById('hotel-antalya-concorde') : null);
  const hotel = h ? `<div class="card"><div class="card-title">${ico('bed')} ${hotelForDate(t) ? 'Tonight' : 'First hotel'}</div>
      <h3>${esc(h.title)}</h3><div class="bk-sub">${esc(h.dates)} · check-in ${esc(h.checkin)}</div>
      <div class="stack" style="margin-top:12px">${copyRow('Confirmation', h.confirmation)}${copyRow('PIN', h.pin)}</div>
      <div class="bk-actions"><a class="btn" href="tel:${h.phone.replace(/\s/g, '')}">${ico('phone')} Call</a>
        <a class="btn" href="${mapsSearch(h.maps, '')}" target="_blank" rel="noopener">${ico('navigation')} Directions</a>
        <button class="btn" data-open-doc="${h.id}">${ico('ticket')} PDF</button></div></div>` : '';

  // next flight
  const f = nextFlight(t);
  const flight = f ? `<div class="card"><div class="card-title">${ico('plane')} Next flight</div>
      <h3>${esc(f.title)}</h3><div class="bk-sub">${esc(f.subtitle)} · ${esc(f.dates)}</div>
      <div class="legs">${f.legs.map(l => `<div class="legrow"><div class="fl">${esc(l.flight)}</div><div class="times">${esc(l.from)} → ${esc(l.to)}</div><div class="seat">${esc(l.seats)}</div></div>`).join('')}</div>
      <div class="stack" style="margin-top:12px">${copyRow('Booking reference', f.confirmation)}</div>
      <div class="bk-actions"><button class="btn" data-open-doc="${f.id}">${ico('ticket')} Ticket</button></div></div>` : '';

  // to-dos
  const openTodos = C().todos.filter(x => !state.todosDone[x.id]).sort((a, b) => a.due.localeCompare(b.due));
  const soon = openTodos.filter(x => daysBetween(t, x.due) <= 10);
  const due = (soon.length ? soon : openTodos).slice(0, 6);
  const todos = due.length ? `<div class="card"><div class="card-title">${ico('list')} ${soon.length ? 'Coming up' : 'Next to book'}</div>${due.map(todoRow).join('')}
      <div class="row" style="margin-top:12px"><button class="btn" data-tab-go="bookings" data-scroll="todos">${ico('arrow')} All ${openTodos.length} to-dos</button></div></div>` : '';

  // spend
  const spent = state.expenses.reduce((a, e) => a + e.aed, 0);
  const money = state.expenses.length ? `<div class="card"><div class="card-title">${ico('wallet')} Spent so far</div>
      <div class="row between"><div class="big">${fmtAed(spent)}</div><div class="small muted" style="text-align:right">of ${fmtAed(C().money.variable.low)}–${nf0.format(C().money.variable.high)}<br>planned for extras</div></div>
      <div class="bar" style="margin-top:10px"><i style="width:${Math.min(100, spent / C().money.variable.high * 100)}%"></i><b style="left:${C().money.variable.low / C().money.variable.high * 100}%"></b></div>
      <div class="row" style="margin-top:12px"><button class="btn" data-tab-go="money">${ico('plus')} Add expense</button></div></div>` : '';

  $('#view-today').innerHTML = `<div class="card hero">${hero}</div>${next}${dl}${hotel}${flight}${todos}${money}`;
}

/* ───────────────────────── days ───────────────────────── */
function renderDays() {
  const t = todayISO();
  const strip = `<div class="strip" id="strip">${C().days.map(d => {
    const dt = isoToDate(d.date);
    return `<button class="daychip ${d.id === state.dayId ? 'is-active' : ''} ${d.date === t ? 'is-today' : ''}" data-day="${d.id}" data-phase="${esc(d.phase)}">
      <div class="dow">${DOW[dt.getDay()]}</div><div class="num">${dt.getDate()}</div><span class="dot"></span></button>`; }).join('')}</div>`;
  const d = C().days.find(x => x.id === state.dayId) || C().days[0];
  const idx = dayIndex(d.id), city = cityFor(d), isToday = d.date === t, now = nowMinutes();
  const head = `<div class="card dayhead"><div class="kicker">${dayLabel(idx)} · ${dateLabel(d.date)} · ${esc(d.city)}</div>
    <h2>${esc(d.title)}</h2>${d.vibe ? `<p class="vibe">${esc(d.vibe)}</p>` : ''}
    <div class="meta">${d.sunset ? `<span class="chip">${ico('sunset')} Sunset ${d.sunset}</span>` : ''}${d.weather ? `<span class="chip">${ico('thermo')} ${esc(d.weather)}</span>` : ''}
      <span class="chip gold">${ico('wallet')} ${d.estAed[1] ? `${fmtAed(d.estAed[0])}–${nf0.format(d.estAed[1])}` : 'Nothing to pay'}</span></div>
    ${d.fixes?.length ? `<details class="fold" style="margin-top:14px"><summary>${ico('chev', 'chev')} What changed and why (${d.fixes.length})</summary>
      ${d.fixes.map(f => `<div class="notebox"><b>${esc(f.what)}</b><br>${esc(f.why)}</div>`).join('')}</details>` : ''}</div>`;

  // which stop is "now" (today only): last stop whose time has passed
  let nowIdx = -1;
  if (isToday) d.stops.forEach((s, i) => { const hm = parseHM(s.time); if (hm != null && hm <= now) nowIdx = i; });

  const items = d.stops.map((s, i) => {
    const small = parseHM(s.time) == null;
    const tr = s.transport;
    const leg = tr ? `<div class="leg">
        <div class="leg-top">${ico(ICONS[tr.mode] ? tr.mode : 'route')}<div class="leg-route">${esc(tr.from)}<span class="arr">→</span>${esc(tr.to)}</div></div>
        <div class="leg-bottom"><div class="leg-meta">${[tr.mins ? `${esc(tr.mins)} min` : '', tr.cost ? costText(tr.cost) : ''].filter(Boolean).join(' · ')}</div>
          <a class="leg-go" href="${mapsDir(tr.from, tr.to, tr.mode, city)}" target="_blank" rel="noopener">${ico('navigation')} Route</a></div>
        ${tr.note ? `<div class="leg-note">${esc(tr.note)}</div>` : ''}</div>` : '';
    const tags = [
      s.cost ? `<span class="chip">${ico('wallet')} ${costText(s.cost)}</span>` : '',
      s.book?.needed ? `<span class="chip violet">${ico('calcheck')} Book${s.book.note ? ' · ' + esc(s.book.note) : ''}</span>` : '',
      s.booking ? `<button class="chip teal" data-open-doc="${s.booking}">${ico('ticket')} Open booking</button>` : '',
    ].filter(Boolean).join('');
    return `<li class="tl-item ${i === nowIdx ? 'is-now' : ''}">
      <div class="tl-rail"><div class="tl-dot ${stopDotClass(s)}">${ico(stopIcon(s))}</div></div>
      <div class="tl-card">
        <div class="tl-top"><div class="tl-time ${small ? 'small' : ''} mono">${esc(s.time)}</div><div class="title">${esc(s.title)}</div></div>
        ${s.place ? placeLink(s.place, city) : ''}
        ${s.detail ? `<p class="detail">${esc(s.detail)}</p>` : ''}${leg}
        ${tags ? `<div class="tags">${tags}</div>` : ''}
        ${(s.warn || []).map(w => `<div class="warn">${ico('alert')}<div>${esc(w)}</div></div>`).join('')}
        ${s.tips?.length ? `<details class="fold"><summary>${ico('chev', 'chev')} Tips (${s.tips.length})</summary>${s.tips.map(x => `<div class="tipbox">${esc(x)}</div>`).join('')}</details>` : ''}
      </div></li>`;
  }).join('');
  const prev = C().days[idx - 1], nxt = C().days[idx + 1];
  const nav = `<div class="daynav">${prev ? `<button class="ghost" data-day="${prev.id}">← ${dateLabel(prev.date, false)}</button>` : '<span></span>'}${nxt ? `<button class="ghost" data-day="${nxt.id}">${dateLabel(nxt.date, false)} →</button>` : '<span></span>'}</div>`;
  $('#view-days').innerHTML = `${strip}${head}<ul class="tl">${items}</ul>${nav}`;
  const act = $('#strip .is-active'); if (act) act.scrollIntoView({ inline: 'center', block: 'nearest' });
}

/* ───────────────────────── bookings ───────────────────────── */
function bookingCard(b) {
  const pill = b.status === 'confirmed' ? '<span class="pill green">Confirmed</span>' : b.status === 'to-cancel' ? '<span class="pill red">To cancel</span>' : '<span class="pill grey">Reference</span>';
  const kv = [];
  if (b.dates) kv.push(['Dates', b.dates]);
  if (b.checkin) kv.push(['Check-in', b.checkin]); if (b.checkout) kv.push(['Check-out', b.checkout]);
  if (b.room) kv.push(['Room', b.room]); if (b.board) kv.push(['Included', b.board]);
  if (b.cabin) kv.push(['Cabin', b.cabin]); if (b.bags) kv.push(['Bags', b.bags]);
  if (b.price) kv.push(['Paid', b.price]); if (b.guests) kv.push(['Guests', b.guests]); if (b.tickets) kv.push(['Tickets', b.tickets]);
  let deadline = '';
  if (b.deadline) { const hrs = Math.round((new Date(b.deadline) - Date.now()) / 3600000); deadline = `<div class="deadline" style="margin-top:10px">${ico('bell')} ${hrs > 0 ? `Free cancellation ends in ${hrs > 48 ? Math.floor(hrs / 24) + ' days' : hrs + ' h'}` : 'Free-cancellation window has passed'}</div>`; }
  return `<div class="card" id="bk-${b.id}">
    <div class="bk-head"><div><h3>${esc(b.title)}</h3><div class="bk-sub">${esc(b.subtitle || '')}</div></div>${pill}</div>
    ${b.legs ? `<div class="legs">${b.legs.map(l => `<div class="legrow"><div class="fl">${esc(l.flight)}</div><div><div class="times">${esc(l.from)} → ${esc(l.to)}</div><div class="small muted">${esc(l.aircraft || '')}</div></div><div class="seat">${esc(l.seats || '')}</div></div>`).join('')}</div>` : ''}
    ${b.confirmation ? `<div class="stack" style="margin-top:12px">${copyRow(b.kind === 'flight' ? 'Booking reference' : 'Confirmation number', b.confirmation)}${b.pin ? copyRow('PIN', b.pin) : ''}</div>` : ''}
    ${kv.length ? `<div class="kv" style="margin-top:14px">${kv.map(([k, v]) => `<div class="k">${esc(k)}</div><div class="v">${esc(v)}</div>`).join('')}</div>` : ''}
    ${b.address ? `<p class="small muted" style="margin-top:12px">${esc(b.address)}${b.gps ? ` <span class="mono">(${esc(b.gps)})</span>` : ''}</p>` : ''}
    ${b.cancel ? `<div class="${b.status === 'to-cancel' ? 'warn' : 'notebox'}" style="margin-top:12px">${b.status === 'to-cancel' ? ico('alert') : ''}<div><b>Cancellation.</b> ${esc(b.cancel)}</div></div>` : ''}${deadline}
    ${b.notes?.length ? `<div class="stack" style="margin-top:10px">${b.notes.map(n => `<div class="tipbox">${esc(n)}</div>`).join('')}</div>` : ''}
    ${b.detail ? `<p class="small muted" style="margin-top:8px">${esc(b.detail)}</p>` : ''}
    <div class="bk-actions">
      ${b.file ? `<button class="btn teal" data-open-doc="${b.id}">${b.kind === 'document' ? ico('download') + ' Download' : ico('ticket') + ' Open PDF'}</button>` : ''}
      ${b.phone ? `<a class="btn" href="tel:${b.phone.replace(/\s/g, '')}">${ico('phone')} Call</a>` : ''}
      ${b.maps ? `<a class="btn" href="${mapsSearch(b.maps, '')}" target="_blank" rel="noopener">${ico('navigation')} Map</a>` : ''}
    </div>${b.via ? `<p class="tiny muted" style="margin-top:10px">${esc(b.via)}</p>` : ''}</div>`;
}
function renderBookings() {
  const B = C().bookings;
  const grp = (title, icon, list) => list.length ? `<div class="card-title" style="margin-top:8px">${ico(icon)} ${title}</div>${list.map(bookingCard).join('')}` : '';
  const todosAll = [...C().todos].sort((a, b) => a.due.localeCompare(b.due));
  const open = todosAll.filter(t => !state.todosDone[t.id]), done = todosAll.filter(t => state.todosDone[t.id]);
  $('#view-bookings').innerHTML =
    grp('Hotels', 'bed', B.filter(b => b.kind === 'hotel')) +
    grp('Flights', 'plane', B.filter(b => b.kind === 'flight')) +
    grp('Documents', 'ticket', B.filter(b => b.kind === 'document')) +
    `<div class="card" id="todos"><div class="card-title">${ico('list')} To-dos · ${open.length} open</div>${open.map(todoRow).join('') || '<p class="muted">All done.</p>'}
      ${done.length ? `<details class="fold" style="margin-top:10px"><summary>${ico('chev', 'chev')} Done (${done.length})</summary>${done.map(todoRow).join('')}</details>` : ''}</div>`;
}

/* ───────────────────────── money ───────────────────────── */
function renderMoney() {
  const M = C().money, v = M.variable;
  const spent = state.expenses.reduce((a, e) => a + e.aed, 0);
  const byCat = {}; state.expenses.forEach(e => byCat[e.cat] = (byCat[e.cat] || 0) + e.aed);
  const byDay = {}; state.expenses.forEach(e => (byDay[e.date] ||= []).push(e));
  const daysSorted = Object.keys(byDay).sort().reverse();
  const maxEst = Math.max(...C().days.map(d => d.estAed[1]));

  $('#view-money').innerHTML = `
    <div class="card hero"><div class="hero-kicker">Plan for</div><div class="hero-title">${fmtAed(M.planTotal)}</div>
      <div class="hero-sub">${fmtAed(M.settledTotal)} already locked · ${fmtAed(v.low)}–${nf0.format(v.high)} for everything else</div>
      <div class="hero-row"><span class="chip onhero">${ico('refresh')} ₺${state.rate} per AED</span><span class="chip onhero">${ico('sparkles')} Live rate is 8 % kinder</span></div></div>

    <div class="card"><div class="card-title">${ico('wallet')} Spent so far · extras only</div>
      <div class="row between"><div class="big">${fmtAed(spent)}</div><div class="small muted" style="text-align:right">plan ${fmtAed(v.low)}<br>ceiling ${fmtAed(v.high)}</div></div>
      <div class="bar" style="margin-top:12px"><i style="width:${Math.min(100, spent / v.high * 100)}%"></i><b style="left:${v.low / v.high * 100}%"></b></div>
      ${Object.keys(byCat).length ? `<div class="row wrap" style="margin-top:12px">${Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<span class="chip">${esc(k)} · ${fmtAed(n)}</span>`).join('')}</div>` : ''}
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
      <p class="small" style="color:var(--ink-2);margin-bottom:10px">${esc(M.bigThreeNote)}</p>
      ${M.bigThree.map(b => `<div class="hbar"><div class="lbl">${esc(b.label.split(' · ')[0])}</div><div class="track"><i style="left:${b.low / 1800 * 100}%;width:${(b.high - b.low) / 1800 * 100}%"></i></div><div class="val mono">${nf0.format(b.low)}–${nf0.format(b.high)}</div></div>`).join('')}
      <div class="warn" style="margin-top:12px">${ico('alert')}<div><b>Held twice.</b> ${esc(M.held)}</div></div></div>

    <div class="card"><div class="card-title">${ico('days')} Estimate by day · AED for two</div>
      ${C().days.filter(d => d.estAed[1] > 0).map(d => `<div class="hbar"><div class="lbl">${dateLabel(d.date, false)}</div><div class="track"><i style="left:${d.estAed[0] / maxEst * 100}%;width:${Math.max(2, (d.estAed[1] - d.estAed[0]) / maxEst * 100)}%"></i></div><div class="val mono">${nf0.format(d.estAed[0])}–${nf0.format(d.estAed[1])}</div></div>`).join('')}
      <p class="tiny muted" style="margin-top:8px">Excludes shopping. Bars show low to high.</p></div>

    <details class="card fold"><summary>${ico('chev', 'chev')} Locked costs · ${fmtAed(M.settledTotal)}</summary>
      <div class="kv">${M.settled.map(s => `<div class="k">${esc(s.label)}</div><div class="v mono">${fmtAed(s.aed)}</div>`).join('')}</div></details>`;
}

/* ───────────────────────── tips ───────────────────────── */
function renderTips() {
  const linkify = (s) => esc(s).replace(/(\+?\d[\d ]{7,}\d)/g, (m) => `<a href="tel:${m.replace(/\s/g, '')}">${m}</a>`).replace(/\b(112)\b/g, '<a href="tel:112">112</a>');
  $('#view-tips').innerHTML = `<div class="card hero"><div class="hero-kicker">Survival kit</div><div class="hero-title">Read once, then trust it</div>
    <div class="hero-sub">${esc(C().meta.timezoneNote)}</div></div>` +
    C().tips.sections.map((s, i) => `<details class="card tipsec" ${i < 2 ? 'open' : ''}><summary><span class="lead">${ico(s.icon)}</span>${esc(s.title)}${ico('chev', 'chev')}</summary>
      <ul>${s.items.map(it => `<li>${s.id === 'emergency' ? linkify(it) : esc(it)}</li>`).join('')}</ul></details>`).join('');
}

/* ───────────────────────── render all + tabs ───────────────────────── */
function renderAll() {
  $('#topbarSub').textContent = (() => { const st = tripStatus(); if (st.phase === 'before') return `${st.days} days to go`; if (st.phase === 'after') return 'Welcome home'; const d = dayByDate(todayISO()); return `${dayLabel(st.dayNum)} · ${d.city}`; })();
  renderToday(); renderDays(); renderBookings(); renderMoney(); renderTips();
  showTab(state.tab); updInstBar();
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

/* ───────────────────────── settings & install ───────────────────────── */
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

/* install bar: shown once unlocked, until installed or dismissed (same behaviour as the Goalak app) */
const instDismissed = () => store.get('tr26.inst_optout', false) === true;
function updInstBar() {
  const bar = $('#instBar'); if (!bar) return;
  const hide = !state.content || isStandalone() || instDismissed();
  bar.hidden = hide; $('#app').classList.toggle('has-instbar', !hide);
}
function dismissInstBar() { store.set('tr26.inst_optout', true); updInstBar(); }
async function installApp() {
  if (state.deferredInstall) {
    const ev = state.deferredInstall; state.deferredInstall = null;
    try { ev.prompt(); const { outcome } = await ev.userChoice; if (outcome === 'accepted') { store.set('tr26.inst_optout', true); toast('Installing…'); } } catch {}
    updInstBar(); return;
  }
  // no native prompt available (iPhone, or the browser has not offered one yet): show the steps
  openSheet();
}

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
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); state.deferredInstall = e; updInstBar(); });
  window.addEventListener('appinstalled', () => { store.set('tr26.inst_optout', true); state.deferredInstall = null; updInstBar(); toast('Installed. Find it on your home screen.'); });
  $('#instBtn').addEventListener('click', installApp);
  $('#instDismiss').addEventListener('click', dismissInstBar);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && state.content) renderToday(); });
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
$('#viewerClose').innerHTML = ico('close'); $('#viewerDownload').innerHTML = ico('download'); $('#viewerOpen').innerHTML = ico('external');
(async () => {
  try { await loadManifest(); } catch { lockMsg('Cannot reach the vault. Check your connection.', true); }
  if (!(await tryAutoUnlock())) { $('#pass').focus(); }
})();
