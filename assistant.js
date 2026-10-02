/* Trip assistant. Works offline: it understands the question, finds the answer in the trip data
   and returns blocks that render in the chat AND export to PDF.
   Nothing trip-specific lives in this file: names, flights, hotels and special topics come from the encrypted content. */

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS = [
  ['sunday', 'sun', 'الاحد'], ['monday', 'mon', 'الاثنين'], ['tuesday', 'tue', 'tues', 'الثلاثاء'], ['wednesday', 'wed', 'الاربعاء'],
  ['thursday', 'thu', 'thur', 'thurs', 'الخميس'], ['friday', 'fri', 'الجمعه'], ['saturday', 'sat', 'السبت'],
];
const MONTHS = [
  ['january', 'jan', 'يناير'], ['february', 'feb', 'فبراير'], ['march', 'mar', 'مارس'], ['april', 'apr', 'ابريل'], ['may', 'مايو'], ['june', 'jun', 'يونيو'],
  ['july', 'jul', 'يوليو'], ['august', 'aug', 'اغسطس'], ['september', 'sep', 'sept', 'سبتمبر'], ['october', 'oct', 'اكتوبر'], ['november', 'nov', 'نوفمبر'], ['december', 'dec', 'ديسمبر'],
];

export function norm(s) {
  return String(s || '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .replace(/İ/g, 'i').replace(/ı/g, 'i').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[’'`]/g, '').replace(/[^\p{L}\p{N}:\s/.-]/gu, ' ').replace(/\s+/g, ' ').trim()
    .replace(/(^|\s)(?:وال|بال|فال|لل)(?=[ء-ي]{3,})/g, '$1')   // "with/and/for the": بالفندق = فندق
    .replace(/(^|\s)ال(?=[ء-ي]{2,})/g, '$1');   // Arabic "al-": الطوارئ = طوارئ
}
const pad2 = (n) => String(n).padStart(2, '0');
const isoAdd = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); const dt = new Date(y, m - 1, d + n); return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`; };
const dowOf = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).getDay(); };
export const dateLabel = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${DOW[new Date(y, m - 1, d).getDay()]} ${d} ${MON[m - 1]}`; };
const monTag = (iso) => `${iso.slice(8)}-${MON[+iso.slice(5, 7) - 1]}`;
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const has = (q, words) => words.length > 0 && new RegExp(`(^|\\s)(${words.map(w => reEsc(norm(w))).filter(Boolean).join('|')})(?=\\s|$)`).test(q);
const fmt = (n) => Math.round(n).toLocaleString('en');
const KIND = { meal: 'Main meal', coffee: 'Coffee', shisha: 'Shisha', breakfast: 'Breakfast' };
const cfg = (ctx) => ctx.content.config || {};

/* ───────────── intents ───────────── */
const INTENTS = {
  greet:    ['hi', 'hello', 'hey', 'salam', 'marhaba', 'merhaba', 'good morning', 'help', 'what can you do', 'how does this work', 'مرحبا', 'السلام عليكم', 'ساعدني'],
  next:     ['next', 'what now', 'whats next', 'right now', 'next step', 'where now', 'where to now', 'التالي', 'الحين', 'دلوقتي', 'الان', 'ماذا بعد', 'وبعدين', 'بعد كده', 'بعدين', 'ba3den', 'baadein', 'shu ba3d'],
  countdown:['days left', 'how many days', 'countdown', 'days to go', 'how long until', 'how long till', 'when do we leave', 'when do we fly', 'كم يوم', 'متي نسافر', 'باقي كم'],
  open:     ['open', 'opened', 'closed', 'opening hours', 'opening', 'hours', 'closes', 'closing', 'closing time', 'what time does', 'مفتوح', 'مقفول', 'يفتح', 'يقفل', 'يسكر', 'دوام'],
  day:      ['plan', 'plans', 'schedule', 'itinerary', 'program', 'programme', 'day', 'agenda', 'what are we doing', 'what do we do', 'route', 'map', 'maps', 'خطه', 'برنامج', 'جدول', 'يوم', 'khotta', 'khetta', 'barnamej'],
  all:      ['whole trip', 'full plan', 'all days', 'entire trip', 'full itinerary', 'complete plan', 'whole plan', 'whole itinerary', 'every day', 'all the days', 'كل الايام', 'الرحله كامله', 'الخطه كامله'],
  flight:   ['flight', 'flights', 'plane', 'fly', 'flying', 'boarding', 'boarding pass', 'e-ticket', 'airline', 'pnr', 'seat', 'seats', 'baggage', 'luggage allowance', 'check-in online', 'online check-in',
             'check in online', 'online check in', 'checkin online', 'online checkin', 'web check in', 'طيران', 'تذكره الطيران', 'طياره', 'رحله الطيران',
             'رحلتنا', 'طيارتنا', 'رحله عوده', 'رحله رجوع', 'عوده', 'رجوع', 'موعد الطياره'],
  hotel:    ['hotel', 'hotels', 'room', 'check in', 'checkin', 'check-in', 'check out', 'checkout', 'booking', 'reservation number', 'confirmation', 'pin', 'resort', 'deposit', 'staying', 'where do we stay', 'where are we staying', 'where do we sleep', 'فندق', 'الفندق', 'حجز', 'غرفه'],
  shuttle:  ['shuttle', 'pickup', 'pick up', 'pick-up', 'transfer', 'airport transfer', 'airport ride', 'from the airport', 'from airport', 'to the airport', 'to airport',
             'airport to hotel', 'airport to the hotel', 'hotel to airport', 'hotel to the airport', 'get to the hotel', 'to the hotel from', 'توصيل', 'الباص'],
  driver:   ['address', 'driver', 'show the driver', 'taxi card', 'take us', 'take me', 'write the address', 'عنوان', 'العنوان', 'السواق', 'السائق'],
  food:     ['eat', 'food', 'restaurant', 'restaurants', 'lunch', 'dinner', 'breakfast', 'meal', 'meals', 'dining', 'coffee', 'cafe', 'cafes', 'shisha', 'hookah', 'nargile', 'argileh', 'dessert', 'menu', 'hungry', 'grab a bite', 'bite to eat', 'snack', 'snacks', 'مطعم', 'مطاعم', 'اكل', 'ناكل', 'ناكل فين', 'نتغدي', 'نتعشي', 'غداء', 'عشاء', 'فطار', 'فطور', 'قهوه', 'شيشه', 'كافيه', 'كوفي'],
  money:    ['budget', 'cost', 'costs', 'money', 'price', 'prices', 'total', 'expensive', 'cheap', '10k', '10000', 'under 10', 'afford', 'exchange', 'exchange rate', 'currency', 'ميزانيه', 'فلوس', 'تكلفه', 'مصاريف', 'سعر'],
  spent:    ['spent', 'spend', 'spending', 'expenses', 'expense', 'logged', 'so far', 'did we spend', 'صرفنا', 'المصروف', 'صرف', 'sarafna', 'kam sarafna', 'saraftu', 'sarfna', 'masareef', 'masaref', 'masarif'],
  transport:['ferry', 'ferries', 'boat', 'boats', 'vapur', 'pier', 'taxi', 'taxis', 'tram', 'metro', 'bus', 'istanbulkart', 'transport', 'get to', 'how do we get', 'bitaksi', 'uber', 'meter', 'عباره', 'مركب', 'فيري', 'تاكسي', 'مواصلات', 'ترام'],
  phrases:  ['phrase', 'phrases', 'turkish', 'speak', 'words', 'translate', 'how do i say', 'how to say', 'language', 'كلمات', 'جمل', 'تركي', 'ترجم', 'اقول'],
  emergency:['emergency', 'police', 'hospital', 'ambulance', 'doctor', 'lost', 'stolen', 'help me', '112', 'pharmacy', 'embassy', 'consulate', 'طوارئ', 'شرطه', 'اسعاف', 'مستشفي', 'دكتور', 'صيدليه'],
  todo:     ['todo', 'to do', 'to-do', 'checklist', 'remind', 'reminder', 'reminders', 'book', 'reserve', 'reservations', 'what should i book', 'what should we book', 'pending', 'tasks', 'deadline', 'deadlines', 'cancel', 'visa', 'visas', 'still need', 'need to do',
             'forget', 'forgot', 'forgotten', 'did we forget', 'مهام', 'تذكير', 'المطلوب', 'فيزا', 'تاشيره', 'نسينا', 'ننسي'],
  tips:     ['tip', 'tips', 'rule', 'rules', 'mosque', 'mosques', 'dress', 'wear', 'headscarf', 'fish', 'kilo', 'service charge', 'bill', 'scam', 'scams', 'weather', 'sunset', 'sunsets', 'time zone', 'timezone', 'time difference', 'cold', 'rain', 'نصائح', 'جامع', 'مسجد', 'طقس', 'غروب'],
  sim:      ['sim', 'esim', 'e-sim', 'data', 'internet', 'roaming', 'turkcell', 'vodafone', 'wifi', 'شريحه', 'انترنت', 'باقه'],
  docs:     ['document', 'documents', 'docs', 'file', 'files', 'word', 'docx', 'voucher', 'vouchers', 'وثيقه', 'ملف', 'ملفات', 'مستندات'],
  mydocs:   ['my documents', 'my docs', 'my files', 'my uploads', 'my tickets', 'our tickets', 'what did i upload', 'what did we upload', 'what i uploaded', 'uploaded', 'i uploaded', 'we uploaded',
             'i added', 'we added', 'added documents', 'my receipts', 'مستنداتي', 'ملفاتي', 'تذاكري', 'تذاكرنا', 'رفعت', 'رفعناه', 'رفعته'],
  pay:      ['pay with card', 'pay by card', 'pay with a card', 'pay with credit card', 'card payment', 'credit card', 'debit card', 'cash or card', 'card or cash', 'accept card', 'accept cards',
             'take card', 'take cards', 'contactless', 'apple pay', 'pay cash', 'pay in cash', 'cash only', 'بالبطاقه', 'بالفيزا', 'كاش', 'نقدا', 'الدفع بالبطاقه'],
  tz:       ['time zone', 'timezone', 'time difference', 'time diff', 'utc', 'gmt', 'local time', 'what time is it', 'clock', 'clocks', 'فرق التوقيت', 'التوقيت', 'توقيت', 'فرق الساعه', 'كم الساعه'],
};
// on a tie the earlier, more specific topic wins (special topics from the content come first)
const PRIORITY = ['spent', 'countdown', 'mydocs', 'pay', 'tz', 'shuttle', 'driver', 'flight', 'hotel', 'food', 'transport', 'phrases', 'emergency', 'sim', 'tips', 'todo', 'money', 'docs', 'all', 'next', 'open', 'day', 'greet'];
const compileWords = (ws) => ws.map(norm).filter(Boolean).map(w => ({ w, multi: w.includes(' '), re: new RegExp(`(^|\\s)${reEsc(w)}(?=\\s|$)`) }));
const VOCAB = new WeakMap();
function vocabFor(content) {
  if (VOCAB.has(content)) return VOCAB.get(content);
  const extra = (kind) => content.bookings.filter(b => b.kind === kind).flatMap(b => b.keywords || []);
  const words = { ...INTENTS, flight: [...INTENTS.flight, ...extra('flight'), ...(content.config?.flightKeywords || [])], hotel: [...INTENTS.hotel, ...extra('hotel')] };
  for (const tp of content.topics || []) words['topic:' + tp.id] = tp.keywords || [];
  const compiled = Object.fromEntries(Object.entries(words).map(([k, ws]) => [k, compileWords(ws)]));
  const priority = [...(content.topics || []).map(tp => 'topic:' + tp.id), ...PRIORITY];
  const v = { compiled, priority };
  VOCAB.set(content, v);
  return v;
}
function scoreIntents(q, vocab) {
  const s = {};
  for (const [k, ws] of Object.entries(vocab.compiled)) {
    let sc = 0;
    for (const { multi, re } of ws) if (re.test(q)) sc += multi ? 2 : 1;
    if (sc) s[k] = sc;
  }
  return s;
}
function pick(sc, vocab) { let best = null, bs = 0; for (const k of vocab.priority) if ((sc[k] || 0) > bs) { best = k; bs = sc[k]; } return best; }
// how strongly a list of aliases matches the question
const aliasScore = (q, aliases) => (aliases || []).reduce((s, a) => s + (has(q, [a]) ? (norm(a).includes(' ') ? 2 : 1) : 0), 0);
const bestByAlias = (q, items) => { let best = null, bs = 0; for (const it of items) { const sc = aliasScore(q, it.aliases); if (sc > bs) { best = it; bs = sc; } } return best; };

/* ───────────── typo tolerance ───────────── */
// Damerau (optimal string alignment) distance with an early exit
function osa(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let p2 = null, p1 = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(p1[j] + 1, cur[j - 1] + 1, p1[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (p2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, p2[j - 2] + 1);
      cur[j] = v; if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    p2 = p1; p1 = cur;
  }
  return p1[b.length];
}
const EXTRA_WORDS = ['today', 'tonight', 'tomorrow', 'yesterday', 'tonite', 'morning', 'evening', 'afternoon', 'airport', 'hotel', 'ferry', 'dinner', 'lunch', 'breakfast',
  'restaurant', 'shisha', 'flying', 'flight', 'pickup', 'address', 'driver', 'budget', 'expenses', 'emergency', 'phrases', 'sunset', 'weather', 'mosque', 'ticket', 'tickets',
  'insurance', 'insured', 'covered', 'coverage', 'policy', 'certificate', 'toothache', 'poisoning', 'luggage', 'suitcase', 'stolen', 'passport', 'hospital', 'paragliding', 'distance'];
// everyday words that must never be "corrected" into a trip keyword
const COMMON = new Set(('last first next open close closed time times long much many near nearest best good water drink drinking safe price prices fare fares cost costs pay paid card cash bank atm '
  + 'walk walking far side sit seat seats left right booked backup cancel cancelled cancellation early late later still need want help come going gone stay leave leaving arrive arriving '
  + 'take taking bring buy where what when which whose with without inside outside open hours minute minutes hour night day days week cheap free table photo photos view views road street '
  + 'boat boats sea beach pool room money change lira dollar euro dirham phone number call wifi password noise quiet kids food tea coffee mint sugar milk water ice cream sweet dessert '
  + 'there their these those this that then than they them else also again around about above below after before during until since every each other another '
  + 'fever cough sick ankle wrist fell slipped twisted broke broken glass glasses tooth teeth wallet bag bags stole robbed delayed hurt burn bleeding pregnant drunk upload uploaded added '
  + 'delight light right night sight fight bright').split(' '));
const TYPOS = { fery: 'ferry', wher: 'where', wat: 'what', hotal: 'hotel', flyt: 'flight', tmrw: 'tomorrow', tonite: 'tonight', nite: 'night' };
const KNOWN = new WeakMap();
function wordsFor(content) {
  if (KNOWN.has(content)) return KNOWN.get(content);
  const vocab = new Set([...Object.values(INTENTS).flat(), ...WEEKDAYS.flat(), ...MONTHS.flat(), ...EXTRA_WORDS].flatMap(w => norm(w).split(' ')).filter(w => /^[a-z]{4,}$/.test(w)));
  const known = new Set(vocab);
  const add = (s) => norm(s).split(' ').forEach(w => known.add(w));
  for (const d of content.days) [d.title, d.intro, d.city, ...(d.plan || []), ...(d.ideas || []), ...(d.fixed || []), ...(d.trips || []).map(t => t.label)].forEach(add);
  for (const v of content.venues) [v.name, v.area, v.notes || ''].forEach(add);
  for (const f of content.transport.ferries) [f.line, f.from_, f.to].forEach(add);
  for (const p of content.phrases) add(p.en);
  for (const b of content.bookings) [b.title, ...(b.aliases || [])].forEach(add);
  for (const s of content.sights || []) [s.name, ...(s.aliases || [])].forEach(add);
  for (const s of content.insurance?.scenarios || []) (s.keywords || []).forEach(add);
  STOP.forEach(w => known.add(w));
  const r = { vocab: [...vocab], known };
  KNOWN.set(content, r);
  return r;
}
// "plan for tommorow", "fery", "shisah tonite" → the words the assistant knows
function fixTypos(q, content, extra = null) {
  const { vocab, known } = wordsFor(content);
  return q.split(' ').map(w => {
    if (TYPOS[w]) return TYPOS[w];
    if (w.length < 5 || !/^[a-z]+$/.test(w) || known.has(w) || COMMON.has(w) || extra?.has(w)) return w;
    const max = w.length <= 6 ? 1 : 2;
    let best = null, bd = max + 1, ties = 0;
    for (const v of vocab) { const d = osa(w, v, max); if (d < bd) { bd = d; best = v; ties = 0; } else if (d === bd) ties++; }
    return best && bd <= max && ties === 0 ? best : w;
  }).join(' ');
}

/* ───────────── where are we in the day? ───────────── */
const toMin = (s) => { const m = /(\d{1,2}):(\d{2})/.exec(s || ''); return m ? +m[1] * 60 + +m[2] : null; };
export const hm = (m) => { const d = ((Math.round(m) % 1440) + 1440) % 1440; return `${pad2(Math.floor(d / 60))}:${pad2(d % 60)}`; };
export const tripMinutes = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(t?.time || ''); return m ? +m[1] * 60 + +m[2] + (t.nextDay ? 1440 : 0) : null; };
// departure day: the legs of the first flight come before the first planned trip
function pseudoFlights(day, C) {
  const id = C?.config?.firstFlight;
  if (!id || !day?.date || day.date !== C.meta?.tripStart) return [];
  const b = (C.bookings || []).find(x => x.id === id), first = (day.trips || []).map(tripMinutes).find(m => m != null) ?? 1e9;
  return (b?.legs || []).map(l => ({ n: '✈', mode: 'flight', modeText: 'Flight', label: `${l.flight} ${l.from} → ${l.to}`, time: (/\d{1,2}:\d{2}/.exec(l.from || '') || [null])[0],
    dur: l.seats ? `seats ${l.seats}` : '', bookingId: b.id, file: b.file || null, pseudo: true })).filter(t => t.time && toMin(t.time) < first);
}
// Where are we in the day? Untimed trips get an estimated minute between their anchors (a timed trip, 09:30, or sunset + 90 min);
// a trip has started when its real or estimated time is 10 min past, or the user tapped Done on it (doneN).
export function nextStep(day, nowMin, { doneN = 0, content = null } = {}) {
  const trips = [...pseudoFlights(day, content), ...(day?.trips || [])];
  const real = trips.map(tripMinutes), est = real.slice();
  const dayStart = 9 * 60 + 30, dayEnd = (toMin(day?.sunset) ?? 18 * 60 + 30) + 90;
  for (let i = 0; i < trips.length;) {
    if (real[i] != null) { i++; continue; }
    let j = i; while (j < trips.length && real[j] == null) j++;
    const nr = j < trips.length, k = j - i;
    const a = i > 0 ? real[i - 1] : Math.min(dayStart, nr ? real[j] : dayStart);
    const b = Math.max(a, nr ? real[j] : Math.max(dayEnd, a + 60 * k));
    // spread after the previous anchor; the last step of the day lands on the evening anchor
    for (let x = 0; x < k; x++) est[i + x] = Math.round((a + (b - a) * (x + 1) / (k + (nr ? 1 : 0))) / 5) * 5;
    i = j;
  }
  let started = -1;
  trips.forEach((t, i) => { if (est[i] <= nowMin - 10 || (doneN && typeof t.n === 'number' && t.n <= doneN)) started = i; });
  const ti = trips.findIndex((t, i) => i > started && real[i] != null);
  const first = trips[started + 1] || null;
  return { first, pending: trips.slice(started + 1, ti >= 0 ? ti : trips.length), nextTimed: ti >= 0 ? trips[ti] : null, guessed: !!first && real[started + 1] == null,
           timeline: trips.map((t, i) => ({ n: t.n, trip: t, min: est[i], at: hm(est[i]), est: real[i] == null, started: i <= started })) };
}

/* ───────────── to-dos: one state for the app and the chat ───────────── */
const MON_RE = new RegExp(`(?:^|[^\\w])(?:for|on)\\s+(?:(?:${DOW.join('|')})[a-z]*,?\\s+)?(\\d{1,2})\\s+(${MON.join('|')})[a-z]*`, 'i');
// after this local time an open to-do is pointless: the content's `expires`, else a linked flight's departure or "… for 15 Oct (19:15)"
export function todoExpiry(t, content = null) {
  if (t.expires !== undefined) return t.expires || null;
  if (!content) return null;
  const bid = content.config?.todoLinks?.[t.id], b = bid && (content.bookings || []).find(x => x.id === bid);
  const dep = b?.kind === 'flight' && b.dateIso && /\d{1,2}:\d{2}/.exec(b.legs?.[0]?.from || '');
  if (dep) return `${b.dateIso}T${dep[0].padStart(5, '0')}`;
  const s = String(t.title || '').replace(/\((?:opens|from)[^)]*\)/gi, ' ');
  const m = MON_RE.exec(s);
  if (!m) return null;
  const y = (t.due || content.meta?.tripStart || '2000').slice(0, 4), mi = MON.findIndex(x => x.toLowerCase() === m[2].slice(0, 3).toLowerCase());
  const times = [...s.matchAll(/(?:^|[^\d])(\d{1,2}):(\d{2})(?!\d)/g)].map(x => +x[1] * 60 + +x[2]);
  return `${y}-${pad2(mi + 1)}-${pad2(+m[1])}T${times.length ? hm(Math.max(...times)) : '23:59'}`;
}
const nowStamp = (iso, nowMin) => String(iso).length > 10 ? String(iso).slice(0, 16) : `${iso}T${hm(nowMin || 0)}`;
export function isExpired(t, nowIso, nowMin = 0, content = null) { const ex = todoExpiry(t, content); return !!ex && nowStamp(nowIso, nowMin) > ex; }
// 'done' | 'missed' (expired, never overdue) | 'overdue' | 'now' (due passed today, still possible) | 'soon' (later today or within 3 days) | 'later'
export function todoState(t, { today, nowMin = 0, done, content = null } = {}) {
  if (done ?? t.done) return 'done';
  const ex = todoExpiry(t, content);
  if (ex && nowStamp(today, nowMin) > ex) return 'missed';
  if (!t.due) return 'later';
  if (t.due < today) return ex && ex.slice(0, 10) === today ? 'now' : 'overdue';
  if (t.due === today) { const dm = toMin(t.time); return dm != null && dm > nowMin ? 'soon' : 'now'; }
  return t.due <= isoAdd(today, 3) ? 'soon' : 'later';
}
export function todoNote(t, state, { today, content = null } = {}) {
  const ex = todoExpiry(t, content), at = t.time ? ' ' + t.time : '';
  const shut = /check-?in/i.test(t.title || '') ? 'closes' : 'until';   // a check-in closes; a deposit or an eSIM just stops mattering
  return { done: 'done ✓', missed: 'missed: the moment has passed', overdue: `overdue (was due ${t.due ? dateLabel(t.due) : ''}${at})`,
           now: `do it now${ex && ex.slice(0, 10) === today ? ` · ${shut} ${ex.slice(11)}` : ''}`,
           soon: t.due === today ? `today${at}` : `due ${dateLabel(t.due)}${at}`, later: `due ${t.due ? dateLabel(t.due) : 'later'}${at}` }[state] || '';
}
const tState = (t, ctx) => todoState(t, { today: ctx.today, nowMin: ctx.nowMin ?? 0, done: (ctx.todosDone || {})[t.id], content: ctx.content });
const tNote = (t, ctx, st = tState(t, ctx)) => todoNote(t, st, { today: ctx.today, content: ctx.content });

/* ───────────── a direct answer for detailed questions ───────────── */
const GENERIC = new Set('time much long many tell know need want like have from with what when where which should does there here please today tomorrow plan trip ferry ferries taxi hotel'.split(' '));
const SYN = { price: ['fare', 'cost'], prices: ['fare', 'cost'], cost: ['price', 'fare'], fare: ['price', 'cost'], ticket: ['tickets', 'admission'], tickets: ['ticket', 'admission'],
  far: ['walk', 'away'], distance: ['walk', 'away'], terminal: ['terminal'], sit: ['side'], eat: ['meal'], dinner: ['meal'], lunch: ['meal'] };
const PRICEQ = /(^|\s)(price|prices|cost|costs|fare|fares|how much|ticket|tickets|admission|fee|entry|budget|كم|سعر|تكلفه)(\s|$)/;
// a query word matches a word in the text, its plural, or a close synonym
const wordRe = (w) => new RegExp(`(^|[^\\p{L}\\p{N}])(${[w, ...(SYN[w] || [])].flatMap(x => [x, x.endsWith('y') ? x.slice(0, -1) + 'ies' : x + 's']).map(reEsc).join('|')})(?![\\p{L}\\p{N}])`, 'u');
function bestSentence(q, ctx) {
  const words = q.split(' ').filter(w => w.length >= 3 && !STOP.has(w));
  const rare = words.filter(w => !GENERIC.has(w));
  if (words.length < 2 || !rare.length) return null;
  const C = ctx.content, pool = [];
  const push = (text, where) => { if (text) pool.push({ text: String(text), where }); };
  for (const d of C.days) {
    [...(d.plan || []), ...(d.ideas || []), ...(d.fixed || []), d.check].forEach(x => push(x, dateLabel(d.date)));
    (d.trips || []).forEach(t => push(`${t.modeText}: ${t.label}${t.time ? ' · ' + t.time : ''}${t.dur ? ' · ' + t.dur : ''}`, dateLabel(d.date)));
    if (PRICEQ.test(q)) (d.costs || []).forEach(c => push(`${c.label}: ${c.value}`, dateLabel(d.date)));   // cost rows only answer price questions
  }
  for (const f of C.transport.ferries) { push(`${f.line}: ${(f.times || []).join(', ')}${f.note ? ' · ' + f.note : ''}`, 'Ferry'); }
  [...C.transport.taxi, ...C.transport.card].forEach(x => push(x, 'Getting around'));
  for (const s of C.tips.sections) s.items.forEach(x => push(x, s.title));
  for (const b of C.bookings) [...(Array.isArray(b.notes) ? b.notes : [b.notes]), b.cancel, b.checkin && `${b.title} check-in ${b.checkin}`, b.checkout && `${b.title} check-out ${b.checkout}`].forEach(x => push(x, b.title));
  for (const v of C.venues) push(`${v.name} (${dateLabel(v.day)}): ${[v.notes, v.book, v.cost].filter(Boolean).join(' · ')}`, v.name);
  for (const tp of C.topics || []) for (const bl of tp.intro || []) (bl.items || [bl.text]).forEach(x => push(x, tp.title));
  let best = null;
  const res = words.map(w => [w, wordRe(w)]);
  for (const it of pool) {
    const n = norm(it.text);
    const hit = res.filter(([, re]) => re.test(n)).map(([w]) => w);
    const rareHit = hit.filter(w => !GENERIC.has(w)).length;
    if (hit.length < 2 || !rareHit) continue;
    const sc = hit.length + rareHit * 0.5 - it.text.length / 2000;
    if (!best || sc > best.sc) best = { ...it, sc };
  }
  return best;
}

/* ───────────── entities ───────────── */
function findDate(q, ctx) {
  const { days } = ctx.content, today = ctx.today;
  const [ty, tm] = (ctx.content.meta.tripStart || days[0].date).split('-').map(Number);
  const mk = (d, mIdx = tm - 1) => (d >= 1 && d <= 31) ? `${ty}-${pad2(mIdx + 1)}-${pad2(d)}` : null;
  const monthIdx = (word) => MONTHS.findIndex(ms => ms.some(m => norm(m) === word));
  const inTrip = (iso) => iso >= days[0].date && iso <= days[days.length - 1].date;
  if (has(q, ['day after tomorrow', 'بعد بكره', 'بعد غد'])) return isoAdd(today, 2);
  // (اليوم normalises to يوم, which is also "day" in "يوم الأحد": it is checked after the weekdays below)
  if (has(q, ['today', 'todays', 'tonight', 'tonights', 'tonite', 'this evening', 'this morning', 'this afternoon', 'now', 'الليله', 'النهارده', 'حين', 'elyom', 'el yom', 'el youm', 'al yawm', 'ennaharda', 'elnaharda'])) return today;
  if (has(q, ['tomorrow', 'tomorrows', 'tmrw', 'tmr', 'بكره', 'غدا', 'الغد', 'غد', 'bukra', 'bokra', 'bukrah', 'bokrah'])) return isoAdd(today, 1);
  if (has(q, ['yesterday', 'yesterdays', 'امبارح', 'امس'])) return isoAdd(today, -1);
  let m = q.match(/(?:^|\s)(?:day|يوم)\s*(\d{1,2})(?=\s|$)/);
  if (m) { const d = days.find(x => x.n === +m[1]); if (d) return d.date; }
  const MW = '([a-z]{3,9}|[\\u0621-\\u064A]{4,7})';
  m = q.match(new RegExp(`(?:^|\\s)(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:of\\s+)?${MW}(?=\\s|$)`));
  if (m && monthIdx(m[2]) >= 0) return mk(+m[1], monthIdx(m[2]));
  m = q.match(new RegExp(`(?:^|\\s)${MW}\\s*(\\d{1,2})(?:st|nd|rd|th)?(?=\\s|$)`));
  if (m && monthIdx(m[1]) >= 0) return mk(+m[2], monthIdx(m[1]));
  m = q.match(/(?:^|\s)(\d{1,2})[/.-](\d{1,2})(?=\s|$|[/.-])/);
  if (m && +m[2] >= 1 && +m[2] <= 12) return mk(+m[1], +m[2] - 1);
  m = q.match(/(?:^|\s)(\d{1,2})(?:st|nd|rd|th)(?=\s|$)/) || q.match(/(?:^|\s)(?:on|for|of|the|in)\s+(\d{1,2})(?=\s|$)/) || q.match(/^(\d{1,2})$/);
  if (m) { const iso = mk(+m[1]); if (iso) return iso; }
  for (let i = 0; i < 7; i++) {
    if (has(q, WEEKDAYS[i])) {
      for (let k = 0; k < 15; k++) { const iso = isoAdd(today, k); if (dowOf(iso) === i && inTrip(iso)) return iso; }
      const d = days.find(x => dowOf(x.date) === i); if (d) return d.date;
    }
  }
  if (/(^|\s)يوم(\s|$)/.test(q) && !/(^|\s)(كم|باقي)(\s|$)/.test(q)) return today;   // اليوم = today ("كم يوم" is a countdown)
  return null;
}

// plain words never name a venue on their own ("is the koc house open" is not The House Café)
const VENUE_PLAIN = new Set('house sunset kahve coffee lounge grill terrace market bistro hookah garden'.split(' '));
function findVenue(q, ctx) {
  let best = null;
  for (const v of ctx.content.venues) {
    const w0 = v.id.split('-')[0], solo = w0.length >= 5 && !VENUE_PLAIN.has(w0) ? w0 : '';
    const two = norm(v.name).split(' ').slice(0, 2), pre = two.length === 2 && !two.some(w => w.length < 3 || ['the', 'cafe', 'old'].includes(w)) ? two.join(' ') : '';   // "czn burak"
    const names = [v.name, v.name.split('(')[0], v.id.replace(/-/g, ' '), solo, pre].map(norm).filter(Boolean);
    for (const nm of names) {
      const core = nm.replace(/\b(the|cafe|lounge|restaurant|bistro|bosphorus|grand bazaar|old|pier|hookah|kahve)\b/g, ' ').replace(/\s+/g, ' ').trim();
      if ((nm.length > 3 && q.includes(nm)) || (core.length >= 3 && new RegExp(`(^|\\s)${reEsc(core)}(?=\\s|$)`).test(q))) {   // "call zin"
        if (!best || nm.length > best.sc) best = { v, sc: nm.length };
      }
    }
  }
  return best && best.v;
}

const STOP = new Set('what when where which with from that this have will about there their your they them then than give show tell want need please could would should does into over plan days trip time take make send file with pdf the for and our are you can get how much day near around best good some visit going today tomorrow tonight morning evening'.split(' '));
const FOODW = new Set('eat food restaurant restaurants lunch dinner breakfast meal meals dining coffee cafe cafes shisha hookah nargile dessert menu places place options option'.split(' '));
function findPlaceDays(q, ctx) {
  const words = q.split(' ').filter(w => w.length > 3 && !STOP.has(w));
  const hits = [];
  for (const d of ctx.content.days) {
    const hay = norm([d.title, d.intro, ...(d.plan || []), ...(d.trips || []).map(t => t.from + ' ' + t.to + ' ' + t.label)].join(' '));
    const sc = words.filter(w => hay.includes(w)).length;
    if (sc) hits.push({ d, sc });
  }
  return hits.sort((a, b) => b.sc - a.sc);
}

function parseConvert(raw) {
  const s = String(raw).replace(/(\d)[,\s](\d{3})(?!\d)/g, '$1$2');
  const num = '(\\d+(?:\\.\\d+)?)';
  const tests = [
    ['TRY', new RegExp(`(?:₺|\\btl|\\btry)\\s?${num}`, 'i')], ['TRY', new RegExp(`${num}\\s?(?:₺|tl\\b|try\\b|lira|liras|ليره)`, 'i')],
    ['AED', new RegExp(`(?:\\baed|\\bdhs?)\\s?${num}`, 'i')], ['AED', new RegExp(`${num}\\s?(?:aed\\b|dhs?\\b|dirhams?|درهم)`, 'i')],
    ['EUR', new RegExp(`(?:€|\\beur)\\s?${num}`, 'i')], ['EUR', new RegExp(`${num}\\s?(?:€|eur\\b|euros?)`, 'i')],
  ];
  for (const [cur, re] of tests) { const m = s.match(re); if (m) return { amount: +m[1], from: cur }; }
  return null;
}

/* ───────────── block helpers ───────────── */
const H = (text) => ({ t: 'h', text }), P = (text, o = {}) => ({ t: 'p', text, ...o }), L = (items, ordered = false) => ({ t: 'list', items, ordered });
const KV = (rows) => ({ t: 'kv', rows }), CALL = (text, tone = 'gold', label) => ({ t: 'callout', text, tone, label });
const TABLE = (head, rows, extra = {}) => ({ t: 'table', head, rows, ...extra });
// "call carlos", "hotel phone number", "رقم الفندق" (but a booking, PIN or policy number is not a phone number)
const CALLQ = { test: (q) => /(^|\s)(call|phone|ring|telephone|number|whatsapp|contact|اتصل|اتصال|رقم|كلم|تلفون|واتساب|واتس)(\s|$)/.test(q)
  && !/(booking|confirmation|reservation|pin|policy|room|flight|seat|ref|reference|ticket|pnr)\s+number|(^|\s)رقم\s+(حجز|غرفه|تاكيد|رحله|بوليصه|تامين)/.test(q) };
const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'answer';
const venueNote = (v) => [v.book, v.notes, v.phone && `Tel ${v.phone}`, v.whatsapp && `WhatsApp ${v.whatsapp}`].filter(Boolean).join(' · ');
const filePrefix = (ctx) => slug(ctx.content.meta.title || 'trip').replace(/^./, c => c.toUpperCase());

export function dayBlocks(d, ctx, { withMap = true } = {}) {
  const C = ctx.content, out = [];
  out.push(P(`${dateLabel(d.date)} ${d.date.slice(0, 4)} · ${d.place || d.city} · Day ${d.n} of ${C.days.length} · sunset ${d.sunset}`, { muted: true }));
  out.push(P(d.intro));
  if (d.free && d.allowAed && !String(d.intro || '').includes(`AED ${d.allowAed[0]}`)) out.push(P(`A free day: ${d.trips?.length ? 'only the fixed points below are booked' : 'nothing is booked'}. Allow about AED ${d.allowAed[0]}–${d.allowAed[1]} for two.`, { muted: true }));
  const notes = (ctx.userNotes || {})[d.date] || [], docs = userDocs(ctx).filter(u => u.dayIso === d.date);
  if (notes.length || docs.length) {
    out.push(H('Your notes & documents'));
    if (notes.length) out.push(L(notes.map(n => n.text).filter(Boolean)));
    if (docs.length) out.push(L(docs.map(u => `${u.tripN != null ? `Trip ${u.tripN} · ` : ''}${udocLine(u)}`)));
  }
  if (withMap && d.map) out.push({ t: 'image', file: d.map, ratio: 780 / 1080, caption: 'Real locations · each line is one trip, numbered in order.' });
  if (d.trips?.length) { out.push(H('How you move')); out.push({ t: 'trips', trips: d.trips }); }
  if (d.plan?.length) { out.push(H('Day plan')); out.push(L(d.plan, true)); }
  if (d.fixed?.length) { out.push(H('Fixed for the day')); out.push(L(d.fixed, true)); }
  if (d.ideas?.length) { out.push(H('Ready-made ideas')); out.push(L(d.ideas, true)); }
  const all = C.venues.filter(v => v.day === d.date), vs = all.filter(v => v.status !== 'option'), opts = all.filter(v => v.status === 'option');
  if (vs.length) {
    out.push(H('Food & drink'));
    out.push(TABLE(['Place', 'What', 'Cost for two', 'Notes'], vs.map(v => [v.name + (v.area ? `\n${v.area}` : ''), KIND[v.kind] || v.kind, v.cost, venueNote(v)]),
      { columns: { 0: { cellWidth: 46 }, 1: { cellWidth: 22 }, 2: { cellWidth: 34 } } }));
  }
  if (d.costs?.length) {
    out.push(H('Estimated costs for two'));
    out.push(TABLE(null, d.costs.map(c => [c.label, c.value]), { columns: { 1: { halign: 'right', cellWidth: 48 } } }));
    if (d.total) out.push({ t: 'total', label: 'Day total', value: d.total });
  }
  if (d.check) out.push(CALL(`Check before you go: ${d.check}`, /BOOK|DO NOT FORGET/i.test(d.check) ? 'red' : 'gold'));
  if (opts.length) {
    out.push(H('Other dining options for the day'));
    out.push(TABLE(['Place', 'What', 'Area', 'Cost for two', 'Notes'], opts.map(v => [v.name, KIND[v.kind] || v.kind, v.area || '', v.cost || '', venueNote(v)]),
      { size: 8.6, columns: { 0: { cellWidth: 30 }, 1: { cellWidth: 20 }, 3: { cellWidth: 26 } } }));
  }
  return out;
}

function bookingBlocks(b) {
  const rows = [];
  const add = (k, v) => { if (v) rows.push([k, String(v)]); };
  add('Status', { paid: 'Paid', confirmed: 'Confirmed', 'to-cancel': 'CANCEL BEFORE THE DEADLINE', cancelled: 'Cancelled', reference: 'Reference' }[b.status] || b.status);
  add('Dates', b.dates); add('When', b.kind === 'transfer' ? b.subtitle : null); add('Confirmation / PNR', b.confirmation); add('PIN', b.pin); add('Booked via', b.via);
  add('Room', b.room); add('Board', b.board); add('Check-in', b.checkin); add('Check-out', b.checkout); add('Cabin', b.cabin); add('Bags', b.bags);
  add('Tickets', b.tickets); add('Skywards', b.loyalty); add('Guests', b.guests); add('Price', b.price); add('Address', b.address); add('Phone', b.phone);
  const out = [KV(rows)];
  if (Array.isArray(b.legs) && b.legs.length) {
    out.push(H('Flight legs'));
    out.push(TABLE(['Flight', 'From', 'To', 'Seats'], b.legs.map(l => [[l.flight, l.aircraft].filter(Boolean).join('\n'), l.from || '', l.to || '', l.seats || ''])));
  }
  if (b.cancel) out.push(CALL(b.cancel, b.status === 'to-cancel' ? 'red' : b.status === 'cancelled' ? 'ok' : 'gold'));
  if (typeof b.notes === 'string' && b.notes) out.push(P(b.notes));
  if (Array.isArray(b.notes) && b.notes.length) out.push(L(b.notes));
  return out;
}
const venueRows = (vs) => vs.map(v => [v.name + (v.status === 'chosen' ? ' (chosen)' : v.status === 'option' ? ' (option)' : ''), v.day ? dateLabel(v.day) : '', KIND[v.kind] || v.kind, v.area || '', v.cost || '', venueNote(v)]);

/* ───────────── the answer function ───────────── */
export function answer(raw, ctx) {
  const C = ctx.content, vocab = vocabFor(C);
  // the user's own words (notes, document titles) are never "corrected"
  const mine = new Set(norm([...userDocs(ctx).map(u => `${u.title || ''} ${u.place || ''} ${u.summary || ''}`), ...Object.values(ctx.userNotes || {}).flat().map(n => n?.text || '')].join(' ')).split(' '));
  const q = fixTypos(norm(raw), C, mine);
  const low = String(raw).toLowerCase();
  const wantsPdf = has(q, ['pdf', 'download', 'print', 'export', 'save']) || /pdf|بي دي اف|تحميل|(^|\s)حمل(\s|$)|اطبع/.test(low);
  const conv = parseConvert(raw);
  const sc = scoreIntents(q, vocab);
  let date = findDate(q, ctx);
  const qp = arPlaces(q);   // "المسجد الأزرق" → blue mosque
  const venue = findVenue(q, ctx), sight = findSight(qp, ctx), ins = insuranceMatch(q, ctx);
  if (/what (to|can we|could we|should we|shall we|will we) do|(^|\s)ideas?(\s|$)/.test(q)) { sc.day = (sc.day || 0) + 3; delete sc.todo; }
  if (/free day/.test(q) && !date) { const f = C.days.find(d => d.free && d.date >= ctx.today) || C.days.find(d => d.free); if (f) { date = f.date; sc.day = (sc.day || 0) + 3; } }
  if (sc.open && date && !venue) delete sc.day;            // "is X open on sunday": the weekday is not a day-plan request
  let intent = pick(sc, vocab);
  const hotelNamed = C.bookings.some(b => b.kind === 'hotel' && has(q, b.keywords || []));

  if (!q) intent = 'greet';
  if (/^(thanks|thank you|thx|ty|shukran|merci|شكرا|تسلم)( .*)?$/.test(q) && q.split(' ').length <= 5 && !sc.phrases) intent = 'thanks';   // not "thank you in turkish"
  if (conv && (!intent || (sc[intent] || 0) < 2 || intent === 'money')) intent = 'convert';
  if (!intent && /(how much|كم|(^|\s)kam(\s|$))/.test(q)) intent = 'money';   // "how much today" is the day's cost, not the day plan
  if (!intent && date) intent = 'day';
  const plain = sight && !qp.split(' ').some(w => w.length > 2 && !STOP.has(w) && !aliasWords(sight).has(w) && !['is', 'the', 'what', 'about', 'tell', 'info'].includes(w));
  // "is the grand bazaar open on sunday", or just "grand bazaar" (a bare name that is also a special topic, "nour mansion", stays the topic)
  if (sight && (sc.open || (plain && !String(intent).startsWith('topic:')))) intent = 'open';
  if (!intent && venue) intent = 'venue';
  if (venue && ['hotel', 'money', 'todo', 'day', 'greet', 'next', 'docs', 'open', 'tips'].includes(intent) && !hotelNamed && !/hotel/.test(q) && !(sight && intent === 'open')) intent = sc.food ? 'food' : 'venue';
  if (intent === 'all' && (sc.food || sc.money || sc.transport)) intent = sc.food ? 'food' : sc.money ? 'money' : 'transport';
  if (intent === 'transport' && date && (sc.day || 0) > (sc.transport || 0)) intent = 'day';
  if (intent === 'hotel' && TAXIQ.test(q) && !CALLQ.test(q)) intent = 'driver';   // "taxi to hotel": the card for the driver
  if (intent === 'open' && !sight && !venue && date && /^(open|show)\s/.test(q)) intent = 'day';   // "open 17 oct" is the day, not opening hours
  if (/^(show( me)?|open|where is|where are|my|our)?\s*(the\s)?(ticket|tickets|e-ticket|تذكره|تذاكر)$/.test(q)) intent = 'mydocs';
  if (/(^|\s)(left|remaining|remain|rest of|باقي|متبقي|المتبقي|يتبقي|ba2i|baqi)(\s|$)/.test(q) && !sc.countdown && (sc.money || sc.spent || /(money|budget|cash|aed|lira|فلوس|ميزانيه)/.test(q))) intent = 'left';
  if (intent === 'money' && date && !/(budget|whole|total trip|10k|10000|under 10)/.test(q)) intent = 'daycost';
  if (intent === 'tips' && /(sunset|غروب)/.test(q) && (date || ctx.todayInTrip)) { date = date || ctx.todayInTrip; intent = 'sunset'; }
  if (/(^|\s)(lost|lose|losing|stolen|missing|ضاع|ضاعت|ضيعنا|ضيعت|فقدنا)(\s|$)/.test(q) && /(istanbulkart|kart|transport card|travel card|metro card|كرت|بطاقه)/.test(q) && sc.transport) intent = 'transport';
  // a user document named by its title, place or reference
  const udHits = matchUserDocs(q, norm(raw), ctx), udTop = udHits[0]?.sc || 0;
  const udNamed = udTop >= 3 || (udTop >= 2 && (!intent || intent === 'docs' || intent === 'mydocs')) || (udTop >= 1 && !intent && /(ticket|booking|receipt|voucher|document|reservation|تذكره|حجز|ايصال)/.test(q));
  if (udNamed) intent = 'mydocs';
  // two words of one of the user's own day notes: show the note (search lists it with its day)
  const qw = q.split(' ').filter(w => w.length >= 4 && !STOP.has(w));
  if (qw.length >= 2 && Object.values(ctx.userNotes || {}).flat().some(n => qw.filter(w => new RegExp(`(^|\\s)${reEsc(w)}`).test(norm(n?.text || ''))).length >= 2)) intent = 'search';
  // "how far is the ferry from the hotel", "taxi from sariyer to ortakoy"
  const dist = !sc.flight && !sc.countdown && !conv && (DISTQ.test(q) || (TAXIQ.test(q) && /(^|\s)(from|to|من|الي)(\s|$)/.test(q) && !/(card|address|show|driver|write|rules?)/.test(q)))
    ? distanceMatch(q, date, ctx) : null;
  if (dist) intent = 'distance';
  // something happened: is it covered? (life in danger always wins)
  const qForm = /^(is|are|will|does|do|can|could|should|when|what time|how|where)\s/.test(q) && !ins.cue;
  // "baggage lost", "tooth broke": no subject, but the words say something happened
  const incident = /(^|\s)(lost|missing|stolen|broke|broken|cracked|damaged|delayed|didnt arrive|did not arrive|never arrived|ضاع|ضاعت|انسرق|انسرقت|انكسر|انكسرت|تاخر|تاخرت)(\s|$)/.test(q);
  const insRoute = ins.life || ins.words || (C.insurance && ((ins.cover && (ins.best || !intent))
    || (ins.best && !qForm && (ins.best.strong > 0 || ((ins.cue || incident) && !ins.info && ins.best.score + 0.5 > (sc[intent] || 0))))));
  if (insRoute) intent = ins.life && !C.insurance ? 'emergency' : 'insurance';

  const r = route(intent, { q, raw, date, venue, sc, conv, ctx, sight, plain: plain && !sc.open, ins, udHits: udNamed ? udHits : [], dist });
  // long general answers start with the one line that answers a detailed question
  if (['transport', 'tips', 'day', 'flight', 'hotel', 'topic', 'open', 'search'].some(k => (intent || 'search').startsWith(k)) && !r.quick && !r.noQuick) {
    const s = bestSentence(q, ctx);
    if (s && (r.blocks.length > 2 || intent === 'open')) r.quick = `${s.text}${s.where && !s.text.includes(s.where) ? ` (${s.where})` : ''}`;
  }
  if (r.quick) {
    const qb = CALL(r.quick, 'sea', 'Quick answer');
    r.blocks = [qb, ...r.blocks];
    if (r.pdf) r.pdf = { ...r.pdf, blocks: [qb, ...r.pdf.blocks] };
  }
  r.intent = intent || 'search';
  r.autoPdf = wantsPdf && !!r.pdf && !r.noAutoPdf;   // "where is the insurance pdf" means the certificate, not a new sheet
  delete r.noQuick; delete r.noAutoPdf;
  return r;
}

function route(intent, a) {
  const { ctx, q, date, venue } = a; const C = ctx.content;
  const dayOf = (iso) => C.days.find(d => d.date === iso);
  if (intent && intent.startsWith('topic:')) { const tp = (C.topics || []).find(t => 'topic:' + t.id === intent); if (tp) return topicAnswer(tp, ctx); }
  switch (intent) {
    case 'greet': return help(ctx);
    case 'thanks': return { title: 'Any time!', blocks: [P('Enjoy every minute of the trip. Ask me anything, whenever you need it.')], suggestions: ['What’s next?', 'Plan for tomorrow'] };
    case 'convert': return convertAnswer(a.conv, ctx);
    case 'next': return nextUp(ctx);
    case 'countdown': return countdownAnswer(ctx);
    case 'open': return a.sight ? sightAnswer(a.sight, q, date, ctx, a.plain) : (!venue && genericOpen(q) && openListAnswer(q, date, ctx)) || openAnswer(q, a.raw, date, ctx);
    case 'insurance': return insuranceAnswer(a.ins, ctx, q);
    case 'distance': return distanceAnswer(a.dist, q, ctx);
    case 'mydocs': return myDocsAnswer(q, a.udHits, ctx);
    case 'pay': return payAnswer(q, ctx);
    case 'tz': return tzAnswer(ctx);
    case 'left': return leftAnswer(ctx);
    case 'daycost': { const d = dayOf(date); return d ? dayCostAnswer(d, ctx) : budgetAnswer(ctx); }
    case 'sunset': {
      const d = dayOf(date); if (!d) return tipsAnswer(q, ctx);
      const r = tipsAnswer(q, ctx); r.title = `Sunset ${d.date === ctx.today ? 'today' : 'on ' + dateLabel(d.date)}: ${d.sunset}`;
      r.quick = `Sunset on ${dateLabel(d.date)} in ${d.city}: ${d.sunset}.`; return r;
    }
    case 'day': {
      const iso = date || findPlaceDays(q, ctx)[0]?.d.date || ctx.todayInTrip || C.days[0].date;
      const d = dayOf(iso);
      return d ? dayAnswer(d, ctx) : outsideTrip(iso, ctx);
    }
    case 'all': return itineraryAnswer(ctx);
    case 'flight': return flightAnswer(q, ctx);
    case 'hotel': return hotelAnswer(q, date, ctx);
    case 'shuttle': return shuttleAnswer(ctx, q);
    case 'driver': return driverAnswer(q, date, ctx);
    case 'food': return foodAnswer(q, date, venue, ctx);
    case 'venue': return venueAnswer(venue, ctx, q);
    case 'money': return budgetAnswer(ctx);
    case 'spent': return spentAnswer(ctx, date);
    case 'transport': return transportAnswer(q, date, ctx, a.sc);
    case 'phrases': return phrasesAnswer(a.raw, ctx);
    case 'emergency': return emergencyAnswer(ctx, q);
    case 'todo': return todoAnswer(ctx, q);
    case 'tips': return tipsAnswer(q, ctx);
    case 'sim': return simAnswer(ctx);
    case 'docs': return docsAnswer(ctx);
    default: {
      const hits = findPlaceDays(q, ctx);
      if (hits.length && (!hits[1] || hits[0].sc > hits[1].sc)) return dayAnswer(hits[0].d, ctx);
      return searchAnswer(q, a.raw, ctx);
    }
  }
}

/* predefined PDFs for the buttons around the app */
export function pdfSpec(key, ctx) {
  const C = ctx.content; const i = key.indexOf(':'); const k = i < 0 ? key : key.slice(0, i), arg = i < 0 ? null : key.slice(i + 1);
  switch (k) {
    case 'trip': return itineraryAnswer(ctx).pdf;
    case 'day': { const d = C.days.find(x => x.date === arg); return d ? dayAnswer(d, ctx).pdf : null; }
    case 'budget': return budgetAnswer(ctx).pdf;
    case 'spent': return spentAnswer(ctx).pdf || null;
    case 'insurance': return insurancePdf(ctx);
    case 'food': return foodAnswer('all options', arg, null, ctx).pdf;
    case 'transport': return transportAnswer('ferry', null, ctx).pdf;
    case 'phrases': return phrasesAnswer('phrases', ctx).pdf;
    case 'emergency': return emergencyAnswer(ctx).pdf;
    case 'todos': return todoAnswer(ctx).pdf;
    case 'tips': return tipsAnswer('', ctx).pdf;
    case 'driver': return driverAnswer('all', null, ctx, true).pdf;
    case 'topic': { const tp = (C.topics || []).find(t => t.id === arg); return tp ? topicAnswer(tp, ctx).pdf : null; }
    case 'flights': return flightAnswer('', ctx).pdf;
    case 'booking': { const b = C.bookings.find(x => x.id === arg); return b ? { title: b.title, subtitle: b.subtitle || '', blocks: bookingBlocks(b), filename: `${filePrefix(ctx)}-${slug(b.title)}.pdf` } : null; }
    default: return null;
  }
}

/* ───────────── answers ───────────── */
function help(ctx) {
  const h = cfg(ctx).help || {};
  const before = ctx.today < ctx.content.days[0].date;
  const I = ctx.content.insurance;
  const sugg = (h.suggestions || ['What’s next?', 'Plan for today', 'Whole trip as PDF', 'My flights', 'Budget'])
    .map(s => before && s === 'Plan for today' ? 'Plan for day 1' : s).concat(before ? ['What do we still need to do before flying?'] : [], I ? ['What does our insurance cover?'] : []);
  const ex = h.examples || ['“Plan for tomorrow”', '“What’s next?”', '“My flights” · “Hotel PIN”', '“Where do we eat tonight?”', '“Budget” · “2,500 TL in AED”', '“Emergency numbers”', '“Whole trip as PDF”'];
  const [p1, p2] = [...(ctx.content.meta.travellers || []), 'I', 'my wife'];
  const more = [...(I && !ex.some(x => /insur/i.test(x)) ? [`“${p2 === 'my wife' ? 'My wife' : p2} has a fever: are we covered?” · “Insurance numbers”`] : []), ...(!ex.some(x => /my documents/i.test(x)) ? ['“My documents” · “What did I upload?”'] : [])];
  return {
    title: 'Hi! I know your whole trip.',
    blocks: [P('Ask me anything about the trip, in your own words. Every answer can be saved as a PDF. For example:'), L([...ex, ...more]),
      ...(I ? [P(`If something happens, just tell me what happened (“${p1 === 'I' ? 'I' : p1} twisted an ankle”, “our bag did not arrive”, “ابني عنده حرارة”). I will tell you whether your travel insurance covers it, what to do now and whom to call.`)] : []),
      P('Add your own tickets, bookings and receipts in Docs (a PDF, a photo or a screenshot): they are filed on the right day and I can find them here.', { muted: true })],
    suggestions: sugg,
  };
}

function outsideTrip(iso, ctx) {
  const C = ctx.content;
  return { title: `${dateLabel(iso)} is outside the trip`, blocks: [P(`The trip runs from ${dateLabel(C.days[0].date)} to ${dateLabel(C.days[C.days.length - 1].date)}.${cfg(ctx).homeLine ? ' ' + cfg(ctx).homeLine : ''}`)],
           actions: [{ act: 'day', date: C.days[0].date, label: 'Open day 1', icon: 'days' }],
           suggestions: ['Plan for day 1', 'Whole trip as PDF', 'My flights'] };
}

function countdownAnswer(ctx) {
  const C = ctx.content, first = C.days[0].date, last = C.days[C.days.length - 1].date;
  const diff = (a, b) => Math.round((new Date(b + 'T12:00') - new Date(a + 'T12:00')) / 86400000);
  if (ctx.today < first) {
    const n = diff(ctx.today, C.meta.departNight || first);
    return { title: n > 1 ? `${n} days to go` : n === 1 ? 'You fly tomorrow night' : 'You fly tonight',
             blocks: [P(cfg(ctx).departText || `The trip starts on ${dateLabel(first)}.`), P(`${C.days.length} days: ${dateLabel(first)} to ${dateLabel(last)}.`, { muted: true })],
             suggestions: ['What do we still need to do before flying?', 'My flights', 'Plan for day 1'] };
  }
  if (ctx.today <= last) {
    const d = C.days.find(x => x.date === ctx.today); const left = diff(ctx.today, last);
    return { title: `Day ${d.n} of ${C.days.length} · ${left} more day${left === 1 ? '' : 's'} after today`, blocks: [P(cfg(ctx).homeLine || `The last day is ${dateLabel(last)}.`)],
             suggestions: ['What’s next?', 'Plan for tomorrow', 'My flight home'] };
  }
  return { title: 'The trip is over', blocks: [P('Welcome home! Everything is still here.')], suggestions: ['How much have we spent?'] };
}

const WEEKDAY_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], DKEY = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const NOWQ = /(^|\s)(now|right now|currently|at the moment|still open|الحين|حين|الان|دلوقتي|هلا|هلق|هسه|هسا)(\s|$)/;   // the question is normalised: الحين → حين
function openAnswer(q, raw, date, ctx) {
  // no opening-hours data for this place: use what the plan says ("closed Wednesdays", "10:00–17:00")
  const hits = findPlaceDays(q, ctx).slice(0, 3);
  const s = bestSentence(q, ctx);
  const blocks = [];
  let title = hits.length ? `In your plan on ${dateLabel(hits[0].d.date)}` : 'Opening hours';
  if (s) {
    const closed = [...s.text.matchAll(/closed (?:on )?(mon|tues|wednes|thurs|fri|satur|sun)days?/gi)].map(m => WEEKDAY_EN.findIndex(w => w.toLowerCase().startsWith(m[1].toLowerCase())));
    const iso = date || ctx.todayInTrip || hits[0]?.d.date;
    if (closed.length && iso) {
      const shut = closed.includes(dowOf(iso));
      title = `${shut ? 'Closed' : 'Open'} on ${dateLabel(iso)} (the plan says closed ${closed.map(i => WEEKDAY_EN[i] + 's').join(' and ')})`;
      blocks.push(CALL(`Your plan says it is closed on ${closed.map(i => WEEKDAY_EN[i] + 's').join(' and ')}, so ${shut ? 'it is closed' : 'it should be open'} on ${dateLabel(iso)}.`, shut ? 'red' : 'ok', 'Opening hours'));
    }
  }
  if (hits.length) blocks.push(L(hits.map(h => `${dateLabel(h.d.date)}: ${h.d.title}`)));
  blocks.push(P('Exact opening hours for this place are not in the app. When in doubt, check Google Maps before you go.', { muted: true }));
  return { title, blocks, quick: s ? s.text : null,
           actions: hits.slice(0, 2).map(h => ({ act: 'day', date: h.d.date, label: `Open ${dateLabel(h.d.date)}`, icon: 'days' })) };
}

/* ───────────── sights with opening hours (content.sights) ───────────── */
const sightNames = (s) => [s.name, s.name.split(' (')[0], ...(s.aliases || [])];
const aliasWords = (s) => new Set(sightNames(s).flatMap(a => norm(a).split(' ')));
function findSight(q, ctx) {
  let best = null, bs = 0;
  for (const s of ctx.content.sights || []) { const sc = aliasScore(q, sightNames(s)); if (sc > bs) { best = s; bs = sc; } }
  return best;
}
// open spans for a weekday: open.mon = ['08:30', '19:00'] or [['08:30', '12:15'], ['13:45', '16:30']] or '08:30–19:00'; null = closed that day
function spansWd(s, wd) {
  const v = s.open?.[DKEY[wd]];
  if (!v) return [];
  const pairs = typeof v === 'string' ? [...v.matchAll(/(\d{1,2}:\d{2})\s*[–-]\s*(\d{1,2}:\d{2})/g)].map(m => [m[1], m[2]]) : Array.isArray(v[0]) ? v : [v];
  return pairs.map(([a, b]) => [toMin(a), toMin(b)]).filter(([a, b]) => a != null && b != null).sort((x, y) => x[0] - y[0]);
}
const spansOn = (s, iso) => spansWd(s, dowOf(iso));
const allDay = (sp) => sp.length === 1 && sp[0][0] <= 0 && sp[0][1] >= 1440;   // '00:00'–'24:00': a square, a quarter, a promenade
const endHm = (m) => m >= 1440 ? '24:00' : hm(m), untilHm = (m) => m >= 1440 ? 'midnight' : hm(m);
const spanText = (sp) => allDay(sp) ? 'all day' : sp.map(([a, b]) => `${hm(a)}–${endHm(b)}`).join(' and ');
const cap = (x) => x ? x.charAt(0).toUpperCase() + x.slice(1) : '', dot = (x) => /[.!?]$/.test(x) ? x : x + '.';
// "https://www.vkv.org.tr/tr/kultur/… (official)" → "vkv.org.tr (official)"
const srcText = (s) => [String(s.source || '').replace(/https?:\/\/(?:www\.)?([^/\s)]+)[^\s;)]*/g, '$1').replace(/\s*;\s*/g, '; ').trim(),
  s.checked && `checked ${dateLabel(s.checked).slice(4)} ${s.checked.slice(0, 4)}`].filter(Boolean).join(' · ');
function sightAnswer(s, q, date, ctx, plain = false) {
  const C = ctx.content, name = s.name.split(' (')[0], days = C.days;
  const known = !!s.open && typeof s.open === 'object';
  const asksNow = NOWQ.test(q);
  // a bare name asks about the planned visit; "on sunday" is the next Sunday, and outside the trip it is about Sundays in general
  let iso = asksNow ? ctx.today : date || (plain && s.day && s.day >= ctx.today ? s.day : null) || ctx.todayInTrip || s.day || ctx.today, generic = false;
  const wd = asksNow || /\d/.test(q) ? -1 : WEEKDAYS.findIndex(w => has(q, w));
  if (wd >= 0) { iso = isoAdd(ctx.today, (wd - dowOf(ctx.today) + 7) % 7); generic = iso < days[0].date || iso > days[days.length - 1].date; }
  const isToday = iso === ctx.today && !generic, WD = WEEKDAY_EN[dowOf(iso)];
  const nextOpen = (from) => { for (let k = 1; k <= 7; k++) { const d = isoAdd(from, k), sp = spansOn(s, d); if (sp.length) return `${dateLabel(d)} ${spanText(sp)}`; } return null; };
  const d = s.day && days.find(x => x.date === s.day);
  const never = known && DKEY.every((_, i) => !spansWd(s, i).length);
  const planDay = (nx = '') => { if (!d || d.date === iso || nx.startsWith(dateLabel(d.date))) return ''; const sp = spansOn(s, d.date); return ` Your plan has it on ${dateLabel(d.date)}: ${sp.length ? `open ${spanText(sp)} that day` : 'closed that day!'}.`; };
  let title, verdict, tone = 'ok';
  if (!known) { title = `${name}: ${s.hours || 'opening hours'}`; verdict = s.hours ? `${name}: ${s.hours}.${s.closed ? ` Closed ${s.closed}.` : ''}` : `I have no opening hours for ${name}.`; tone = 'gold'; }
  else if (never) {   // a private house, a school seen from the street, a museum shut for renovation
    const why = /^every day \((.+)\)$/i.exec(s.closed || '');
    tone = s.outsideOnly ? 'gold' : 'red';
    title = s.outsideOnly ? `${name}: outside only, not open to visitors` : `${name}: closed every day`;
    verdict = s.outsideOnly ? `${dot(cap(s.hours || 'Not open to visitors: see it from outside'))}${why ? ' ' + dot(cap(why[1])) : ''}` : `${name} is not open to visitors during your trip.${s.hours ? ' ' + dot(s.hours) : ''}`;
  } else {
    const sp = spansOn(s, iso), nx = generic ? null : nextOpen(iso);
    if (!sp.length) {
      title = `${name}: closed on ${WD}s`; tone = 'red';
      verdict = generic ? `${name} is closed on ${WD}s${s.closed && !norm(s.closed).startsWith(norm(WD)) ? ` (closed ${s.closed})` : ''}.${planDay()}`
        : `${name} is closed ${isToday ? `today (${dateLabel(iso)})` : `on ${dateLabel(iso)}`}${s.closed ? `: closed ${s.closed}` : ''}.${nx ? ` Next open: ${nx}.` : ''}${planDay(nx || '')}`;
    } else if (allDay(sp)) { title = `${name}: open any time`; verdict = dot(cap(s.hours || 'Open all day')); }
    else if (isToday && ctx.todayInTrip && ctx.nowMin != null) {
      const m = ctx.nowMin, cur = sp.find(([a, b]) => a <= m && m < b), later = sp.find(([a]) => a > m);
      const now = cur ? `It is open now (${hm(m)}), until ${untilHm(cur[1])}.` : later ? `Right now (${hm(m)}) it is closed; it opens at ${hm(later[0])}.` : `It has closed for today (now ${hm(m)}).${nx ? ` Next open: ${nx}.` : ''}`;
      tone = cur ? 'ok' : later ? 'gold' : 'red';
      title = asksNow ? `${name}: ${cur ? `open now, until ${untilHm(cur[1])}` : later ? `closed now, opens ${hm(later[0])}` : 'closed now'}` : `${name}: open today, ${spanText(sp)}`;
      verdict = `${asksNow ? `${now} Today: ${spanText(sp)}.` : `Open today (${dateLabel(iso)}): ${spanText(sp)}. ${now}`}${planDay(cur || later ? '' : nx || '')}`;
    } else if (generic) { title = `${name}: open on ${WD}s, ${spanText(sp)}`; verdict = `Open on ${WD}s: ${spanText(sp)}.${planDay()}`; }
    else { title = `${name}: open on ${dateLabel(iso)}, ${spanText(sp)}`; verdict = `Open on ${dateLabel(iso)}: ${spanText(sp)}.${planDay()}`; }
    if (s.outsideOnly) verdict += ' You can only see it from outside.';
  }
  if (s.prayerNote && known && !never) verdict += ` ${s.prayerNote}`;
  // the plan's own lines about the place ("take exterior photos; do not enter the palace")
  const lines = d ? [...(d.plan || []), ...(d.fixed || [])].filter(p => sightNames(s).some(a => { const n = norm(a); return n.length >= 4 && norm(p).includes(n); })).slice(0, 2) : [];
  const blocks = [CALL(verdict, tone, 'Opening hours'), ...(lines.length ? [H(`In your plan · ${dateLabel(d.date)}`), L(lines)] : []),
    KV([['Hours', s.hours || ''], ['Closed', s.closed || ''], ['In your plan', d && !lines.length ? `${dateLabel(d.date)} · ${d.title}` : ''], ['Note', s.note || '']].filter(r => r[1])),
    ...(s.source || s.checked ? [P(`Source: ${srcText(s)}. Hours can change on holidays; check on the day.`, { muted: true })] : [])];
  return { title, blocks, noQuick: true, sight: s.id,
           actions: [...(d ? [{ act: 'day', date: d.date, label: `Open ${dateLabel(d.date)}`, icon: 'days' }] : []), { act: 'pdf', label: 'Download PDF', icon: 'download' }],
           pdf: { title: name, subtitle: s.hours || 'Opening hours', blocks, filename: `${filePrefix(ctx)}-${slug(name)}-hours.pdf` },
           suggestions: d ? [`Plan for ${dateLabel(d.date)}`] : [] };
}

// "what's open now?", "is it open now", "what is open on monday": no place named → the sights of that day's plan
const OPEN_FILLER = new Set(['what', 'whats', 'which', 'is', 'are', 'it', 'its', 'still', 'open', 'opened', 'closed', 'opening', 'hours', 'closes', 'closing', 'time', 'now', 'right', 'currently',
  'places', 'place', 'sights', 'things', 'anything', 'something', 'everything', 'there', 'here', 'on', 'we', 'can', 'go', 'mosques', 'museums', 'شو', 'ايش', 'وش', 'ماذا', 'مفتوح', 'مفتوحه', 'حين', 'الان', 'دلوقتي', 'ايه', 'اليوم', 'يوم', 'شي'].map(norm));
const DATEW = new Set([...WEEKDAYS.flat(), ...MONTHS.flat(), 'today', 'tonight', 'tomorrow', 'this', 'morning', 'evening', 'afternoon', 'at', 'the', 'of', 'in', 'day'].map(norm));
const genericOpen = (q) => q.split(' ').every(w => !w || OPEN_FILLER.has(w) || DATEW.has(w) || STOP.has(w) || /^\d/.test(w) || w.length <= 2);
function openListAnswer(q, date, ctx) {
  const C = ctx.content, asksNow = NOWQ.test(q) || !date;
  const iso = asksNow ? ctx.todayInTrip : date;
  const d = iso && C.days.find(x => x.date === iso);
  if (!d || !C.sights?.length) return C.sights?.length ? { title: 'Which place?', blocks: [P('Name the place (and the day if it is not today), for example “Is the Grand Bazaar open on Sunday?” or “Blue Mosque open now?”')],
    suggestions: ['Is the Grand Bazaar open on Sunday?', 'Plan for day 1'], noQuick: true } : null;
  const S = C.sights.filter(s => s.day === iso && s.open && typeof s.open === 'object');
  const chk = S.map(s => s.checked).filter(Boolean).sort().pop();
  const live = asksNow && iso === ctx.today && ctx.nowMin != null, m = ctx.nowMin;
  if (!S.length) return { title: `No sights with opening hours on ${dateLabel(iso)}`, blocks: [P(`Your plan for ${dateLabel(iso)} (${d.title}) has no museum, mosque or sight with opening hours. Ask about a place by name, for example “Is the Grand Bazaar open on Sunday?”`)],
                          actions: [{ act: 'day', date: iso, label: `Open ${dateLabel(iso)}`, icon: 'days' }], suggestions: [`Plan for ${dateLabel(iso)}`], noQuick: true };
  const state = (s) => {
    const sp = spansOn(s, iso);
    if (!sp.length) return s.outsideOnly ? 'outside only' : 'closed';
    if (allDay(sp)) return 'any time';
    if (!live) return spanText(sp);
    const cur = sp.find(([a, b]) => a <= m && m < b), later = sp.find(([a]) => a > m);
    return cur ? `open now · until ${untilHm(cur[1])}` : later ? `closed now · opens ${hm(later[0])}` : `closed for today (${spanText(sp)})`;
  };
  const rows = S.map(s => [s.name.split(' (')[0], state(s)]);
  const pray = S.some(s => s.prayerNote && spansOn(s, iso).length);
  const blocks = [P(live ? `The places in today’s plan, at ${hm(m)}:` : `The places in your plan on ${dateLabel(iso)}:`), TABLE(['Place', live ? 'Now' : 'Open'], rows, { columns: { 1: { cellWidth: 52 } } }),
    ...(pray ? [P('Mosques close to visitors for a while around each prayer: ask about one by name for the times.', { muted: true })] : []),
    P(`Hours from the official sites and Google Maps${chk ? `, checked ${dateLabel(chk).slice(4)}` : ''}. They can change on holidays; check on the day.`, { muted: true })];
  return { title: live ? `Open now · ${d.title}` : `Opening hours · ${dateLabel(iso)}`, blocks, noQuick: true,
           actions: [{ act: 'day', date: iso, label: `Open ${dateLabel(iso)}`, icon: 'days' }, { act: 'pdf', label: 'Download PDF', icon: 'download' }],
           pdf: { title: `Opening hours · ${dateLabel(iso)}`, subtitle: d.title, blocks, filename: `${filePrefix(ctx)}-hours-${monTag(iso)}.pdf` },
           suggestions: S.slice(0, 2).map(s => `Is ${s.name.split(' (')[0]} open now?`) };
}

function dayCostAnswer(d, ctx) {
  const blocks = [];
  if (d.costs?.length) blocks.push(TABLE(null, d.costs.map(c => [c.label, c.value]), { columns: { 1: { halign: 'right', cellWidth: 48 } } }));
  blocks.push({ t: 'total', label: 'Day total', value: d.total || (d.allowAed ? `allow ≈ AED ${d.allowAed[0]}–${d.allowAed[1]}` : 'Included') });
  const spent = (ctx.expenses || []).filter(e => e.date === d.date);
  if (spent.length) { const sp = spentSummary({ ...ctx, expenses: spent }); blocks.push(CALL(`Logged on this day: ≈ AED ${fmt(sp.aed)} (${spent.length} expense${spent.length === 1 ? '' : 's'}).`, 'sea')); }
  return { title: `${dateLabel(d.date)} · cost for two`, blocks, quick: d.total ? `${dateLabel(d.date)}: ${d.total}` : null,
           actions: [{ act: 'pdf', label: 'Download PDF', icon: 'download' }, { act: 'day', date: d.date, label: 'Open the day', icon: 'days' }],
           pdf: { title: `${dateLabel(d.date)} · cost for two`, subtitle: d.title, blocks, filename: `${filePrefix(ctx)}-cost-${monTag(d.date)}.pdf` },
           suggestions: ['Budget', 'How much have we spent today?'] };
}

function dayAnswer(d, ctx) {
  const blocks = dayBlocks(d, ctx), C = ctx.content;
  const nextDay = C.days[C.days.indexOf(d) + 1];
  return {
    title: `${dateLabel(d.date)} · ${d.title}`, blocks,
    actions: [{ act: 'pdf', label: 'Download PDF', icon: 'download' }, { act: 'day', date: d.date, label: 'Open the day', icon: 'days' }, ...userDocs(ctx).filter(u => u.dayIso === d.date).slice(0, 4).map(udocAct)],
    pdf: { title: `${dateLabel(d.date)} · ${d.title}`, subtitle: `Day ${d.n} of ${C.days.length} · ${d.city}`, blocks, filename: `${filePrefix(ctx)}-${monTag(d.date)}-${slug(d.title)}.pdf` },
    suggestions: [nextDay ? `Plan for ${dateLabel(nextDay.date)}` : 'My flight home', `Where do we eat on ${dateLabel(d.date)}?`, 'Whole trip as PDF'],
  };
}

function nextUp(ctx) {
  const C = ctx.content, now = ctx.nowMin;
  const today = C.days.find(d => d.date === ctx.today);
  if (!today) {
    const first = C.days[0];
    if (ctx.today < first.date) {
      const fb = C.bookings.find(b => b.id === cfg(ctx).firstFlight);
      const blocks = [...(cfg(ctx).departCallout ? [CALL(cfg(ctx).departCallout, 'sea')] : []), ...todoBlocks(ctx, { beforeTrip: true }), ...dayBlocks(first, ctx, { withMap: false })];
      return { title: 'Next up: the trip starts', blocks, actions: [{ act: 'pdf', label: 'Download PDF', icon: 'download' }, ...(fb?.file ? [{ act: 'doc', id: fb.file, label: 'Ticket', icon: 'ticket' }] : []), { act: 'day', date: first.date, label: 'Open day 1', icon: 'days' }],
               pdf: { title: `Day 1 · ${first.title}`, subtitle: dateLabel(first.date), blocks: dayBlocks(first, ctx), filename: `${filePrefix(ctx)}-day-1.pdf` }, suggestions: ['To-do list', 'My flights'] };
    }
    return { title: 'The trip is over', blocks: [P('Welcome home! Every day, document and the budget are still here.')], suggestions: ['Budget', 'How much have we spent?'] };
  }
  const st = nextStep(today, now, { doneN: (ctx.progress || {})[today.date] || 0, content: C }), nxt = st.first;
  const tl = new Map(st.timeline.map(x => [x.trip, x]));
  const at = (t) => t.time ? `${t.time}${t.nextDay ? ' (after midnight)' : ''}` : `≈ ${tl.get(t)?.at}`;
  const line = (t) => `${at(t)} · ${t.modeText}: ${t.label}${t.dur ? ' · ' + t.dur : ''}`;
  const blocks = [];
  if (nxt) {
    blocks.push(CALL(`${nxt.modeText}${nxt.dur ? ' · ' + nxt.dur : ''}.${st.guessed ? ' No fixed time: this is my estimate from the plan. Tap Done on Today when you finish a step.' : ''}`, 'sea', nxt.time ? `At ${at(nxt)}` : `About ${tl.get(nxt)?.at}`));
    const rest = st.timeline.filter(x => !x.started && x.trip !== nxt).slice(0, 3);
    if (rest.length) blocks.push(L(rest.map(x => `Then ${typeof x.trip.n === 'number' ? x.trip.n + '.' : x.trip.n} ${line(x.trip)}`)));
  } else if (today.free) blocks.push(P('Today is a free day. Here are the ideas and the fixed points:'));
  else blocks.push(P('No more trips today. Here is the rest of the day:'));
  blocks.push(...todoBlocks(ctx));
  blocks.push(...dayBlocks(today, ctx, { withMap: false }));
  // tickets: the next flight still to come today, and the user's own documents filed on the next trip
  const fl = st.timeline.find(x => !x.started && x.trip.mode === 'flight')?.trip, fb = fl && flightBooking(fl, today, C);
  const onTrip = (u, t) => !!t && ((u.dayIso === today.date && u.tripN != null && String(u.tripN) === String(t.n)) || (!!t.bookingId && u.bookingId === t.bookingId));
  const mine = userDocs(ctx).filter(u => onTrip(u, nxt) || onTrip(u, fl) || (fb && u.bookingId === fb.id));
  return { title: nxt ? `Next: ${nxt.label}` : `Today · ${today.title}`, blocks,
           actions: [...(fb?.file ? [{ act: 'doc', id: fb.file, label: `Ticket ${(fb.legs || []).map(l => l.flight).join(' + ')}`.trim(), icon: 'ticket' }] : []),
                     ...mine.slice(0, 3).map(u => ({ ...udocAct(u), icon: 'ticket' })),
                     { act: 'pdf', label: 'Download PDF', icon: 'download' }, { act: 'day', date: today.date, label: 'Open today', icon: 'days' }]
             .concat(nxt?.directions ? [{ act: 'url', href: nxt.directions, label: 'Directions', icon: 'navigation' }] : []),
           pdf: { title: `Today · ${today.title}`, subtitle: dateLabel(today.date), blocks: dayBlocks(today, ctx), filename: `${filePrefix(ctx)}-today-${today.date}.pdf` },
           next: nxt ? { n: nxt.n, guessed: st.guessed, at: tl.get(nxt)?.at } : null,
           suggestions: ['Where do we eat today?', 'Hotel address for the driver', 'Plan for tomorrow'] };
}
// the flight booking behind a flight trip: its booking id, a flight number in the label, or the date
function flightBooking(t, day, C) {
  const fl = C.bookings.filter(b => b.kind === 'flight');
  if (t.bookingId) return fl.find(b => b.id === t.bookingId) || null;
  const s = norm(`${t.label} ${t.dur || ''}`);
  return fl.find(b => (b.legs || []).some(l => l.flight && has(s, [l.flight]))) || fl.find(b => b.dateIso === (t.nextDay ? isoAdd(day.date, 1) : day.date)) || null;
}
// open to-dos that matter today, with the state the app shows (expired ones are never listed)
function todoBlocks(ctx, { beforeTrip = false } = {}) {
  const C = ctx.content, start = C.meta.tripStart || C.days[0].date, recent = isoAdd(ctx.today, -2);
  const order = { now: 0, overdue: 1, soon: 2 };
  const all = C.todos.map(t => ({ t, s: tState(t, ctx) })).filter(({ t, s }) => s in order && (beforeTrip ? t.due <= start : s !== 'soon' || t.due === ctx.today));
  // like Today: overdue items from the last two days are listed, older ones only counted
  const list = all.filter(({ t, s }) => beforeTrip || s !== 'overdue' || t.due >= recent).sort((a, b) => order[a.s] - order[b.s] || (a.t.due || '').localeCompare(b.t.due || '')).slice(0, 8);
  const older = all.length - list.length;
  return list.length || older ? [H(beforeTrip ? 'Before you fly' : 'To-do today'), ...(list.length ? [L(list.map(({ t, s }) => `${t.title} — ${tNote(t, ctx, s)}`))] : []),
    ...(older ? [P(`${older} older item${older === 1 ? ' is' : 's are'} still open in the checklist.`, { muted: true })] : [])] : [];
}

function itineraryAnswer(ctx) {
  const C = ctx.content;
  const overview = TABLE(['Day', 'Date', 'City', 'Plan', 'Total for two'], C.days.map(d => [String(d.n), dateLabel(d.date), d.city, d.title, d.total || 'Free']), { size: 9 });
  const blocks = [P('Your whole trip, one day per page: the route map, how you move, food, costs and what to check.'), overview];
  for (const d of C.days) { blocks.push({ t: 'pagebreak' }); blocks.push(H(`${dateLabel(d.date)} · ${d.title}`)); blocks.push(...dayBlocks(d, ctx)); }
  const summary = cfg(ctx).tripSummary || `${C.days.length} days · ${dateLabel(C.days[0].date)} to ${dateLabel(C.days[C.days.length - 1].date)}.`;
  return { title: 'Your whole trip', blocks: [P(summary), overview],
           actions: [{ act: 'pdf', label: 'Download the whole trip (PDF)', icon: 'download' }, ...(C.files.some(f => f.id === 'plan-pdf') ? [{ act: 'doc', id: 'plan-pdf', label: 'Open the Word plan (PDF)', icon: 'filetext' }] : [])],
           pdf: { title: `${C.meta.title} · the whole trip`, subtitle: C.meta.subtitle || '', blocks, filename: `${filePrefix(ctx)}-whole-trip.pdf` },
           suggestions: ['Plan for today', 'Budget', 'To-do list'] };
}

// Arabic place and direction words → the English aliases the content uses
const AR_EN = [['دبي', 'dubai'], ['ابوظبي', 'abu dhabi'], ['ابو ظبي', 'abu dhabi'], ['انطاليا', 'antalya'], ['اسطنبول', 'istanbul'], ['استنبول', 'istanbul'], ['عوده', 'return home'],
  ['رجوع', 'return home'], ['للبيت', 'home'], ['بيت', 'home'], ['نرجع', 'return home'], ['مطار', 'airport'], ['فندق', 'hotel'], ['عباره', 'ferry pier'], ['فيري', 'ferry pier'], ['اسكله', 'pier']];
const withAr = (q) => AR.test(q) ? AR_EN.reduce((s, [a, e]) => s.replace(new RegExp(`(^|\\s)(?:و|ل|ب|لل|بال)?${a}(?=\\s|$)`, 'g'), `$1${e}`), q) : q;
// Arabic names of the famous Istanbul sights (normalised: no "al-", ة → ه, أ → ا), longest first
const AR_SIGHTS = [['بازار مصري', 'spice bazaar'], ['سوق مصري', 'spice bazaar'], ['بازار كبير', 'grand bazaar'], ['سوق مسقوف', 'grand bazaar'], ['جراند بازار', 'grand bazaar'], ['بازار', 'grand bazaar'],
  ['مسجد ازرق', 'blue mosque'], ['جامع ازرق', 'blue mosque'], ['جامع سلطان احمد', 'blue mosque'], ['مسجد سلطان احمد', 'blue mosque'], ['ايا صوفيا', 'hagia sophia'], ['اياصوفيا', 'hagia sophia'], ['ايا صوفيه', 'hagia sophia'],
  ['قصر توبكابي', 'topkapi'], ['توبكابي', 'topkapi'], ['توب كابي', 'topkapi'], ['دولمه بهجه', 'dolmabahce'], ['دولما بهجه', 'dolmabahce'], ['دولمابهجه', 'dolmabahce'], ['برج غلطه', 'galata tower'], ['برج جلطه', 'galata tower'],
  ['سليمانيه', 'suleymaniye'], ['برج فتاه', 'maidens tower'], ['برج البنت', 'maidens tower'], ['صهريج', 'basilica cistern'], ['ايوب سلطان', 'eyup sultan'], ['بيت العشق الممنوع', 'vehbi koc'], ['قصر العشق الممنوع', 'vehbi koc']].map(([a, e]) => [norm(a), e]);
const arPlaces = (q) => AR.test(q) ? AR_SIGHTS.reduce((s, [a, e]) => s.replace(new RegExp(`(^|\\s)(?:و|ب|ل|ف)?${reEsc(a)}(?=\\s|$)`, 'g'), `$1${e}`), q) : q;
function flightAnswer(q0, ctx) {
  const q = withAr(q0);
  const fl = ctx.content.bookings.filter(b => b.kind === 'flight').sort((a, b) => (a.dateIso || '').localeCompare(b.dateIso || ''));
  let pick = fl;
  const named = bestByAlias(q, fl);
  const checkQ = /check ?-?in/.test(q) && /(online|web|app)/.test(q);
  const singular = /(^|\s)(next|our|my|the) flight(\s|$)/.test(q) && !/flights/.test(q) || /(^|\s)(رحلتنا|طيارتنا|طياره)(\s|$)/.test(q) || /boarding|e-ticket/.test(q) || checkQ;
  if (named) pick = [named];
  else if (/(^|\s)next(\s|$)/.test(q) || checkQ || (singular && ctx.today >= (fl[0]?.dateIso || '') )) { const nx = fl.find(b => (b.dateIso || '') >= ctx.today) || fl[fl.length - 1]; if (nx) pick = [nx]; }
  if (!pick.length) pick = fl;
  const blocks = [];
  for (const b of pick) { blocks.push(H(`${b.title} · ${b.dates || ''}`)); blocks.push(P(b.subtitle || '', { muted: true })); blocks.push(...bookingBlocks(b)); }
  const acts = pick.filter(b => b.file).map(b => ({ act: 'doc', id: b.file, label: pick.length > 1 ? `Ticket: ${b.title}` : 'Open the ticket', icon: 'ticket' }));
  const one = pick.length === 1 ? pick[0] : null;
  const airlines = [...new Set(fl.map(b => (b.subtitle || '').split(' · ')[0]).filter(Boolean))].join(' · ');
  // one flight: say when it leaves, and which night that is for departures after midnight
  const dep = one?.legs?.[0] && toMin(one.legs[0].from), night = dep != null && dep < 6 * 60 && one.dateIso ? ` (the night of ${dateLabel(isoAdd(one.dateIso, -1))})` : '';
  const callQ = CALLQ.test(q) && one?.phone, airline = one && (one.subtitle || '').split(' · ')[0];
  // "online check-in": the check-in to-do linked to that flight, with its state
  const links = cfg(ctx).todoLinks || {}, ct = checkQ && one && ctx.content.todos.find(t => links[t.id] === one.id && /check-?in/i.test(t.title));
  const quick = callQ ? `${airline || one.title}: call ${one.phone}. Booking ${one.confirmation || '—'}.`
    : ct ? `${ct.title} — ${tNote(ct, ctx)}.${ct.note ? ' ' + ct.note : ''}`
    : one?.legs?.length ? `${one.legs.map(l => `${l.flight} ${l.from} → ${l.to}`).join(', then ')}${one.dateIso ? ` on ${dateLabel(one.dateIso)}${night}` : ''}. Booking ${one.confirmation || '—'}.` : null;
  return { title: one ? `${one.title} · ${one.dates}` : `Your ${pick.length} flights`, blocks, quick,
           actions: [...(callQ ? [{ act: 'url', href: telOf(one.phone), label: `Call ${airline || 'the airline'}`, icon: 'phone' }] : []), { act: 'pdf', label: 'Download PDF', icon: 'download' }, ...acts],
           pdf: { title: one ? one.title : 'Flights', subtitle: one ? one.subtitle : airlines, blocks, filename: `${filePrefix(ctx)}-${one ? slug(one.title) : 'flights'}.pdf` },
           suggestions: ['Airport pickup', 'Hotel address for the driver', 'To-do list'] };
}

function hotelForDate(iso, ctx) {
  const C = ctx.content;
  const d = C.days.find(x => x.date === iso) || (iso < C.days[0].date ? C.days[0] : C.days[C.days.length - 1]);
  return C.bookings.find(b => b.id === d.hotel);
}
function hotelAnswer(q, date, ctx) {
  const hs = ctx.content.bookings.filter(b => b.kind === 'hotel');
  const backup = /(backup|cancel)/.test(q) ? hs.find(h => ['to-cancel', 'cancelled'].includes(h.status)) : null;
  const pick = bestByAlias(q, hs) || backup || hotelForDate(date || ctx.todayInTrip || ctx.today, ctx) || hs[0];
  const blocks = [P(pick.subtitle || '', { muted: true }), ...bookingBlocks(pick)];
  const others = hs.filter(h => h !== pick && !['to-cancel', 'cancelled'].includes(h.status));
  // a cancelled booking: nothing to do, except the refund to-do if there is one
  const key = norm(pick.title).split(' ')[0];
  const refund = pick.status === 'cancelled' ? ctx.content.todos.filter(t => /refund/i.test(t.title) && norm(t.title).includes(key)) : [];
  // "where do we sleep tonight", "call the hotel": one line first
  const iso = date || ctx.todayInTrip, callQ = CALLQ.test(q) && !!pick.phone;
  const outQ = /check ?-?out|checkout/.test(q), inQ = /check ?-?in|checkin/.test(q) && !/online|web/.test(q);
  const quick = pick.status === 'cancelled' ? `Nothing to do: ${pick.title} is already cancelled. ${pick.cancel || ''}${refund.map(t => ` To-do: ${t.title} — ${tNote(t, ctx)}.`).join('')}`.trim()
    : callQ ? `${pick.title}: call ${pick.phone}.`
    : outQ && pick.checkout ? `${pick.title}: check-out ${pick.checkout}.` : inQ && pick.checkin ? `${pick.title}: check-in ${pick.checkin}.`
    : iso && !bestByAlias(q, hs) && /(^|\s)(sleep|stay|staying|tonight|نام|ننام|نسكن|نبات)(\s|$)|(which|what) hotel|اي فندق|اين فندق|وين فندق/.test(q) ? `${dateLabel(iso)}: ${pick.title}${pick.address ? ', ' + pick.address : ''}.` : null;
  const call = pick.phone && { act: 'url', href: telOf(pick.phone), label: callQ ? `Call ${pick.short || pick.title.split(' ')[0]}` : 'Call', icon: 'phone' };
  return { title: pick.status === 'cancelled' ? `${pick.title} (cancelled)` : pick.title, blocks, quick,
           actions: [callQ && call, { act: 'pdf', label: 'Download PDF', icon: 'download' }, pick.file && { act: 'doc', id: pick.file, label: 'Open the booking', icon: 'filetext' },
                     pick.driverCard && !['to-cancel', 'cancelled'].includes(pick.status) && { act: 'driver', id: pick.driverCard, label: 'Show the driver', icon: 'navigation' },
                     !callQ && call].filter(Boolean),
           pdf: { title: pick.title, subtitle: pick.subtitle || '', blocks, filename: `${filePrefix(ctx)}-${slug(pick.title)}.pdf` },
           suggestions: [...others.map(h => `${h.short || h.title} hotel`), 'Airport pickup', 'My flights'] };
}

function shuttleAnswer(ctx, q = '') {
  const C = ctx.content, S = C.bookings.filter(b => b.kind === 'transfer');
  // the ride that matters: in the city the question names, else the next one from now
  const rides = C.days.flatMap(d => (d.trips || []).filter(t => t.mode === 'shuttle').map(t => ({ d, t })));
  const city = rides.map(x => x.d.city).find(c => c && has(q, [c]));
  const pool = city ? rides.filter(x => x.d.city === city) : rides;
  const nx = pool.find(x => x.d.date > ctx.today || (x.d.date === ctx.today && (tripMinutes(x.t) ?? 1440) >= (ctx.nowMin ?? 0) - 30)) || (city ? pool[0] : null);
  const nb = nx && (S.find(b => b.phase && norm(`${nx.t.from} ${nx.t.to} ${nx.t.label}`).includes(norm(b.phase))) || S.find(b => b.phase && norm(nx.d.city || '').includes(norm(b.phase))));
  const quick = nx ? `${nx.d.date === ctx.today ? 'Today' : dateLabel(nx.d.date)}${nx.t.time ? ' ' + nx.t.time : ''}: ${nx.t.label}${nx.t.dur ? ' · ' + nx.t.dur : ''}.`
    + (nb ? ` ${String(nb.via || nb.title).split(' · ').pop()}: ${nb.phone || ''}${nb.whatsapp ? ` (WhatsApp ${nb.whatsapp})` : ''}${nb.confirmation ? `, booking ${nb.confirmation}` : ''}.` : '') : null;
  const blocks = [];
  if (cfg(ctx).shuttleNote) blocks.push(CALL(cfg(ctx).shuttleNote, 'gold'));
  const legs = ctx.content.days.flatMap(d => (d.trips || []).filter(t => t.mode === 'shuttle').map(t => [dateLabel(d.date), t.label, t.time || '—', t.dur || '']));
  if (legs.length) { blocks.push(H('Your shuttle rides')); blocks.push(TABLE(['Day', 'Ride', 'Time', 'Note'], legs, { columns: { 0: { cellWidth: 24 }, 2: { cellWidth: 16 } } })); }
  for (const b of S) { blocks.push(H(b.title)); blocks.push(...bookingBlocks(b)); }
  const paid = S.length && S.every(b => b.status === 'paid');
  const who = nb && String(nb.via || nb.title).split(' · ').pop();
  return { title: `Airport shuttles${paid ? ' (paid)' : ''}`, blocks, quick,
           actions: [...(nb?.phone ? [{ act: 'url', href: telOf(nb.phone), label: `Call ${who}`, icon: 'phone' }] : []), ...(nb?.whatsapp ? [{ act: 'url', href: waOf(nb.whatsapp), label: 'WhatsApp', icon: 'msgcircle' }] : []),
                     ...(nb?.file ? [{ act: 'doc', id: nb.file, label: 'Booking', icon: 'filetext' }] : []), { act: 'pdf', label: 'Download PDF', icon: 'download' }],
           pdf: { title: 'Airport shuttles', subtitle: `${S.map(b => b.phase).filter(Boolean).join(' and ')}${paid ? ' · paid' : ''}`, blocks, filename: `${filePrefix(ctx)}-airport-shuttles.pdf` },
           suggestions: ['My flights', 'Hotel address for the driver'] };
}

function driverAnswer(q, date, ctx, all = false) {
  const C = ctx.content, cards = C.driverCards;
  const kind = (k) => cards.filter(c => c.kind === k);
  const named = cards.filter(c => aliasScore(q, c.aliases) > 0);
  const iso = date || ctx.todayInTrip;
  let pick = [];
  if (!all) {
    if (/(airport|havalimani|مطار)/.test(q)) {
      const air = kind('airport'), n = air.filter(c => named.includes(c));
      const byDate = iso ? air.filter(c => (!c.fromIso || c.fromIso <= iso) && (!c.toIso || iso <= c.toIso)) : [];
      pick = n.length ? n : byDate.length ? byDate : air;
    } else if (/(pier|iskele|ferry)/.test(q)) {
      const piers = kind('pier'), n = piers.filter(c => named.includes(c));
      pick = n.length ? n : piers;
    } else if (named.length) pick = named;
    else if (/(hotel|فندق|home|back)/.test(q)) {
      const hb = iso ? hotelForDate(iso, ctx) : null;
      pick = hb?.driverCard ? cards.filter(c => c.id === hb.driverCard) : kind('hotel');
    }
  }
  if (!pick.length) pick = cards;
  const blocks = [];
  pick.forEach((c, i) => { if (i) blocks.push({ t: 'pagebreak' }); blocks.push(H(c.title)); blocks.push({ t: 'big', text: c.tr }); blocks.push(P(c.en, { muted: true })); });
  const short = (c) => c.title.includes(' · ') ? c.title.split(' · ').slice(1).join(' · ') : c.title;
  return { title: pick.length === 1 ? pick[0].title : 'Show-the-driver cards', blocks,
           actions: [...pick.slice(0, 4).map(c => ({ act: 'driver', id: c.id, label: `Show: ${short(c)}`, icon: 'navigation' })), { act: 'pdf', label: 'Download PDF', icon: 'download' }],
           pdf: { title: 'Show the driver', subtitle: 'Big Turkish text for taxi drivers', blocks, filename: pick.length === 1 ? `${filePrefix(ctx)}-driver-${pick[0].id}.pdf` : `${filePrefix(ctx)}-driver-cards.pdf` },
           suggestions: ['Taxi rules', 'Turkish phrases'] };
}

function foodAnswer(q, date, venue, ctx) {
  if (venue && !date && !/(options|where|list|all|places|near|around)/.test(q)) return venueAnswer(venue, ctx, q);
  const C = ctx.content;
  let vs = C.venues.slice();
  const kinds = [/(shisha|hookah|nargile|argileh|شيشه)/.test(q) && 'shisha', /(coffee|cafe|قهوه|كافيه)/.test(q) && 'coffee', /(breakfast|فطار|فطور)/.test(q) && 'breakfast',
                 /(lunch|dinner|meal|restaurant|غداء|عشاء|مطعم)/.test(q) && 'meal'].filter(Boolean);
  const kind = kinds.length === 1 ? kinds[0] : null;
  if (date) vs = vs.filter(v => v.day === date);
  if (kinds.length) vs = vs.filter(v => kinds.includes(v.kind) || (kinds.includes('meal') && v.kind === 'breakfast'));
  const words = q.split(' ').filter(w => w.length > 3 && !STOP.has(w) && !FOODW.has(w));
  const byArea = vs.filter(v => words.some(w => norm(`${v.area} ${v.name} ${v.view || ''}`).includes(w)));
  if (byArea.length) {
    // the day's own planned place counts as "near X" when the day's route walks from X to it (Ortaköy → Cafe Bosphorus)
    const iso = date || ctx.todayInTrip, dd = iso && C.days.find(x => x.date === iso);
    const near = dd ? C.venues.filter(v => v.day === iso && v.status !== 'option' && !byArea.includes(v) && (!kinds.length || kinds.includes(v.kind))
      && (dd.trips || []).some(t => { const s = norm(`${t.from} ${t.to} ${t.label}`); return words.some(w => s.includes(w)) && s.includes(norm(v.name.split(' (')[0])); })) : [];
    vs = [...near, ...byArea];
  }
  const dayHasOptions = !!date && C.venues.some(v => v.day === date && v.status === 'option');
  const wantOptions = /(option|options|alternative|alternatives|instead|other|all)/.test(q) || dayHasOptions || byArea.length;
  if (!wantOptions) vs = vs.filter(v => v.status !== 'option');
  if (!vs.length) vs = date ? C.venues.filter(v => v.day === date) : C.venues.filter(v => v.status !== 'option');
  const rank = { chosen: 0, plan: 0, option: 1 };
  // during the trip, with no day named, today's places come first
  const first = !date && ctx.todayInTrip && vs.some(v => v.day === ctx.todayInTrip) ? ctx.todayInTrip : null;
  vs.sort((a, b) => ((b.day === first) - (a.day === first)) || a.day.localeCompare(b.day) || (rank[a.status] - rank[b.status]));
  const area = byArea.length ? words.find(w => byArea.some(v => norm(`${v.area} ${v.name}`).includes(w))) : null;
  const areaWord = area ? (byArea.map(v => `${v.area} ${v.name}`.split(/[\s,]+/).find(w => norm(w) === area)).find(Boolean) || area) : '';
  const areaLabel = areaWord ? ` near ${areaWord.charAt(0).toUpperCase()}${areaWord.slice(1)}` : '';
  const kindLabel = kind ? (kind === 'meal' ? 'Meals' : KIND[kind]) : kinds.length ? kinds.map(k => k === 'meal' ? 'Meals' : KIND[k]).join(' & ') : 'Food & drink';
  const title = `${date ? dateLabel(date) + ' · ' : ''}${kindLabel}${areaLabel}${first ? ' (today first)' : ''}`;
  const blocks = [P(`${vs.length} place${vs.length === 1 ? '' : 's'}. Prices are for two: a main meal is 2 mains, 1 appetizer and 2 soft drinks; shisha is 1 shisha, a Turkish coffee and a tea with mint.`),
    TABLE(['Place', 'Day', 'What', 'Area', 'Cost for two', 'Notes'], venueRows(vs), { size: 8.4, columns: { 0: { cellWidth: 30 }, 1: { cellWidth: 17 }, 2: { cellWidth: 20 }, 4: { cellWidth: 25 } } })];
  if (date && !vs.length) blocks.push(P('Nothing is planned for that day.'));
  const optDay = C.venues.find(v => v.status === 'option')?.day;
  return { title, blocks, venues: vs.map(v => v.id),
           actions: [{ act: 'pdf', label: 'Download PDF', icon: 'download' }],
           pdf: { title, subtitle: `Food & drink · ${C.meta.title}`, blocks, filename: `${filePrefix(ctx)}-food${date ? '-' + monTag(date) : ''}${kind ? '-' + kind : ''}.pdf` },
           suggestions: ['Shisha places', ...(optDay && optDay !== date ? [`Dining options on ${dateLabel(optDay)}`] : []), 'Fish by the kilo tips'] };
}

function venueAnswer(v, ctx, q = '') {
  const d = ctx.content.days.find(x => x.date === v.day);
  if (/(^|\s)(open|opened|closed|hours|opening)(\s|$)/.test(q)) {
    const key = norm(v.name.split(' (')[0]);
    const line = d && [...(d.plan || []), ...(d.fixed || [])].find(p => norm(p).includes(key));
    const r = venueAnswer(v, ctx);
    r.quick = `${v.name} is in your plan on ${dateLabel(v.day)}${line ? `: ${line}` : '.'} Opening hours are only in the app where the plan mentions them.`;
    return r;
  }
  const blocks = [KV([['Day', d ? `${dateLabel(v.day)} · ${d.title}` : dateLabel(v.day)], ['What', KIND[v.kind] || v.kind], ['Where', v.area], ['Cost for two', v.cost],
                      ...(v.book ? [['Booking', v.book]] : []), ...(v.phone ? [['Phone', v.phone]] : []), ...(v.whatsapp ? [['WhatsApp', v.whatsapp]] : []), ...(v.view ? [['View', v.view]] : [])]),
                  ...(v.notes ? [P(v.notes)] : []), ...(v.status === 'option' ? [CALL('This is an alternative, not the chosen place for the day.', 'sea')] : [])];
  // is there a booking to-do for this place, and is it ticked?
  const key = norm(v.name.split(' (')[0]).split(' ').find(w => w.length >= 4 && !['the', 'cafe', 'lounge', 'old'].includes(w));
  const todo = key && ctx.content.todos.find(t => norm(t.title).includes(key));
  const ts = todo && tState(todo, ctx);
  if (todo) blocks.unshift(CALL(`${todo.title}: ${ts === 'done' ? 'ticked as done ✓' : ts === 'missed' ? 'not ticked, and the day has passed' : `not ticked yet (${tNote(todo, ctx, ts)})`}.`, ts === 'done' ? 'ok' : 'gold', 'Booking'));
  // "call carlos terrace": the number first, and the Call / WhatsApp buttons before the map
  const callQ = CALLQ.test(q);
  const call = [v.phone && { act: 'url', href: telOf(v.phone), label: callQ ? `Call ${v.name.split(' (')[0]}` : 'Call', icon: 'phone' },
                v.whatsapp && { act: 'url', href: waOf(v.whatsapp), label: 'WhatsApp', icon: 'msgcircle' }].filter(Boolean);
  const quick = !callQ ? null : call.length ? `${v.name}: ${[v.phone && `call ${v.phone}`, v.whatsapp && (v.whatsapp === v.phone ? 'the same number on WhatsApp' : `WhatsApp ${v.whatsapp}`)].filter(Boolean).join(' · ')}.`
    : `No phone number for ${v.name} in the app.${v.book ? ' ' + dot(v.book) : ''}`;
  return { title: v.name, blocks, quick,
           actions: [...(callQ ? call : []), { act: 'url', href: v.maps, label: 'Map', icon: 'pin' }, ...(callQ ? [] : call),
                     v.menu && { act: 'url', href: v.menu, label: 'Menu', icon: 'filetext' }, d && { act: 'day', date: d.date, label: 'Open the day', icon: 'days' },
                     { act: 'pdf', label: 'Download PDF', icon: 'download' }].filter(Boolean),
           pdf: { title: v.name, subtitle: `${dateLabel(v.day)} · ${v.area}`, blocks, filename: `${filePrefix(ctx)}-${slug(v.name)}.pdf` },
           suggestions: [`Where do we eat on ${dateLabel(v.day)}?`, 'Shisha places'] };
}

function convertAnswer(c, ctx) {
  const r = ctx.rate, e = ctx.content.money.rates.tryPerEur;
  const tryVal = c.from === 'TRY' ? c.amount : c.from === 'AED' ? c.amount * r : c.amount * e;
  const aed = tryVal / r, eur = tryVal / e;
  const two = (n) => n.toLocaleString('en', { maximumFractionDigits: n < 100 ? 2 : 0 });
  const src = c.from === 'TRY' ? `₺${two(c.amount)}` : c.from === 'AED' ? `AED ${two(c.amount)}` : `€${two(c.amount)}`;
  const dst = c.from === 'TRY' ? `AED ${two(aed)}` : `₺${two(tryVal)}`;
  return { title: `${src} ≈ ${dst}`, blocks: [KV([['Turkish lira', `₺${two(tryVal)}`], ['UAE dirham', `AED ${two(aed)}`], ['Euro', `€${two(eur)}`]]),
           P(`Rates: AED 1 ≈ ₺${r} · €1 ≈ ₺${e}. You can change the AED rate in More → Settings. Always pay in lira.`, { muted: true })],
           suggestions: ['Budget', 'How much have we spent?'] };
}

function budgetAnswer(ctx) {
  const C = ctx.content, M = C.money, B = M.budgetCheck;
  const blocks = [
    CALL(`${B.title} ${B.answer}`, 'ok'),
    H('Planned spending by day (for two)'),
    TABLE(['Date', 'Plan', 'Food', 'Taxi', 'Tickets', 'Total ₺', 'AED'], M.variable.map(r => [r.date, r.plan, r.food, r.taxi, r.tickets, r.totalTry, r.totalAed]), { size: 8 }),
    { t: 'total', label: M.plannedTotal.label, value: `₺${fmt(M.plannedTotal.try_[0])}–${fmt(M.plannedTotal.try_[1])} ≈ AED ${fmt(M.plannedTotal.aed[0])}–${fmt(M.plannedTotal.aed[1])}` },
    H(B.heading || 'Budget check'), TABLE(['', 'AED'], B.rows.map(r => [r.label, r.aed]), { boldLast: true, columns: { 1: { halign: 'right', cellWidth: 40 } } }),
    L(B.risks),
    H('Already paid'), TABLE(['Booking', 'AED'], M.settled.map(s => [s.label, s.aed ? fmt(s.aed) : (s.note || '—')]), { columns: { 1: { halign: 'right', cellWidth: 34 } } }),
    { t: 'total', label: 'Paid bookings', value: `AED ${fmt(M.settledTotalAed)}` },
    ...(M.spendPlan ? [{ t: 'total', label: 'Spending plan (not yet paid)', value: `≈ AED ${fmt(M.spendPlan.aed[0])}–${fmt(M.spendPlan.aed[1])}` }] : []),
    { t: 'total', label: M.tripTotal.label, value: `≈ AED ${fmt(M.tripTotal.aed[0])}–${fmt(M.tripTotal.aed[1])}` },
    P(`${M.rates.note} Plan figures use the planning rate AED 1 ≈ ₺${M.rates.tryPerAed}${+ctx.rate !== +M.rates.tryPerAed ? `; your logged expenses use your rate ₺${ctx.rate}` : ''}. €1 ≈ ₺${M.rates.tryPerEur}.`, { muted: true }),
  ];
  const sp = spentSummary(ctx);
  if (sp.count) blocks.splice(1, 0, CALL(`Logged so far: ${sp.count} expense${sp.count === 1 ? '' : 's'} ≈ AED ${fmt(sp.aed)} (₺${fmt(sp.try)} + AED ${fmt(sp.aedDirect)}).`, 'sea'));
  return { title: 'Budget', blocks, actions: [{ act: 'pdf', label: 'Download PDF', icon: 'download' }, { act: 'tab', tab: 'money', label: 'Open Money', icon: 'wallet' }],
           pdf: { title: `Budget · ${C.meta.title}`, subtitle: 'Planned spending, paid bookings and the budget check', blocks, filename: `${filePrefix(ctx)}-budget.pdf` },
           suggestions: ['How much have we spent?', 'Where do we eat tomorrow?', '2,500 TL in AED'] };
}

function spentSummary(ctx) {
  const ex = ctx.expenses || [], rate = ctx.rate;
  let tr = 0, ae = 0; for (const e of ex) { if (e.cur === 'TRY') tr += +e.amount; else ae += +e.amount; }
  return { count: ex.length, try: tr, aedDirect: ae, aed: tr / rate + ae };
}
function spentAnswer(ctx, date = null) {
  const all = (ctx.expenses || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  if (date) {
    const day = all.filter(e => e.date === date), sp = spentSummary({ ...ctx, expenses: day });
    const d = ctx.content.days.find(x => x.date === date);
    const blocks = [CALL(day.length ? `${dateLabel(date)}: ≈ AED ${fmt(sp.aed)} logged (₺${fmt(sp.try)} + AED ${fmt(sp.aedDirect)}).` : `Nothing logged for ${dateLabel(date)} yet.`, 'sea'),
      ...(day.length ? [TABLE(['Category', 'Note', 'Amount'], day.map(e => [e.cat, e.note || '', `${e.cur === 'TRY' ? '₺' : 'AED '}${fmt(e.amount)}`]), { columns: { 2: { halign: 'right' } } })] : []),
      ...(d?.total ? [P(`The plan for that day: ${d.total}.`, { muted: true })] : [])];
    return { title: `Spent on ${dateLabel(date)}`, blocks, actions: [{ act: 'tab', tab: 'money', label: 'Open Money', icon: 'wallet' }], suggestions: ['How much have we spent?', 'Budget'] };
  }
  const ex = all, sp = spentSummary(ctx);
  if (!ex.length) return { title: 'Nothing logged yet', blocks: [P('Log what you spend in More → Money (amount, category, note). I will add it up here and compare it with the plan.')], actions: [{ act: 'tab', tab: 'money', label: 'Open Money', icon: 'wallet' }] };
  const byCat = {}; for (const e of ex) byCat[e.cat] = (byCat[e.cat] || 0) + (e.cur === 'TRY' ? e.amount / ctx.rate : +e.amount);
  const blocks = [CALL(`Total so far ≈ AED ${fmt(sp.aed)} (₺${fmt(sp.try)} + AED ${fmt(sp.aedDirect)}).`, 'sea'),
    H('By category'), TABLE(['Category', 'AED'], Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, fmt(v)]), { columns: { 1: { halign: 'right', cellWidth: 34 } } }),
    H('Every expense'), TABLE(['Date', 'Category', 'Note', 'Amount'], ex.map(e => [dateLabel(e.date), e.cat, e.note || '', `${e.cur === 'TRY' ? '₺' : 'AED '}${fmt(e.amount)}`]), { size: 9, columns: { 3: { halign: 'right' } } })];
  return { title: `Spent so far ≈ AED ${fmt(sp.aed)}`, blocks, actions: [{ act: 'pdf', label: 'Download PDF', icon: 'download' }, { act: 'tab', tab: 'money', label: 'Open Money', icon: 'wallet' }],
           pdf: { title: 'Expenses so far', subtitle: 'Logged on this phone', blocks, filename: `${filePrefix(ctx)}-expenses.pdf` }, suggestions: ['Budget'] };
}

function transportAnswer(q, date0, ctx) {
  const T = ctx.content.transport, cardT = T.cardTitle || 'transport card';
  // a lost transport card: buy a new one; until then the bank card works
  if (/(^|\s)(lost|lose|losing|stolen|missing|ضاع|ضاعت|ضيعنا|ضيعت|فقدنا)(\s|$)/.test(q) && /(istanbulkart|kart|card|كرت|بطاقه)/.test(q)) {
    const amt = (/₺[\d,.]+/.exec(T.card.find(x => /^buy/i.test(x)) || '') || [])[0], bank = T.card.find(x => /contactless|bank card/i.test(x));
    return { title: `Lost the ${cardT}?`, blocks: [H(cardT), L(T.card)],
             quick: `Buy a new ${cardT} at a pier or metro ticket machine and load it again${amt ? ` (the plan loads ${amt})` : ''}. The balance on an unregistered card cannot be recovered.${bank ? ` Until then: ${bank.charAt(0).toLowerCase()}${bank.slice(1)}` : ''}`,
             actions: [{ act: 'tab', tab: 'transport', label: 'Getting around', icon: 'ferry' }], suggestions: ['Ferry times tomorrow', 'Taxi rules'] };
  }
  const boatQ = /(ferry|ferries|boat|boats|vapur|عباره|مركب|فيري)/.test(q);
  const backQ = /(^|\s)(back|return|returning|home|رجوع|عوده|نرجع|راجعين)(\s|$)/.test(q) && boatQ;
  const nextQ = /(^|\s)(next|التالي|الجاي|الجايه)(\s|$)/.test(q) && boatQ && !!ctx.todayInTrip;   // "next ferry": today's next boat in the plan
  const tagOf = (iso) => `${+iso.slice(8)} ${MON[+iso.slice(5, 7) - 1]}`;
  const lastToday = /(^|\s)last(\s|$)/.test(q) && boatQ && !!ctx.todayInTrip && T.ferries.some(f => f.used === tagOf(ctx.todayInTrip) && (f.back || []).length);
  const date = date0 || (backQ || nextQ || lastToday ? ctx.todayInTrip : null);
  let fs = T.ferries;
  if (date) { const tag = `${+date.slice(8)} ${MON[+date.slice(5, 7) - 1]}`; const f2 = fs.filter(f => f.used === tag); if (f2.length) fs = f2; }
  const words = q.split(' ').filter(w => w.length > 3 && !STOP.has(w) && !['ferry', 'ferries', 'boat', 'boats', 'times', 'timetable', 'pier', 'taxi', 'taxis', 'back', 'return', 'returning', 'home', 'last', 'first'].includes(w));
  const byPlace = fs.filter(f => words.some(w => norm(`${f.line} ${f.from_} ${f.to} ${(f.times || []).join(' ')}`).includes(w)));
  if (byPlace.length) fs = byPlace;
  const named = T.ferries.filter(f => aliasScore(q, f.aliases) > 0);
  if (named.length) fs = named;
  const onlyTaxi = /(^|\s)(taxi|taxis|bitaksi|uber|meter|تاكسي)(\s|$)/.test(q) && !/(ferry|boat|vapur|pier|istanbulkart|card)/.test(q);
  const blocks = [];
  if (!onlyTaxi) for (const f of fs) {
    blocks.push(H(f.line));
    blocks.push(KV([['Used on', f.used], ['From → to', `${f.from_} → ${f.to}`], ['Fare', f.fare]].filter(r => r[1])));
    if (f.times?.length) blocks.push(L(f.times.map(t => 'Out: ' + t)));
    if (f.back?.length) blocks.push(L(f.back.map(t => 'Back: ' + t)));
    if (f.note) blocks.push(P(f.note, { muted: true }));
  }
  blocks.push(H('Taxis')); blocks.push(L(T.taxi));
  if (!onlyTaxi) { blocks.push(H(T.cardTitle || 'Transport card')); blocks.push(L(T.card)); }
  const title = onlyTaxi ? 'Taxis' : date ? `Getting around · ${dateLabel(date)}` : fs.length === 1 ? fs[0].line : `Ferries, taxis & ${T.cardTitle || 'transport card'}`;
  // "last boat back from X": the last time in the app's list for the matching line
  const lastF = /(^|\s)last(\s|$)/.test(q) && !onlyTaxi ? fs.find(f => (f.back || []).length) : null;
  const askPrice = /(^|\s)(price|prices|fare|fares|cost|costs|how much)(\s|$)/.test(q);
  // "ferry back": the boats back on that day's lines, and how the day's plan actually ends
  let backLine = null;
  if (backQ) {
    const d = date && ctx.content.days.find(x => x.date === date), last = d?.trips?.[d.trips.length - 1];
    const backs = fs.filter(f => (f.back || []).length && (!date || f.used === `${+date.slice(8)} ${MON[+date.slice(5, 7) - 1]}`));
    const parts = [];
    if (last && /taxi_home|shuttle/.test(last.mode)) parts.push(`${date === ctx.today ? 'Today' : dateLabel(date)} has no ferry back in the plan: the day ends by ${last.mode === 'shuttle' ? 'the paid shuttle' : 'taxi'}, ${last.label}${last.time ? ' at about ' + last.time : ''}.`);
    if (backs.length) parts.push(`${parts.length ? 'A boat back is possible' : 'Boats back'}: ${backs.map(f => `${f.line}: ${f.back.join(' · ')}`).join(' — ')}.`);
    else if (!parts.length) parts.push('No boat back is listed for that day. Check the Şehir Hatları app or call 153.');
    backLine = parts.join(' ');
  }
  let nextLine = null;
  if (nextQ && date === ctx.today) {
    const d = ctx.content.days.find(x => x.date === date), up = (d?.trips || []).filter(t => t.mode === 'ferry' && (tripMinutes(t) ?? -1) >= (ctx.nowMin ?? 0) - 5);
    nextLine = up.length ? `Your next boat today: ${up[0].time} · ${up[0].label}${up[0].dur ? ' · ' + up[0].dur : ''}.${up[1] ? ` Then ${up[1].time} · ${up[1].label}.` : ''}`
      : `No more boats in today’s plan${(d?.trips || []).some(t => t.mode === 'ferry') ? '' : ' (today has no ferry)'}. The lines and times below are the ones the app knows.`;
  }
  const quick = backLine ? backLine : nextLine ? nextLine
    : lastF ? `Last boat in the app's list for ${lastF.line}: ${lastF.back[lastF.back.length - 1]}. Later boats may run; check the Şehir Hatları app or call 153.`
    : askPrice && onlyTaxi ? T.taxi[0]
    : askPrice ? `${fs.slice(0, 3).map(f => `${f.line}: ${f.fare}`).join(' · ')}. Pay with the ${T.cardTitle || 'transport card'}.` : null;
  return { title, blocks, quick, actions: [{ act: 'pdf', label: 'Download PDF', icon: 'download' }, { act: 'tab', tab: 'transport', label: 'Getting around', icon: 'ferry' }],
           pdf: { title, subtitle: T.timetableNote || 'Check departures the night before', blocks, filename: `${filePrefix(ctx)}-${onlyTaxi ? 'taxis' : 'ferries'}${date ? '-' + monTag(date) : ''}.pdf` },
           suggestions: ['Hotel address for the driver', 'Plan for tomorrow', 'Emergency numbers'] };
}

function phrasesAnswer(raw, ctx) {
  const P2 = ctx.content.phrases;
  const m = norm(raw).match(/(?:how (?:do i|do you|to|can i|do we) say|translate|in turkish|what is)\s+(.+)/);
  let list = P2;
  if (m) {
    const want = m[1].replace(/\b(in turkish|turkish|please|for me)\b/g, ' ').replace(/\s+/g, ' ').trim();
    const exact = want ? P2.filter(p => norm(p.en).includes(want)) : [];
    const loose = P2.filter(p => want.split(' ').some(w => w.length > 3 && norm(p.en).includes(w)));
    if (exact.length) list = exact; else if (loose.length) list = loose;
  }
  const full = list === P2;
  const blocks = [TABLE(['Turkish', 'Say it like', 'Meaning'], list.map(p => [p.tr, p.say, p.en]), { columns: { 0: { fontStyle: 'bold' } } })];
  const pdfBlocks = blocks.slice();
  if (full) { pdfBlocks.push({ t: 'pagebreak' }); pdfBlocks.push(H('Show the driver')); ctx.content.driverCards.forEach((c, i) => { if (i) pdfBlocks.push({ t: 'space', h: 4 }); pdfBlocks.push({ t: 'h3', text: c.title }); pdfBlocks.push({ t: 'big', text: c.tr, size: 17 }); }); }
  return { title: full ? 'Turkish phrases' : `“${list[0].en}” in Turkish`, blocks, phrases: list.map(p => P2.indexOf(p)),
           actions: [{ act: 'pdf', label: 'Download PDF', icon: 'download' }, { act: 'tab', tab: 'phrases', label: 'All phrases', icon: 'languages' }],
           pdf: { title: 'Turkish phrases & driver cards', subtitle: 'Show these to taxi drivers, waiters and shisha bars', blocks: pdfBlocks, filename: `${filePrefix(ctx)}-phrases.pdf` } };
}

function emergencyAnswer(ctx, q = '') {
  const E = ctx.content.emergency, hs = ctx.content.bookings.filter(b => b.kind === 'hotel' && !['to-cancel', 'cancelled'].includes(b.status));
  const I = ctx.content.insurance, digits = (x) => String(x || '').replace(/\D/g, '');
  // the insurer's numbers may already be rows of the list: then only the policy numbers are added
  const listed = I && E.some(e => digits(e.number) && digits(e.number) === digits(I.hotline?.call));
  const insBlocks = !I ? [] : listed ? [H('Travel insurance · policy numbers'), KV((I.policies || []).map(p => [p.who, p.policyNo]))]
    : [H(`Travel insurance · ${insShort(I)} 24 h`), KV(insNumbers(I)), P(cap(String(I.firstSteps?.[1] || I.hotline?.note || '').replace(/^then\s+/i, '')), { muted: true })];
  const blocks = [CALL('112 is the one number for police, ambulance and fire. It is free from any phone.', 'red'),
    TABLE(['Who', 'Number', 'Note'], E.map(e => [e.label, e.number || '—', e.note || '']), { columns: { 0: { cellWidth: 46 }, 1: { cellWidth: 34 } } }), ...insBlocks,
    H('Your hotels'), TABLE(['Hotel', 'Address', 'Phone'], hs.map(h => [h.title, h.address || '', h.phone || '']), { columns: { 0: { cellWidth: 46 }, 2: { cellWidth: 34 } } })];
  // "nearest pharmacy", "flydubai number": the row it names
  const row = q && E.find(e => !/insurance/i.test(e.label) && norm(e.label).split(' ').some(w => w.length >= 5 && !['emergencies', 'police', 'ambulance', 'service', 'customer', 'hours'].includes(w) && has(q, [w])));
  return { title: 'Emergency & contacts', blocks, quick: row ? `${row.label}: ${[row.number, row.note].filter(Boolean).join(' · ')}` : null,
           actions: [{ act: 'url', href: 'tel:112', label: 'Call 112', icon: 'phone' }, ...(I ? insActions(I).slice(0, 2) : []),
                     ...(row?.number && digits(row.number).length > 3 ? [{ act: 'url', href: telOf(row.number), label: `Call ${row.label.split(' (')[0].split(' · ')[0]}`, icon: 'phone' }] : []), { act: 'pdf', label: 'Download PDF', icon: 'download' }],
           suggestions: I ? ['What does our insurance cover?', 'Insurance as PDF'] : [],
           pdf: { title: 'Emergency & contacts', subtitle: 'Keep a copy on the phone', blocks, filename: `${filePrefix(ctx)}-emergency.pdf` } };
}

function todoAnswer(ctx, q = '') {
  const C = ctx.content;
  const byDue = (a, b) => (a.due || '').localeCompare(b.due || '') || (a.time || '12:00').localeCompare(b.time || '12:00');
  const all = C.todos.map(t => ({ ...t, st: tState(t, ctx) }));
  const doneN = all.filter(t => t.st === 'done').length;
  let open = all.filter(t => t.st !== 'done' && t.st !== 'missed').sort(byDue), scope = '';
  const missed = all.filter(t => t.st === 'missed');
  // narrow the list when the question says what it is about
  const words = q.split(' ').filter(w => w.length >= 4 && !STOP.has(w) && !['todo', 'list', 'checklist', 'need', 'still', 'tasks', 'what'].includes(w));
  const namedAll = all.filter(t => words.some(w => norm(`${t.title} ${t.note || ''}`).includes(w)));
  if (/(^|\s)(book|reserve|reservations?|booking)(\s|$)/.test(q)) { open = open.filter(t => t.kind === 'book'); scope = 'Bookings to make'; }
  else if (/before (we )?(fly|flying|leave|leaving|the trip|departure|travel)/.test(q)) { const lim = C.meta.tripStart || C.days[0].date; open = open.filter(t => t.due <= lim); scope = 'Before you fly'; }
  else if (namedAll.length && namedAll.length < C.todos.length / 2) {
    // a specific to-do (visa, eSIM, deposit, check-in…): say whether it is done
    const tone = { done: 'ok', missed: 'sea', overdue: 'red', now: 'red' };
    const blocks = namedAll.map(t => CALL(`${t.title} — ${t.st === 'done' ? 'ticked as done ✓' : tNote(t, ctx, t.st)}.${t.note ? ' ' + t.note : ''}`, tone[t.st] || (t.urgent ? 'red' : 'gold')));
    return { title: namedAll.length === 1 ? namedAll[0].title : 'Matching to-dos', blocks,
             actions: [{ act: 'tab', tab: 'todos', label: 'Open the checklist', icon: 'calcheck' }], suggestions: ['To-do list', 'What do we still need to book?'] };
  }
  const groups = [['Do it now', open.filter(t => t.st === 'now')], ['Overdue', open.filter(t => t.st === 'overdue')], ['Next 3 days', open.filter(t => t.st === 'soon')], ['Later', open.filter(t => t.st === 'later')]].filter(g => g[1].length);
  const row = (t) => [(t.due ? dateLabel(t.due) : '') + (t.time ? ' ' + t.time : ''), (t.urgent ? 'URGENT · ' : '') + t.title, [t.st === 'now' ? tNote(t, ctx, t.st) : '', t.note || ''].filter(Boolean).join(' · ')];
  const blocks = [P(`${open.length} open${scope ? '' : ` · ${doneN} done`}.`)];
  for (const [label, list] of groups) { blocks.push(H(label)); blocks.push(TABLE(['Due', 'What', 'Note'], list.map(row), { columns: { 0: { cellWidth: 26 } } })); }
  if (!open.length) blocks.push(P('Nothing open here. Well done!'));
  if (missed.length && !scope) blocks.push(P(`${missed.length} past item${missed.length === 1 ? ' is' : 's are'} no longer needed (the moment has passed): under Past in the checklist.`, { muted: true }));
  const urgent = open.filter(t => t.urgent);
  if (urgent.length) blocks.unshift(CALL(urgent.map(t => `${t.title}: by ${dateLabel(t.due)}${t.time ? ' ' + t.time : ''}.`).join(' '), 'red'));
  return { title: scope || 'To-do list', blocks, actions: [{ act: 'pdf', label: 'Download PDF', icon: 'download' }, { act: 'tab', tab: 'todos', label: 'Open the checklist', icon: 'calcheck' }],
           pdf: { title: scope || 'To-do list', subtitle: 'Bookings, check-ins and reminders', blocks, filename: `${filePrefix(ctx)}-todo.pdf` } };
}

function tipsAnswer(q, ctx) {
  const S = ctx.content.tips.sections;
  let pick = S;
  const map = { mosque: /(mosque|dress|wear|headscarf|prayer|جامع|مسجد)/, fish: /(fish|kilo)/, shisha: /(shisha|hookah|nargile)/, bills: /(bill|service|tip|cash|card|scam)/,
                weather: /(weather|sunset|cold|rain|time zone|timezone|time difference|غروب|طقس)/, taxi: /(taxi)/, ferry: /(ferry|istanbulkart)/ };
  for (const [id, re] of Object.entries(map)) if (re.test(q)) { const f = S.filter(s => s.id === id); if (f.length) { pick = f; break; } }
  const blocks = []; for (const s of pick) { blocks.push(H(s.title)); blocks.push(L(s.items)); }
  if (/(sunset|غروب)/.test(q)) blocks.unshift(TABLE(['Day', 'Sunset'], ctx.content.days.map(d => [`${dateLabel(d.date)} · ${d.city}`, d.sunset])));
  const one = pick.length === 1 ? pick[0] : null;
  return { title: one ? one.title : 'Tips & rules', blocks, actions: [{ act: 'pdf', label: 'Download PDF', icon: 'download' }],
           pdf: { title: one ? one.title : 'Tips & rules', subtitle: ctx.content.meta.title, blocks, filename: `${filePrefix(ctx)}-tips${one ? '-' + one.id : ''}.pdf` } };
}

function simAnswer(ctx) {
  const s = ctx.content.sim; const blocks = [L(s.items)];
  return { title: s.title, blocks, actions: [{ act: 'pdf', label: 'Download PDF', icon: 'download' }], pdf: { title: s.title, subtitle: 'Data for two phones', blocks, filename: `${filePrefix(ctx)}-sim.pdf` } };
}

function docsAnswer(ctx) {
  const F = ctx.content.files.filter(f => f.group !== 'maps'), U = userDocs(ctx);
  const ins = F.filter(f => f.group === 'insurance'), rest = F.filter(f => f.group !== 'insurance');   // the insurance certificates always get a button
  const act = (f) => ({ act: 'doc', id: f.id, label: f.title.replace(' (PDF)', ''), icon: f.group === 'insurance' ? 'shield' : 'filetext' });
  const blocks = [P('Your documents. Tap one to open it, then save or share it.'), ...(U.length ? [H('Added by you'), L(U.map(udocDayLine))] : []),
    ...(ins.length ? [H('Travel insurance'), L(ins.map(f => f.title))] : []), H('Trip documents'), L(rest.map(f => f.title))];
  return { title: 'Your documents', blocks, actions: [...U.slice(0, 3).map(udocAct), ...ins.slice(0, 2).map(act), ...rest.slice(0, Math.max(2, 6 - Math.min(3, U.length) - Math.min(2, ins.length))).map(act)]
    .concat([{ act: 'tab', tab: 'docs', label: 'All documents', icon: 'ticket' }]) };
}

/* ───────────── documents the user added on the phone ───────────── */
const UKIND = { flight: 'Flight ticket', hotel: 'Hotel booking', transfer: 'Transfer', tour: 'Tour', museum: 'Museum / sight ticket', event: 'Event ticket', restaurant: 'Restaurant booking',
  transport: 'Transport ticket', receipt: 'Receipt', insurance: 'Insurance', id: 'ID document', other: 'Document' };
const TICKETS = new Set(['flight', 'tour', 'museum', 'event', 'transport', 'transfer']);
const userDocs = (ctx) => (ctx.userDocs || []).filter(u => u && u.id);
const udocAct = (u) => ({ act: 'doc', id: 'u:' + u.id, label: (u.title || UKIND[u.kind] || 'Document').slice(0, 40), icon: TICKETS.has(u.kind) ? 'ticket' : 'filetext' });
const udocLine = (u, withRef = true) => [u.title || UKIND[u.kind] || 'Document', u.title && UKIND[u.kind] ? UKIND[u.kind] : '', u.time, u.place, withRef && u.ref && `ref ${u.ref}`].filter(Boolean).join(' · ');
const udocDayLine = (u) => `${u.dayIso ? dateLabel(u.dayIso) + (u.tripN != null ? ` · trip ${u.tripN}` : '') + ': ' : ''}${udocLine(u)}`;
// how well a question names a user document: its reference (strong), title, place or kind
function matchUserDocs(q, q2, ctx) {
  const U = userDocs(ctx); if (!U.length) return [];
  const words = [...new Set([...q.split(' '), ...q2.split(' ')])].filter(w => w.length >= 3 && !STOP.has(w) && !GENERIC.has(w) && !['ticket', 'tickets', 'document', 'documents', 'file', 'booking', 'my', 'our'].includes(w));
  return U.map(u => {
    const hay = norm(`${u.title || ''} ${u.place || ''} ${UKIND[u.kind] || ''} ${u.summary || ''}`), ref = norm(u.ref || '');
    const sc = (ref.length >= 4 && words.includes(ref) ? 3 : 0) + words.filter(w => new RegExp(`(^|\\s)${reEsc(w)}`).test(hay)).length;
    return { u, sc };
  }).filter(x => x.sc > 0).sort((a, b) => b.sc - a.sc);
}
function myDocsAnswer(q, hits, ctx) {
  const C = ctx.content, all = userDocs(ctx), tick = /(ticket|tickets|تذاكر|تذكره|تذاكري|تذاكرنا)/.test(q);
  const strong = (hits || []).filter(h => h.sc === hits[0].sc);   // only passed when the question names a document
  let list = strong.length ? strong.map(h => h.u) : tick ? all.filter(u => TICKETS.has(u.kind)) : all;
  const fl = tick ? C.bookings.filter(b => b.kind === 'flight' && b.file) : [];
  const acts = [...list.slice(0, 6).map(udocAct), ...fl.map(b => ({ act: 'doc', id: b.file, label: `Ticket: ${b.title}`, icon: 'ticket' })), { act: 'tab', tab: 'docs', label: 'All documents', icon: 'ticket' }];
  if (!list.length) {
    return { title: tick ? 'Your tickets' : 'No documents added yet',
             blocks: [P(`${tick && all.length ? 'None of the documents you added is a ticket.' : 'You have not added any documents on this phone yet.'} In Docs, tap Add and pick a PDF, a photo or a screenshot of a ticket, booking or receipt: I read it, file it on the right day and it shows up here.`),
                      ...(fl.length ? [P('Your flight tickets are already in the app:'), L(fl.map(b => `${b.title} · ${b.dates}`))] : [])],
             actions: acts, suggestions: ['Documents', 'My flights'] };
  }
  list = list.slice().sort((a, b) => (a.dayIso || '9').localeCompare(b.dayIso || '9') || (a.time || '').localeCompare(b.time || ''));
  const one = strong.length === 1 ? list[0] : null;
  const blocks = one ? [KV([['What', UKIND[one.kind] || 'Document'], ['Day', one.dayIso ? dateLabel(one.dayIso) + (one.tripN != null ? ` · trip ${one.tripN}` : '') : 'Not filed on a day'],
                            ['Date', one.date ? dateLabel(one.date) + (one.time ? ' ' + one.time : '') : ''], ['Place', one.place || ''], ['Reference', one.ref || ''], ['Booking', one.bookingId || '']].filter(r => r[1])),
                         ...(one.summary ? [P(one.summary)] : []), ...(one.notes?.length ? [L(one.notes)] : [])]
    : [P(`${list.length} document${list.length === 1 ? '' : 's'} you added${tick ? ' (tickets)' : ''}. Tap one to open it.`), TABLE(['Day', 'Document', 'Ref'], list.map(u => [u.dayIso ? dateLabel(u.dayIso) + (u.tripN != null ? ` · trip ${u.tripN}` : '') : '—', udocLine(u, false), u.ref || '']))];
  return { title: one ? one.title || UKIND[one.kind] : tick ? 'Your tickets' : 'Documents you added', blocks, actions: one ? acts : [...acts, { act: 'pdf', label: 'Download PDF', icon: 'download' }],
           pdf: one ? null : { title: 'Documents you added', subtitle: C.meta.title, blocks, filename: `${filePrefix(ctx)}-my-documents.pdf` }, suggestions: ['Documents', 'What’s next?'] };
}

function topicAnswer(tp, ctx) {
  const d = ctx.content.days.find(x => x.date === tp.day);
  const intro = tp.intro || [];
  const blocks = d ? [...intro, { t: 'space', h: 4 }, H(`${dateLabel(d.date)} · ${d.title}`), ...dayBlocks(d, ctx)] : intro;
  return { title: tp.title, blocks: intro,
           actions: [{ act: 'pdf', label: 'Download PDF', icon: 'download' }, ...(d ? [{ act: 'day', date: d.date, label: `Open ${dateLabel(d.date)}`, icon: 'days' }] : [])],
           pdf: { title: tp.pdfTitle || tp.title, subtitle: tp.pdfSubtitle || '', blocks, filename: tp.filename || `${filePrefix(ctx)}-${slug(tp.title)}.pdf` },
           suggestions: tp.suggestions || [] };
}

/* ───────────── travel insurance (content.insurance) ───────────── */
const INS_WORDS = ['insurance', 'insured', 'insure', 'insurer', 'policy', 'policies', 'policy number', 'claim', 'claims', 'reimburse', 'reimbursed', 'reimbursement', 'certificate', 'certificates',
  'تامين', 'تامينات', 'بوليصه', 'تعويض', 'شركه تامين'];
const COVER_WORDS = ['cover', 'covered', 'covers', 'coverage', 'is it covered', 'are we covered', 'مغطي', 'يغطي', 'تغطيه', 'يشمل', 'يعوض'];
const LIFE = ['unconscious', 'not conscious', 'not breathing', 'isnt breathing', 'stopped breathing', 'cant breathe', 'cannot breathe', 'can not breathe', 'not responding', 'unresponsive',
  'chest pain', 'heart attack', 'stroke', 'seizure', 'heavy bleeding', 'bleeding heavily', 'severe bleeding', 'lots of blood', 'collapsed', 'passed out', 'fainted', 'overdose', 'drowning', 'choking',
  'anaphylaxis', 'anaphylactic', 'فاقد الوعي', 'فقد الوعي', 'مغمي عليه', 'مغمي عليها', 'اغمي عليه', 'اغمي عليها', 'اغماء', 'لا يتنفس', 'لا تتنفس', 'ما يتنفس', 'ما تتنفس', 'مش بيتنفس',
  'الم في صدر', 'الم صدر', 'الم بالصدر', 'نزيف شديد', 'نزيف قوي', 'جلطه', 'سكته', 'نوبه قلبيه', 'غرق', 'يغرق', 'اختناق', 'تشنج', 'تشنجات'];
// someone is telling what happened (a subject or an incident verb), vs. an information question
const CUE = ['i', 'im', 'ive', 'we', 'were', 'weve', 'me', 'my', 'our', 'us', 'he', 'she', 'his', 'her', 'him', 'they', 'someone', 'somebody', 'wife', 'husband', 'son', 'daughter', 'kid', 'baby', 'friend',
  'what if', 'what happens if', 'عندي', 'عنده', 'عندها', 'عندنا', 'انا', 'احنا', 'نحن', 'ابني', 'ابنتي', 'بنتي', 'ولدي', 'زوجتي', 'زوجي', 'مرتي', 'جوزي', 'اختي', 'اخوي', 'اخي', 'امي', 'ابوي',
  'صار', 'صارت', 'حصل', 'حصلت', 'تعبان', 'تعبانه', 'تعبت', 'اذا', 'لو'];
const INFOQ = /(^|\s)(how much|how many|where|nearest|closest|number|address|what time|open|price|cost|allowance|allowed|can we take|kg|وين|فين|اين|اقرب|رقم|سعر|متي)(\s|$)/;
// words that alone are too common to mean an incident (they need someone telling what happened)
const INS_WEAK = new Set(['doctor', 'hospital', 'clinic', 'pharmacy', 'medicine', 'cold', 'stomach', 'ambulance', 'er', 'operation', 'luggage', 'baggage', 'suitcase', 'passport', 'delay', 'delayed',
  'horse', 'diving', 'snorkel', 'scooter', 'motorbike', 'motorcycle', 'helicopter', 'alcohol', 'storm', 'flood', 'glasses', 'lens', 'lenses', 'stress', 'attack', 'protest', 'damage', 'damaged',
  'scratched', 'spilled', 'broke', 'broken', 'allergy', 'allergic', 'tooth', 'teeth', 'filling', 'crown', 'asthma', 'diabetes', 'bite', 'cut', 'burn', 'burned', 'hurt', 'fall', 'cough', 'headache',
  'دكتور', 'طبيب', 'مستشفي', 'صيدليه', 'دواء', 'اسعاف', 'طوارئ', 'شنطه', 'حقيبه', 'عفش', 'جواز', 'جوال', 'موبايل', 'تلفون', 'محفظه', 'فلوس', 'سكر', 'ضغط', 'قلب', 'حمل', 'سن', 'بطن', 'معده',
  'حصان', 'خيل', 'موتر', 'تاخير', 'الغاء', 'عمليه', 'حساسيه', 'ضرر', 'تلف', 'صداع', 'نظاره', 'نظارات', 'عدسات', 'عدسه', 'قلق', 'توتر', 'عاصفه', 'كحول', 'اسنان'].map(norm));
// verbs weigh less than the thing they happened to ("broke my glasses" is about glasses)
const INS_ACTION = new Set(['fell', 'fall', 'fallen', 'slipped', 'twisted', 'broke', 'broken', 'cut', 'burn', 'burned', 'hurt', 'crash', 'bitten', 'bite', 'stolen', 'stole', 'robbed', 'damaged',
  'damage', 'scratched', 'spilled', 'delay', 'delayed', 'وقعت', 'وقع', 'سقطت', 'انكسر', 'كسر', 'لويت', 'سرق', 'انسرق', 'انسرقت', 'ضاع', 'ضاعت', 'ضيعت', 'كسرت', 'خربت', 'اتلفت'].map(norm));
const AR = /[؀-ۿ]/;
// Arabic keywords also match with a prefix (و ف ب ل ال) and a pronoun/feminine ending: وانكسرت = انكسر (short words: no ending)
const AR_PRE = '(?:و|ف|ب|ل|وال|بال|فال|لل|ال)?', AR_SUF = '(?:ت|ه|ها|ي|نا|وا|ين|ات|ني|هم|كم|تي|ته|تها)?';
const kwRe = (w, exact = false) => AR.test(w) ? new RegExp(`(^|\\s)${AR_PRE}${reEsc(w)}${exact || w.length <= 2 ? '' : AR_SUF}(?=\\s|$)`)
  : new RegExp(`(^|\\s)${reEsc(w)}${exact ? '' : '(?:s|es)?'}(?=\\s|$)`);
const KW = new WeakMap();
function insKeywords(I) {
  if (!KW.has(I)) KW.set(I, (I.scenarios || []).map(s => ({ s, kws: [...new Set((s.keywords || []).map(norm).filter(Boolean))].map(w => ({ w, multi: w.includes(' '), re: kwRe(w), ex: kwRe(w, true) })) })));
  return KW.get(I);
}
const KWC = new Map();
const kwReC = (w) => { if (!KWC.has(w)) KWC.set(w, kwRe(norm(w))); return KWC.get(w); };
const anyKw = (q, list) => list.some(w => kwReC(w).test(q));
function insuranceMatch(q, ctx) {
  const I = ctx.content.insurance;
  const life = anyKw(q, LIFE);
  const words = (anyKw(q, INS_WORDS) && !/(cancellation|refund|hotel|booking|privacy) polic/.test(q)) || (!!I?.insurer && has(q, [insShort(I)]));   // or the insurer's name
  const cover = anyKw(q, COVER_WORDS) && !/(cover charge|kuver|(shoulders|knees|head|arms|hair|legs) (are |must be |should be |be )?covered|covered (shoulders|knees|head|arms))/.test(q);
  const cue = has(q, CUE) || ctx.content.meta?.travellers?.some(n => has(q, [n])), info = INFOQ.test(q);
  if (!I) return { life, words, cover, cue, info, best: null, second: null };
  // everyday ways to say "sick" ("زوجتي تعبانة", "Alaa is unwell")
  const qi = q.replace(/(^|\s)(not feeling well|not well|unwell|feeling unwell|feels unwell)(?=\s|$)/g, '$1sick').replace(/(^|\s)(تعبان|تعبانه|تعبانين|مريضه)(?=\s|$)/g, '$1مريض');
  const scored = insKeywords(I).map(({ s, kws }) => {
    let strong = 0, weak = 0;
    for (const k of kws) if (k.re.test(qi)) {   // the exact word form beats a stem match by a hair (كسرت كاس = damage, not a fracture)
      const w = (k.multi ? 2 : INS_ACTION.has(k.w) ? 0.5 : 1) + (k.ex.test(qi) ? 0.1 : 0);
      if (!k.multi && INS_WEAK.has(k.w)) weak += w; else strong += w;
    }
    return { s, strong, weak, score: strong + weak };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score || b.strong - a.strong);
  return { life, words, cover, cue, info, best: scored[0] || null, second: scored[1] || null };
}
const VERDICT = { covered: { label: 'Covered', tone: 'ok' }, partly: { label: 'Partly covered', tone: 'gold' }, 'not-covered': { label: 'Not covered', tone: 'red' } };
const verdictOf = (s) => VERDICT[s.verdict] || { label: 'Ask the insurer', tone: 'gold' };
const telOf = (n) => `tel:${String(n).replace(/[^\d+]/g, '')}`, waOf = (n) => `https://wa.me/${String(n).replace(/[^\d]/g, '')}`;
const insShort = (I) => (I.insurer || 'Insurer').split(' ')[0];
function insNumbers(I) {
  return [...(I.policies || []).map(p => [p.who, p.policyNo]), [`${insShort(I)} 24 h`, I.hotline?.call || ''], ['WhatsApp', I.hotline?.whatsapp || '']].filter(r => r[1]);
}
function insActions(I, { life = false } = {}) {
  const n = insShort(I), hl = I.hotline || {};
  return [...(life ? [{ act: 'url', href: 'tel:112', label: 'Call 112', icon: 'phone' }] : []),
    ...(hl.call ? [{ act: 'url', href: telOf(hl.call), label: `Call ${n}`, icon: 'phone' }] : []), ...(hl.whatsapp ? [{ act: 'url', href: waOf(hl.whatsapp), label: `WhatsApp ${n}`, icon: 'msgcircle' }] : []),
    ...(I.policies || []).filter(p => p.file).map(p => ({ act: 'doc', id: p.file, label: `${p.who}’s certificate`, icon: 'shield' }))];
}
// cover runs only while you are in the country: say so before and after the trip
function insValidity(I, ctx) {
  const C = ctx.content, last = C.days[C.days.length - 1].date;
  if (ctx.today < (I.valid?.from || C.days[0].date)) return P(`Not active yet: ${I.valid?.note || `cover starts on ${dateLabel(I.valid.from)}.`}`, { muted: true });
  if (ctx.today > last) return P(I.valid?.note || 'Cover ended when you left the country.', { muted: true });
  return null;
}
function insuranceAnswer(ins, ctx, q = '') {
  const I = ctx.content.insurance;
  if (!I) return { title: 'Travel insurance', blocks: [P('Your travel-insurance details are not in the app yet. If you have the certificates, they are in Docs.'), CALL('In an emergency call 112: it is free from any phone.', 'red')],
                   actions: [{ act: 'url', href: 'tel:112', label: 'Call 112', icon: 'phone' }, { act: 'tab', tab: 'docs', label: 'Documents', icon: 'ticket' }], insurance: null };
  const pick =ins.best?.s || (ins.life ? I.scenarios?.find(s => (s.keywords || []).some(k => /ambulance/i.test(k))) || I.scenarios?.find(s => s.verdict === 'covered') : null);
  if (!pick) return insuranceOverview(ctx, q);
  const V = verdictOf(pick), n = insShort(I);
  const second = ins.second && ins.second.score >= 1 && ins.second.s !== pick ? ins.second.s : null;
  const blocks = [];
  if (ins.life) blocks.push(CALL(`Call 112 now: it is free and sends an ambulance. Then call ${n} on ${I.hotline?.call}.`, 'red', 'Life in danger'));
  // the callout label already says the verdict, so the answer text drops its own "Covered:" opening
  const bare = (s) => String(s || '').replace(/^(covered|partly|not covered)\b[^:]{0,24}:\s*/i, '').replace(/^./, c => c.toUpperCase());
  blocks.push(CALL(bare(pick.answer), V.tone, V.label));
  if (second) blocks.push(CALL(bare(second.answer), verdictOf(second).tone, `Also relevant · ${verdictOf(second).label}`));
  blocks.push(H('What to do now'), L(pick.steps || [], true));
  // the claim papers are medical: list them only for medical cases that are (partly) covered
  if (pick.verdict !== 'not-covered' && I.claimDocs?.length && /(doctor|hospital|medic|illness|injur|clinic|treatment|pandemic|epicrisis)/i.test(`${pick.answer} ${(pick.steps || []).join(' ')}`)) blocks.push(H('Keep for the claim'), L(I.claimDocs));
  blocks.push(H('Your policies'), KV(insNumbers(I)));
  const val = insValidity(I, ctx); if (val) blocks.push(val);
  if (!ins.life && I.firstSteps?.[0]) blocks.push(P(I.firstSteps[0], { muted: true }));
  blocks.push(P(I.disclaimer || 'The insurer decides each claim; when in doubt, call them before paying.', { muted: true }));
  const title = `${V.label}: ${pick.title.split(' (')[0]}`;
  return { title, blocks, insurance: { scenario: pick.id, verdict: pick.verdict, life: !!ins.life, also: second?.id || null },
           actions: [...insActions(I, { life: ins.life || (pick.steps || []).some(x => /112/.test(x)) }), { act: 'pdf', label: 'Download PDF', icon: 'download' }],
           pdf: { title, subtitle: `Travel insurance · ${I.insurer}`, blocks, filename: `${filePrefix(ctx)}-insurance-${slug(pick.id || pick.title)}.pdf` },
           suggestions: ['What does our insurance cover?', 'Emergency numbers', 'Insurance as PDF'] };
}
// whose policy a question names: a traveller's name or alias (the booking aliases only one of the two has)
function insWho(I, q, C) {
  const bk = (I.policies || []).map(p => C.bookings.find(b => b.id === p.bookingId)?.aliases || []);
  return (I.policies || []).find((p, i) => new RegExp(`(^|\\s)${reEsc(norm(p.who))}s?(?=\\s|$)`).test(q)
    || has(q, bk[i].filter(a => !bk.some((o, j) => j !== i && o.includes(a))))) || null;
}
// "insurance certificate", "where is the insurance pdf", "شهادة التأمين": the two certificates, not the whole cover
const INS_DOCQ = /(certificate|certificates|document|documents|docs|copy|copies|original|file|files|paper|papers|card|شهاده|شهادات|وثيقه|ملف|ملفات|مستند|ورقه|اوراق)/;
function insuranceDocs(ctx, q) {
  const C = ctx.content, I = C.insurance, n = insShort(I), hl = I.hotline || {}, who = insWho(I, q, C);
  const pols = (I.policies || []).filter(p => p.file), order = who ? [who, ...pols.filter(p => p !== who)] : pols;
  const blocks = [CALL(`${who ? `${who.who}’s certificate is` : 'Both certificates are'} in Docs → Travel insurance, saved on this phone (${who ? 'it opens' : 'they open'} offline). Tap below to open, save or share ${who ? 'it' : 'them'}.`, 'sea', 'Insurance certificates'),
    KV([...order.map(p => [p.who, `policy ${p.policyNo}`]), [`${n} 24 h`, hl.call || ''], ['WhatsApp', hl.whatsapp || '']].filter(r => r[1])),
    P(`At a clinic or hospital, show the certificate or give the policy number, and call ${n} first if you can.`, { muted: true }),
    P(I.disclaimer || '', { muted: true })];
  const docs = order.map(p => ({ act: 'doc', id: p.file, label: `${p.who}’s certificate`, icon: 'shield' }));
  return { title: who ? `${who.who}’s insurance certificate` : 'Insurance certificates', blocks, insurance: { scenario: null, verdict: null, life: false }, noAutoPdf: true,
           actions: [...docs, ...insActions(I).filter(a => a.act !== 'doc'), { act: 'tab', tab: 'docs', label: 'All documents', icon: 'ticket' }, { act: 'pdf', label: 'If something happens (PDF)', icon: 'download' }],
           pdf: insurancePdf(ctx), suggestions: ['What does our insurance cover?', 'Emergency numbers'] };
}
function insuranceOverview(ctx, q = '') {
  const I = ctx.content.insurance, n = insShort(I);
  if (INS_DOCQ.test(q) || (/(^|\s)(where|open|show|find|وين|فين|افتح|اعرض|وريني)(\s|$)/.test(q) && !anyKw(q, COVER_WORDS))) return insuranceDocs(ctx, q);
  const blocks = [CALL(I.summary || `Travel insurance with ${I.insurer}.`, 'sea'), H('Numbers'), KV([...insNumbers(I), ['Valid', `${dateLabel(I.valid.from)} – ${dateLabel(I.valid.to)} ${I.valid.to.slice(0, 4)} · ${I.valid.territory || ''}`]])];
  if (I.limits?.length) blocks.push(H(`What is covered (${I.annualLimit ? I.annualLimit + ' in total' : 'each person'})`), TABLE(['Cover', 'Limit'], I.limits, { columns: { 1: { cellWidth: 40 } } }));
  if (I.exclusions?.length) blocks.push(H('Not covered'), L(I.exclusions.map(e => `${e.label}: ${e.text}`)));
  if (I.firstSteps?.length) blocks.push(H('If something happens'), L(I.firstSteps, true));
  const val = insValidity(I, ctx); if (val) blocks.push(val);
  blocks.push(P(I.disclaimer || '', { muted: true }));
  const numQ = /(number|phone|call|contact|whatsapp|hotline|رقم|تلفون|اتصال)/.test(q), who = insWho(I, q, ctx.content);
  return { title: `Travel insurance · ${I.insurer.split(' ').slice(0, 2).join(' ')}`, blocks, insurance: { scenario: null, verdict: null, life: false },
           quick: numQ || who ? `${who ? `${who.who}’s policy: ${who.policyNo} · ` : ''}${n} 24 h: ${I.hotline.call} · WhatsApp ${I.hotline.whatsapp}${who ? '' : ` · ${(I.policies || []).map(p => `${p.who} ${p.policyNo}`).join(' · ')}`}` : null,
           actions: [...insActions(I), { act: 'pdf', label: 'Download PDF', icon: 'download' }],
           pdf: insurancePdf(ctx), suggestions: ['Emergency numbers', 'Is toothache covered?', 'What if our luggage is lost?'] };
}
// the one-page "If something happens" sheet
function insurancePdf(ctx) {
  const I = ctx.content.insurance;
  if (!I) return null;
  const hl = I.hotline || {};
  // compact enough for about one page: exclusions by name ("Allergies (except anaphylaxis)"), claim papers as one line
  const excl = (I.exclusions || []).map(e => { const m = /except ([^,.(]+)/i.exec(e.text || ''); return m ? `${e.label} (except ${m[1].trim()})` : e.label; });
  const blocks = [CALL('Life in danger: call 112 first (free · ambulance, police, fire).', 'red'),
    H(`${insShort(I)} 24-hour assistance`), KV([['Call', hl.call], ['WhatsApp', hl.whatsapp], ['Office', hl.office], ['E-mail', hl.email], ...(I.policies || []).map(p => [`${p.who} · policy`, p.policyNo]),
      ['Valid', `${dateLabel(I.valid.from)} – ${dateLabel(I.valid.to)} ${I.valid.to.slice(0, 4)} · ${I.valid.territory || ''}`]].filter(r => r[1])),
    H('First steps'), L(I.firstSteps || [], true),
    H(`What is covered (${I.annualLimit ? I.annualLimit + ' in total' : 'each person'})`), TABLE(['Cover', 'Limit'], I.limits || [], { size: 7.8, columns: { 1: { cellWidth: 46 } } }),
    H('Not covered'), P(excl.join(' · '), { size: 9.5 }),
    ...(I.claimDocs?.length ? [P(`Keep for a claim: ${I.claimDocs.map(x => x.replace(/\.$/, '')).join('; ')}.`, { size: 9.5 })] : []),
    P([I.valid?.note, I.disclaimer].filter(Boolean).join(' '), { muted: true, size: 9 })];
  return { title: 'If something happens', subtitle: `Travel insurance · ${I.insurer}`, blocks, filename: `${filePrefix(ctx)}-insurance-if-something-happens.pdf` };
}

/* ───────────── distances and taxi estimates between known places ───────────── */
const DISTQ = /(how far|far from|far is|is it far|distance|how long (does it take|is the|from|to|by|on foot|in a taxi|by taxi)|how many (km|kilometers|minutes|min) |km from|walking distance|كم يبعد|كم تبعد|بعيد|المسافه|مسافه)/;
const TAXIQ = /(^|\s)(taxi|cab|uber|bitaksi|تاكسي)(\s|$)/;
const PCLASS = { pier: ['pier', 'iskele', 'iskelesi', 'ferry', 'ferries', 'boat', 'vapur', 'عباره', 'فيري', 'مركب', 'اسكله'], airport: ['airport', 'havalimani', 'مطار'],
  hotel: ['hotel', 'resort', 'otel', 'فندق'], mansion: ['mansion', 'yali', 'house', 'قصر'], mosque: ['mosque', 'camii', 'جامع', 'مسجد'], palace: ['palace', 'sarayi'],
  market: ['market', 'bazaar', 'pazar', 'سوق'], mall: ['mall', 'avm', 'مول'], tower: ['tower', 'kulesi', 'برج'], square: ['square', 'meydani', 'ميدان'], gate: ['gate', 'kapi', 'بوابه'] };
const PCW = new Set(Object.values(PCLASS).flat().map(norm));
const GEO = new WeakMap();
function geoFor(C) {
  if (GEO.has(C)) return GEO.get(C);
  const pts = [], legs = [], byName = new Map();
  const ll = (url, key) => { const m = new RegExp(`[?&]${key}=(-?[\\d.]+),(-?[\\d.]+)`).exec(url || ''); return m ? [+m[1], +m[2]] : null; };
  const hotelWords = new Set(C.bookings.filter(b => b.kind === 'hotel' && b.status !== 'cancelled').map(b => norm(b.title).split(' ')[0]));   // the brand word: arise, concorde
  const add = (name, p, d) => {
    if (!name) return null; const n = norm(name);
    if (!p) return byName.get(n) || null;
    if (!byName.has(n)) {
      const toks = n.split(' ').filter(w => w.length >= 3 && !STOP.has(w));
      const cls = Object.keys(PCLASS).filter(k => PCLASS[k].some(w => toks.includes(norm(w)))).concat(toks.some(w => hotelWords.has(w)) ? ['hotel'] : []);
      const e = { name, n, lat: p[0], lng: p[1], city: d.city, toks: toks.filter(w => !PCW.has(w)), cls: [...new Set(cls)] };
      byName.set(n, e); pts.push(e);
    }
    return byName.get(n);
  };
  for (const d of C.days) for (const t of d.trips || []) {
    const a = add(t.from, ll(t.directions, 'origin'), d), b = add(t.to, ll(t.directions, 'destination') || ll(t.pin, 'query'), d);
    if (a && b) legs.push({ a, b, t, d });
  }
  const g = { pts, legs };
  GEO.set(C, g);
  return g;
}
const kmBetween = (a, b) => { const R = 6371, r = Math.PI / 180, dl = (b.lat - a.lat) * r, dg = (b.lng - a.lng) * r;
  const h = Math.sin(dl / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dg / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
// the places a question names: "how far is the ferry from the hotel" → { from: hotel, to: pier }
function distanceMatch(q0, date, ctx) {
  const C = ctx.content, G = geoFor(C), q = withAr(q0);
  if (!G.pts.length) return null;
  const SEP = /^(from|to|and|between|till|until|من|الي|عن|حتي)$/, parts = []; let sep = null;
  for (const seg of q.split(/(?:^|\s)(from|to|and|between|till|until|من|الي|عن|حتي)(?=\s|$)/)) {
    if (SEP.test(seg)) { sep = seg; continue; }
    if (seg.trim()) parts.push({ text: ` ${seg.trim()} `, sep });
  }
  const hb = hotelForDate(date || ctx.todayInTrip || ctx.today, ctx);
  const isHotel = (e) => e.cls.includes('hotel');
  const hotelNear = (ref) => G.pts.filter(isHotel).sort((a, b) => kmBetween(a, ref) - kmBetween(b, ref))[0];
  let myHotel = hb && G.pts.find(e => isHotel(e) && e.toks.some(w => norm(hb.title).includes(w)));
  const cand = (part) => {
    const cls = Object.keys(PCLASS).filter(k => PCLASS[k].some(w => kwReC(w).test(part.text)));
    return G.pts.map(e => ({ e, spec: e.toks.filter(w => new RegExp(`(^|\\s)${reEsc(w)}(\\s|$)`).test(part.text)).length, cls: e.cls.filter(c => cls.includes(c)).length }))
      .filter(x => x.spec || x.cls).map(x => ({ ...x, sc: x.spec * 3 + x.cls }));
  };
  const res = parts.map(p => ({ p, c: cand(p) })).filter(x => x.c.length);
  if (!res.length) return null;
  // names first, then "the hotel" (today's hotel), then class words ("the pier") chosen relative to the other place
  const pickFor = (x, ref) => {
    const top = Math.max(...x.c.map(c => c.sc)), best = x.c.filter(c => c.sc === top).map(c => c.e);
    if (best.length === 1) return best[0];
    if (best.some(isHotel) && myHotel && best.includes(myHotel)) return myHotel;
    const r = ref || myHotel;
    if (!r) return best[0];
    const linked = best.filter(e => G.legs.some(l => (l.a === e && l.b.n === r.n) || (l.b === e && l.a.n === r.n)));
    return (linked.length ? linked : best).sort((a, b) => kmBetween(a, r) - kmBetween(b, r))[0];
  };
  const rank = (x) => Math.max(...x.c.map(c => c.spec)) * 10 + (x.c.some(c => isHotel(c.e) && c.cls) ? 5 : 0);
  const choose = () => {
    const got = [];
    for (const x of res.slice().sort((a, b) => rank(b) - rank(a))) { const e = pickFor(x, got[0]?.e); if (e && !got.some(g => g.e === e)) got.push({ e, sep: x.p.sep }); }
    if (got.length === 1) {   // one place named: measure from the hotel
      const h = myHotel && kmBetween(myHotel, got[0].e) < 60 ? myHotel : hotelNear(got[0].e);
      if (h && h !== got[0].e) got.unshift({ e: h, sep: 'from' });
    }
    return got;
  };
  let got = choose();
  // "the hotel" in another city than the place (asked before the trip): it means the hotel of that city
  if (got.length === 2 && kmBetween(got[0].e, got[1].e) > 60 && got.some(g => isHotel(g.e))) { const other = got.find(g => !isHotel(g.e)); if (other) { myHotel = hotelNear(other.e); got = choose(); } }
  if (got.length < 2) return null;
  const [x, y] = got;
  const from = ['from', 'من', 'عن'].includes(x.sep) || ['to', 'الي'].includes(y.sep) ? x.e : y.e, to = from === x.e ? y.e : x.e;
  return from === to || kmBetween(from, to) > 400 ? null : { from, to };
}
function meterFor(city, ctx) {
  for (const s of ctx.content.transport?.taxi || []) {
    const m = new RegExp(`^${reEsc(city || '')}[^:]*meter:\\s*₺([\\d.,]+) to open,\\s*₺([\\d.,]+) per km,\\s*₺([\\d.,]+) minimum`, 'i').exec(s);
    if (m) return { open: +m[1].replace(/,/g, ''), km: +m[2].replace(/,/g, ''), min: +m[3].replace(/,/g, ''), line: s };
  }
  return null;
}
const fmtKm = (km) => km < 1 ? `${Math.round(km * 1000 / 10) * 10} m` : `${km.toFixed(km < 10 ? 1 : 0)} km`;
function distanceAnswer(m, q, ctx) {
  const C = ctx.content, G = geoFor(C), { from, to } = m;
  const km = kmBetween(from, to), road = km * 1.35;
  const leg = G.legs.find(l => l.a.n === from.n && l.b.n === to.n) || G.legs.find(l => l.a.n === to.n && l.b.n === from.n);
  const meter = meterFor(from.city || to.city, ctx), fast = road > 25;   // long rides use the motorways
  const walkMin = Math.round(km * 1.25 / 4.5 * 60), taxiMin = [Math.max(5, Math.round(road / (fast ? 50 : 30) * 60 / 5) * 5), Math.max(8, Math.round(road / (fast ? 32 : 20) * 60 / 5) * 5)];
  const fare = meter ? Math.max(meter.min, meter.open + meter.km * road) : null, r10 = (n) => Math.round(n / 10) * 10;
  const fareTxt = fare ? (fare <= meter.min ? `the minimum fare, ₺${fmt(meter.min)}` : `≈ ₺${fmt(r10(fare * 0.9))}–${fmt(r10(fare * 1.15))} on the meter`) : '';
  const walkOk = walkMin <= 15;
  const legTxt = leg ? `${leg.t.modeText}: ${leg.t.label}${leg.t.dur ? ' · ' + leg.t.dur : ''}${leg.t.time ? ` (planned ${leg.t.time} on ${dateLabel(leg.d.date)})` : ` (${dateLabel(leg.d.date)})`}` : '';
  const legDist = leg && /(\d+(?:[.,]\d+)?)\s?(km|m)(?![a-z])/.exec(leg.t.dur || ''), shown = legDist ? `${legDist[1]} ${legDist[2]}` : fmtKm(km);
  // a line in the plan that already gives this distance ("Sütlüce pier … is about 1.5 km away")
  const pool = [...C.bookings.flatMap(b => (Array.isArray(b.notes) ? b.notes : [b.notes]).filter(Boolean).map(t => ({ t, w: b.title }))), ...C.days.flatMap(d => (d.plan || []).map(t => ({ t, w: '' })))];
  const said = pool.find(({ t, w }) => /\d(\.\d)?\s?(km|m)\b/.test(t) && [from, to].every(e => e.toks.some(k => norm(`${t} ${w}`).includes(k))));
  const est = `About ${fmtKm(km)} as the crow flies: ${walkOk ? `a ${walkMin}-minute walk` : `${fareTxt ? `a taxi of about ${taxiMin[0]}–${taxiMin[1]} min, ${fareTxt}` : `about ${taxiMin[0]}–${taxiMin[1]} min by taxi`}`}.`;
  const quick = leg && !TAXIQ.test(q) ? legTxt : leg ? `${est} In your plan: ${legTxt}.` : est;
  const rows = [['Distance', legDist ? `${shown} on the route (≈ ${fmtKm(km)} in a straight line)` : `≈ ${fmtKm(km)} in a straight line`], leg && ['In your plan', legTxt], fare && km >= 0.5 && ['Taxi', `${fareTxt} · about ${taxiMin[0]}–${taxiMin[1]} min`],
    km <= 3 && ['On foot', `about ${walkMin} min${walkOk ? '' : ' — over 15 min: take a taxi'}`]].filter(Boolean);
  const blocks = [KV(rows), ...(said ? [P(`Your plan: ${said.t}`)] : []),
    P(`Estimates from the map${meter ? ` and the meter (₺${meter.open} to open, ₺${meter.km} per km, ₺${meter.min} minimum)` : ''}. Tolls are extra; traffic can double the time.`, { muted: true })];
  const card = C.driverCards.find(c => aliasScore(to.n, c.aliases) > 0);
  const href = leg && leg.a.n === from.n ? leg.t.directions : `https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}&travelmode=${walkOk ? 'walking' : 'driving'}`;
  return { title: `${from.name} → ${to.name}: about ${shown}`, blocks, quick, distance: { from: from.name, to: to.name, km: +km.toFixed(2) },
           actions: [{ act: 'url', href, label: 'Directions', icon: 'navigation' }, ...(card ? [{ act: 'driver', id: card.id, label: 'Show the driver', icon: 'taxi' }] : [])],
           suggestions: ['Taxi rules', 'Hotel address for the driver'] };
}

/* ───────────── paying, the time difference, money left ───────────── */
function payAnswer(q, ctx) {
  const C = ctx.content, pool = [...C.tips.sections.flatMap(s => s.items), ...C.transport.taxi, ...C.transport.card];
  const lines = [...new Set(pool.filter(x => /(cash|contactless|bank card|credit card|card machine|card or |by card|pay in|pay with)/i.test(x)))];
  const where = /(taxi|cab|uber|bitaksi|تاكسي)/.test(q) ? /taxi|bitaksi|uber/i : /(museum|cistern|palace|ticket|متحف)/.test(q) ? /museum|cistern|palace/i
    : /(bazaar|market|shop|سوق)/.test(q) ? /bazaar|trader|shop/i : /(ferry|tram|metro|bus|istanbulkart)/.test(q) ? /ride|istanbulkart|ferry/i : /(restaurant|cafe|shisha|meal|مطعم)/.test(q) ? /tip|bill|service/i : null;
  const rel = where ? lines.filter(x => where.test(x)) : [];
  const taxi = /(taxi|cab|uber|bitaksi|تاكسي)/.test(q);
  const quick = rel[0] || (taxi ? 'Taxis: carry cash in Turkish lira. Many drivers have a card machine, but not all, so ask before you get in: “Kartla ödeyebilir miyim?” (Can I pay by card?). Always pay in lira, never in AED or EUR.' : lines[0]);
  return { title: taxi ? 'Paying in taxis' : 'Card or cash?', blocks: [L(lines)], quick, actions: [{ act: 'tab', tab: 'money', label: 'Open Money', icon: 'wallet' }], suggestions: ['Taxi rules', '1,000 TL in AED'] };
}
function tzAnswer(ctx) {
  const C = ctx.content, note = C.meta.timezoneNote || C.tips.sections.flatMap(s => s.items).find(x => /UTC/.test(x)) || '';
  const m = /(one|two|1|2) hours? (behind|ahead of) ([A-Z][\w ]+?)(?:[.,;]|$)/i.exec(note);
  const blocks = [CALL(note || 'No time-zone note in the trip data.', 'sea')];
  let title = 'Time difference';
  if (m) {
    const n = /one|1/i.test(m[1]) ? 1 : 2, behind = /behind/i.test(m[2]), home = m[3].trim(), off = (behind ? -1 : 1) * n * 60, now = ctx.nowMin;
    title = `${n === 1 ? 'One hour' : 'Two hours'} ${behind ? 'behind' : 'ahead of'} ${home}`;
    const away = ctx.todayInTrip ? now : now != null ? now + off : null;
    blocks.push(KV([['Example', `12:00 in ${home} = ${hm(12 * 60 + off)} in ${C.meta.title.split(' ')[0]}`], ...(away != null ? [['Now (about)', `${hm(away)} in ${C.meta.title.split(' ')[0]} · ${hm(away - off)} in ${home}`]] : [])]));
  }
  return { title, blocks, suggestions: ['What’s next?', 'Sunset today'] };
}
function leftAnswer(ctx) {
  const C = ctx.content, M = C.money, sp = spentSummary(ctx), last = C.days[C.days.length - 1].date;
  const plan = M.spendPlan?.aed || M.plannedTotal?.aed || [0, 0];
  const upTo = ctx.todayInTrip || (ctx.today > last ? last : null);
  const dayAed = (d) => d.totalAed || d.allowAed || [0, 0];
  const pd = upTo ? C.days.filter(d => d.date <= upTo).reduce((s, d) => [s[0] + dayAed(d)[0], s[1] + dayAed(d)[1]], [0, 0]) : null;
  const lo = plan[0] - sp.aed, hi = plan[1] - sp.aed;
  const status = !pd ? 'The trip has not started yet.' : sp.aed < pd[0] ? 'You are below the plan so far.' : sp.aed <= pd[1] ? 'You are within the plan so far.' : 'You are above the plan so far.';
  const blocks = [CALL(`Spent so far ≈ AED ${fmt(sp.aed)} of the spending plan (AED ${fmt(plan[0])}–${fmt(plan[1])}). About AED ${fmt(Math.max(0, lo))}–${fmt(Math.max(0, hi))} is left. ${status}`, sp.aed > (pd?.[1] ?? Infinity) ? 'red' : 'sea'),
    TABLE(['', 'AED'], [[M.spendPlan?.label || 'Spending plan', `${fmt(plan[0])}–${fmt(plan[1])}`], ...(pd ? [[`Plan up to ${dateLabel(upTo)}`, `${fmt(pd[0])}–${fmt(pd[1])}`]] : []),
      [`Logged so far (${sp.count} expense${sp.count === 1 ? '' : 's'})`, fmt(sp.aed)], ['Left in the plan', `${fmt(lo)}–${fmt(hi)}`]], { boldLast: true, columns: { 1: { halign: 'right', cellWidth: 40 } } }),
    P('Paid bookings (hotels, flights, shuttles) are not in these numbers. Log every spend in More → Money to keep this right.', { muted: true })];
  return { title: `About AED ${fmt(Math.max(0, lo))}–${fmt(Math.max(0, hi))} left`, blocks, actions: [{ act: 'tab', tab: 'money', label: 'Open Money', icon: 'wallet' }, { act: 'pdf', label: 'Download PDF', icon: 'download' }],
           pdf: { title: 'Money left', subtitle: C.meta.title, blocks, filename: `${filePrefix(ctx)}-money-left.pdf` }, suggestions: ['How much have we spent?', 'Budget'] };
}

/* ───────────── fallback: search everything ───────────── */
function searchAnswer(q, raw, ctx) {
  const C = ctx.content; const words = q.split(' ').filter(w => w.length > 2 && !STOP.has(w));
  if (!words.length) return help(ctx);
  const hits = [], res = words.map(w => wordRe(w));
  const consider = (text, where, open) => { const n = norm(text); const sc = res.filter(re => re.test(n)).length; if (sc) hits.push({ sc: sc + (n.startsWith(words[0]) ? .5 : 0), text, where, open }); };
  for (const d of C.days) {
    consider(`${d.title}: ${d.intro}`, `${dateLabel(d.date)}`, { act: 'day', date: d.date });
    (d.plan || []).concat(d.ideas || [], d.fixed || []).forEach(p => consider(p, `${dateLabel(d.date)} · plan`, { act: 'day', date: d.date }));
    (d.trips || []).forEach(t => consider(`${t.modeText}: ${t.label}${t.time ? ' at ' + t.time : ''}`, `${dateLabel(d.date)} · trip ${t.n}`, { act: 'day', date: d.date }));
  }
  for (const v of C.venues) consider(`${v.name}, ${v.area} · ${v.cost}${v.notes ? ' · ' + v.notes : ''}`, `${dateLabel(v.day)} · ${KIND[v.kind] || v.kind}`, { act: 'venue', id: v.id });
  for (const s of C.tips.sections) s.items.forEach(i => consider(i, s.title, null));
  for (const f of C.transport.ferries) consider(`${f.line} · ${(f.times || []).join(', ')}${f.note ? ' · ' + f.note : ''}`, 'Ferry', null);
  for (const b of C.bookings) consider(`${b.title} · ${b.subtitle || ''} · ${b.confirmation || ''}`, 'Booking', b.file ? { act: 'doc', id: b.file } : null);
  for (const p of C.phrases) consider(`${p.tr} (${p.say}): ${p.en}`, 'Phrase', null);
  for (const u of userDocs(ctx)) consider(`${udocLine(u)}${u.summary ? ' · ' + u.summary : ''}`, `Your document${u.dayIso ? ' · ' + dateLabel(u.dayIso) : ''}`, { act: 'doc', id: 'u:' + u.id });
  for (const [iso, ns] of Object.entries(ctx.userNotes || {})) for (const n of ns || []) consider(n.text || '', `Your note · ${dateLabel(iso)}`, { act: 'day', date: iso });
  hits.sort((a, b) => b.sc - a.sc);
  const top = hits.slice(0, 8).filter(h => h.sc >= Math.min(2, words.length));   // one stray shared word is not a match
  if (!top.length) return { title: 'I could not find that in the trip', blocks: [P('Try a date (“plan for tomorrow”), a place name, or a topic: flights, hotel, ferry, budget, phrases, emergency.')], suggestions: ['Plan for today', 'My flights', 'Ferry times', 'Budget'] };
  const blocks = [P(`Best matches for “${String(raw).trim()}”:`), L(top.map(h => `${h.where}: ${h.text}`))];
  const opens = []; const seen = new Set();
  for (const h of top) { if (!h.open) continue; const k = JSON.stringify(h.open); if (seen.has(k)) continue; seen.add(k); opens.push(h); if (opens.length === 3) break; }
  return { title: 'Here is what I found', blocks,
           actions: [{ act: 'pdf', label: 'Download PDF', icon: 'download' }, ...opens.map(h => ({ ...h.open, label: h.open.act === 'day' ? `Open ${dateLabel(h.open.date)}` : h.open.act === 'venue' ? 'Open the place' : 'Open the document', icon: h.open.act === 'day' ? 'days' : h.open.act === 'venue' ? 'food' : 'filetext' }))],
           pdf: { title: `Search: ${String(raw).trim()}`, subtitle: 'Matches in your trip', blocks, filename: `${filePrefix(ctx)}-search-${slug(raw)}.pdf` } };
}
