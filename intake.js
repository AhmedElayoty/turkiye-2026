/* Offline document intake: read a file, pull the PDF text, shrink photos, and guess what a document is and which trip
   day (and trip) it belongs to. Returns the same Proposal shape as ai.classifyDocument, with source 'phone'.
   No storage and no DOM except a canvas for photos. Nothing trip-specific lives here: it all comes from `content`. */

export const KINDS = {
  flight: { label: 'Flight ticket', icon: 'plane' }, hotel: { label: 'Hotel booking', icon: 'hotel' },
  transfer: { label: 'Transfer', icon: 'bus' }, tour: { label: 'Tour', icon: 'star' },
  museum: { label: 'Museum / sight ticket', icon: 'ticket' }, event: { label: 'Event ticket', icon: 'ticket' },
  restaurant: { label: 'Restaurant booking', icon: 'food' }, transport: { label: 'Transport ticket', icon: 'ferry' },
  receipt: { label: 'Receipt', icon: 'receipt' }, insurance: { label: 'Insurance', icon: 'shield' },
  id: { label: 'ID document', icon: 'shield' }, other: { label: 'Document', icon: 'filetext' },
};

/* ---------- files ---------- */
const EXT = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  heic: 'image/heic', heif: 'image/heif', avif: 'image/avif', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff', txt: 'text/plain' };
function sniff(b) {
  const s = (i, n) => String.fromCharCode(...b.subarray(i, i + n));
  if (s(0, 1024).includes('%PDF-')) return 'application/pdf';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && s(1, 3) === 'PNG') return 'image/png';
  if (s(0, 4) === 'GIF8') return 'image/gif';
  if (s(0, 4) === 'RIFF' && s(8, 4) === 'WEBP') return 'image/webp';
  if (s(4, 4) === 'ftyp') {
    const brands = s(8, Math.min(32, b.length - 8));
    if (/avi[fs]/.test(brands)) return 'image/avif';
    if (/hei[cxms]|hev[cx]|mif1|msf1/.test(brands)) return 'image/heic';
  }
  if (s(0, 2) === 'BM') return 'image/bmp';
  if (s(0, 4) === 'II*\0' || s(0, 4) === 'MM\0*') return 'image/tiff';
  return '';
}
export async function readFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const name = file.name || 'document', ext = (/\.([a-z0-9]{2,5})$/i.exec(name) || [])[1]?.toLowerCase();
  const typed = file.type && file.type !== 'application/octet-stream' ? file.type : '';
  const mime = sniff(bytes) || typed || EXT[ext] || 'application/octet-stream';
  return { bytes, mime, name, size: bytes.length, type: mime === 'application/pdf' ? 'pdf' : mime.startsWith('image/') ? 'image' : 'other' };
}

/* chunked, so a 10 MB file never overflows the call stack */
export const toBase64 = (bytes) => {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (typeof b.toBase64 === 'function') return b.toBase64();
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
};

/* photos → upright JPEG, longest edge ≤ maxEdge, EXIF (and GPS) dropped. Undecodable (HEIC on Chrome): original bytes back. */
function loadImg(blob) {
  return new Promise((res) => {
    if (typeof Image === 'undefined' || !globalThis.URL?.createObjectURL) { res(null); return; }
    const url = URL.createObjectURL(blob), img = new Image();
    img.onload = () => res({ src: img, w: img.naturalWidth, h: img.naturalHeight, done: () => URL.revokeObjectURL(url) });
    img.onerror = () => { URL.revokeObjectURL(url); res(null); };
    img.src = url;
  });
}
async function decodeImage(blob) {
  if (typeof createImageBitmap === 'function') {
    try { const bm = await createImageBitmap(blob, { imageOrientation: 'from-image' }); return { src: bm, w: bm.width, h: bm.height, done: () => bm.close() }; } catch { /* fall back to <img> */ }
  }
  return loadImg(blob);
}
function canvas2d(w, h) {
  if (typeof OffscreenCanvas === 'function') { const cv = new OffscreenCanvas(w, h); const ctx = cv.getContext('2d'); if (ctx) return { cv, ctx }; }
  if (typeof document === 'undefined') return null;
  const cv = Object.assign(document.createElement('canvas'), { width: w, height: h });
  return { cv, ctx: cv.getContext('2d') };
}
const jpegBlob = (cv, quality) => cv.convertToBlob ? cv.convertToBlob({ type: 'image/jpeg', quality })
  : new Promise((res, rej) => cv.toBlob((b) => b ? res(b) : rej(new Error('toBlob')), 'image/jpeg', quality));
export async function normalizeImage(bytes, mime, { maxEdge = 2000, quality = 0.85 } = {}) {
  const keep = { bytes, mime, width: 0, height: 0, unreadable: true };
  let img = null;
  try {
    img = await decodeImage(new Blob([bytes], { type: mime || 'image/jpeg' }));
    if (!img || !img.w || !img.h) return keep;
    const k = Math.min(1, maxEdge / Math.max(img.w, img.h)), width = Math.max(1, Math.round(img.w * k)), height = Math.max(1, Math.round(img.h * k));
    const c = canvas2d(width, height); if (!c?.ctx) return keep;
    c.ctx.fillStyle = '#fff'; c.ctx.fillRect(0, 0, width, height);          // transparent PNG → white, not black
    c.ctx.imageSmoothingQuality = 'high'; c.ctx.drawImage(img.src, 0, 0, width, height);
    const out = new Uint8Array(await (await jpegBlob(c.cv, quality)).arrayBuffer());
    return { bytes: out, mime: 'image/jpeg', width, height };
  } catch { return keep; } finally { img?.done(); }
}

/* ---------- PDF text (pdf.js), lines in reading order ---------- */
let pdfjsLoading = null;
function loadPdfjs() {
  if (!pdfjsLoading) pdfjsLoading = import(new URL('./vendor/pdf.min.mjs', import.meta.url).href).then((lib) => {
    if (!lib.GlobalWorkerOptions.workerSrc) lib.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', import.meta.url).href;
    return lib;
  }).catch((e) => { pdfjsLoading = null; throw e; });
  return pdfjsLoading;
}
/* text drawn with fonts that have no Unicode map (printer-driver PDFs) comes out as symbol soup: drop it */
function garbled(t) {
  const toks = t.split(/\s+/).filter(Boolean); if (toks.join('').length < 20) return false;
  return toks.filter(w => /^[\p{L}][\p{L}'’-]+[.,:;)]?$/u.test(w)).length / toks.length < 0.15;   // real pages ≥ 0.45, symbol soup ≈ 0
}
function pageLines(items) {
  const its = items.filter(i => i.str && i.str.trim()).map(i => ({ s: i.str, x: i.transform[4], y: i.transform[5], w: i.width || 0, h: Math.abs(i.height || i.transform[3]) || 10 }));
  its.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const it of its) {
    const l = lines[lines.length - 1];
    if (l && Math.abs(l.y - it.y) <= Math.max(2, Math.min(l.h, it.h) * 0.5)) l.items.push(it); else lines.push({ y: it.y, h: it.h, items: [it] });
  }
  return lines.map((l) => {
    l.items.sort((a, b) => a.x - b.x);
    let out = '', end = null;
    for (const it of l.items) {
      if (end !== null && it.x - end > it.h * 0.2 && !/\s$/.test(out) && !/^\s/.test(it.s)) out += it.x - end > it.h * 2.5 ? '   ' : ' ';
      out += it.s; end = it.x + it.w;
    }
    return out.replace(/\s+$/, '');
  }).join('\n');
}
/* pdfjs: pass the app's already-loaded pdf.js module to share it; '' when the PDF has no readable text (scan, password) */
export async function pdfText(bytes, { maxPages = 8, pdfjs = null } = {}) {
  const lib = pdfjs || await loadPdfjs();
  let doc = null;
  try {
    doc = await lib.getDocument({ data: bytes.slice(0), isEvalSupported: false, disableFontFace: true }).promise;
    const pages = [];
    for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
      const page = await doc.getPage(i), t = pageLines((await page.getTextContent()).items);
      if (!garbled(t)) pages.push(t);
      page.cleanup();
    }
    return pages.join('\n\n').trim();
  } catch (e) {
    console.warn('pdfText:', e?.name || 'error');
    return '';
  } finally { if (doc) doc.destroy(); }
}

/* ---------- text helpers ---------- */
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad2 = (n) => String(n).padStart(2, '0');
const isoOf = (y, m, d) => { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? `${y}-${pad2(m)}-${pad2(d)}` : null; };
const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const days = (a, b) => (Date.parse(a) - Date.parse(b)) / 864e5;
const dateLabel = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MON[m - 1]}`; };
const localIso = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const cut = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).replace(/[\s,.;:·-]+$/, '') + '…' : s; };
const uniq = (a) => [...new Set(a)];

/* fold = lower case, accents off, Turkish İ/ı → i, Arabic letter variants and digits unified. One char in, one char out,
   so positions in the folded text are positions in the original. */
const FOLD = new Map();
function foldChar(c) {
  if (c === 'İ' || c === 'I' || c === 'ı') return 'i';
  const a = c.charCodeAt(0);
  if (a >= 0x660 && a <= 0x669) return String(a - 0x660);
  if (a >= 0x6f0 && a <= 0x6f9) return String(a - 0x6f0);
  if (c === 'ة') return 'ه';
  if (c === 'ى') return 'ي';
  const s = c.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '');
  return s.length ? s[0] : c;
}
const fold = (s) => String(s || '').replace(/[A-Z]|[^\t\n\r -@\[-~]/g, (c) => { let r = FOLD.get(c); if (r === undefined) FOLD.set(c, r = foldChar(c)); return r; });
/* No regex lookbehind anywhere (Safari before iOS 16.4 cannot even parse it). Instead a match is dropped in JS when the
   text just before it ends with `bad`; the regexes still start with plain text, which keeps scanning fast. */
const LETTER = /[\p{L}\p{N}]$/u;
function next(re, s, bad = LETTER) {
  let m;
  while ((m = re.exec(s))) { if (!m.index || !bad.test(s.slice(Math.max(0, m.index - 2), m.index))) return m; re.lastIndex = m.index + 1; }
  return null;
}
const each = (re, s, fn, bad) => { re.lastIndex = 0; for (let m; (m = next(re, s, bad));) fn(m); };
const W = (alts, flags = 'gu') => new RegExp(`(?:${alts})(?![\\p{L}\\p{N}])`, flags);
const count = (re, s, cap = 99) => { re.lastIndex = 0; let n = 0; while (n < cap && next(re, s)) n++; return n; };
const words = (s) => s.match(/[\p{L}\p{N}]+/gu) || [];
const lineAt = (s, i) => { const a = s.lastIndexOf('\n', i - 1) + 1, b = s.indexOf('\n', i); return [a, b < 0 ? s.length : b]; };
/* the label in front of a value: the start of its line, or the end of the previous line when the value starts a line */
function before(s, i, n = 60) {
  const [a] = lineAt(s, i); let from = a;
  if (!s.slice(a, i).trim()) from = s.lastIndexOf('\n', a - 2) + 1;
  return s.slice(Math.max(from, i - n), i);
}
/* keyword phrases live in "word space": folded words joined by one space ('check-in' → 'check in', 'booking.com' → 'booking com') */
const P = (s) => s.split('|');
function counter(wl) {
  const fw = ` ${wl.join(' ')} `, wc = new Map();
  for (const w of wl) wc.set(w, (wc.get(w) || 0) + 1);
  return (terms, cap = 99) => {
    let n = 0;
    for (const t of terms) {
      if (t.includes(' ')) { const k = ` ${t} `; for (let i = fw.indexOf(k); i >= 0 && n < cap; i = fw.indexOf(k, i + 1)) n++; } else n += wc.get(t) || 0;
      if (n >= cap) return cap;
    }
    return n;
  };
}

/* ---------- dates and times ---------- */
const MONTHS = [
  ['january', 'jan', 'ocak', 'oca', 'يناير', 'كانون الثاني'], ['february', 'feb', 'subat', 'sub', 'فبراير', 'شباط'],
  ['march', 'mar', 'mart', 'مارس', 'اذار'], ['april', 'apr', 'nisan', 'nis', 'ابريل', 'نيسان'], ['may', 'mayis', 'مايو', 'ايار'],
  ['june', 'jun', 'haziran', 'haz', 'يونيو', 'حزيران'], ['july', 'jul', 'temmuz', 'tem', 'يوليو', 'تموز'],
  ['august', 'aug', 'agustos', 'agu', 'اغسطس'], ['september', 'sept', 'sep', 'eylul', 'eyl', 'سبتمبر', 'ايلول'],
  ['october', 'oct', 'ekim', 'eki', 'اكتوبر', 'تشرين الاول'], ['november', 'nov', 'kasim', 'kas', 'نوفمبر', 'تشرين الثاني'],
  ['december', 'dec', 'aralik', 'ديسمبر', 'كانون الاول'],
];
const MON_OF = new Map(MONTHS.flatMap((ws, i) => ws.map(w => [w, i + 1])));
const MON_ALT = [...MON_OF.keys()].sort((a, b) => b.length - a.length).join('|');
const RE_ISO = /(20\d\d)[-./](\d{1,2})[-./](\d{1,2})(?!\d)/g;
const RE_NUM = /(\d{1,2})([./-])(\d{1,2})\2(20\d\d|\d\d)(?!\d|[.,:]\d)/g;
const RE_DMY = new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?[\\s.\\-/]{0,2}(?:of\\s+)?(${MON_ALT})(?![\\p{L}])\\.?(?:[\\s,.\\-/]{0,3}(20\\d\\d)(?!\\d)|[\\-/.]?(\\d\\d)(?![\\d:]))?`, 'gu');
const RE_MDY = new RegExp(`(${MON_ALT})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?!\\d|[:.,]\\d)(?:,?\\s+(20\\d\\d)(?!\\d))?`, 'gu');
const RE_MON_WORD = new RegExp(`(${MON_ALT})(?![\\p{L}])`, 'gu');
const RE_TIME = /([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?(?!\d)(?:\s?([ap])\.?m\.?(?![\p{L}]))?/gu;
const RE_TIME_TR = /saat\s*:?\s*([01]?\d|2[0-3])\.([0-5]\d)(?!\d)/g;
const B_DIGIT = /\d$/, B_NUM = /\d[.,/-]?$/, B_DMY = /[\p{L}\d]$/u, B_TIME = /[\d:.,]$/;

function findDates(f, year, lo, hi) {
  const out = [], push = (y, m, d, i, len, hasYear) => {
    const iso = isoOf(y, m, d);
    if (iso && iso >= lo && iso <= hi && !out.some(o => i < o.i + o.len && o.i < i + len)) out.push({ iso, i, len, hasYear });
  };
  each(RE_ISO, f, (m) => push(+m[1], +m[2], +m[3], m.index, m[0].length, true), B_DIGIT);
  each(RE_NUM, f, (m) => {
    let a = +m[1], b = +m[3]; const y = m[4].length === 2 ? 2000 + +m[4] : +m[4];
    if (b > 12 && a <= 12) [a, b] = [b, a];                    // 10/17/2026 (US) → 17 Oct
    push(y, b, a, m.index, m[0].length, true);
  }, B_NUM);
  each(RE_DMY, f, (m) => push(m[3] ? +m[3] : m[4] ? 2000 + +m[4] : year, MON_OF.get(m[2]), +m[1], m.index, m[0].length, !!(m[3] || m[4])), B_DMY);
  each(RE_MDY, f, (m) => push(m[3] ? +m[3] : year, MON_OF.get(m[1]), +m[2], m.index, m[0].length, !!m[3]), LETTER);
  return out.sort((a, b) => a.i - b.i);
}
function findTimes(f) {
  const out = []; let m;
  each(RE_TIME, f, (m) => {
    let h = +m[1]; if (m[3] === 'p' && h < 12) h += 12; if (m[3] === 'a' && h === 12) h = 0;
    out.push({ t: `${pad2(h)}:${m[2]}`, i: m.index });
  }, B_TIME);
  for (RE_TIME_TR.lastIndex = 0; (m = RE_TIME_TR.exec(f));) out.push({ t: `${pad2(+m[1])}:${m[2]}`, i: m.index + m[0].length - 5 });
  return out.sort((a, b) => a.i - b.i);
}

/* ---------- money ---------- */
const CUR = { '₺': 'TRY', tl: 'TRY', try: 'TRY', ytl: 'TRY', '€': 'EUR', eur: 'EUR', euro: 'EUR', euros: 'EUR', '$': 'USD', usd: 'USD',
  aed: 'AED', dhs: 'AED', dh: 'AED', '£': 'GBP', gbp: 'GBP' };
const CUR_ALT = '₺|€|\\$|£|TRY|TL|YTL|EUR|Euros?|USD|AED|Dhs|GBP';
const RE_MONEY = new RegExp(`(?:(${CUR_ALT})(?![\\p{L}])\\s?\\*?\\s?)?\\*?(\\d{1,3}(?:([.,])\\d{3})(?:\\3\\d{3})*(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?)(?![\\d.,]\\d)(?:\\s?(${CUR_ALT})(?![\\p{L}]))?`, 'giu');
function parseNum(s) {
  s = s.replace(/[\s*]/g, '');
  const c = s.lastIndexOf(','), d = s.lastIndexOf('.'), k = Math.max(c, d);
  if (k < 0) return +s;
  if (c >= 0 && d >= 0) return +s.slice(0, k).replace(/[.,]/g, '') + +('0.' + s.slice(k + 1));
  const sep = s[k], n = s.split(sep).length - 1, frac = s.length - k - 1;
  if (n > 1 || frac === 3) return +s.replace(/[.,]/g, '');
  return +s.replace(sep, '.');
}
function findMoney(T) {
  const out = []; let m;
  for (RE_MONEY.lastIndex = 0; (m = next(RE_MONEY, T, /\p{L}$/u));) {                 // "TL" inside a word is not lira
    const sym = m[1] || m[4], value = parseNum(m[2]);
    if (!(value > 0)) continue;
    const cur = sym ? CUR[sym.toLowerCase()] || CUR[sym] : null;
    if (!cur && !/[.,]\d{2}$/.test(m[2])) continue;                    // a bare number needs decimals to count as money
    out.push({ value: Math.round(value * 100) / 100, cur, raw: m[0].trim().replace(/^\*/, ''), i: m.index });
  }
  return out;
}

/* ---------- references, flights ---------- */
const AIRLINES = 'TK|PC|FZ|EK|EY|XQ|VF|AJ|G9|J2|QR|SV|MS|RJ|W6|LH|BA|AF|KL|LX|OS|A3|U2|FR|KU|GF|WY|6E|AI|UX|IB|AZ|XY|NE|F3';
const RE_FLIGHT = new RegExp(`(${AIRLINES})\\s?-?\\s?(\\d{2,4})(?![\\dA-Za-z])`, 'g');
const B_ALNUM = /[A-Za-z0-9]$/;
const IATA = { IST: 'Istanbul', SAW: 'Istanbul Sabiha Gökçen', AYT: 'Antalya', AUH: 'Abu Dhabi', DXB: 'Dubai', DWC: 'Dubai', SHJ: 'Sharjah',
  ESB: 'Ankara', ADB: 'İzmir', DLM: 'Dalaman', BJV: 'Bodrum', ASR: 'Kayseri', NAV: 'Cappadocia', TZX: 'Trabzon', GZT: 'Gaziantep', DOH: 'Doha' };
const REF_LABELS = [
  ['policy id/policy no|policy no|policy number|police no|police numarasi', 12],
  ['pnr|reservation code|booking reference|booking ref|reservation reference|airline reference|confirmation number|confirmation no|confirmation code|confirmation|reference number|reference no|reference code|reference|ref no|ref|rezervasyon kodu|rezervasyon no|rezervasyon numarasi|onay kodu|pnr no', 10],
  ['booking number|booking no|booking id|booking code|reservation id|reservation number|reservation no|order number|order no|order id|order|siparis no|siparis numarasi|voucher number|voucher no|voucher code|voucher|ticket number|ticket no|ticket id|e-ticket number|bilet no|bilet numarasi|transaction id', 8],
];
const RE_REF_LABEL = REF_LABELS.map(([alts, w]) => [W(alts.replace(/\//g, '\\/'), 'gu'), w]);
const RE_SENSITIVE = W('passport(?: no| number)?|pasaport(?: no)?|identity number|id number|id no|identity no|kimlik(?: no)?|tc kimlik|national id|document no|date of birth|birth date|dogum tarihi|personal no');
function refAfter(T, end, pnrish) {
  const m = /^[\s:#.\-–]*(?:no\.?|number|#)?[\s:#.\-–]*([A-Za-z0-9][A-Za-z0-9\-./]{2,30}[A-Za-z0-9])/.exec(T.slice(end, end + 80));
  if (m && okRef(m[1], pnrish)) return m[1];
  for (const l of T.slice(end, end + 160).split('\n').slice(1, 3)) { const v = l.trim(); if (/^[A-Z0-9]{5,8}$/.test(v) && okRef(v, pnrish)) return v; }   // value a line or two below (Turkish Airlines)
  return null;
}
function okRef(v, pnrish) {
  if (v.length < 4 || v.length > 32 || /^(20\d\d|\d{1,3})$/.test(v)) return false;
  if (/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(v) || /^\d{1,2}:\d{2}$/.test(v)) return false;
  if (!/\d/.test(v)) return pnrish && /^[A-Z]{6}$/.test(v);
  return /[A-Za-z]/.test(v) || v.replace(/\D/g, '').length >= 4;
}

/* ---------- kind signals: [phrases, weight, cap] ---------- */
const SIG = {
  flight: [[P('boarding pass|binis karti|boarding time|gate closes|boarding group|mobile boarding'), 5, 2], [P('flight|flights|ucus|ucusu'), 1.5, 3],
    [P('flight no|flight number|ucus no'), 2, 1], [P('airlines|airways|flydubai|pegasus|ajet|anadolujet|sunexpress|emirates|etihad|air arabia|hava yollari|qatar airways'), 2.5, 2],
    [P('pnr|reservation code|booking reference|e ticket receipt|eticket receipt|itinerary receipt'), 2, 1], [P('departure|arrival|terminal|baggage|cabin|economy|business class|seat|gate|kalkis|varis|bagaj'), 0.7, 6]],
  hotel: [[P('check out|checkout|cikis tarihi'), 2.5, 1], [P('check in|checkin|giris tarihi'), 1, 1], [P('hotel|hotels|otel|oteli|resort|hostel|apart|aparts|suite|suites|pansiyon'), 1.5, 3],
    [P('room|rooms|oda|night|nights|gece|guest|guests|double|twin|king|queen|deluxe|all inclusive|breakfast included|half board'), 0.7, 6],
    [P('booking com|agoda|expedia|hotels com|airbnb|trivago'), 2, 1], [P('konaklama|accommodation|stay'), 1.5, 2]],
  transfer: [[P('transfer|transfers|shuttle'), 3, 3], [P('airport transfer|havalimani transferi|private transfer'), 3, 1],
    [P('pick up|pickup|drop off|dropoff|meet and greet|meet greet|meeting point|driver|sofor|vehicle|arac|private van|private car|minivan|vito|sprinter|sign board|name sign'), 1.5, 5]],
  tour: [[P('tour|tours|turu|cruise|excursion|guided|rehberli|boat trip|tekne turu|day trip|balloon|sightseeing|safari|yacht'), 3, 3],
    [P('sunset cruise|dinner cruise|boat tour|bosphorus cruise|bosphorus tour|bogaz turu|tour operator'), 3, 1],
    [P('meeting point|bulusma noktasi|hotel pick up|hotel pickup|guide|rehber|itinerary|duration'), 1, 3]],
  museum: [[P('museum|muze|muzesi|palace|sarayi|cistern|sarnici|gallery|exhibition|sergi|archaeology|archaeological|arkeoloji|tower|kulesi|mosque|camii|monument|oren yeri|museum pass|muzekart|muze kart'), 2, 4],
    [P('admission|entry|entrance|giris|visit|visitor|visitors|ziyaret|time slot|skip the line|audio guide|sesli rehber|ticket|tickets|bilet|bileti|biletleri|ebilet|e bilet|eticket|e ticket'), 1, 5]],
  event: [[P('concert|konser|show|gosteri|performance|theatre|theater|tiyatro|festival|stadium|stadyum|match|ceremony|seremoni|whirling|dervish|dervishes|sema|opera|ballet|bale|cinema|sinema|doors open|biletix|passo|biletinial|mobilet'), 2.5, 3],
    [P('seat|koltuk|row|sira|block|blok|section|tribun|venue|salon|sahne|stage'), 0.8, 4]],
  restaurant: [[P('restaurant|restoran|lokanta|brasserie|bistro|steakhouse|meyhane|kebap|kebab|ocakbasi|rooftop|terrace|teras'), 1.5, 3],
    [P('table|masa|party size|covers|kisi|people|persons|diners|guests'), 1, 3], [P('reservation|rezervasyon|reserved|booking confirmed'), 1, 2],
    [P('dinner|lunch|breakfast|brunch|aksam yemegi|ogle yemegi|kahvalti|menu'), 1, 2], [P('opentable|thefork|sevenrooms|resy|tablecheck|quandoo|rezzta'), 3, 1]],
  transport: [[P('ferry|feribot|vapur|sehir hatlari|turyol|dentur|ido|marmaray|metro|metrobus|tram|tramvay|funicular|fuunikuler|train|tren|tcdd|yht|bus ticket|otobus|istanbulkart|dolmus|seabus|deniz otobusu|cable car|teleferik'), 2.5, 3],
    [P('pier|iskele|iskelesi|platform|route|line|hat|sefer|kalkis'), 0.7, 4]],
  receipt: [[P('toplam|topkdv|kdv|fis|fis no|z no|eku no|vergi dairesi|vkn|nakit|kredi karti|banka karti|para ustu|ara toplam|odenecek|tutar'), 2, 6],
    [P('receipt|invoice|fatura|subtotal|grand total|amount due|total paid|cashier|kasiyer|terminal id|auth code|thank you for your visit|thank you for your purchase|taksimetre'), 2, 3],
    [P('total|tax|vat|tip|cash|card|paid|qty|fare|taxi|taksi|meter|change|amount|received'), 0.7, 6]],
  insurance: [[P('insurance|sigorta|sigortasi|insured|sigortali|policy holder|sigorta ettiren|coverage|teminat|premium|policy no|policy id|police no|assistance|emergency center|emergency centers'), 2, 8],
    [P('demir saglik|allianz|axa|mapfre|anadolu sigorta|ergo|sompo|zurich|eureko|ray sigorta|turkiye sigorta|neova|bupa|daman|orient insurance|travel guard'), 4, 1]],
  id: [[P('emirates id|identity card|id card|kimlik karti|nufus cuzdani|resident identity|residence permit|ikamet izni|evisa|e visa|electronic visa|elektronik vize|visa grant|visa number|visa no'), 4, 2],
    [P('passport|pasaport'), 0.5, 2], [P('date of birth|dogum tarihi|place of birth|nationality|uyruk|sex|cinsiyet|date of expiry|date of issue|issuing state|issuing authority|issuing country|surname|given name|given names|personal no'), 0.8, 6]],
};
const FILE_SIG = [
  ['flight', P('boarding|boardingpass|bp|flight|eticket|e ticket|airline|pnr'), 3], ['hotel', P('hotel|otel|resort|booking|stay'), 3],
  ['transfer', P('transfer|shuttle|pickup'), 3], ['tour', P('tour|cruise|excursion|balloon'), 3],
  ['museum', P('museum|muze|palace|sarayi|hagia|ayasofya|topkapi|cistern|ticket|bilet'), 2], ['event', P('concert|event|show|konser|match'), 3],
  ['restaurant', P('restaurant|dinner|lunch|table|reservation|rezervasyon'), 2], ['transport', P('ferry|vapur|metro|train|bus|istanbulkart'), 3],
  ['receipt', P('receipt|fis|fatura|invoice|bill'), 3], ['insurance', P('insurance|policy|sigorta|certificate'), 2],
  ['id', P('passport|pasaport|visa|evisa|emirates id|eid|id card|kimlik|residence'), 3],
];
const CATS = [['Taxi', P('taxi|taksi|taksimetre|uber|bitaksi|yellow cab|cab fare')], ['Shisha', P('nargile|shisha|hookah')],
  ['Ferry & transit', P('istanbulkart|ferry|vapur|metro|marmaray|tram|tramvay|sehir hatlari|funicular|bus|otobus')],
  ['Tickets', P('museum|muze|muzesi|ticket|bilet|admission|giris')], ['SIM & data', P('turkcell|vodafone|turk telekom|esim|e sim|sim card|sim kart|data plan|internet paketi')],
  ['Food', P('restaurant|restoran|lokanta|cafe|kafe|kahve|coffee|kebap|kebab|yemek|meal|food|pide|doner|baklava|cay|tea|corba|salata|icecek|beverage|water|su|ayran|kunefe|kofte|lahmacun|burger|pizza')],
  ['Shopping', P('store|shop|magaza|market|clothing|giyim|souvenir|hediyelik|boutique|carsi|bazaar')]];
const RE_MRZ = /(^|\n)[ \t]*(?:P[A-Z<]|I[A-Z<]|V[A-Z<]|ID)[A-Z<]{3}[A-Z0-9<]{20,}|[A-Z0-9<]{9}\d[A-Z<]{3}\d{6}\d[MF<]\d{6}/;
const RE_ITIN = W('day \\d+ of \\d+|daily plan|itinerary|day plan|gun \\d+');
const RE_POS = W('departure|depart|date of travel|travel date|visit date|visit|ziyaret tarihi|ziyaret|tarih|tarihi|event date|date|check-?in|arrival|pick-?up|pickup|valid on|valid for|for|on|at|flight date|giris|kalkis|time slot|session|seans');
const RE_NEG = W('transaction|booked on|booking date|issue date|issued|order date|ordered|purchase date|purchased|payment|paid on|printed|created|date of birth|birth|dogum|expiry|expires|expire date|valid until|duzenleme|islem tarihi|satis tarihi|satin alma|hzr|publication|condition date|generated');
const RE_TPOS = W('departure|dep|std|kalkis|time slot|entry|giris saati|giris|saat|start|starts|begins|pick-?up|pickup|boarding|from|at|seans|session|time|reservation time');
const RE_TNEG = W('transaction|booked|printed|issued|created|hzr|until|closes|close|latest|before|opening hours|open|gmt|duration');
const RE_DEP = W('departure|dep|kalkis|std'), RE_ARR = W('arrival|arrives|varis|lands|arr');
const RE_TOT = W('genel toplam|grand total|toplam tutar|total amount|amount due|total paid|total price|total|toplam|tutar|odenecek|fare|price|ucret|amount|fiyat');
const RE_NOT = W('kdv|topkdv|vat|tax|ara toplam|subtotal|sub total|discount|indirim|change|para ustu|tip|per person|each|deposit');
const RE_NOTE = W('arrive|be ready|please bring|bring|please print|meeting point|meet at|exit gate|gate closes|dress code|free cancellation|non-refundable|valid only|show this|check-in opens|online check-in|deposit|headscarf|passport required');
const GENERIC = new Set(('the and of de la le el pier iskele iskelesi hotel otel resort cafe kafe coffee restaurant restoran lounge bar hookah shisha nargile ' +
  'mosque camii cami square meydani airport havalimani gate kapi kapisi museum muzesi muze palace sarayi tower kulesi market park parki street cad caddesi cd sk ' +
  'sok sokak waterfront mall church college terrace rooftop grand old new view center centre mansion house port bistro brasserie kebab kebap lahmacun bakery ' +
  'produce istanbul antalya bosphorus bogaz golden horn halic sea beach lara city turkey turkiye international terminal deluxe luxe saved pin your meal lunch ' +
  'dinner breakfast tram ferry taxi walk lanes lower upper waterfall blue espressolab imperial').split(' '));
/* everyday words that must not identify a place on their own (Sunset Grill, Castle Cafe, Kıyı, Sade Kahve) */
const COMMON = new Set(('sunset grill garden royal star sky home white black red green little big best happy central art modern castle kitchen table rose ' +
  'moon sun life time world ocean point corner family club social son kiyi sade kahve cay yeni eski deniz liman tarihi').split(' '));
const SIGHTS = [['Hagia Sophia', 'ayasofya|aya sofya|hagia sophia'], ['Blue Mosque', 'sultanahmet camii|sultan ahmed mosque|sultanahmet mosque|sultan ahmet camii|blue mosque'],
  ['Topkapı Palace', 'topkapi sarayi|topkapi palace|topkapi'], ['Basilica Cistern', 'yerebatan|basilica cistern'], ['Galata Tower', 'galata kulesi|galata tower'],
  ['Grand Bazaar', 'kapalicarsi|kapali carsi|grand bazaar'], ['Dolmabahçe Palace', 'dolmabahce'], ['Süleymaniye Mosque', 'suleymaniye'],
  ['Rumeli Fortress', 'rumeli hisari|rumelihisari'], ['Maiden’s Tower', 'kiz kulesi|maidens tower'], ['Archaeology Museums', 'arkeoloji muzeleri|archaeology museum|archaeology museums'],
  ['Pera Museum', 'pera muzesi|pera museum'], ['Istanbul Modern', 'istanbul modern'], ['Chora', 'kariye|chora'],
  ['Düden Waterfall', 'duden'], ['Hadrian’s Gate', 'hadrian'], ['Kaleiçi', 'kaleici']].map(([name, alts]) => ({ name, terms: P(alts) }));
const STOP = new Set('for with the and from check app book reserve your one pay buy load photograph receipt online ticket tickets each table day oct sehir hatlari'.split(' '));
const INSURERS = [['demir saglik', 'Demir Sağlık'], ['allianz', 'Allianz'], ['axa', 'AXA'], ['mapfre', 'Mapfre'], ['anadolu sigorta', 'Anadolu Sigorta'],
  ['sompo', 'Sompo'], ['zurich', 'Zurich'], ['eureko', 'Eureko'], ['ray sigorta', 'Ray Sigorta'], ['turkiye sigorta', 'Türkiye Sigorta'], ['neova', 'Neova'], ['daman', 'Daman']];

const tokens = (s) => words(fold(s)).filter(t => t.length >= 3 && !GENERIC.has(t));
function namer(name) {
  const all = words(fold(name)).filter(t => t !== 'the');
  return { name, toks: tokens(name), phrase: ` ${all.join(' ')} ` };
}
/* a place is in the text when its whole name is, or its distinctive words are (the first one must be there and be unusual) */
function hit(p, M) {
  if (!p || !p.phrase.trim()) return false;
  if (M.fw.includes(p.phrase)) return true;
  const k = p.toks; if (!k.length) return false;
  const h = k.filter(t => M.wset.has(t));
  if (h.length === k.length) return h.some(t => t.length >= 4) && (k.length > 1 || !COMMON.has(k[0]));
  if (!M.wset.has(k[0]) || COMMON.has(k[0])) return false;
  return h.length >= 2 || k[0].length >= 6;
}

/* ---------- per-content index (cached) ---------- */
const CACHE = new WeakMap();
const refRe = (v) => {
  const a = String(v || '').replace(/[^A-Za-z0-9]/g, '');
  return a.length >= 5 ? new RegExp(`${a.split('').join('[\\s.\\-/]?')}(?![A-Za-z0-9])`, 'gi') : null;
};
const findRef = (re, T) => { re.lastIndex = 0; return next(re, T, B_ALNUM)?.[0] || null; };
function bookingDates(b, year) {
  const out = []; if (b.dateIso) out.push(b.dateIso);
  const s = fold(b.dates || '');
  each(/(\d{1,2})(?![\d:]|\s*(?:nights?|h\b|min))/g, s, (m) => {
    const rest = s.slice(m.index); RE_MON_WORD.lastIndex = 0; const mm = next(RE_MON_WORD, rest, /\p{L}$/u); if (!mm) return;
    const y = /20\d\d/.exec(rest), iso = isoOf(y ? +y[0] : year, MON_OF.get(mm[1]), +m[1]); if (iso) out.push(iso);
  }, /[\d:]$/);
  return uniq(out).sort();
}
function index(c) {
  if (CACHE.has(c)) return CACHE.get(c);
  const dayList = c.days || [], dayIsos = dayList.map(d => d.date);
  const start = c.meta?.tripStart || dayIsos[0] || null, end = c.meta?.tripEnd || dayIsos[dayIsos.length - 1] || start, now = localIso();
  const year = +(start || now).slice(0, 4), pols = c.insurance?.policies || [];
  const bookings = (c.bookings || []).map((b) => {
    const pol = pols.find(p => p.bookingId === b.id);
    const refs = [b.confirmation, pol?.policyNo, ...String(b.tickets || '').match(/\d[\d-]{8,}\d/g) || []].map(refRe).filter(Boolean);
    const times = [...(b.legs || []).map(l => (/\d{1,2}:\d{2}/.exec(l.from) || [])[0]), (/\d{1,2}:\d{2}/.exec(b.dates || '') || [])[0]].filter(Boolean);
    return { b, refs, dates: bookingDates(b, year), times, flights: (b.legs || []).map(l => l.flight.replace(/\s/g, '').toUpperCase()),
      names: [b.title, b.short].filter(Boolean).map(namer), via: b.kind === 'transfer' && b.via ? [namer(b.via.split('·').pop())] : [],
      keys: (b.keywords || []).map(fold), aliases: (b.aliases || []).map(fold) };
  });
  for (const p of pols) if (p.bookingId && !bookings.some(x => x.b.id === p.bookingId)) bookings.push({ b: { id: p.bookingId, kind: 'insurance' }, refs: [refRe(p.policyNo)].filter(Boolean), dates: [], times: [], flights: [], names: [], via: [], keys: [], aliases: [] });
  const places = [], seen = new Set();
  const add = (name, extra) => { const k = fold(name || '').trim(); if (!k || seen.has(k)) return; seen.add(k); places.push({ ...namer(name), ...extra }); };
  (c.venues || []).forEach(v => { add(v.name, { venue: v }); (v.aliases || []).forEach(a => add(a, { venue: v, label: v.name })); });
  (c.sights || []).forEach(s => { add(s.name, { sight: s }); (s.aliases || []).forEach(a => add(a, { sight: s, label: s.name })); });
  dayList.forEach(d => (d.trips || []).forEach(t => { add(t.to, { trip: true }); add(t.from, { trip: true }); }));
  const X = { dayIsos, daySet: new Set(dayIsos), dayBy: new Map(dayList.map(d => [d.date, d])), start, end, year, bookings, places,
    lo: start ? addDays(start, -150) : addDays(now, -400), hi: end ? addDays(end, 150) : addDays(now, 400), cats: c.money?.categories || ['Food', 'Taxi', 'Ferry & transit', 'Tickets', 'Shisha', 'Shopping', 'SIM & data', 'Other'],
    trips: new Map(dayList.map(d => [d.date, (d.trips || []).map(t => ({ t, to: namer(t.to || ''), from: namer(t.from || '') }))])) };
  CACHE.set(c, X);
  return X;
}

/* ---------- day / trip mapping (spec rules) ---------- */
function mapDay(X, iso, time, kind) {
  if (!iso) return null;
  if ((kind === 'flight' || kind === 'transfer') && time && time < '06:00' && X.daySet.has(addDays(iso, -1))) return addDays(iso, -1);
  if (X.daySet.has(iso)) return iso;
  if (iso >= X.start && iso <= X.end) { let best = null; for (const d of X.dayIsos) if (d <= iso) best = d; return best; }
  return null;
}
function pickTrip(X, dayIso, kind, M, opts) {
  const list = X.trips.get(dayIso) || []; if (!list.length) return null;
  const score = (r) => (hit(r.to, M) ? 2 : 0) + (hit(r.from, M) ? 1 : 0);
  const best = (rs, min) => { let b = null, s = min - 1; for (const r of rs) { const v = score(r); if (v > s) { s = v; b = r; } } return b?.t.n ?? null; };
  const mins = (t, next) => { const x = /^(\d{1,2}):(\d{2})/.exec(t || ''); return x ? +x[1] * 60 + +x[2] + (next ? 1440 : 0) : null; };
  const nearest = (rs) => {                                                          // no words to go on: the planned time closest to the document's
    const at = mins(opts.time, !!opts.date && opts.date > dayIso); if (at == null) return null;
    let b = null, d = 151; for (const r of rs) { const v = mins(r.t.time, r.t.nextDay); if (v != null && Math.abs(v - at) < d) { d = Math.abs(v - at); b = r; } } return b?.t.n ?? null;
  };
  if (kind === 'flight') { const fl = list.filter(r => r.t.mode === 'flight'); return fl.length === 1 ? fl[0].t.n : best(fl, 1) ?? nearest(fl); }
  if (kind === 'transfer') { const sh = list.filter(r => r.t.mode === 'shuttle'); return sh.length === 1 ? sh[0].t.n : best(sh, 1) ?? nearest(sh); }
  if (kind === 'transport') {
    const pt = list.filter(r => /ferry|tram|metro|train|bus|funicular/.test(r.t.mode));
    return best(pt, 2) ?? (pt.length === 1 && opts.ferryWord ? pt[0].t.n : null);
  }
  if (kind === 'receipt') return opts.category === 'Taxi' ? best(list.filter(r => /taxi/.test(r.t.mode)), 3) : null;
  if (['museum', 'tour', 'event', 'restaurant'].includes(kind)) return best(list, 2);
  return null;
}

/* ---------- the classifier ---------- */
export function classifyText(text, content, { filename = '', today = null, done = null } = {}) {
  const X = index(content || {});
  const todayIso = today instanceof Date ? localIso(today) : today || localIso();
  const raw = String(text || '').normalize('NFC');
  const T = raw.trim().length >= 12 && !garbled(raw) ? raw.slice(0, 40000) : '';
  const f = fold(T);
  const stem = String(filename || '').replace(/^.*[\\/]/, '').replace(/\.[a-z0-9]{2,5}$/i, '');
  const wl = words(f), cnt = counter(wl), fcnt = counter(words(fold(stem)));
  const sights = SIGHTS.filter(s => cnt(s.terms, 1));
  const M = { fw: ` ${wl.concat(...sights.map(s => words(fold(s.name)))).join(' ')} ` };
  M.wset = new Set(words(M.fw));

  /* sensitive values (passport / ID numbers, birth dates) never leave this function */
  const secrets = new Set(); let m;
  for (RE_SENSITIVE.lastIndex = 0; (m = next(RE_SENSITIVE, f));) {
    const seg = T.slice(m.index + m[0].length, m.index + m[0].length + 48).split('\n')[0];
    for (const v of seg.match(/[A-Za-z0-9][A-Za-z0-9./-]{3,}/g) || []) if (/\d/.test(v)) secrets.add(v.replace(/[.\-/]+$/, ''));
  }
  const mrz = RE_MRZ.test(T);
  if (mrz) for (const l of T.split('\n')) if (/[A-Z0-9<]{20,}/.test(l) && l.includes('<')) for (const v of l.split(/<+/)) if (v.length >= 5) secrets.add(v);

  /* flight numbers; a boarding pass says so in a short header line or has gate / boarding-time fields */
  const flightNos = []; each(RE_FLIGHT, T, (x) => { if (!/(airbus|boeing)\s?$/i.test(T.slice(Math.max(0, x.index - 7), x.index))) flightNos.push(x[1] + x[2]); }, B_ALNUM);   // not "Airbus A321"
  const flights = uniq(flightNos), knownFl = flights.filter(n => X.bookings.some(x => x.flights.includes(n)));
  const isBP = /(^|\n)[^\n]{0,40}(boarding pass|binis karti)[^\n]{0,40}(\n|$)/.test(f) || cnt(P('boarding time|gate closes|boarding group|seq|sequence|you are checked in|check in confirmation'), 1) > 0;

  /* kind */
  const sc = {};
  for (const k in SIG) sc[k] = SIG[k].reduce((s, [terms, w, cap]) => s + w * cnt(terms, cap), 0);
  sc.flight += Math.min(2, knownFl.length) * 4 + (flights.length > knownFl.length ? 2 : 0);
  sc.museum += Math.min(2, sights.length + X.places.filter(p => p.sight && hit(p, M)).length) * 3;
  const venueHits = X.places.filter(p => p.venue && hit(p, M));
  if (venueHits.some(p => /meal|breakfast|coffee|shisha/.test(p.venue.kind || ''))) sc.restaurant += 3;
  if (mrz) sc.id += 10;
  const resv = cnt(P('reservation|rezervasyon|rezervasyonu|reserved|table for|party size|booking confirmed'), 1) > 0;
  if (resv) sc.receipt -= 3;                                                         // a booking that mentions a total is still a booking
  else if (cnt(P('toplam|topkdv|kdv|fis|receipt|invoice|fatura|subtotal|total paid|amount due'), 1)) sc.restaurant -= 3;   // a paid bill is a receipt
  for (const [k, terms, w] of FILE_SIG) if (fcnt(terms, 1)) sc[k] += T ? w / 2 : w;
  let kind = 'other', top = 0, second = 0;
  for (const k in sc) { if (sc[k] > top) { second = top; top = sc[k]; kind = k; } else if (sc[k] > second) second = sc[k]; }
  if (top < 2.5) kind = 'other';

  /* dates */
  const dates = T ? findDates(f, X.year, X.lo, X.hi) : [];
  for (const d of dates) {
    const lb = before(f, d.i); d.neg = count(RE_NEG, lb, 1) > 0; d.pos = !d.neg && count(RE_POS, lb, 1) > 0;
    d.inTrip = d.iso >= X.start && d.iso <= X.end; d.lb = lb;
  }
  const tripDates = uniq(dates.filter(d => d.inTrip).map(d => d.iso));
  const itinerary = tripDates.length >= 8 || (tripDates.length >= 4 && count(RE_ITIN, f, 1) > 0);
  if (itinerary && kind !== 'insurance' && kind !== 'id') kind = 'other';
  const freq = (iso) => dates.filter(d => d.iso === iso).length;
  const rank = (d) => (d.inTrip ? 10 : 0) + (d.pos ? 3 : 0) + (d.neg ? -8 : 0) + Math.min(3, freq(d.iso) - 1) + 2 * (1 - d.i / (f.length || 1));
  const labelled = (re) => dates.find(d => count(re, d.lb.slice(-40), 1));
  let main = null, date = null, endDate = null;
  const good = dates.filter(d => !d.neg);
  if (kind === 'insurance') {
    date = labelled(W('effective date|start date|policy start date|baslangic tarihi|valid from'))?.iso || null;
    endDate = labelled(W('expire date|expiry date|end date|bitis tarihi|valid until|valid to'))?.iso || null;
  } else if (kind !== 'id' && good.length) {
    main = good.reduce((a, b) => rank(b) > rank(a) ? b : a);
    date = main.iso;
    if (kind === 'hotel') {
      const ci = labelled(W('check-?in|arrival|giris|giris tarihi')), co = labelled(W('check-?out|departure|cikis|cikis tarihi'));
      const td = tripDates.length ? tripDates : uniq(good.map(d => d.iso)).sort();
      date = ci?.iso || td[0]; endDate = co?.iso || (td.length > 1 ? td[td.length - 1] : null);
      main = dates.find(d => d.iso === date) || main;
    } else if (kind === 'transfer' || itinerary) {
      const td = itinerary ? tripDates : tripDates.filter(x => x > date);
      if (itinerary) date = td[0] || date;
      endDate = td.length ? td[td.length - 1] : null;
      if (endDate === date) endDate = null;
    }
  }

  /* bookings: a printed reference, then flight number + date, then hotel / provider name + dates, then the file name */
  let booking = null, how = null;
  if (T && !itinerary) {
    const byRef = X.bookings.filter(x => x.refs.some(r => findRef(r, T)));
    booking = byRef.find(x => x.b.kind === kind) || (kind === 'other' ? byRef[0] : null) || null; if (booking) how = 'ref';
    if (booking && kind === 'other' && booking.b.kind in KINDS) kind = booking.b.kind;          // unclear wording, but it carries a known booking number
    if (!booking && kind === 'flight' && knownFl.length) {
      booking = X.bookings.find(x => x.flights.some(n => knownFl.includes(n)) && (!date || x.dates.includes(date))) || null; if (booking) how = 'flight';
    }
    if (!booking && (kind === 'hotel' || kind === 'transfer')) {
      booking = X.bookings.find(x => x.b.kind === kind && (x.names.concat(x.via).some(n => hit(n, M)) || x.keys.some(k => M.wset.has(k))) && (!date || x.dates.includes(date))) || null; if (booking) how = 'name';
    }
  }
  if (!booking && !T && stem) {
    const fn = ` ${words(fold(stem)).join(' ')} `, fw = new Set(words(fn)); let best = 0, tie = false;
    for (const x of X.bookings) {
      let s = x.keys.filter(k => fw.has(k) || fn.includes(k)).length * 3 + x.names.reduce((a, n) => a + n.toks.filter(t => fw.has(t)).length, 0) * 2 + x.aliases.filter(a => fw.has(a)).length;
      if (fn.includes(` ${words(fold(x.b.id)).join(' ')} `)) s += 4;
      if (s && sc[x.b.kind] > 0) s += 2 + (x.b.phase && fw.has(fold(x.b.phase)) ? 1 : 0);
      if (s >= 3 && s === best) tie = true;
      if (s >= 3 && s > best) { best = s; booking = x; how = 'file'; tie = false; }
    }
    if (tie) booking = null;                                                         // two bookings fit the name equally: do not guess
    if (booking && kind === 'other') kind = booking.b.kind in KINDS ? booking.b.kind : 'other';
  }
  if (booking && how !== 'ref' && booking.b.kind !== kind && kind !== 'other') booking = null;
  if (booking && !date && booking.dates.length && kind !== 'insurance') { date = booking.dates[0]; if (kind === 'hotel' || booking.dates.length > 1) endDate = booking.dates[booking.dates.length - 1]; }

  /* time */
  const times = T && kind !== 'id' && kind !== 'insurance' ? findTimes(f) : [];
  let time = null;
  if (times.length) {
    const legs = booking?.b.legs?.filter(l => !flights.length || flights.includes(l.flight.replace(/\s/g, '').toUpperCase())) || [];
    const legT = legs.map(l => (/\d{1,2}:\d{2}/.exec(l.from) || [])[0]).find(t => times.some(x => x.t === t));
    if (legT) time = legT;
    else {
      const at = main ? main.i + main.len : 0;
      const tr = (x) => {
        const lb = before(f, x.i, 40), [a, b] = lineAt(f, x.i);
        let s = 0;
        if (main) { const dd = x.i - at; s += dd >= -2 && dd < 260 ? 4 - dd / 80 : dd < 0 && dd > -80 ? 1 : 0; }
        if (count(RE_TPOS, lb, 1)) s += 3;
        if (count(RE_TNEG, lb, 1) || count(RE_NEG, f.slice(a, b), 1)) s -= 6;
        if (kind === 'flight' && count(RE_DEP, lb, 1)) s += 2;
        if (kind !== 'transfer' && count(RE_ARR, lb, 1)) s -= 2;
        return s;
      };
      const bt = times.reduce((a, b) => tr(b) > tr(a) ? b : a);
      if (tr(bt) > -2) time = bt.t;
    }
  }
  if (!time && booking && how === 'file' && booking.times.length) time = booking.times[0];

  /* day */
  const outOfTrip = kind === 'insurance' || kind === 'id';
  let dayIso = outOfTrip || itinerary ? null : mapDay(X, date, time, kind);
  if (!dayIso && !date && !outOfTrip && !itinerary && (!T || kind === 'receipt') && todayIso >= X.start && todayIso <= X.end) dayIso = mapDay(X, todayIso, null, 'other');

  /* money: the labelled total, else the largest amount with a currency */
  const money = T ? findMoney(T) : [];
  const docCur = (() => { const n = {}; money.forEach(x => x.cur && (n[x.cur] = (n[x.cur] || 0) + 1)); return Object.keys(n).sort((a, b) => n[b] - n[a])[0] || (cnt(P('toplam|kdv|tutar'), 1) ? 'TRY' : null); })();
  let total = null, bestS = -1;
  for (RE_TOT.lastIndex = 0; (m = next(RE_TOT, f));) {
    const i = m.index, [ls, le] = lineAt(f, i), nx = f.indexOf('\n', le + 1), stop = nx < 0 ? f.length : nx;
    if (count(RE_NOT, f.slice(Math.max(ls, i - 14), i + m[0].length), 1)) continue;
    const onLine = money.some(y => y.i > i && y.i <= le), cand = money.filter(x => x.i > i && x.i <= (onLine ? le : stop));
    if (!cand.length) continue;
    const pick = cand[cand.length - 1], s = (/genel|grand|amount due|paid|toplam tutar/.test(m[0]) ? 3 : /total|toplam/.test(m[0]) ? 2 : 1) + (pick.cur ? 1 : 0);
    if (s > bestS || (s === bestS && pick.value > total.value)) { bestS = s; total = pick; }
  }
  if (!total) { const withCur = money.filter(x => x.cur); if (withCur.length) total = withCur.reduce((a, b) => b.value > a.value ? b : a); }
  const price = total ? total.raw : null, cur = total ? total.cur || docCur : null;

  /* spending category */
  const kw = CATS.find(([, terms]) => cnt(terms, 1))?.[0];
  const cat = kind === 'museum' || kind === 'event' || kind === 'tour' ? 'Tickets' : kind === 'transport' ? 'Ferry & transit' : kind === 'restaurant' ? 'Food'
    : kw === 'Taxi' ? kw : venueHits.some(p => p.venue.kind === 'shisha') ? 'Shisha' : kw || (venueHits.length ? 'Food' : 'Other');
  const category = X.cats.includes(cat) ? cat : X.cats.includes('Other') ? 'Other' : X.cats[X.cats.length - 1];

  /* trip of the day */
  const tripN = !dayIso ? null : T ? pickTrip(X, dayIso, kind, M, { category, time, date, ferryWord: cnt(P('ferry|vapur|sehir hatlari|turyol|dentur'), 1) > 0 })
    : kind === 'flight' || kind === 'transfer' ? pickTrip(X, dayIso, kind, M, { time, date }) : null;
  const trip = tripN != null ? X.dayBy.get(dayIso)?.trips.find(t => t.n === tripN) : null;

  /* reference: the matched booking's number as printed, else the value after the strongest label */
  let ref = null;
  if (T && kind !== 'id') {
    if (booking && how === 'ref') for (const r of booking.refs) { const v = findRef(r, T); if (v) { ref = v; break; } }
    let bestW = ref ? 99 : 0;
    for (const [re, w] of RE_REF_LABEL) {
      if (w <= bestW || (kind !== 'insurance' && w === 12)) continue;
      for (re.lastIndex = 0; (m = next(re, f));) {
        const lb = before(f, m.index, 24);
        if (count(RE_SENSITIVE, lb, 1) || /payment|transaction|customer|merchant|terminal|tax|vat|invoice/.test(lb)) continue;
        const v = refAfter(T, m.index + m[0].length, /pnr|code|reference|rezervasyon/.test(m[0]));
        if (v && !secrets.has(v)) { ref = v; bestW = w; break; }
      }
    }
  }
  if (!ref && booking && how !== 'file' && booking.b.confirmation && kind !== 'insurance') ref = booking.b.confirmation;

  /* people (number and word on the same line) */
  const pm = next(/(\d{1,2})[ \t]*(?:\(|x[ \t]*)?[ \t]*(?:passengers?|adults?|people|persons?|guests?|pax|kisi|yetiskin|tickets?|tam|travellers?|travelers?)(?![\p{L}])/gu, f, /[\d.,:]$/)
    || /(?:passengers?|adults?|guests?|persons?|party size|kisi sayisi|pax|people|number of guests|visitors?)[ \t]*[:x×]?[ \t]*(\d{1,2})(?![\d.,:])/u.exec(f);
  const people = pm && +pm[1] > 0 && +pm[1] <= 20 ? +pm[1] : null;

  /* place */
  let place = null;
  if (sights.length && ['museum', 'tour', 'event'].includes(kind)) place = sights[0].name;          // the palace, not the gate the taxi drops you at
  else if (trip) place = ['flight', 'transfer', 'transport'].includes(kind) || (kind === 'receipt' && category === 'Taxi') ? trip.from : trip.to;
  else if (kind === 'hotel' && booking) place = booking.b.title;
  else if (!['insurance', 'id', 'other', 'flight'].includes(kind) && T) {
    const ps = X.places.filter(p => !p.trip && hit(p, M)).concat(X.places.filter(p => p.trip && hit(p, M)));
    place = ps[0] ? ps[0].label || ps[0].name : sights[0]?.name || null;
    if (!place) { const pp = /(?:^|[\s(])([A-ZÇĞİÖŞÜ][\p{L}’'-]+(?: [A-ZÇĞİÖŞÜ][\p{L}’'-]+)?) (?:[Pp]ier|İskelesi|iskelesi)/u.exec(T); if (pp) place = `${pp[1]} pier`; }
  }

  /* the open to-do this document completes */
  const doneSet = new Set(done || []);
  let todoId = null;
  if (T && !itinerary) {
    let bestT = 0;
    const named = X.places.filter(p => (p.venue || p.sight) && hit(p, M)).map(p => p.label || p.name).concat(sights.map(s => s.name));
    for (const td of content?.todos || []) {
      if (td.done || doneSet.has(td.id)) continue;
      const tt = fold(td.title || ''), tw = new Set(words(tt)); let s = 0;
      const tdDate = findDates(tt, X.year, X.lo, X.hi)[0]?.iso;
      if (tdDate && date && tdDate !== date && td.kind !== 'check') continue;
      if (td.kind === 'check' && kind === 'flight' && isBP && flights.some(n => tw.has(n.toLowerCase()))) s = 10;
      else if (td.kind === 'book' && ['restaurant', 'museum', 'event', 'tour', 'transport'].includes(kind)) {
        const tp = ` ${words(tt).join(' ')} `;
        if (named.some(n => { const k = tokens(n); return tp.includes(namer(n).phrase) || (k.length && (k.every(t => tw.has(t)) || (k[0].length >= 4 && tw.has(k[0])))); })) s = 8;
      } else if (td.kind === 'check' && kind === 'transport') {
        const tts = findTimes(tt).map(x => x.t), tk = tokens(td.title).filter(t => !/^\d/.test(t) && !STOP.has(t));
        if (tts.length && time && tts.includes(time) && tk.some(t => M.wset.has(t)) && (!tdDate || tdDate === date)) s = 7;
      } else if (td.kind === 'trip' && kind === 'receipt') {
        if (tokens(td.title).filter(t => !STOP.has(t) && !/^\d+$/.test(t) && M.wset.has(t)).length >= 2) s = 6;
      }
      if (s && td.due && date) s -= Math.min(1, Math.abs(days(td.due, date)) / 30);   // same words: the to-do due nearest the document wins
      if (s > bestT) { bestT = s; todoId = td.id; }
    }
  }

  /* expense: money spent on the trip (not the prepaid bookings) */
  let expense = null;
  if (total && ['receipt', 'museum', 'event', 'tour', 'transport', 'restaurant'].includes(kind) && !booking && ['TRY', 'AED', 'EUR', 'USD'].includes(cur)) {
    const when = kind === 'receipt' ? date : null;
    if (!when || !X.start || (when >= addDays(X.start, -1) && when <= X.end)) expense = { amount: total.value, currency: cur, category };
  }

  /* id-document type, insurer, insured person */
  const idType = kind !== 'id' ? null : cnt(P('emirates id|resident identity'), 1) ? 'Emirates ID' : !mrz && cnt(P('evisa|e visa|electronic visa|elektronik vize|visa'), 1) ? 'e-Visa'
    : cnt(P('residence permit|ikamet'), 1) ? 'Residence permit' : cnt(P('identity card|id card|kimlik'), 1) ? 'ID card' : 'Passport';
  const pol = kind === 'insurance' ? (content?.insurance?.policies || []).find(p => (booking && p.bookingId === booking.b.id) || ((r) => r && findRef(r, T))(refRe(p.policyNo))) : null;

  /* title */
  const route = (() => { const cs = uniq((T.match(/\b[A-Z]{3}\b/g) || []).filter(x => IATA[x])); return cs.length >= 2 ? `${IATA[cs[0]]} → ${IATA[cs[1]]}` : null; })();
  const headline = (re) => T.split('\n').map(l => l.trim()).find(l => l.length >= 4 && l.length <= 70 && re.test(fold(l)) && !/\d{5,}/.test(l));
  const merchant = (() => {
    const l = T.split('\n').map(x => x.trim()).find(x => /\p{L}{3}/u.test(x) && x.length <= 48 && !/\b(receipt|fis|fatura|invoice|tarih|date|saat|tel|www|arsiv|thank)\b/.test(fold(x)));
    if (!l) return null;
    const tr = /[İŞĞıışğ]/.test(l), low = tr ? l.toLocaleLowerCase('tr') : l.toLowerCase();
    return l === l.toUpperCase() ? low.replace(/(^|[\s(/-])(\p{L})/gu, (a, b, c) => b + (tr ? c.toLocaleUpperCase('tr') : c.toUpperCase())) : l;
  })();
  const short = (s) => String(s || '').replace(/\s+(pier|İskelesi|iskelesi)$/i, '');
  const fl = flights.join(' + ');
  let title;
  switch (kind) {
    case 'flight': title = `${isBP ? 'Boarding pass' : 'Flight'}${fl ? ' ' + fl : ''}${booking?.b.title || route ? ' · ' + (booking?.b.title || route) : ''}`; break;
    case 'hotel': title = `Hotel booking${booking ? ' · ' + booking.b.title : ''}`; break;
    case 'transfer': title = booking?.b.title || (trip ? `Transfer · ${trip.from} → ${trip.to}` : 'Airport transfer'); break;
    case 'museum': title = `${place || headline(/museum|muze|palace|sarayi|tower|kulesi|cistern/) || 'Museum'} ticket`; break;
    case 'tour': title = headline(/cruise|tour|turu|excursion/) || `${place ? place + ' ' : ''}tour`; break;
    case 'event': title = headline(/concert|konser|show|ceremony|seremoni|festival|match|theatre|theater|opera/) || 'Event ticket'; break;
    case 'restaurant': title = `${place || merchant || 'Restaurant'} reservation`; break;
    case 'transport': title = trip ? `${trip.modeText || 'Ferry'} ticket · ${short(trip.from)} → ${short(trip.to)}` : `${/ferry|vapur|iskele|pier/.test(f) ? 'Ferry' : /train|tren|tcdd/.test(f) ? 'Train' : /bus|otobus/.test(f) ? 'Bus' : 'Transport'} ticket`; break;
    case 'receipt': title = category === 'Taxi' ? 'Taxi receipt' : merchant ? `Receipt · ${merchant}` : 'Receipt'; break;
    case 'insurance': title = pol?.who ? `Travel insurance · ${pol.who}` : 'Travel insurance certificate'; break;
    case 'id': title = idType; break;
    default: title = itinerary ? 'Trip plan' : (T && T.split('\n').map(l => l.trim()).find(l => /\p{L}{3}/u.test(l) && l.length <= 70)) || stem.replace(/[_-]+/g, ' ').trim() || 'Document';
  }
  if (!T && kind === 'other' && /^(img|pxl|dsc|dcim|photo|image|screenshot|whatsapp image|scan)(?![a-z])/i.test(stem)) title = /^screenshot/i.test(stem) ? 'Screenshot' : 'Photo';
  title = cut(title.replace(/\s+—.*$/, ''), 60);

  /* summary and notes */
  const when = date ? `${dateLabel(date)}${time ? ' ' + time : ''}` : '';
  let summary;
  if (kind === 'id') summary = 'Identity document. It stays encrypted on this phone and is never shown in the chat.';
  else if (kind === 'insurance') {
    const insurer = INSURERS.find(([k]) => cnt([k], 1))?.[1];
    const lim = /annual limit(?![a-z])[\s\S]{0,120}?(\d{1,3}(?:[.,]\d{3})+|\d{4,})\s*(usd|eur|try|tl)\b/i.exec(T);
    summary = [insurer ? `${insurer} travel health insurance` : 'Travel health insurance', date && endDate ? `valid ${dateLabel(date)} → ${dateLabel(endDate)} ${endDate.slice(0, 4)}` : '',
      /valid territory[\s\S]{0,60}t[uü]rk[iİı]ye/i.test(T) ? 'Türkiye only' : '', lim ? `annual limit ${lim[1]} ${lim[2].toUpperCase()}` : ''].filter(Boolean).join(' · ');
  } else {
    const parts = {
      flight: [fl, booking?.b.title || route, when, ref && `PNR ${ref}`], hotel: [booking?.b.title, date && `check-in ${dateLabel(date)}`, endDate && `check-out ${dateLabel(endDate)}`, ref && `ref ${ref}`],
      transfer: [when && `pickup ${when}`, trip && `${trip.from} → ${trip.to}`, people && `${people} passengers`, ref && `ref ${ref}`],
      restaurant: [people ? `Table for ${people}` : 'Table', place, when, ref && `ref ${ref}`], receipt: [merchant, price, when],
      other: [itinerary ? `Plan with ${tripDates.length} trip days` : cut(T.replace(/\s+/g, ' '), 160)],
    }[kind] || [place, when, people && `${people} people`, price, ref && `ref ${ref}`];
    summary = parts.filter(Boolean).join(' · ');
  }
  const notes = [];
  if (kind === 'insurance') {
    for (const [re, label] of [[/call ?cent(?:er|re)[^\n+]{0,20}(\+\d[\d ()]{8,18}\d)/i, 'Call center'], [/whats ?app(?: line)?[^\n+]{0,20}(\+\d[\d ()]{8,18}\d)/i, 'WhatsApp']]) { const x = re.exec(T); if (x) notes.push(`${label} ${x[1]}`); }
    if (/valid territory[\s\S]{0,60}t[uü]rk[iİı]ye/i.test(T)) notes.push('Valid in Türkiye only');
  } else if (kind !== 'id' && T) {
    for (const l of T.split('\n')) {
      const s = l.replace(/^[\s●•▪·*-]+/, '').trim();
      if (s.length >= 12 && s.length <= 110 && count(RE_NOTE, fold(s), 1) && !count(RE_SENSITIVE, fold(s), 1) && !notes.includes(s)) notes.push(s);
      if (notes.length >= 4) break;
    }
  }
  const todos = [];
  if (date && /please print|print (?:this|the|your) (?:voucher|ticket|confirmation)|printed (?:voucher|ticket)/.test(f)) todos.push({ title: 'Print the voucher', due: addDays(date, -1), time: null });
  if (date && /please reconfirm|reconfirm your/.test(f)) todos.push({ title: 'Reconfirm the booking', due: addDays(date, -1), time: null });

  /* confidence */
  const confidence = !T ? 0.2 + (kind !== 'other' ? 0.15 : 0) + (booking ? 0.1 : 0) : itinerary ? 0.3 : kind === 'other' ? Math.min(0.35, 0.15 + top / 20)
    : Math.min(0.95, 0.45 + Math.min(0.25, (top - second) / 20) + (date && dayIso ? 0.1 : 0) + (booking ? 0.1 : 0) + (ref ? 0.05 : 0));

  /* scrub: no passport / ID numbers or birth dates in anything we return */
  const scrub = (s) => { if (typeof s !== 'string') return s; for (const v of secrets) if (v.length >= 5 && s.includes(v)) s = s.split(v).join('•••'); return s; };
  const isId = kind === 'id', bare = isId || itinerary, realId = (id) => id && (content?.bookings || []).some(b => b.id === id) ? id : null;
  return {
    kind, title: scrub(title), summary: scrub(cut(summary, 200)), date: isId ? null : date, endDate: isId ? null : endDate, time: bare ? null : time,
    dayIso, tripN: tripN ?? null, bookingId: realId(booking?.b.id) || realId(pol?.bookingId),
    ref: isId || (ref && secrets.has(ref)) ? null : scrub(ref), place: bare ? null : scrub(place), price: bare || kind === 'insurance' ? null : price, people: bare ? null : people,
    todos: bare ? [] : todos, notes: bare ? [] : notes.map(scrub).filter(s => !s.includes('•••')).slice(0, 4),
    confidence: Math.round(confidence * 100) / 100, isIdDocument: isId, todoId: isId ? null : todoId, expense: isId ? null : expense, source: 'phone',
  };
}

/* ---------- pickers ---------- */
export function dayOptions(content) {
  return (content?.days || []).map(d => ({ iso: d.date, label: `${dateLabel(d.date)} · ${d.title || d.city || ''}`.replace(/ · $/, '') }));
}
export function tripOptions(content, iso) {
  const d = (content?.days || []).find(x => x.date === iso);
  return (d?.trips || []).map(t => ({ n: t.n, label: [t.n, t.time, `${t.modeText || ''} ${t.label || [t.from, t.to].filter(Boolean).join(' → ')}`.trim()].filter(Boolean).join(' · ') }));
}
