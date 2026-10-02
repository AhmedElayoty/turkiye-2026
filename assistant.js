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
    .replace(/[’'`]/g, '').replace(/\bwi[\s-]?fi\b/g, 'wifi').replace(/[^\p{L}\p{N}:\s/.-]/gu, ' ').replace(/\s+/g, ' ').trim()
    .replace(/(^|\s)(?:وال|بال|فال|لل)(?=[ء-ي]{3,})/g, '$1')   // "with/and/for the": بالفندق = فندق
    .replace(/(^|\s)ال(?=[ء-ي]{2,})/g, '$1');   // Arabic "al-": الطوارئ = طوارئ
}
const pad2 = (n) => String(n).padStart(2, '0');
const isoAdd = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); const dt = new Date(y, m - 1, d + n); return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`; };
const dowOf = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).getDay(); };
export const dateLabel = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${DOW[new Date(y, m - 1, d).getDay()]} ${d} ${MON[m - 1]}`; };
const monTag = (iso) => `${iso.slice(8)}-${MON[+iso.slice(5, 7) - 1]}`;
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const HASRE = new Map();   // the same word lists are asked about on every answer: compile each list once
const has = (q, words) => {
  if (!words.length) return false;
  const k = words.join('\u0001'); let e = HASRE.get(k);
  if (!e) { if (HASRE.size > 4000) HASRE.clear(); const ns = words.map(norm).filter(Boolean); e = { ns, re: new RegExp(`(^|\\s)(${ns.map(reEsc).join('|')})(?=\\s|$)`) }; HASRE.set(k, e); }
  return (!e.ns.length || e.ns.some(w => q.includes(w))) && e.re.test(q);
};
const fmt = (n) => Math.round(n).toLocaleString('en');
const KIND = { meal: 'Main meal', coffee: 'Coffee', shisha: 'Shisha', breakfast: 'Breakfast' };
const cfg = (ctx) => ctx.content.config || {};

/* ───────────── intents ───────────── */
const INTENTS = {
  greet:    ['hi', 'hello', 'hey', 'salam', 'marhaba', 'merhaba', 'good morning', 'help', 'what can you do', 'how does this work', 'مرحبا', 'السلام عليكم', 'ساعدني'],
  next:     ['next', 'what now', 'whats next', 'right now', 'next step', 'where now', 'where to now', 'التالي', 'الحين', 'دلوقتي', 'الان', 'ماذا بعد', 'وبعدين', 'بعد كده', 'بعدين', 'ba3den', 'baadein', 'shu ba3d'],
  countdown:['days left', 'how many days', 'countdown', 'days to go', 'how long until', 'how long till', 'when do we leave', 'when do we fly', 'كم يوم', 'متي نسافر', 'باقي كم'],
  open:     ['open', 'opened', 'closed', 'opening hours', 'opening', 'hours', 'closes', 'closing', 'closing time', 'what time does', 'last entry', 'last admission', 'last tickets', 'last ticket', 'تقفل', 'تفتح', 'تسكر', 'مسكر', 'مفتوح', 'مقفول', 'يفتح', 'يقفل', 'يسكر', 'دوام'],
  day:      ['plan', 'plans', 'schedule', 'itinerary', 'program', 'programme', 'day', 'agenda', 'what are we doing', 'what do we do', 'route', 'map', 'maps', 'خطه', 'برنامج', 'جدول', 'يوم', 'khotta', 'khetta', 'barnamej'],
  all:      ['whole trip', 'full plan', 'all days', 'entire trip', 'full itinerary', 'complete plan', 'whole plan', 'whole itinerary', 'every day', 'all the days', 'كل الايام', 'الرحله كامله', 'الخطه كامله'],
  flight:   ['flight', 'flights', 'plane', 'fly', 'flying', 'boarding', 'boarding pass', 'e-ticket', 'airline', 'pnr', 'seat', 'seats', 'baggage', 'luggage allowance', 'check-in online', 'online check-in',
             'land', 'landing', 'lands', 'terminal', 'flight number', 'bag allowance', 'bags allowance', 'baggage allowance', 'allowance',
             'check in online', 'online check in', 'checkin online', 'online checkin', 'web check in', 'طيران', 'تذكره الطيران', 'طياره', 'رحله الطيران',
             'رحلتنا', 'طيارتنا', 'رحله عوده', 'رحله رجوع', 'عوده', 'رجوع', 'موعد الطياره'],
  hotel:    ['hotel', 'hotels', 'room', 'check in', 'checkin', 'check-in', 'check out', 'checkout', 'booking', 'reservation number', 'confirmation', 'pin', 'resort', 'deposit', 'staying', 'where do we stay', 'where are we staying', 'where do we sleep', 'فندق', 'الفندق', 'حجز', 'غرفه'],
  shuttle:  ['shuttle', 'pickup', 'pick up', 'pick-up', 'picks us up', 'pick us up', 'the van', 'transfer', 'airport transfer', 'airport ride', 'from the airport', 'from airport', 'to the airport', 'to airport',
             'airport to hotel', 'airport to the hotel', 'hotel to airport', 'hotel to the airport', 'get to the hotel', 'to the hotel from', 'توصيل', 'الباص'],
  driver:   ['address', 'driver', 'show the driver', 'taxi card', 'take us', 'take me', 'write the address', 'عنوان', 'العنوان', 'السواق', 'السائق'],
  food:     ['eat', 'eating', 'food', 'restaurant', 'restaurants', 'lunch', 'dinner', 'breakfast', 'meal', 'meals', 'dining', 'coffee', 'cafe', 'cafes', 'shisha', 'hookah', 'nargile', 'argileh', 'dessert', 'menu', 'hungry', 'starving', 'famished', 'peckish', 'grab a bite', 'bite to eat', 'snack', 'snacks', 'مطعم', 'مطاعم', 'اكل', 'ناكل', 'ناكل فين', 'نتغدي', 'نتعشي', 'غداء', 'عشاء', 'فطار', 'فطور', 'قهوه', 'شيشه', 'كافيه', 'كوفي'],
  money:    ['budget', 'cost', 'costs', 'money', 'price', 'prices', 'total', 'expensive', 'cheap', '10k', '10000', 'under 10', 'afford', 'exchange', 'exchange rate', 'currency', 'ميزانيه', 'فلوس', 'تكلفه', 'مصاريف', 'سعر'],
  spent:    ['spent', 'spend', 'spending', 'expenses', 'expense', 'logged', 'so far', 'did we spend', 'صرفنا', 'المصروف', 'صرف', 'sarafna', 'kam sarafna', 'saraftu', 'sarfna', 'masareef', 'masaref', 'masarif'],
  transport:['ferry', 'ferries', 'boat', 'boats', 'vapur', 'pier', 'taxi', 'taxis', 'tram', 'metro', 'bus', 'istanbulkart', 'transport', 'get to', 'how do we get', 'bitaksi', 'uber', 'meter', 'move around', 'get around', 'getting around', 'عباره', 'مركب', 'فيري', 'تاكسي', 'مواصلات', 'ترام'],
  phrases:  ['phrase', 'phrases', 'turkish', 'speak', 'words', 'translate', 'how do i say', 'how to say', 'how do you say', 'how do we say', 'how can i say', 'how can we say', 'language', 'كلمات', 'جمل', 'تركي', 'ترجم', 'اقول'],
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
    for (const { w, multi, re } of ws) if (q.includes(w) && re.test(q)) sc += multi ? 2 : 1;
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
  + 'delight light right night sight fight bright drive drives driving ride rides stop stops keep wake urgent normal extra included include alternative alternatives reception '
  + 'tariff percent miss missed make still enough inside entry stamp valid start starts begin ends layover connection transit belt rain raining rainy rains storm tired skip '
  // everyday English that sits one or two letters from a trip word ("waiting" is not "eating")
  + 'wait waits waiting waited meeting seating heating rating taking making getting paying staying leaving driving walking talking looking going coming '
  + 'having giving sitting standing parking packing sleeping resting shopping visiting asking calling answer answers question normal usual extra cheaper cheapest').split(' '));
const TYPOS = { fery: 'ferry', wher: 'where', wat: 'what', hotal: 'hotel', flyt: 'flight', tmrw: 'tomorrow', tonite: 'tonight', nite: 'night', leve: 'leave', wats: 'whats', flite: 'flight',
  flites: 'flights', numbr: 'number', wich: 'which', tim: 'time', r: 'are', u: 'you', pls: 'please', plz: 'please', wht: 'what', whn: 'when', '2day': 'today', '2nite': 'tonight',
  sheesha: 'shisha', shesha: 'shisha', shutle: 'shuttle', chek: 'check', chk: 'check', tmrow: 'tomorrow', tmro: 'tomorrow', istambul: 'istanbul', flihgt: 'flight', fligt: 'flight',
  taksi: 'taxi', tarif: 'tariff', hw: 'how', frm: 'from', n: 'and', opn: 'open', pikup: 'pickup', pickap: 'pickup', airprot: 'airport', layover: 'layover', oclock: 'oclock' };
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
  for (const b of content.bookings) [b.title, b.subtitle || '', ...(b.aliases || []), ...(b.keywords || [])].forEach(add);
  (content.config?.flightKeywords || []).forEach(add);   // "turkish airlines" is not a typo of "airline"
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
    if (Object.hasOwn(TYPOS, w)) return TYPOS[w];
    if (w.length < 5 || !/^[a-z]+$/.test(w) || known.has(w) || COMMON.has(w) || extra?.has(w)) return w;
    const max = w.length <= 6 ? 1 : 2;
    let best = null, bd = max + 1, ties = 0;
    for (const v of vocab) { const d = osa(w, v, max); if (d < bd) { bd = d; best = v; ties = 0; } else if (d === bd) ties++; }
    return best && bd <= max && ties === 0 ? best : w;
  }).join(' ');
}

/* ───────────── spoken Arabic and Arabizi → the words the assistant knows ───────────── */
// "emta el checkout bokra", "wein nakol", "kam el shisha el leila": whole words, after norm()
const ARABIZI = new Map(Object.entries({
  tomorrow: 'bokra bukra bokrah bukrah', when: 'emta imta emteh imtaa', open: 'fat7 fate7 fat7a fati7 maftou7 maftoo7 maftu7 maftooh yeftah yefta7 yifta7 yiftah byefta7 byeftah bteftah btefta7 teftah tefta7',
  today: 'naharda ennaharda elnaharda elyom elyoum elyawm', where: 'wein wayn fein feen fen wain', eat: 'nakol nakul nakel nokol naakol',
  hungry: 'jaw3an jaw3ana jaw3anin jaw3aneen jo3an jou3an ga3an ge3an ga3anin ge3anin ga3ana', 'how much': 'kam 2addesh addesh adesh qaddesh b2adesh bkam',
  left: 'ba2i ba2ye baqi ba2y', what: 'shu shou eish esh', number: 'ra2m raqam rakam ra2am ra2em raqm nemra nimra', here: 'hon hown', 'to the': 'lel lal lil', airport: 'matar',
  i: 'ana', and: 'w wa', 'we have': '3anna 3ana 3enna', sick: 'ta3ban ta3bana ta3banin ta3baneen mareed mareeda 3ayan 3ayana', fever: 'sukhuna s5ona sokhna skhuna 7arara harara',
  pharmacy: 'saydaliya saydalia saidaliya saydaleya saydaliyya agzakhana agzakhane', nearest: 'a2rab aqrab', 'i have': '3andi 3indi', 'we have': '3andna 3ndna',
  doctor: 'daktor doktor', hospital: 'mustashfa mostashfa', must: 'lazem lazim lazm', room: 'ghorfa ghurfa owda', hotel: 'fondo2 fondoq funduq otel',
  now: 'el7in hal2 halla2 hala2 delwa2ti dilwa2ti delwa2t hal7een', until: 'lehad la7ad', go: 'nrou7 nro7 nruh nrouh nrooh', how: 'izzay ezay ezzay izay keef kif',
  flight: 'tayyara tiyara tayara', shisha: 'arghile argile nargila argeela', lunch: 'netghada nitghada ghada ghadaa', dinner: 'net3asha nit3asha nt3asha 3asha 3asa 3ashaa',
  address: '3enwan 3nwan 3onwan 3inwan 3unwan', turkish: 'turki torki', coffee: 'ahwa ahwe 2ahwa 2ahwe qahwa qahwe kahwa', drink: 'neshrab nishrab nshrab',
  can: 'ne2dar ni2dar neqdar n2dar', possible: 'yenfa3 yinfa3 ynfa3', cost: 'taklfet taklifet taklefet taklufa taklfa', minutes: 'da2i2a da2aye2 da2ayi2 da2ayeq dakika daqiqa',
  from: 'men mn', last: 'akher a5er akhir 2akher', boat: 'markeb markib mrkb', back: 'rag3a raj3a rag3in raj3in rag3een rju3', ferry: 'ma3dya ma3diya me3dieh ma3addeya ma3dia',
  allergy: '7asasiya 7asasia hasasiya 7sasiya', itchy: 'hersh 7ersh 7ekka 7aka', arm: 'dra3i zra3i', insurance: 'ta2meen ta2min tameen', cover: 'yeghatti yghatti bey8atti beyghatti',
  want: '3ayzeen 3ayzin 3awzeen baddna badna', change: 'nghayar neghayar ngheyer nghayer', dates: 'mawa3eed mawa3id mawa3ed', if: 'law', in: 'fi bel', arrive: 'nwsal nowsal nusal nesal nousal',
  be: 'nkoon nkun', down: 'taht', first: 'awel awal', trip: 're7la rehla', expensive: 'ghali', normal: 'tabi3i', bags: 'shanta shonat shenat', allowed: 'masmoo7 masmou7',
}).flatMap(([en, ws]) => ws.split(' ').map(w => [w, en])));
// spoken Arabic (normalised: no "al-", ة → ه) and venue names in Arabic script
const AR_DIALECT = [
  [/(^|\s)صباح الخير(?=\s|$)/g, '$1good morning'], [/(^|\s)(?:ايش|شو|وش|ايه|شنو|ماذا|اش) (?:في )?عندنا(?=\s|$)/g, '$1what do we have'],
  [/(^|\s)(?:صبح|صباح|صباحا)(?=\s|$)/g, '$1this morning'], [/(^|\s)(?:متي|امتي|ايمتي|امتا)(?: لازم)? (?:نطلع|نخرج|نمشي|نتحرك)(?=\s|$)/g, '$1when do we leave'],
  [/(^|\s)ساعه (?:كم|كام)(?=\s|$)/g, '$1what time'], [/(^|\s)(?:نطلع|نخرج|نتحرك)(?=\s|$)/g, '$1leave'],
  [/(^|\s)(?:ازاي|كيف|شلون|اشلون) (?:نروح|نوصل|اروح|اوصل)(?=\s|$)/g, '$1how do we go'], [/(^|\s)(?:و|ف)?(?:جوعان|جوعانين|جوعانه|جعان|جعانين|جعانه)(?=\s|$)/g, '$1hungry'],
  [/(^|\s)(?:و|ب)?بيبك(?=\s|$)/g, '$1bebek'], [/(^|\s)(?:ل|و|ب)?برج (?:جالاتا|جلطه|غلطه|غلاطه|جالاطه)(?=\s|$)/g, '$1galata tower'], [/(^|\s)ل(?:جالاتا|جلطه|غلطه|غلاطه|جالاطه)(?=\s|$)/g, '$1to galata'], [/(^|\s)(?:و|ب)?(?:جالاتا|جلطه|غلطه|غلاطه|جالاطه)(?=\s|$)/g, '$1galata'],
  [/(^|\s)(مطعم|رقم|كافيه|مقهي|عند|في) زين(?=\s|$)/g, '$1$2 zin'], [/(^|\s)(?:و|ل|ب|ف)?نصرت(?=\s|$)/g, '$1nusret'], [/(^|\s)(?:و|ل|ب|ف)?كارلوس(?=\s|$)/g, '$1carlos'],
  [/(^|\s)(?:و|ل|ب|ف)?لوتيز(?=\s|$)/g, '$1lotiz'], [/(^|\s)(?:و|ل|ب|ف)?كايتان(?=\s|$)/g, '$1kaytan'], [/(^|\s)(?:و|ل|ب|ف)?فورنو(?=\s|$)/g, '$1forno'],
  [/(^|\s)(?:و|ل|ب|ف)?ميموس(?=\s|$)/g, '$1memos'], [/(^|\s)(?:و|ل|ب|ف)?زيبرا(?=\s|$)/g, '$1zebra'], [/(^|\s)(?:و|ل|ب|ف)?فيريه(?=\s|$)/g, '$1feriye'],
  // Levantine and Gulf: "شو عنا بكرا", "متى نوصل", "كام شنطة مسموح", "يشتغل من الحين ولا لما نوصل"
  [/(^|\s)(?:ايش|شو|وش|ايه|شنو|ماذا|اش) (?:في )?عنا(?=\s|$)/g, '$1what do we have'], [/(^|\s)و?رقم(?:هم|ه|ها|كم)(?=\s|$)/g, '$1number'], [/(^|\s)(?:عندنا|عنا) (?:شي|شيء|اي شي|حاجه|برنامج)(?=\s|$)/g, '$1what do we have'], [/(^|\s)(?:بكرا|بكرة|بكره)(?=\s|$)/g, '$1tomorrow'],
  [/(^|\s)(?:متي|امتي|امتا) (?:راح |رح |ح |بن)?(?:نوصل|نصل|بنوصل)(?=\s|$)/g, '$1when do we arrive'], [/(^|\s)(?:نوصل|نصل|بنوصل)(?=\s|$)/g, '$1arrive'],
  [/(^|\s)(?:كام|كم|كمن) (?:شنطه|شنط|حقيبه|حقائب|شنطة)(?=\s|$)/g, '$1how many bags'], [/(^|\s)مسموح(?:ه|ين)?(?=\s|$)/g, '$1allowed'],
  [/(^|\s)(?:يشتغل|يبدا|يبدأ|ساري|شغال|يفعل)(?=\s|$)/g, '$1valid'], [/(^|\s)من (?:الحين|حين|الان|هلا|دلوقتي)(?=\s|$)/g, '$1from now'], [/(^|\s)(?:لما|لمن|اول ما) (?:نوصل|نصل|arrive)(?=\s|$)/g, '$1when we arrive'],
  // Egyptian: "السواق هيستنانا قد ايه لو اتأخرنا" = how long will the driver wait for us if we are late
  [/(^|\s)(?:ه|ح|ب|بي|هي|حي)?(?:يستنانا|يستنونا|يستنا|يستني|يستنوا|ينتظرنا|ينتظرونا)(?=\s|$)/g, '$1wait for us'], [/wait for us (?:قد ايه|اد ايه|قديش|كم)(?=\s|$)/g, 'wait for us how long'],
  [/(^|\s)(?:قد ايه|اد ايه|قديش|كم) (?:ه|ح|ب|بي|هي|حي)?(?:يستنانا|يستنونا|يستنا|يستني|يستنوا|ينتظرنا|ينتظرونا|wait for us)(?=\s|$)/g, '$1how long wait for us'],
  [/(^|\s)(?:لو|اذا|لما) (?:ا)?(?:تاخرنا|اتاخرنا|تاخرت|اتاخرت)(?=\s|$)/g, '$1if we are late'],
  [/(^|\s)(?:ولا لا|او لا|ولا لأ|ولا لاء)(?=\s|$)/g, '$1or not'], [/(^|\s)(?:حقتنا|تبعتنا|حقنا|تبعنا)(?=\s|$)/g, '$1our'], [/(^|\s)قبل (?:طياره|الطياره|رحله|الرحله|طيران)(?=\s|$)/g, '$1before the flight'],
];
function dialect(q) {
  if (AR.test(q)) for (const [re, to] of AR_DIALECT) q = q.replace(re, to);
  // "الفيزا" is the visa unless the question is about paying with a card ("ندفع بالفيزا": norm already dropped the بال)
  if (/(^|\s)(?:فيزا|تاشيره)(?=\s|$)/.test(q) && !/(ادفع|ندفع|دفع|نشتري|اشتري|كاش|بطاقه|كارت|نقدا)/.test(q)) q = q.replace(/(^|\s)(?:فيزا|تاشيره)(?=\s|$)/g, '$1visa');
  // Arabizi phrases before single words: "el sa3a kam" = what time, "b kam" = how much, "kam da2i2a" = how many minutes, "men X la Y" = from X to Y
  q = q.replace(/(^|\s)(?:(?:el|al) )?sa3a kam(?=\s|$)/g, '$1what time').replace(/(^|\s)kam (?:el )?sa3a(?=\s|$)/g, '$1what time').replace(/(^|\s)b kam(?=\s|$)/g, '$1how much')
    .replace(/(^|\s)kam (?:da2i2a|da2aye2|da2ayi2|dakika|da2ayeq|daqiqa)(?=\s|$)/g, '$1how many minutes').replace(/(^|\s)(men|mn) (.+?) (?:la|lal|lel|ila) (?=\S)/g, '$1from $3 to ')
    .replace(/(^|\s)(?:leave|out of|vacate|hand back|give back|give up) (?:the |our )?(?:room|rooms|keys?)(?=\s|$)/g, '$1check out of the room')
    .replace(/(^|\s)(?:shu|shou|eish|esh)(?: fi)? (?:3anna|3ana|3enna|3andna|3ndna)(?=\s|$)/g, '$1what do we have').replace(/(^|\s)(?:izzay|ezay|ezzay|izay|keef|kif) (?:nrou7|nro7|nruh|nrouh|nrooh|nrou7)(?=\s|$)/g, '$1how do we go to')
    .replace(/(^|\s)(?:wein|wayn|fein|feen) (?:nrou7|nro7|nruh|nrouh|nrooh)(?=\s|$)/g, '$1what do we do');
  q = q.replace(/(^|\s)(?:el|al|il)\s?(?:leila|leile|leileh|lela|layla)(?=\s|$)/g, '$1tonight').replace(/(^|\s)(?:el|al|il)\s?(?:yom|youm|yawm)(?=\s|$)/g, '$1today')
    .replace(/(^|\s)(?:nesalem|nsallem|nsalem|nesallem|nsalim)(?:\s(?:el|al))?\s(?:ghorfa|ghurfa|oda|owda|room|otel|hotel|mofta7)(?=\s|$)/g, '$1check out')
    .replace(/(^|\s)were (do|is|are|can|should|does|did)(?=\s|$)/g, '$1where $2');   // "were do we watch it" (but "we were robbed" stays)
  if (!/[a-z0-9]/.test(q)) return q;
  return q.split(' ').map(w => ARABIZI.get(w) ?? w).join(' ').replace(/(^|\s)(?:el|al|il)\s+(?=\S)/g, '$1').replace(/\s+/g, ' ').trim();
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
  // what the documents say: trip documents read at build time, and documents the user added (facts the AI read, the phone's text)
  // only the named booking's document when one is named ("pets at Concorde" must not answer from Swissôtel's papers);
  // a question about a booking's own number or PIN is answered from the booking itself, not from its paperwork
  const namedFiles = new Set(C.bookings.filter(b => b.file && (has(q, b.keywords || []) || (b.aliases || []).some(a => q.includes(norm(a))))).map(b => b.file));
  const fieldQ = /(booking|confirmation|reservation|reference)\s*(number|no|code|id)|(^|\s)(pin|ref)(\s|$)/.test(q);
  if (!fieldQ) for (const [fid, facts] of Object.entries(C.docFacts || {})) {
    if (namedFiles.size && !namedFiles.has(fid)) continue;
    const f = (C.files || []).find(x => x.id === fid); (facts || []).forEach(x => push(x, f?.title || fid));
  }
  for (const u of userDocs(ctx)) {
    [u.summary, ...(u.notes || []), ...(u.facts || [])].forEach(x => push(x, u.title));
    String(u.text || '').split(/(?<=[.!?])\s+|\n+/).map(x => x.trim()).filter(x => x.length >= 12 && x.length <= 240).slice(0, 80).forEach(x => push(x, u.title));
  }
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
    ['USD', new RegExp(`(?:\\$|\\busd)\\s?${num}`, 'i')], ['USD', new RegExp(`${num}\\s?(?:\\$|usd\\b|dollars?|دولار)`, 'i')],
  ];
  // "how many dirhams is 7500 lira": the other currency word is the one wanted
  for (const [cur, re] of tests) { const m = s.match(re); if (m) { const to = curWord(s.replace(m[0], ' ')); return { amount: +m[1], from: cur, to: to !== cur ? to : null }; } }
  return null;
}
const curWord = (s) => /(₺|\btl\b|\btry\b|lira|liras|ليره)/i.test(s) ? 'TRY' : /(\baed\b|\bdhs?\b|dirhams?|درهم|دراهم)/i.test(s) ? 'AED' : /(€|\beur\b|euros?|يورو)/i.test(s) ? 'EUR' : /(\$|\busd\b|dollars?|دولار)/i.test(s) ? 'USD' : null;

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
  // voice text ends sentences with "." ("I said today. Not in general"); names in Arabic script or with a typo get the content's spelling
  const q = arPlaces(canonNames(fixTypos(dialect(norm(raw).replace(/\.+(?=\s|$)/g, '').trim()), C, mine), C));
  const low = String(raw).toLowerCase();
  const wantsPdf = has(q, ['pdf', 'download', 'print', 'export', 'save']) || /pdf|بي دي اف|تحميل|(^|\s)حمل(\s|$)|اطبع/.test(low);
  // a follow-up to the previous offline answer ("and tomorrow?", "call them", "how much for 2"): its subject and day carry over
  if (ctx.prev?.q && !ctx._again) { const f = followUp(q, ctx, wantsPdf); if (f) return f; }
  // two questions in one ("where is lunch and is it far from the tower"): each part is answered
  if (!ctx._part) { const cp = compound(q, ctx); if (cp) return cp; }
  const fr = frameOf(q);   // the party size and a clock time are never a date ("price for 2", "the 3 oclock ferry")
  const conv = parseConvert(raw);
  const sc = scoreIntents(q, vocab);
  let date = ctx._date || findDate(fr.qd, ctx);
  const qp = arPlaces(q);   // "المسجد الأزرق" → blue mosque
  const venue = findVenue(fr.qd, ctx), sight = findSight(qp, ctx), ins = insuranceMatch(q, ctx);
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
  if (/(to[\s-]?dos?|checklist|tasks?|مهام)/.test(low) && /(today|tonight|اليوم)/.test(low)) intent = 'todo';   // "my to-dos for today" (raw words: typo fixing may change "dos")
  if (intent === 'tips' && /(sunset|غروب)/.test(q) && (date || ctx.todayInTrip)) { date = date || ctx.todayInTrip; intent = 'sunset'; }
  if (/(^|\s)(lost|lose|losing|stolen|missing|ضاع|ضاعت|ضيعنا|ضيعت|فقدنا)(\s|$)/.test(q) && /(istanbulkart|kart|transport card|travel card|metro card|كرت|بطاقه)/.test(q) && sc.transport) intent = 'transport';
  // what the words are for, before single keywords decide: hungry → food, the driver coming → the transfer, a night surcharge → taxi rules
  if (sc.food && MEALQ.test(q) && !venue && [null, 'day', 'flight', 'next', 'hotel', 'open', 'all'].includes(intent ?? null)) intent = 'food';
  if (/(^|\s)(driver|drivers|سواق|سائق)(\s|$)/.test(q) && !/(show|write|card|address|tell the driver|taxi driver|عنوان)/.test(q)
    && /(come|coming|pick|pickup|take us|what time|when|land|landed|arrived|where|waiting|wait|meet|not here|late|no show|call|number|phone|متي|وين|فين)/.test(q)) intent = 'shuttle';
  // "we are at exit 13 under the M 55 sign and nobody is here": the booked pickup's meeting notes
  if (/(nobody|no one|noone|no driver|not here|cant find (him|them|the driver)|cant see (him|them|the driver))/.test(q) && /(exit|gate|sign|meeting point|arrivals|airport|van|pickup)/.test(q)) intent = 'shuttle';
  if (TAXIQ.test(q) && /(extra|surcharge|night|scam|overcharg|allowed|cheat|more money|نصب|زياده)/.test(q)) intent = 'transport';
  if (TAXIQ.test(q) && /(^|\s)(app|apps|application|number|تطبيق)(\s|$)/.test(q) && !/(from|to|card|address)/.test(q)) intent = 'transport';
  if (intent === 'hotel' && /(ferry|ferries|boat|boats|vapur|عباره|مركب)/.test(q)) intent = 'transport';   // "the last boat to our hotel"
  if (/(istanbulkart|(^|\s)kart(\s|$))/.test(q) && /(buy|load|top up|topup|where|how much|recharge|charge)/.test(q)) intent = 'transport';
  if (/(what (do|should|can) (i|we) say|how (do|can|should) (i|we) say|what to say|(ايش|شو|وش|ماذا|ايه) (اقول|نقول))/.test(q)) intent = 'phrases';
  // "how do i order turkish coffee without sugar": the phrase, when the phrase list has it (not a café)
  if (/(how (do|can|should) (i|we) (order|ask for|ask)|how to (order|ask for))\s/.test(q) && !venue && phraseHits(q, C).length) intent = 'phrases';
  if (sight && !venue && /(^|\s)(go in|go into|get in|get into|enter|visit|go inside|inside|ندخل|نزور)(\s|$)/.test(q) && !DISTQ.test(q) && !/(how do we|how to|ticket|price)/.test(q)) intent = 'open';
  if (/(^|\s)(left|remaining|باقي|متبقي)(\s|$)/.test(q) && /(how much|كم)/.test(q) && !/(time|days|minutes|hours|وقت|يوم|ساعه)/.test(q)) intent = 'left';
  if (sc.food && NEARHQ.test(q)) intent = 'food';   // "shisha near the hotel tonight"
  // a user document named by its title, place or reference
  const udHits = matchUserDocs(q, norm(raw), ctx), udTop = udHits[0]?.sc || 0;
  const udNamed = udTop >= 3 || (udTop >= 2 && (!intent || intent === 'docs' || intent === 'mydocs')) || (udTop >= 1 && !intent && /(ticket|booking|receipt|voucher|document|reservation|تذكره|حجز|ايصال)/.test(q));
  // "what time is boarding on the cruise ticket": one added document clearly named + a detail word -> what the document says
  // (opening hours, insurance, conversions and time zones keep their own answers)
  if (udTop >= 1 && DOC_DETAIL.test(q) && udTop > (udHits[1]?.sc || 0) && !['open', 'insurance', 'convert', 'tz'].includes(intent)) intent = 'docqa';
  else if (udNamed) intent = 'mydocs';
  // two words of one of the user's own day notes: show the note (search lists it with its day)
  const qw = q.split(' ').filter(w => w.length >= 4 && !STOP.has(w));
  if (qw.length >= 2 && Object.values(ctx.userNotes || {}).flat().some(n => qw.filter(w => new RegExp(`(^|\\s)${reEsc(w)}`).test(norm(n?.text || ''))).length >= 2)) intent = 'search';
  // "how far is the ferry from the hotel", "taxi from sariyer to ortakoy"
  const ferryNamed = C.transport.ferries.some(f => aliasScore(q, f.aliases) > 0);   // "the princes islands": the boat line, not a map distance
  // "we're at besiktas, is there a boat back to the hotel": the boats back from that pier, not a map distance
  const boatBack = /(ferry|ferries|boat|boats|vapur|عباره|مركب|فيري)/.test(q) && /(back|return|home|hotel|فندق|نرجع|رجوع)/.test(q)
    && C.transport.ferries.some(f => (f.back || []).length && q.split(' ').some(w => w.length >= 4 && norm(f.back[0]).startsWith(w)));
  if (boatBack) intent = 'transport';
  const distQ = !sc.flight && !sc.countdown && !conv && !ferryNamed && !boatBack && !/(^|\s)(driver|drivers|سواق|سائق)(\s|$)/.test(q) && (DISTQ.test(q) || (ROUTEQ.test(q) && (!sc.shuttle || ((venue || sight) && !/airport/.test(q))))
    || (TAXIQ.test(q) && /(^|\s)(from|to|من|الي)(\s|$)/.test(q) && !/(card|address|show|driver|write|rules?|extra|night|(^|\s)app)/.test(q)));
  const away = distQ && Object.entries(factsFor(C).city).some(([code, n]) => n && !C.days.some(d => d.city === n) && has(withAr(q), [norm(n)]));   // Dubai, Abu Dhabi
  const dist = distQ && !away ? distanceMatch(q, date, ctx) || homeLeg(q, date, ctx) : null;
  if (dist) intent = 'distance';
  // something happened: is it covered? (life in danger always wins)
  const qForm = /^(is|are|will|does|do|can|could|should|when|what time|how|where)\s/.test(q) && !ins.cue;
  // "baggage lost", "tooth broke": no subject, but the words say something happened
  const incident = /(^|\s)(lost|missing|stolen|broke|broken|cracked|damaged|delayed|didnt arrive|did not arrive|never arrived|ضاع|ضاعت|انسرق|انسرقت|انكسر|انكسرت|تاخر|تاخرت)(\s|$)/.test(q);
  // a thing that went missing ("our suitcase didnt come out on the belt"): the luggage / belongings help, whatever else the sentence asks
  const gone = /(didnt|did not|never|hasnt|has not) (arrive|arrived|come|came|show)( out| up)?|not on the belt|(^|\s)(missing|lost|stolen)(\s|$)/.test(q) && /(bag|bags|suitcase|suitcases|luggage|baggage|phone|wallet|passport|glasses|شنط|عفش|حقيب|جوال|محفظ|جواز)/.test(q);
  const insRoute = ins.life || ins.words || (gone && ins.best) || (C.insurance && ((ins.cover && (ins.best || !intent))
    || (ins.best && !qForm && (ins.best.strong > 0 || ((ins.cue || incident) && !ins.info && ins.best.score + 0.5 > (sc[intent] || 0))))));
  if (insRoute) intent = ins.life && !C.insurance ? 'emergency' : 'insurance';
  if (!ins.life && /(pharmacy|eczane|صيدليه)/.test(q) && /(where|nearest|closest|find|open|near|وين|فين|اقرب|اين)/.test(q)) intent = 'emergency';
  if (/(bag|bags|baggage|luggage|suitcase|شنط|عفش)/.test(q) && /(allowance|kg|kilo|kilos|weight|how many|allowed|وزن|كيلو)/.test(q) && !incident) intent = 'flight';
  // a venue named with a question about it (open late? walk in? the bill?) is about that venue, not the day's food list
  if (venue && !sight && ['food', 'tips', 'money', 'open', 'todo', 'day', 'search', null].includes(intent ?? null)
    && /(^|\s)(open|opens|opened|closed|close|closes|late|hours|walk in|walk-in|reservations?|book|booking|how much|price|bill|cost|roughly)(\s|$)/.test(q)) intent = 'venue';
  if (sight && /(last (entry|entrance|admission|ticket|tickets)|ticket office)/.test(q)) intent = 'open';
  if (/(^|\s)(whats next|what is next|what now|whats now|next step|what do we do now)(\s|$)/.test(q) && !venue && !sight && intent !== 'insurance') intent = 'next';
  if (/(^|\s)(tip|tips|tipping|bahsis)(\s|$)/.test(q) && /(driver|waiter|taxi|restaurant|how much|should|do we|have to)/.test(q)) intent = 'tips';
  if (/(need|bring|carry|enough)( any| some| much)? (cash|lira|money|card)/.test(q) && /(today|tonight|tomorrow)/.test(q) && !/(how do we get|go to|taxi to)/.test(q)) intent = 'pay';
  if (/(included|include|free)/.test(q) && /(breakfast|minibar|drinks|meals?|wifi|parking|spa|room service)/.test(q) && !venue && !sight) intent = 'hotel';
  if (sight && !venue && ((/(^|\s)(still|now|today|tonight)(\s|$)/.test(q) && /(ticket|tickets|get in|go in|enter|visit|inside)/.test(q)) || /(^|\s)still (go|get) (to|there)(\s|$)/.test(q))) intent = 'open';
  if (/(over|under|within|on|above|below) (the )?(budget|plan)/.test(q)) intent = 'left';
  if (/before (we )?(fly|flying|leave|leaving|go|the trip|travel|departure)/.test(q) && /(need|anything|forget|to do|todo|prepare|ready|pack|should)/.test(q) && !/(airport|eat|food|dinner|lunch)/.test(q)) intent = 'todo';

  // situations answered from the derived facts: the connection, check-in windows, a missed boat, "is that normal?", "how long till…"
  const hit = !ins.life ? smart({ q, raw, date, venue, sight, intent, sc, ins, conv, ctx, fr }) : null;
  if (hit) return finish(hit, hit.intent, { q, date: hit.date ?? date, ctx, wantsPdf });
  // goals answered by reasoning over the clock, the trips, the venues and the bookings
  const goal = !ins.life && intent !== 'insurance' ? reason(q, { date, sc, ctx, venue, intent }) : null;
  if (goal) return finish(goal, goal.intent, { q, date, ctx, wantsPdf });
  const r = route(intent, { q, raw, date, venue, sc, conv, ctx, sight, plain: plain && !sc.open, ins, udHits: udNamed || intent === 'docqa' ? udHits : [], dist });
  return finish(r, intent, { q, date, ctx, wantsPdf, venue, sight });
}
// every answer: the one-line answer first, the intent, and the day and subject the next question can refer to
function finish(r, intent, { q, date = null, ctx, wantsPdf = false, venue = null, sight = null }) {
  intent = r.intent || intent || 'search';
  // long general answers start with the one line that answers a detailed question
  if (['transport', 'tips', 'day', 'flight', 'hotel', 'topic', 'open', 'search'].some(k => intent.startsWith(k)) && !r.quick && !r.noQuick) {
    const s = bestSentence(q, ctx);
    if (s && (r.blocks.length > 2 || intent === 'open')) r.quick = `${s.text}${s.where && !s.text.includes(s.where) ? ` (${s.where})` : ''}`;
  }
  if (r.quick) {
    const qb = CALL(r.quick, 'sea', 'Quick answer');
    r.blocks = [qb, ...r.blocks];
    if (r.pdf) r.pdf = { ...r.pdf, blocks: [qb, ...r.pdf.blocks] };
  }
  r.intent = intent;
  r.autoPdf = wantsPdf && !!r.pdf && !r.noAutoPdf;   // "where is the insurance pdf" means the certificate, not a new sheet
  if (r.date === undefined) r.date = date || null;
  if (r.subject === undefined) r.subject = sight && intent === 'open' ? { kind: 'sight', id: sight.id } : venue && ['venue', 'food'].includes(intent) ? { kind: 'venue', id: venue.id }
    : intent.startsWith('topic:') ? { kind: 'topic', id: intent.slice(6) } : intent === 'day' && r.date ? { kind: 'day', id: r.date } : null;
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
    case 'docqa': return docQaAnswer(q, a.udHits[0].u, ctx);
    case 'pay': return payAnswer(q, ctx);
    case 'tz': return tzAnswer(ctx);
    case 'left': return leftAnswer(ctx, /(^|\s)(today|todays|tonight|يوم)(\s|$)/.test(q) ? ctx.todayInTrip : date);
    case 'daycost': { const d = dayOf(date || ctx.todayInTrip); return d ? dayCostAnswer(d, ctx) : budgetAnswer(ctx, q); }
    case 'sunset': {
      const d = dayOf(date); if (!d) return tipsAnswer(q, ctx);
      const r = tipsAnswer(q, ctx), sp = sunsetSpot(d); r.title = `Sunset ${d.date === ctx.today ? 'today' : 'on ' + dateLabel(d.date)}: ${d.sunset}`;
      r.quick = sp && /(where|watch|see|spot|place|وين|فين|اين)/.test(q) ? `Sunset ${d.sunset} ${sp.where}${sp.then}.` : `Sunset on ${dateLabel(d.date)} in ${d.city}: ${d.sunset}.${sp ? ` Your plan: ${sp.where}.` : ''}`;
      r.blocks = [...r.blocks.filter(b => b.t !== 'table'), ...r.blocks.filter(b => b.t === 'table')];   // the 14-day table goes last
      return Object.assign(r, { date: d.date, subject: { kind: 'day', id: d.date } });
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
    case 'money': return budgetAnswer(ctx, q);
    case 'spent': return spentAnswer(ctx, date, q);
    case 'transport': return transportAnswer(q, date, ctx);
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
    return { title: n > 1 ? `${n} days to go` : n === 1 ? 'You fly tomorrow night' : 'You fly tonight', quick: `${n > 1 ? `${n} days to go` : n === 1 ? 'You fly tomorrow night' : 'You fly tonight'}: ${cfg(ctx).departText || dateLabel(first)}.`,
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
// "is it open", "can we go in now", "grand bazaar open today?": a yes/no question about a place
const YESNO = (q) => /^(is|are|can|could|will|does|do|هل|نقدر|ممكن|بنقدر|نستطيع)\s/.test(q) || (/(^|\s)(open|opened|closed|مفتوح|مقفول)(\s|$)/.test(q) && !/(^|\s)(what|when|which|where|how|until|till|متي|ايش|شو|وين|فين)(\s|$)/.test(q));
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
  let sp = pairs.map(([a, b]) => [toMin(a), toMin(b)]).filter(([a, b]) => a != null && b != null).sort((x, y) => x[0] - y[0]);
  // the hours text is the source: "daily about 09:00–19:30" sets the close, "Friday closed about 12:00–14:30" is a gap, not a later opening
  const fx = hoursFix(s), g = fx.gaps[wd], n = sp.length - 1;
  if (fx.daily && n >= 0 && !allDay(sp) && sp[n][1] !== fx.daily[1] && Math.abs(sp[n][1] - fx.daily[1]) <= 60) sp[n] = [sp[n][0], fx.daily[1]];
  if (g && sp.length) sp = sp[0][0] >= g[1] && fx.daily && fx.daily[0] < g[0] ? [[fx.daily[0], g[0]], ...sp] : sp.flatMap(([a, b]) => a < g[0] && b > g[1] ? [[a, g[0]], [g[1], b]] : [[a, b]]);
  return sp;
}
const HFX = new WeakMap();
// what the hours text adds to the table: a daily range, a closed gap on one weekday, the last entry
function hoursFix(s) {
  if (HFX.has(s)) return HFX.get(s);
  const h = String(s.hours || ''), m = /\bdaily (?:about )?(\d{1,2}:\d{2})\s*[–-]\s*(\d{1,2}:\d{2})/i.exec(h), gaps = {};
  for (const g of h.matchAll(/\b(mon|tues|wednes|thurs|fri|satur|sun)days? closed (?:about )?(\d{1,2}:\d{2})\s*[–-]\s*(\d{1,2}:\d{2})/gi)) gaps[WEEKDAY_EN.findIndex(w => w.toLowerCase().startsWith(g[1].toLowerCase()))] = [toMin(g[2]), toMin(g[3])];
  // the note's own rule for a working mosque: "avoid Friday noon prayer (about 12:15–14:00)"
  for (const g of String(s.note || '').matchAll(/\b(mon|tues|wednes|thurs|fri|satur|sun)day noon prayer \(about (\d{1,2}:\d{2})\s*[–-]\s*(\d{1,2}:\d{2})\)/gi)) { const i = WEEKDAY_EN.findIndex(w => w.toLowerCase().startsWith(g[1].toLowerCase())); if (!gaps[i]) gaps[i] = [toMin(g[2]), toMin(g[3])]; }
  // a closed gap every day: "Daily 09:00–18:30 (day) and 19:30–22:00 (night session); closed 18:30–19:30"
  const every = /(?:^|[;,.(]\s*)closed (?:about )?(\d{1,2}:\d{2})\s*[–-]\s*(\d{1,2}:\d{2})/i.exec(h);
  if (every) for (let i = 0; i < 7; i++) if (!gaps[i]) gaps[i] = [toMin(every[1]), toMin(every[2])];
  // "last entry 17:00", "ticket office and last entry 17:00", "ticket office 09:00–17:00" (a range: its end is the last entry)
  const last = /(?:last (?:tickets?|entry|admission)|ticket office(?: and last entry)?)\s*(?:at\s*)?(\d{1,2}:\d{2})(?:\s*[–-]\s*(\d{1,2}:\d{2}))?/i.exec(h);
  const r = { daily: m ? [toMin(m[1]), toMin(m[2])] : null, gaps, last: last ? toMin(last[2] || last[1]) : null };
  HFX.set(s, r);
  return r;
}
// "Realistic windows: 08:30–12:10, 13:10–15:10, 16:15–17:00" on the date the prayer note names
function prayerWindows(s, iso) {
  const n = String(s.prayerNote || ''), m = /windows?:\s*((?:\d{1,2}:\d{2}\s*[–-]\s*\d{1,2}:\d{2}[,;\s]*(?:and\s*)?)+)/i.exec(n);
  return m && n.includes(dateLabel(iso)) ? [...m[1].matchAll(/(\d{1,2}:\d{2})\s*[–-]\s*(\d{1,2}:\d{2})/g)].map(x => [toMin(x[1]), toMin(x[2])]) : null;
}
// busy-for-prayer times the note gives for that date: "busy about 15:25–16:20", "Avoid about 15:25–16:15", "asked out from about 17:55"
function prayerBusy(s, iso) {
  const n = String(s.prayerNote || ''); if (!n.includes(dateLabel(iso))) return [];
  const out = [...n.matchAll(/(?:busy|avoid|closed|step out|wait outside)[^.;:]*?(\d{1,2}:\d{2})\s*[–-]\s*(\d{1,2}:\d{2})/gi)].map(m => [toMin(m[1]), toMin(m[2])]);
  const from = /asked out from (?:about )?(\d{1,2}:\d{2})/i.exec(n); if (from) out.push([toMin(from[1]), 1440]);
  return out.filter(([a, b]) => a != null && b != null && b > a);
}
// open spans minus the busy windows
const cutSpans = (sp, busy) => busy.reduce((acc, [x, y]) => acc.flatMap(([a, b]) => b <= x || a >= y ? [[a, b]] : [...(a < x ? [[a, x]] : []), ...(b > y ? [[y, b]] : [])]), sp);
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
      // now-aware: prayer windows of the day, a closed gap (Friday prayer), the last entry before closing
      // the prayer note's own busy times for this date cut the open spans ("busy about 15:25–16:20: go inside after ~16:20")
      const m = ctx.nowMin, win = prayerWindows(s, iso), busy = win ? [] : prayerBusy(s, iso), live = win || (busy.length ? cutSpans(sp, busy) : sp), cur = live.find(([a, b]) => a <= m && m < b), later = live.find(([a]) => a > m);
      const isBusy = (a, b) => busy.some(([x, y]) => x <= a + 1 && y >= b - 1);
      const last = !win && cur && hoursFix(s).last != null && hoursFix(s).last < cur[1] ? hoursFix(s).last : null, gapWhy = win ? ' for prayer' : hoursFix(s).gaps[dowOf(iso)] && dowOf(iso) === 5 ? ' (Friday prayer)' : '';
      // between two open spans (a prayer gap): how long to wait, not "it opens at"
      const gapEnd = !cur && later && live.filter(([, b]) => b <= m).pop();
      const gapTxt = (a, b) => isBusy(a, b) ? `busy with prayer about ${hm(a)}–${hm(b)}` : `closed ${hm(a)}–${hm(b)}${gapWhy}`;
      let now = cur ? `It is open now (${hm(m)}), until ${untilHm(cur[1])}${busy.some(([x]) => x === cur[1]) ? ' (then visitors are asked out for prayer)' : ''}.`
        : gapEnd ? (isBusy(gapEnd[1], later[0]) ? `Not yet — wait about ${spanTxt(later[0] - m)}: the mosque is ${gapTxt(gapEnd[1], later[0])}; go inside from about ${hm(later[0])}.`
          : `Not yet — wait about ${spanTxt(later[0] - m)}: it is ${gapTxt(gapEnd[1], later[0])}; visitors are welcome again from ${hm(later[0])}.`)
        : later ? `Right now (${hm(m)}) it is closed; it opens at ${hm(later[0])}.` : `It has closed for today (now ${hm(m)}).${nx ? ` Next open: ${nx}.` : ''}`;
      tone = cur ? 'ok' : later ? 'gold' : 'red';
      if (cur && later) now = `It is open now (${hm(m)}), but only until ${hm(cur[1])}${cur[1] - m <= 20 ? ', so hurry' : ''}; then ${gapTxt(cur[1], later[0])}, open again ${hm(later[0])}–${endHm(later[1])}.`;
      if (last != null && m >= last - 5) { now = m <= last + 5 ? `Only just: last tickets are at ${hm(last)} (it closes ${untilHm(cur[1])}).` : `Too late to go in today: the last entry was ${hm(last)} (it closes ${untilHm(cur[1])}).`; tone = m <= last + 5 ? 'gold' : 'red'; }
      else if (last != null && last - m <= 90) now += ` Last entry ${hm(last)}.`;
      const yn = YESNO(q) ? (tone === 'ok' ? 'Yes — ' : tone === 'red' ? 'No — ' : '') : '';
      title = last != null && m >= last - 5 ? `${name}: ${m <= last + 5 ? 'only just' : 'too late to enter'} (last entry ${hm(last)})` : asksNow ? `${name}: ${cur ? `open now, until ${untilHm(cur[1])}` : gapEnd && isBusy(gapEnd[1], later[0]) ? `busy with prayer now, go in from ${hm(later[0])}` : later ? `closed now, opens ${hm(later[0])}` : 'closed now'}` : `${name}: open today, ${spanText(sp)}`;
      verdict = `${yn}${asksNow ? `${now} Today: ${spanText(sp)}.` : `Open today (${dateLabel(iso)}): ${spanText(sp)}. ${now}`}${planDay(cur || later ? '' : nx || '')}`;
    } else if (generic) { title = `${name}: open on ${WD}s, ${spanText(sp)}`; verdict = `Open on ${WD}s: ${spanText(sp)}.${planDay()}`; }
    else { title = `${name}: open on ${dateLabel(iso)}, ${spanText(sp)}`; verdict = `Open on ${dateLabel(iso)}: ${spanText(sp)}.${planDay()}`; }
    if (s.outsideOnly) verdict += ' You can only see it from outside.';
  }
  if (s.prayerNote && known && !never) verdict += ` ${s.prayerNote}`;
  // "dolmabahce last entry": the last entry first
  const lastQ = /(last (entry|entrance|admission|ticket|tickets)|ticket office)/.test(q), lastE = known ? hoursFix(s).last : null;
  if (lastQ) { verdict = lastE != null ? `Last entry ${hm(lastE)} (ticket office). ${verdict}` : `The app has no last-entry time for ${name}. ${verdict}`; if (lastE != null) title = `${name}: last entry ${hm(lastE)}`; }
  if (known && YESNO(q) && !/^(Yes|No) — /.test(verdict) && (tone === 'ok' || tone === 'red')) verdict = `${tone === 'ok' ? 'Yes' : 'No'} — ${verdict}`;   // a yes/no question gets yes or no first
  verdict = verdict.replace(/^(Yes|No) — (It|Open|Right|Only|Too)\b/, (_, a, b) => `${a} — ${b.toLowerCase()}`);
  // the plan's own lines about the place ("take exterior photos; do not enter the palace")
  const lines = d ? [...(d.plan || []), ...(d.fixed || [])].filter(p => sightNames(s).some(a => { const n = norm(a); return n.length >= 4 && norm(p).includes(n); })).slice(0, 2) : [];
  const blocks = [CALL(verdict, tone, 'Opening hours'), ...(lines.length ? [H(`In your plan · ${dateLabel(d.date)}`), L(lines)] : []),
    KV([['Hours', s.hours || ''], ['Closed', s.closed || ''], ['In your plan', d && !lines.length ? `${dateLabel(d.date)} · ${d.title}` : ''], ['Note', s.note || '']].filter(r => r[1])),
    ...(s.source || s.checked ? [P(`Source: ${srcText(s)}. Hours can change on holidays; check on the day.`, { muted: true })] : [])];
  return { title, blocks, noQuick: true, sight: s.id, date: iso, subject: { kind: 'sight', id: s.id },
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
    title: `${dateLabel(d.date)} · ${d.title}`, blocks, date: d.date, subject: { kind: 'day', id: d.date },
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
    blocks.push(CALL(`${nxt.modeText}: ${plainLabel(nxt.label)}${nxt.dur ? ' · ' + nxt.dur : ''}.${st.guessed ? ' No fixed time: this is my estimate from the plan. Tap Done on Today when you finish a step.' : ''}`, 'sea', nxt.time ? `At ${at(nxt)}` : `About ${tl.get(nxt)?.at}`));
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
  ['سليمانيه', 'suleymaniye'], ['برج فتاه', 'maidens tower'], ['برج البنت', 'maidens tower'], ['صهريج', 'basilica cistern'], ['ايوب سلطان', 'eyup sultan'], ['ايوب', 'eyup'], ['بيت العشق الممنوع', 'vehbi koc'], ['قصر العشق الممنوع', 'vehbi koc']].map(([a, e]) => [norm(a), e]);
const arPlaces = (q) => AR.test(q) ? AR_SIGHTS.reduce((s, [a, e]) => s.replace(new RegExp(`(^|\\s)(?:و|ب|ل|ف)?${reEsc(a)}(?=\\s|$)`, 'g'), `$1${e}`), q) : q;
function flightAnswer(q0, ctx, force = null) {
  const q = withAr(q0);
  const fl = ctx.content.bookings.filter(b => b.kind === 'flight').sort((a, b) => (a.dateIso || '').localeCompare(b.dateIso || ''));
  let pick = fl;
  const named = force || bestByAlias(q, fl);
  const checkQ = /check ?-?in/.test(q) && /(online|web|app)/.test(q);
  const landQ = /(^|\s)(land|landing|lands|landed|arrive|arrives|arrival|arriving|terminal|نوصل|نهبط)(\s|$)/.test(q);
  const bagQ = /(^|\s)(bag|bags|baggage|luggage|suitcase|allowance|kg|kilo|kilos|weight|شنط|عفش|وزن)(\s|$)/.test(q), seatQ = /(^|\s)(seat|seats|مقعد|مقاعد)(\s|$)/.test(q);
  const refQ = /(reference|pnr|confirmation|booking number|booking code|(^|\s)ref(\s|$))/.test(q);
  // an airline named ("turkish airlines", "flydubai"): its bookings only; "when do we land in antalya": the booking that ends there
  const air = fl.filter(b => { const a = norm((b.subtitle || '').split(' · ')[0]); return a && q.includes(a); });
  const dest = !named && landQ ? fl.find(b => { const to = norm(String(b.title || '').split(' → ').pop()); return to && has(q, [to]); }) : null;
  const singular = /(^|\s)(next|our|my|the) flight(\s|$)/.test(q) && !/flights/.test(q) || /(^|\s)(رحلتنا|طيارتنا|طياره)(\s|$)/.test(q) || /boarding|e-ticket/.test(q) || checkQ
    || (/(tonight|tomorrow|when)/.test(q) && !/flights/.test(q));
  const route = !named && fl.filter(b => { const e = String(b.title || '').split(' → ').map(norm); return e.length === 2 && e.every(x => x && has(q, [x])); });
  if (named) pick = [named]; else if (route?.length === 1) pick = route; else if (dest) pick = [dest]; else if (air.length && air.length < fl.length) pick = air;
  else if (/(^|\s)next(\s|$)/.test(q) || checkQ || singular) { const nx = fl.find(b => (b.dateIso || '') >= ctx.today) || fl[fl.length - 1]; if (nx) pick = [nx]; }
  if (!pick.length) pick = fl;
  // a day named ("seats for tonight", "our flight tomorrow"): the flight of that day, a night flight counting for the evening before
  const dq = !named && !force && findDate(q, ctx), byDay = dq && flightFor(q, dq, ctx);
  const onDay = byDay && (byDay.b.dateIso === dq || (byDay.dep?.min < 360 && byDay.b.dateIso === isoAdd(dq, 1) && /(tonight|night)/.test(q))) ? byDay.b : null;
  if (onDay) pick = [onDay];
  if (bagQ && !named && !onDay && route?.length !== 1) pick = [...fl.filter(b => (b.dateIso || '') >= ctx.today), ...fl.filter(b => (b.dateIso || '') < ctx.today)];   // allowances: the next flight first
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
  const fno = (b) => (b.legs || []).map(l => l.flight).join(' + ');
  const lastL = one?.legs?.[one.legs.length - 1], arr = lastL && /^([A-Z]{3})(?:\s+(T\d))?\s+(\d{1,2}:\d{2})/.exec(lastL.to || '');
  const relQ = /(tonight|tomorrow|when|what time)/.test(q) && one?.dateIso && dep != null;
  const quick = callQ ? `${airline || one.title}: call ${one.phone}. Booking ${one.confirmation || '—'}.`
    : ct ? `${ct.title} — ${tNote(ct, ctx)}.${ct.note ? ' ' + ct.note : ''}`
    : seatQ && onDay ? `${/tonight/.test(q) ? 'Tonight' : cap(dayRel(dq, ctx))}: ${(onDay.legs || []).map(l => `${l.flight} ${l.from} → ${l.to}, seats ${l.seats || '—'}`).join('; ')}.`
    : seatQ ? `Seats: ${pick.map(b => `${(b.legs || []).map(l => `${l.flight} ${l.seats || '—'}`).join(', ')} (${b.title})`).join('; ')}.`
    : bagQ ? `Bags: ${pick.map(b => `${fno(b)} (${b.title}): ${b.bags || 'not listed'}`).join('; ')}.`
    : refQ ? `${pick.length > 1 && air.length ? (air[0].subtitle || '').split(' · ')[0] + ' refs' : 'Booking ref'}: ${pick.map(b => `${b.confirmation || '—'} (${b.title}, ${fno(b)})`).join(' and ')}.`
    // "when is the plane and when do we land": both, the departure first
    : landQ && arr && relQ && /(flight|plane|fly|leave|leaves|depart|take off|طياره)(\s.*)?(when|what time)|(when|what time)(\s.*)?(flight|plane|fly|leave|depart)/.test(q) && !/(^|\s)(land|lands|landing)(\s|$)/.test(q.split(/\s(?:and|w)\s/)[0])
      ? `${cap(flightWhen(one.dateIso, dep, ctx))}: ${one.legs.map(l => `${l.flight} ${l.from} → ${l.to}`).join(', then ')}; you land at ${arr[3]}${arr[2] ? ` (${String(one.title).split(' → ').pop()} Terminal ${arr[2].slice(1)})` : ''}.`
    : landQ && arr ? `Lands ${arr[3]} on ${dateLabel(one.dateIso)}: ${lastL.flight} ${lastL.from} → ${lastL.to} (${String(one.title).split(' → ').pop()}${arr[2] ? ` Terminal ${arr[2].slice(1)}` : ''}).${/terminal/.test(q) && !arr[2] ? ' The booking does not list the terminal: check the airport screens or the airline app.' : ''}${(Array.isArray(one.notes) ? one.notes : []).filter(n => /land/i.test(n)).map(n => ' ' + n).join('')}`
    : relQ ? `${cap(flightWhen(one.dateIso, dep, ctx))}: ${one.legs.map(l => `${l.flight} ${l.from} → ${l.to}`).join(', then ')}.`
    : one?.legs?.length ? `${one.legs.map(l => `${l.flight} ${l.from} → ${l.to}`).join(', then ')}${one.dateIso ? ` on ${dateLabel(one.dateIso)}${night}` : ''}. Booking ${one.confirmation || '—'}.` : null;
  return { title: one ? `${one.title} · ${one.dates}` : `Your ${pick.length} flights`, blocks, quick, date: one?.dateIso || null, subject: one ? { kind: 'booking', id: one.id } : null,
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
  const outQ = /check ?-?out|checkout/.test(q), inQ = /check ?-?in|checkin/.test(q) && !/online|web/.test(q);
  // check-out on a day: the hotel you leave that morning, not the next one
  const leaving = outQ && date && hs.find(h => !['to-cancel', 'cancelled'].includes(h.status) && checkoutIso(h, ctx) === date);
  const pick = bestByAlias(q, hs) || backup || leaving || hotelForDate(date || ctx.todayInTrip || ctx.today, ctx) || hs[0];
  const blocks = [P(pick.subtitle || '', { muted: true }), ...bookingBlocks(pick)];
  const others = hs.filter(h => h !== pick && !['to-cancel', 'cancelled'].includes(h.status));
  // a cancelled booking: nothing to do, except the refund to-do if there is one
  const key = norm(pick.title).split(' ')[0];
  const refund = pick.status === 'cancelled' ? ctx.content.todos.filter(t => /refund/i.test(t.title) && norm(t.title).includes(key)) : [];
  // "where do we sleep tonight", "call the hotel": one line first
  const iso = date || ctx.todayInTrip, callQ = CALLQ.test(q) && !!pick.phone;
  const boardQ = /(breakfast|board|all inclusive|included|include|فطور|فطار)/.test(q) && !!pick.board;
  const quick = pick.status === 'cancelled' ? `Nothing to do: ${pick.title} is already cancelled. ${pick.cancel || ''}${refund.map(t => ` To-do: ${t.title} — ${tNote(t, ctx)}.`).join('')}`.trim()
    : callQ ? `${pick.title}${pick.phase ? ` (${pick.phase})` : ''}: call ${pick.phone}.`
    : outQ && pick.checkout ? checkoutLine(pick, date, ctx, q) : inQ && pick.checkin ? `${pick.title}: check-in ${pick.checkin}.`
    : boardQ || (/(included|include|free)/.test(q) && pick.board) ? (() => { const it = (/(breakfast|minibar|drinks|meals?|wifi|parking|spa|room service|pool|beach)/.exec(q) || [])[1];
      return it && !new RegExp(it.replace(/s$/, ''), 'i').test(norm(`${pick.board} ${pick.subtitle || ''}`)) ? `${cap(it)} is not listed on the ${pick.short || pick.title} booking. The board: ${pick.board} Ask reception.` : `${pick.short || pick.title}: ${pick.board}`; })()
    : /(address|location|where is|عنوان)/.test(q) && pick.address ? `${pick.title}: ${pick.address}.${pick.driverCard ? ' Tap “Show the driver” for the Turkish card.' : ''}`
    : iso && !bestByAlias(q, hs) && /(^|\s)(sleep|stay|staying|tonight|نام|ننام|نسكن|نبات)(\s|$)|(which|what) hotel|اي فندق|اين فندق|وين فندق/.test(q) ? `${dateLabel(iso)}: ${pick.title}${pick.address ? ', ' + pick.address : ''}.`
    : ownNote(pick, q);
  const call = pick.phone && { act: 'url', href: telOf(pick.phone), label: callQ ? `Call ${pick.short || pick.title.split(' ')[0]}` : 'Call', icon: 'phone' };
  return { title: pick.status === 'cancelled' ? `${pick.title} (cancelled)` : pick.title, blocks, quick, date: date || null, subject: { kind: 'booking', id: pick.id },
           actions: [callQ && call, { act: 'pdf', label: 'Download PDF', icon: 'download' }, pick.file && { act: 'doc', id: pick.file, label: 'Open the booking', icon: 'filetext' },
                     pick.driverCard && !['to-cancel', 'cancelled'].includes(pick.status) && { act: 'driver', id: pick.driverCard, label: 'Show the driver', icon: 'navigation' },
                     !callQ && call].filter(Boolean),
           pdf: { title: pick.title, subtitle: pick.subtitle || '', blocks, filename: `${filePrefix(ctx)}-${slug(pick.title)}.pdf` },
           suggestions: [...others.map(h => `${h.short || h.title} hotel`), 'Airport pickup', 'My flights'] };
}

// the picked booking's own note that answers the question ("anniversary decoration" → its special request), never another hotel's
function ownNote(b, q) {
  const ws = q.split(' ').filter(w => w.length >= 4 && !STOP.has(w) && !GENERIC.has(w) && !(b.aliases || []).map(norm).includes(w) && !(b.keywords || []).map(norm).includes(w));
  if (!ws.length) return null;
  let best = null, bs = 0;
  for (const s of sentences(b.notes, b.cancel)) { const n = norm(s), sc = ws.filter(w => wordRe(w).test(n) || (w.length >= 6 && n.includes(w.slice(0, -1)))).length; if (sc > bs) { best = s; bs = sc; } }
  return best ? `${b.short || b.title}: ${best}` : null;
}
function shuttleAnswer(ctx, q = '') {
  const C = ctx.content, S = C.bookings.filter(b => b.kind === 'transfer');
  // the ride that matters: in the city the question names, else the next one from now
  const rides = C.days.flatMap(d => (d.trips || []).filter(t => t.mode === 'shuttle').map(t => ({ d, t })));
  const city = rides.map(x => x.d.city).find(c => c && has(q, [c]));
  const pool = city ? rides.filter(x => x.d.city === city) : rides;
  const nx = pool.find(x => x.d.date > ctx.today || (x.d.date === ctx.today && (tripMinutes(x.t) ?? 1440) >= (ctx.nowMin ?? 0) - 30)) || (city ? pool[0] : null);
  const nb = nx && transferOf(nx.t, nx.d, C)?.b;
  const who0 = nb && String(nb.via || nb.title).split(' · ').pop(), notes = nb ? (Array.isArray(nb.notes) ? nb.notes : [nb.notes]).filter(Boolean) : [];
  const fromAir = nx && /airport/i.test(nx.t.from), contact = nb ? `${nb.phone || ''}${nb.whatsapp ? ` (WhatsApp ${nb.whatsapp})` : ''}${nb.confirmation ? `, booking ${nb.confirmation}` : ''}` : '';
  // "driver not here", "who do we call": the numbers first; "we landed, where is the driver": where they wait
  const lateQ = /(not here|nobody|no one|noone|late|no show|not come|didnt come|hasnt come|who do we call|who to call|call|number|phone|contact|whatsapp|متاخر|ما جا|ماجا)/.test(q) && !!nb;
  const whereQ = fromAir && /(where|landed|land|arrived|meet|waiting|wait|find|cant see|وين|فين)/.test(q) && notes.length;
  const taxiQ = /(taxi|cab|تاكسي)/.test(q) && nx && /airport/i.test(nx.t.to);
  // at the meeting point and nobody there: how long the van takes to come, how long they wait, then the numbers
  const atSign = lateQ && fromAir && /(nobody|no one|noone|not here|no driver|cant see|cant find)/.test(q);
  const rd = atSign && factsFor(C).rides.find(r => r.t === nx.t), vanS = atSign ? notes.flatMap(n => sentences(n)).filter(s => /(van comes|after you reach|wait up to|after landing)/i.test(s)) : [];
  const vanTxt = vanS.map(s => /(wait up to|after landing)/i.test(s) && rd?.until != null ? s.replace(/\.$/, ` (until about ${hm(rd.until)}).`) : s).join(' ');
  const quick = !nx ? null : atSign && vanS.length ? `${vanTxt} If nobody comes, call ${who0} ${nb.phone || ''}${nb.whatsapp ? ` or WhatsApp ${nb.whatsapp}` : ''}${nb.confirmation ? ` (booking ${nb.confirmation})` : ''}.`
    : lateQ ? `Call ${who0} ${nb.phone || ''}${nb.whatsapp ? ` or WhatsApp ${nb.whatsapp}` : ''}${nb.confirmation ? ` (booking ${nb.confirmation})` : ''}. ${nx.d.date === ctx.today ? 'Today' : dateLabel(nx.d.date)}${nx.t.time ? ' ' + nx.t.time : ''}: ${nx.t.label}${nx.t.dur ? ' · ' + nx.t.dur : ''}.`
    : whereQ ? `${notes.filter(n => /^(arrival|if you cannot|the van|they wait)/i.test(n)).join(' ')}${nb.phone && !notes.join(' ').includes(nb.phone) ? ` Call ${who0}: ${nb.phone}.` : ''}`
    : `${taxiQ ? `No taxi needed: your paid ${who0 || 'transfer'} takes you. ` : ''}${nx.d.date === ctx.today ? 'Today' : dateLabel(nx.d.date)}${nx.t.time ? ' ' + nx.t.time : ''}: ${nx.t.label}${nx.t.dur ? ' · ' + nx.t.dur : ''}.`
      + (nb ? ` ${who0}: ${contact}.` : '');
  const blocks = [];
  if (cfg(ctx).shuttleNote) blocks.push(CALL(cfg(ctx).shuttleNote, 'gold'));
  const legs = ctx.content.days.flatMap(d => (d.trips || []).filter(t => t.mode === 'shuttle').map(t => [dateLabel(d.date), t.label, t.time || '—', t.dur || '']));
  if (legs.length) { blocks.push(H('Your shuttle rides')); blocks.push(TABLE(['Day', 'Ride', 'Time', 'Note'], legs, { columns: { 0: { cellWidth: 24 }, 2: { cellWidth: 16 } } })); }
  for (const b of S) { blocks.push(H(b.title)); blocks.push(...bookingBlocks(b)); }
  const paid = S.length && S.every(b => b.status === 'paid');
  const who = nb && String(nb.via || nb.title).split(' · ').pop();
  return { title: `Airport shuttles${paid ? ' (paid)' : ''}`, blocks, quick, date: nx?.d.date || null, subject: nb ? { kind: 'booking', id: nb.id } : null,
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
    } else if (iso) {
      // nothing named: the card for where the next ride goes today ("22 Oct · Bebek pier"), else the hotel of the day's city
      const sb = ctx.prev?.subject?.kind === 'booking' && C.bookings.find(b => b.id === ctx.prev.subject.id), hb = hotelForDate(iso, ctx);
      const d = dayAt(ctx, iso), now = iso === ctx.today ? ctx.nowMin ?? 0 : -1;
      const nx = d && tripClock(d, ctx).find(x => !x.t.pseudo && x.min >= now - 10 && /(taxi|shuttle)/.test(x.t.mode));
      const dest = nx && cards.find(c => aliasScore(norm(nx.t.to), c.aliases) > 0 && (!c.fromIso || c.fromIso <= iso) && (!c.toIso || iso <= c.toIso));
      const own = sb?.driverCard && cards.find(c => c.id === sb.driverCard), home = hb?.driverCard && cards.find(c => c.id === hb.driverCard);
      pick = [own || dest || home].filter(Boolean);
    }
  }
  if (!pick.length) pick = cards;
  const blocks = [];
  pick.forEach((c, i) => { if (i) blocks.push({ t: 'pagebreak' }); blocks.push(H(c.title)); blocks.push({ t: 'big', text: c.tr }); blocks.push(P(c.en, { muted: true })); });
  const short = (c) => c.title.includes(' · ') ? c.title.split(' · ').slice(1).join(' · ') : c.title;
  return { title: pick.length === 1 ? pick[0].title : 'Show-the-driver cards', blocks, quick: pick.length === 1 && !all ? `Show the driver the “${pick[0].title}” card: ${pick[0].en}.` : null,
           actions: [...pick.slice(0, 4).map(c => ({ act: 'driver', id: c.id, label: `Show: ${short(c)}`, icon: 'navigation' })), { act: 'pdf', label: 'Download PDF', icon: 'download' }],
           pdf: { title: 'Show the driver', subtitle: 'Big Turkish text for taxi drivers', blocks, filename: pick.length === 1 ? `${filePrefix(ctx)}-driver-${pick[0].id}.pdf` : `${filePrefix(ctx)}-driver-cards.pdf` },
           suggestions: ['Taxi rules', 'Turkish phrases'] };
}

function foodAnswer(q, date, venue, ctx) {
  if (venue && (!date || venue.day === date) && !/(options|where|list|all|places|near|around)/.test(q)) return venueAnswer(venue, ctx, q);   // "cafe son open today": that place
  const C = ctx.content;
  let vs = C.venues.slice();
  const kinds = [/(shisha|hookah|nargile|argileh|شيشه)/.test(q) && 'shisha', /(coffee|cafe|قهوه|كافيه)/.test(q) && 'coffee', /(breakfast|فطار|فطور)/.test(q) && 'breakfast',
                 /(lunch|dinner|meal|restaurant|غداء|عشاء|مطعم)/.test(q) && 'meal'].filter(Boolean);
  const kind = kinds.length === 1 ? kinds[0] : null;
  const nearH = NEARHQ.test(q), listQ = /(^|\s)(options?|alternatives?|list|all|places|every|which|best|any|other|others)(\s|$)/.test(q);
  const words = q.split(' ').filter(w => w.length > 3 && !STOP.has(w) && !FOODW.has(w) && !['hungry', 'starving', 'famished', 'where', 'tonight', 'today', 'tomorrow', 'sunset', 'what', 'time', 'plan', 'much', 'whats'].includes(w) && !(nearH && ['hotel', 'resort', 'near', 'close'].includes(w)));
  // during the trip a meal question with no day means today ("lunch where", "we are hungry", "shisha tonight")
  const areaHit = words.some(w => C.venues.some(v => norm(`${v.area} ${v.name} ${v.view || ''}`).includes(w)));
  if (!date && ctx.todayInTrip && !listQ && !areaHit && (kinds.length || MEALQ.test(q) || nearH || /(^|\s)(where|hungry)(\s|$)/.test(q))) date = ctx.todayInTrip;
  if (date) vs = vs.filter(v => v.day === date);
  if (kinds.length) vs = vs.filter(v => kinds.includes(v.kind) || (kinds.includes('meal') && v.kind === 'breakfast'));
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
  // the answer first: the chosen place of the day (or what the plan says instead), then the list
  const pickd = nearH ? nearHotelText(date, kinds, q, ctx) : date && !listQ && !byArea.length ? mealPick(date, kinds, q, ctx)
    : vs.length && !listQ && (vs.length === 1 || byArea.length) ? { v: vs[0], text: `${cap(relDay(vs[0].day, ctx))}: ${venueLine(vs[0], ctx, { price: PRICEQ.test(q) })}.` } : null;
  let quick = pickd?.text || null;
  const sd = /(sunset|غروب)/.test(q) && dayAt(ctx, date || ctx.todayInTrip), ss = sd && sunsetSpot(sd);
  if (quick && sd) quick = `Sunset ${sd.sunset}${ss ? ' ' + ss.where : ''}. ${quick}`;   // "what time is sunset and where do we have shisha tonight"
  const note = P(`${vs.length} place${vs.length === 1 ? '' : 's'}. Prices are for two: a main meal is 2 mains, 1 appetizer and 2 soft drinks; shisha is 1 shisha, a Turkish coffee and a tea with mint.`, quick ? { muted: true } : {});
  const table = TABLE(['Place', 'Day', 'What', 'Area', 'Cost for two', 'Notes'], venueRows(vs), { size: 8.4, columns: { 0: { cellWidth: 30 }, 1: { cellWidth: 17 }, 2: { cellWidth: 20 }, 4: { cellWidth: 25 } } });
  const blocks = quick ? [table, note] : [note, table];
  if (date && !vs.length) blocks.push(P('Nothing is planned for that day.'));
  const optDay = C.venues.find(v => v.status === 'option')?.day;
  return { title, blocks, venues: vs.map(v => v.id), quick, date: date || pickd?.v?.day || null, subject: pickd?.v ? { kind: 'venue', id: pickd.v.id } : undefined,
           actions: [{ act: 'pdf', label: 'Download PDF', icon: 'download' }],
           pdf: { title, subtitle: `Food & drink · ${C.meta.title}`, blocks, filename: `${filePrefix(ctx)}-food${date ? '-' + monTag(date) : ''}${kind ? '-' + kind : ''}.pdf` },
           suggestions: ['Shisha places', ...(optDay && optDay !== date ? [`Dining options on ${dateLabel(optDay)}`] : []), 'Fish by the kilo tips'] };
}

function venueAnswer(v, ctx, q = '') {
  const d = ctx.content.days.find(x => x.date === v.day);
  if (/(^|\s)(open|opened|opens|closed|close|closes|hours|opening|late)(\s|$)/.test(q) && !/(how much|price|cost|bill)/.test(q)) {
    const key = norm(v.name.split(' (')[0]);
    const line = d && [...(d.plan || []), ...(d.fixed || [])].find(p => norm(p).includes(key));
    const r = venueAnswer(v, ctx), hrs = venueHours(v, q, null, ctx);   // "closes 19:00 on Thursday", "from 09:30", "confirm Tuesday service"
    r.quick = hrs || `${v.name} is in your plan on ${dateLabel(v.day)}${line ? `: ${line}` : '.'} Opening hours are only in the app where the plan mentions them.`;
    return r;
  }
  const blocks = [KV([['Day', d ? `${dateLabel(v.day)} · ${d.title}` : dateLabel(v.day)], ['What', KIND[v.kind] || v.kind], ['Where', v.area], ['Cost for two', v.cost],
                      ...(v.book ? [['Booking', v.book]] : []), ...(v.phone ? [['Phone', v.phone]] : []), ...(v.whatsapp ? [['WhatsApp', v.whatsapp]] : []), ...(v.view ? [['View', v.view]] : [])]),
                  ...(v.notes ? [P(v.notes)] : []), ...(v.status === 'option' ? [CALL('This is an alternative, not the chosen place for the day.', 'sea')] : [])];
  // is there a booking to-do for this place, and is it ticked?
  const key = norm(v.name.split(' (')[0]).split(' ').find(w => w.length >= 4 && !['the', 'cafe', 'lounge', 'old'].includes(w));
  const todo = key && ctx.content.todos.find(t => norm(t.title).includes(key));
  const ts = todo && tState(todo, ctx);
  // "we're at nusret now": no "book it" reminder once you are there (or its time has come)
  const vt = v.day === ctx.today ? toMin(venueVisit(v, ctx).at) : null, there = /(we are at|were at|we re at|im at|i am at|we are in|sitting at|here at|we are here)/.test(q) || (vt != null && (ctx.nowMin ?? 0) >= vt);
  if (todo && !(there && ts !== 'done')) blocks.unshift(CALL(`${todo.title}: ${ts === 'done' ? 'ticked as done ✓' : ts === 'missed' ? 'not ticked, and the day has passed' : `not ticked yet (${tNote(todo, ctx, ts)})`}.`, ts === 'done' ? 'ok' : 'gold', 'Booking'));
  // "call carlos terrace": the number first, and the Call / WhatsApp buttons before the map
  const callQ = CALLQ.test(q);
  const call = [v.phone && { act: 'url', href: telOf(v.phone), label: callQ ? `Call ${v.name.split(' (')[0]}` : 'Call', icon: 'phone' },
                v.whatsapp && { act: 'url', href: waOf(v.whatsapp), label: 'WhatsApp', icon: 'msgcircle' }].filter(Boolean);
  // "when is lunch at nusret": the planned time and how you get there
  const vis = /(^|\s)(when|what time|time|متي)(\s|$)/.test(q) && !callQ ? venueVisit(v, ctx) : null;
  // "how much is dinner at carlos", "the bill roughly": the cost first, then the booking still to make
  const costQ = !callQ && /(^|\s)(how much|price|prices|cost|costs|bill|roughly|expensive|كم|بكم|سعر)(\s|$)/.test(q);
  const remind = costQ && todo && !there && !['done', 'missed'].includes(ts) && v.book ? ` ${cap(bookText(v))} (not ticked yet: ${tNote(todo, ctx, ts)}).` : '';
  const walkQ = /(walk in|walk-in|without (a )?(booking|reservation)|did not book|didnt book|not booked|just show up)/.test(q);
  const quick = walkQ ? walkInLine(v, ctx) : costQ ? `${venueCost(v, ctx)}${remind}`
    : vis ? `${vis.at ? `${vis.at} ${relDay(v.day, ctx)}` : cap(relDay(v.day, ctx))} at ${v.name}${vis.inT ? ` (${reachText(vis.inT)})` : ''}${v.book ? `; ${bookText(v)}` : ''}.`
    : !callQ ? null : call.length ? `${v.name}: ${[v.phone && `call ${v.phone}`, v.whatsapp && (v.whatsapp === v.phone ? 'the same number on WhatsApp' : `WhatsApp ${v.whatsapp}`)].filter(Boolean).join(' · ')}.`
    : `No phone number for ${v.name} in the app.${v.book ? ' ' + dot(v.book) : ''}`;
  return { title: v.name, blocks, quick, date: v.day, subject: { kind: 'venue', id: v.id },
           actions: [...(callQ ? call : []), { act: 'url', href: v.maps, label: 'Map', icon: 'pin' }, ...(callQ ? [] : call),
                     v.menu && { act: 'url', href: v.menu, label: 'Menu', icon: 'filetext' }, d && { act: 'day', date: d.date, label: 'Open the day', icon: 'days' },
                     { act: 'pdf', label: 'Download PDF', icon: 'download' }].filter(Boolean),
           pdf: { title: v.name, subtitle: `${dateLabel(v.day)} · ${v.area}`, blocks, filename: `${filePrefix(ctx)}-${slug(v.name)}.pdf` },
           suggestions: [`Where do we eat on ${dateLabel(v.day)}?`, 'Shisha places'] };
}

function convertAnswer(c, ctx) {
  const r = +ctx.rate || ctx.content.money.rates.tryPerAed, e = ctx.content.money.rates.tryPerEur, u = USD_AED * r;   // no USD rate in the app: via the AED peg
  const per = { TRY: 1, AED: r, EUR: e, USD: u }, tryVal = c.amount * per[c.from], val = (cur) => tryVal / per[cur];
  const two = (n) => n.toLocaleString('en', { maximumFractionDigits: n < 100 ? 2 : 0 });
  const sym = (cur, n) => cur === 'TRY' ? `₺${two(n)}` : cur === 'AED' ? `AED ${two(n)}` : cur === 'EUR' ? `€${two(n)}` : `$${two(n)}`;
  const to = c.to && c.to !== c.from ? c.to : c.from === 'TRY' ? 'AED' : 'TRY', usd = c.from === 'USD' || to === 'USD';
  const title = `${sym(c.from, c.amount)} ≈ ${sym(to, val(to))}`;
  const rateTxt = (cur) => cur === 'EUR' ? `₺${e} per €` : cur === 'AED' ? `₺${r} per AED` : cur === 'USD' ? `$1 ≈ AED ${USD_AED} ≈ ₺${two(u)}` : '';
  const quick = usd ? (c.from === 'USD' && c.amount === 1 ? `The app has no USD rate. Via the AED peg (${USD_AED}) and ₺${r} per AED, $1 ≈ ₺${Math.round(u)}.` : `${title} (no USD rate in the app: via the AED peg, ${rateTxt('USD')}).`)
    : c.to ? `${title} (at ${rateTxt(to === 'TRY' ? c.from : to)}).` : null;
  return { title, quick, blocks: [KV([['Turkish lira', `₺${two(tryVal)}`], ['UAE dirham', `AED ${two(val('AED'))}`], ['Euro', `€${two(val('EUR'))}`], ...(usd ? [['US dollar (via the AED peg)', `$${two(val('USD'))}`]] : [])]),
           P(`Rates: AED 1 ≈ ₺${r} · €1 ≈ ₺${e}. You can change the AED rate in More → Settings. Always pay in lira.`, { muted: true })],
           subject: { kind: 'topic', id: 'convert', amount: c.amount, cur: c.from }, suggestions: ['Budget', 'How much have we spent?'] };
}

function budgetAnswer(ctx, q = '') {
  const C = ctx.content, M = C.money, B = M.budgetCheck;
  // "the whole trip": paid bookings plus the spending plan, before the Istanbul-only check
  const whole = /(whole|total|entire|overall|all in|كليه|اجمالي|كامله|كل رحله)/.test(q) && M.tripTotal?.aed;
  const quick = whole ? `Whole trip ≈ AED ${fmt(M.tripTotal.aed[0])}–${fmt(M.tripTotal.aed[1])} for two: AED ${fmt(M.settledTotalAed)} already paid (hotels, flights, shuttles) + the spending plan${M.spendPlan ? ` (≈ AED ${fmt(M.spendPlan.aed[0])}–${fmt(M.spendPlan.aed[1])})` : ''}.` : null;
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
  return { title: whole ? `Whole trip ≈ AED ${fmt(M.tripTotal.aed[0])}–${fmt(M.tripTotal.aed[1])}` : 'Budget', blocks, quick, actions: [{ act: 'pdf', label: 'Download PDF', icon: 'download' }, { act: 'tab', tab: 'money', label: 'Open Money', icon: 'wallet' }],
           pdf: { title: `Budget · ${C.meta.title}`, subtitle: 'Planned spending, paid bookings and the budget check', blocks, filename: `${filePrefix(ctx)}-budget.pdf` },
           suggestions: ['How much have we spent?', 'Where do we eat tomorrow?', '2,500 TL in AED'] };
}

function spentSummary(ctx) {
  const ex = ctx.expenses || [], rate = ctx.rate;
  let tr = 0, ae = 0; for (const e of ex) { if (e.cur === 'TRY') tr += +e.amount; else ae += +e.amount; }
  return { count: ex.length, try: tr, aedDirect: ae, aed: tr / rate + ae };
}
function spentAnswer(ctx, date = null, q = '') {
  const all = (ctx.expenses || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  if (date) {
    const day = all.filter(e => e.date === date), sp = spentSummary({ ...ctx, expenses: day });
    const d = ctx.content.days.find(x => x.date === date);
    const blocks = [CALL(day.length ? `${dateLabel(date)}: ≈ AED ${fmt(sp.aed)} logged (₺${fmt(sp.try)} + AED ${fmt(sp.aedDirect)}).` : `Nothing logged for ${dateLabel(date)} yet.`, 'sea'),
      ...(day.length ? [TABLE(['Category', 'Note', 'Amount'], day.map(e => [e.cat, e.note || '', `${e.cur === 'TRY' ? '₺' : 'AED '}${fmt(e.amount)}`]), { columns: { 2: { halign: 'right' } } })] : []),
      ...(d?.total ? [P(`The plan for that day: ${d.total}.`, { muted: true })] : [])];
    return { title: `Spent on ${dateLabel(date)}`, blocks, actions: [{ act: 'tab', tab: 'money', label: 'Open Money', icon: 'wallet' }], suggestions: ['How much have we spent?', 'Budget'] };
  }
  // "in istanbul only": the expenses of that part of the trip, with the whole trip second
  const F = factsFor(ctx.content), ph = F.phases.length > 1 && F.phases.find(p => has(withAr(q), [norm(p.city)]));
  if (ph && all.length) {
    const xs = all.filter(e => e.date >= ph.from && e.date <= ph.to), s1 = spentSummary({ ...ctx, expenses: xs }), s0 = spentSummary(ctx);
    const rng = ph.from.slice(5, 7) === ph.to.slice(5, 7) ? `${+ph.from.slice(8)}–${+ph.to.slice(8)} ${MON[+ph.to.slice(5, 7) - 1]}` : `${dateLabel(ph.from)} – ${dateLabel(ph.to)}`;
    const blocks = [CALL(`${ph.city} only (${rng}): about AED ${fmt(s1.aed)} (₺${fmt(s1.try)} + AED ${fmt(s1.aedDirect)}). The whole trip so far ≈ AED ${fmt(s0.aed)}.`, 'sea'),
      TABLE(['Date', 'Category', 'Note', 'Amount'], xs.map(e => [dateLabel(e.date), e.cat, e.note || '', `${e.cur === 'TRY' ? '₺' : 'AED '}${fmt(e.amount)}`]), { size: 9, columns: { 3: { halign: 'right' } } })];
    return { title: `Spent in ${ph.city} ≈ AED ${fmt(s1.aed)}`, blocks, actions: [{ act: 'tab', tab: 'money', label: 'Open Money', icon: 'wallet' }], suggestions: ['How much have we spent?', 'Budget'] };
  }
  const ex = all, sp = spentSummary(ctx);
  if (!ex.length) return { title: 'Nothing logged yet', blocks: [P('Log what you spend in More → Money (amount, category, note). I will add it up here and compare it with the plan.')], actions: [{ act: 'tab', tab: 'money', label: 'Open Money', icon: 'wallet' }] };
  const byCat = {}; for (const e of ex) byCat[e.cat] = (byCat[e.cat] || 0) + (e.cur === 'TRY' ? e.amount / ctx.rate : +e.amount);
  // "the whole trip": what was logged plus the bookings paid before the trip
  const paid = /(whole|total|entire|overall|all in|كليه|اجمالي|كامله)/.test(q) && ctx.content.money?.settledTotalAed;
  const blocks = [CALL(`${paid ? 'Logged on the trip' : 'Total so far'} ≈ AED ${fmt(sp.aed)} (₺${fmt(sp.try)} + AED ${fmt(sp.aedDirect)}).${paid ? ` With the AED ${fmt(paid)} paid before the trip (hotels, flights, shuttles), the whole trip ≈ AED ${fmt(sp.aed + paid)}.` : ''}`, 'sea'),
    H('By category'), TABLE(['Category', 'AED'], Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, fmt(v)]), { columns: { 1: { halign: 'right', cellWidth: 34 } } }),
    H('Every expense'), TABLE(['Date', 'Category', 'Note', 'Amount'], ex.map(e => [dateLabel(e.date), e.cat, e.note || '', `${e.cur === 'TRY' ? '₺' : 'AED '}${fmt(e.amount)}`]), { size: 9, columns: { 3: { halign: 'right' } } })];
  return { title: `Spent so far ≈ AED ${fmt(sp.aed)}`, blocks, actions: [{ act: 'pdf', label: 'Download PDF', icon: 'download' }, { act: 'tab', tab: 'money', label: 'Open Money', icon: 'wallet' }],
           pdf: { title: 'Expenses so far', subtitle: 'Logged on this phone', blocks, filename: `${filePrefix(ctx)}-expenses.pdf` }, suggestions: ['Budget'] };
}

function transportAnswer(q, date0, ctx, force = null) {
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
  const named = force ? [force] : T.ferries.filter(f => aliasScore(q, f.aliases) > 0);
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
  const askPrice = /(^|\s)(price|prices|fare|fares|cost|costs|how much|كم|بكم|سعر)(\s|$)/.test(q);
  // "ferry back": the boats back on that day's lines, and how the day's plan actually ends
  let backLine = null;
  if (backQ) {
    const d = date && ctx.content.days.find(x => x.date === date), last = d?.trips?.[d.trips.length - 1];
    const backs = fs.filter(f => (f.back || []).length && (!date || named.includes(f) || f.used === `${+date.slice(8)} ${MON[+date.slice(5, 7) - 1]}`));
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
  const smart = transportSmart(q, date, ctx, { fs, named, boatQ, backQ, onlyTaxi });
  if (smart?.moves) blocks.unshift(H(`How you move · ${dateLabel(smart.moves.date)}`), { t: 'trips', trips: smart.moves.trips });
  if (smart?.cardFirst) { const i = blocks.findIndex(b => b.t === 'h' && b.text === (T.cardTitle || 'Transport card')); if (i > 0) blocks.unshift(...blocks.splice(i, 2)); }
  const lastL = named.length === 1 && /(^|\s)last(\s|$)/.test(q) && ferryLast(named[0]);
  // a free-day idea boat: the time the idea names, and the earlier boats you cannot reach any more
  const idea = named.length === 1 && !lastL && !/^\d/.test(named[0].used || '') && /(what time|when|time|which boat|times|schedule)/.test(q) && ideaTimes(named[0], ctx);
  const soon = idea && date === ctx.todayInTrip ? deps(named[0]).filter(x => x.dep < idea.dep && x.dep < (ctx.nowMin ?? 0) + 45).map(x => hm(x.dep)) : [];
  const hb0 = idea && hotelForDate(ctx.todayInTrip || ctx.today, ctx), from0 = hb0 ? String(hb0.subtitle || hb0.title).split(/[,·]/)[0].trim() : 'the hotel';
  const ideaQ = idea ? `${idea.out} (the free-day plan)${idea.back ? `; back ${idea.back}` : ''}.${soon.length ? ` The ${soon.join(' and ')} leave${soon.length === 1 ? 's' : ''} too soon to reach from ${from0}.` : ''}` : null;
  const quick = smart?.quick ? smart.quick : ideaQ ? ideaQ
    : lastL ? `${ferryOut(named[0])}. Last boat back: ${lastL.text}.`
    : backLine ? backLine : nextLine ? nextLine
    : lastF ? `Last boat in the app's list for ${lastF.line}: ${lastF.back[lastF.back.length - 1]}. Later boats may run; check the Şehir Hatları app or call 153.`
    : (askPrice || /(meter|per km|km|tariff|rate|rates|flag)/.test(q)) && onlyTaxi ? taxiCityLine(q, date, ctx)
    : askPrice ? `${fs.slice(0, 3).map(f => `${f.line}: ${f.fare}`).join(' · ')}. Pay with the ${T.cardTitle || 'transport card'}.` : null;
  const one = smart?.ferry || (fs.length === 1 && !onlyTaxi ? fs[0] : null);
  return { title, blocks, quick, date: smart?.moves?.date || date || null, subject: one ? { kind: 'ferry', id: one.id } : null,
           actions: [{ act: 'pdf', label: 'Download PDF', icon: 'download' }, { act: 'tab', tab: 'transport', label: 'Getting around', icon: 'ferry' }],
           pdf: { title, subtitle: T.timetableNote || 'Check departures the night before', blocks, filename: `${filePrefix(ctx)}-${onlyTaxi ? 'taxis' : 'ferries'}${date ? '-' + monTag(date) : ''}.pdf` },
           suggestions: ['Hotel address for the driver', 'Plan for tomorrow', 'Emergency numbers'] };
}

// the taxi meter of the city the question names, else of the day (Antalya and Istanbul meters differ)
function taxiCityLine(q, date, ctx) {
  const T = ctx.content.transport, cities = [...new Set([...(cfg(ctx).cities || []).map(c => c.city), ...ctx.content.days.map(d => d.city)])].filter(Boolean);
  const city = cities.find(c => has(withAr(q), [norm(c)])) || dayAt(ctx, date || ctx.todayInTrip)?.city || null;
  return (city && meterFor(city, ctx)?.line) || T.taxi[0];
}

// phrases whose meaning the question uses: the whole meaning inside it ("no sugar"), else its main words
function phraseHits(q, C) {
  const want = ` ${norm(q).replace(/(^|\s)without(?=\s|$)/g, '$1no')} `;
  return (C.phrases || []).filter(p => {
    const e = norm(p.en), ws = e.split(' ').filter(w => w.length >= 3 && !STOP.has(w) && !['the', 'and'].includes(w));
    return (e.includes(' ') && want.includes(` ${e} `)) || (ws.length && ws.filter(w => want.includes(` ${w} `)).length >= Math.min(2, ws.length));
  });
}
function phrasesAnswer(raw, ctx) {
  const P2 = ctx.content.phrases;
  const m = norm(raw).match(/(?:how (?:do i|do you|to|can i|do we|should i|should we|can we) (?:say|order|ask for|ask)|translate|in turkish|what is)\s+(.+)/);
  let list = P2, missing = null, combo = null;
  if (m) {
    const want = m[1].replace(/\b(in turkish|turkish|please|for me|to the (taxi )?driver|to the waiter|to them)\b/g, ' ').replace(/(^|\s)without(?=\s|$)/g, '$1no').replace(/\s+/g, ' ').trim();
    const exact = want ? P2.filter(p => norm(p.en).includes(want)) : [];
    // the meaning of a short phrase inside the question ("coffee no sugar" holds "No sugar"): that phrase first
    const inside = P2.filter(p => norm(p.en).includes(' ') && ` ${want} `.includes(` ${norm(p.en)} `));
    const loose = P2.filter(p => want.split(' ').some(w => w.length > 3 && norm(p.en).includes(w)));
    if (exact.length) list = exact;
    else if (inside.length) {
      // "Türk kahvesi, orta şekerli" + "Sade" (No sugar) → "Türk kahvesi, sade" (Turkish coffee, no sugar)
      const p = inside[0], pw = norm(p.en).split(' ').filter(w => w.length >= 3);
      const base = loose.find(x => x !== p && x.tr.includes(',') && x.en.includes(',') && pw.some(w => norm(x.en.split(',').slice(1).join(' ')).includes(w)));
      if (base) combo = { tr: `${base.tr.split(',')[0]}, ${p.tr.toLowerCase()}`, en: `${base.en.split(',')[0]}, ${p.en.toLowerCase()}`, p, base };
      list = [p, ...(base ? [base] : [])];
    } else if (loose.length) list = loose;
    else if (want) {
      // not in the list: say so, then the nearest phrases by meaning (money words → the bill) and the tip rule when it is about tipping
      const REL = { change: 'bill', tip: 'bill', tips: 'bill', pay: 'bill', receipt: 'bill', check: 'bill', price: 'how much', cost: 'how much', money: 'how much', expensive: 'how much',
        bathroom: 'toilet', wc: 'toilet', restroom: 'toilet', booking: 'reservation', reserved: 'reservation', view: 'sea-view', sugar: 'sugar', help: 'help', meter: 'meter', stop: 'stop' };
      const near = P2.filter(p => want.split(' ').some(w => REL[w] && norm(p.en).includes(norm(REL[w]))));
      const tip = /(change|tip|tips)/.test(want) && ctx.content.tips.sections.flatMap(s => s.items).find(x => /^tip\b/i.test(x));
      missing = `“${cap(want)}” is not in your phrase list${near.length ? `. Closest: ${near.slice(0, 2).map(p => `“${p.tr}” (${p.en})`).join(', ')}` : ''}${tip ? `; ${lcFirst(String(tip).split(/(?<=\.)\s+/)[0]).replace(/\.$/, '')} (optional)` : ''}.`;
      if (near.length) list = near;
    }
  } else {   // "the restaurant added service charge, what do I say": the phrase whose words the question uses
    const ws = norm(raw).split(' ').filter(w => w.length >= 4 && !STOP.has(w) && !['turkish', 'say', 'what', 'phrase', 'phrases', 'added', 'restaurant'].includes(w)).map(w => w.replace(/s$/, ''));
    const sc = P2.map(p => ({ p, n: ws.filter(w => norm(p.en).includes(w)).length })).filter(x => x.n).sort((a, b) => b.n - a.n);
    if (sc.length && /(say|tell|phrase|in turkish|اقول|نقول)/.test(norm(raw))) list = sc.filter(x => x.n === sc[0].n).map(x => x.p);
  }
  const full = list === P2;
  const quick = missing || (combo ? `Say: “${combo.tr}” — ${combo.en}. “${combo.p.tr}” (${combo.p.say}) means ${lcFirst(combo.p.en)}; your phrase list has “${combo.base.tr}” for “${combo.base.en}”.`
    : !full && list.length <= 2 ? list.map(p => `Say: “${p.tr}” (${p.say}) — ${p.en}.`).join(' ') : null);
  const blocks = [TABLE(['Turkish', 'Say it like', 'Meaning'], list.map(p => [p.tr, p.say, p.en]), { columns: { 0: { fontStyle: 'bold' } } })];
  const pdfBlocks = blocks.slice();
  if (full) { pdfBlocks.push({ t: 'pagebreak' }); pdfBlocks.push(H('Show the driver')); ctx.content.driverCards.forEach((c, i) => { if (i) pdfBlocks.push({ t: 'space', h: 4 }); pdfBlocks.push({ t: 'h3', text: c.title }); pdfBlocks.push({ t: 'big', text: c.tr, size: 17 }); }); }
  return { title: full ? 'Turkish phrases' : `“${combo ? combo.en : list[0].en}” in Turkish`, blocks, quick, phrases: list.map(p => P2.indexOf(p)),
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
  // a pharmacy question from someone unwell: where to find one, then the doctor line through the insurer
  const doc = row && /pharmacy|eczane/i.test(row.label) && I?.hotline?.call ? ` For a doctor, call ${insShort(I)} 24 h on ${I.hotline.call} first; 112 if it is serious.` : '';
  return { title: 'Emergency & contacts', blocks, quick: row ? `${row.label}: ${[row.number, row.note].filter(Boolean).join(' · ')}${doc}` : null,
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
  else if (/(^|\s)(today|tonight|now|اليوم|الحين|هلا|النهارده)(\s|$)/.test(q)) {
    // "today" means what is due today (and anything overdue or still possible now), then the next one coming
    const now = open.filter(t => t.due <= ctx.today && ['now', 'overdue', 'soon'].includes(t.st)), next = open.find(t => t.due > ctx.today);
    const blocks = now.length ? [TABLE(['Due', 'What', 'Note'], now.map(t => [(t.due === ctx.today ? 'Today' : dateLabel(t.due)) + (t.time ? ' ' + t.time : ''), t.title, tNote(t, ctx, t.st)]), { columns: { 0: { cellWidth: 26 } } })]
      : [CALL(`Nothing is due today (${dateLabel(ctx.today)}).`, 'ok')];
    if (next) blocks.push(P(`Next: ${next.title} · ${dateLabel(next.due)}${next.time ? ' ' + next.time : ''}.`));
    return { title: now.length ? `To do today · ${now.length}` : 'Nothing due today', blocks,
             actions: [{ act: 'tab', tab: 'todos', label: 'Open the checklist', icon: 'calcheck' }], suggestions: ['To-do list', 'Plan for today'] };
  }
  else if (namedAll.length && namedAll.length < C.todos.length / 2) {
    // a specific to-do (visa, eSIM, deposit, check-in…): say whether it is done
    const tone = { done: 'ok', missed: 'sea', overdue: 'red', now: 'red' };
    const blocks = namedAll.map(t => CALL(`${t.title} — ${t.st === 'done' ? 'ticked as done ✓' : tNote(t, ctx, t.st)}.${t.note ? ' ' + t.note : ''}`, tone[t.st] || (t.urgent ? 'red' : 'gold')));
    const t1 = namedAll[0], yn = namedAll.length === 1 && (/^(is|are|did|have|has|was|were|do|does)\s/.test(q) || /(or not|granted|done|ready|approved|issued|came out|طلعت|جاهز)/.test(q));
    const quick = yn ? `${t1.st === 'done' ? 'Yes' : 'Not yet'} — ${lcFirst(t1.title)}: ${t1.st === 'done' ? 'ticked as done ✓' : tNote(t1, ctx, t1.st)}.${t1.note ? ' ' + dot(t1.note) : ''}` : null;
    return { title: namedAll.length === 1 ? namedAll[0].title : 'Matching to-dos', blocks, quick,
             actions: [{ act: 'tab', tab: 'todos', label: 'Open the checklist', icon: 'calcheck' }], suggestions: ['To-do list', 'What do we still need to book?'] };
  }
  const groups = [['Do it now', open.filter(t => t.st === 'now')], ['Overdue', open.filter(t => t.st === 'overdue')], ['Next 3 days', open.filter(t => t.st === 'soon')], ['Later', open.filter(t => t.st === 'later')]].filter(g => g[1].length);
  const row = (t) => [(t.due ? dateLabel(t.due) : '') + (t.time ? ' ' + t.time : ''), (t.urgent ? 'URGENT · ' : '') + t.title, [t.st === 'now' ? tNote(t, ctx, t.st) : '', t.note || ''].filter(Boolean).join(' · ')];
  const blocks = [P(`${open.length} open${scope ? '' : ` · ${doneN} done`}.`)];
  const top = [...open.filter(t => ['now', 'overdue'].includes(t.st)), ...open.filter(t => !['now', 'overdue'].includes(t.st))].slice(0, 2);
  const quick = (!scope || scope === 'Before you fly') && top.length && /(forget|remember|what (should|do|must) we|need|still|anything)/.test(q) ? `${open.length} open${scope ? ' before you fly' : ''}. Next: ${top.map(t => `${t.title} (${tNote(t, ctx, t.st)})`).join('; ')}.` : null;
  for (const [label, list] of groups) { blocks.push(H(label)); blocks.push(TABLE(['Due', 'What', 'Note'], list.map(row), { columns: { 0: { cellWidth: 26 } } })); }
  if (!open.length) blocks.push(P('Nothing open here. Well done!'));
  if (missed.length && !scope) blocks.push(P(`${missed.length} past item${missed.length === 1 ? ' is' : 's are'} no longer needed (the moment has passed): under Past in the checklist.`, { muted: true }));
  const urgent = open.filter(t => t.urgent);
  if (urgent.length) blocks.unshift(CALL(urgent.map(t => `${t.title}: by ${dateLabel(t.due)}${t.time ? ' ' + t.time : ''}.`).join(' '), 'red'));
  return { title: scope || 'To-do list', blocks, quick, actions: [{ act: 'pdf', label: 'Download PDF', icon: 'download' }, { act: 'tab', tab: 'todos', label: 'Open the checklist', icon: 'calcheck' }],
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
  const TSYN = { wear: ['covered', 'headscarf', 'shoulders'], dress: ['covered', 'headscarf', 'shoulders'], cold: ['°c', 'night', 'layer'], warm: ['°c'], tip: ['tip'], tips: ['tip'], tipping: ['tip'], weather: ['°c'] };
  const ws = q.split(' ').filter(w => w.length >= 3 && !STOP.has(w)).flatMap(w => [w, ...(TSYN[w] || [])]);
  const it = one && (one.items.map((x, i) => ({ x, i, n: ws.filter(w => new RegExp(`(^|[^\\p{L}])${reEsc(w)}(?![\\p{L}])`, 'u').test(norm(x)) || (w.length > 4 && norm(x).includes(w))).length })).sort((a, b) => b.n - a.n || a.i - b.i)[0]?.x || one.items[0]);
  return { title: one ? one.title : 'Tips & rules', blocks, quick: it && !/(sunset|غروب)/.test(q) ? String(it).split(/(?<=\.)\s+/).slice(0, 2).join(' ') : null, actions: [{ act: 'pdf', label: 'Download PDF', icon: 'download' }],
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
// a detail question about one added document: the best sentence of what it says (facts the AI read, the phone's text)
const DOC_DETAIL = /(^|\s)(what time|when|time|boarding|board|gate|pier|meet|meeting|included|include|inclusive|cancel|cancellation|refund|change|price|cost|how much|how long|duration|bring|wear|address|phone|seat|baggage|bag|bags|allowed|policy|rules?|wifi|breakfast|drink|drinks|متى|وين|كم|الغاء|يشمل|مسموح)(\s|$)/;
function docQaAnswer(q, u, ctx) {
  const named = new Set(norm(`${u.title} ${u.place || ''} ${UKIND[u.kind] || ''} ticket document voucher booking`).split(' '));
  const ask = q.split(' ').filter(w => w.length >= 3 && !STOP.has(w) && !named.has(w));
  const stem = (w) => new RegExp(`(^|[^\\p{L}])${w.slice(0, Math.max(4, w.length - 2)).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u');
  const pool = [...(u.facts || []), ...(u.notes || []), u.summary, ...String(u.text || '').split(/(?<=[.!?])\s+|\n+/)].map(x => String(x || '').trim()).filter(x => x.length >= 8 && x.length <= 300);
  let best = null;
  for (const s of pool) { const n = norm(s), hit = ask.filter(w => stem(w).test(n)).length, sc = hit - s.length / 1000; if (hit && (!best || sc > best.sc)) best = { s, sc }; }
  const blocks = [best ? CALL(best.s, 'sea', `From “${u.title}”`) : CALL(`“${u.title}” does not say that in what was read from it. Open it to check.`, 'gold')];
  if (u.time || u.dayIso) blocks.push(P(`${u.dayIso ? dateLabel(u.dayIso) : ''}${u.time ? ' · ' + u.time : ''}${u.place ? ' · ' + u.place : ''}${u.ref ? ' · ref ' + u.ref : ''}`.replace(/^ · /, '')));
  if ((u.facts || []).length) blocks.push(H('What it says'), L(u.facts));
  return { title: u.title || UKIND[u.kind] || 'Document', quick: best ? best.s : null, noQuick: true, blocks,
           actions: [udocAct(u), ...(u.dayIso ? [{ act: 'day', date: u.dayIso, label: `Open ${dateLabel(u.dayIso)}`, icon: 'days' }] : [])], suggestions: ['Documents', 'What’s next?'] };
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
                         ...(one.summary ? [P(one.summary)] : []), ...(one.notes?.length ? [L(one.notes)] : []), ...(one.facts?.length ? [H('What it says'), L(one.facts)] : [])]
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
const kwReC = (w) => { if (!KWC.has(w)) { const n = norm(w), re = kwRe(n); re.n = n; KWC.set(w, re); } return KWC.get(w); };
const anyKw = (q, list) => list.some(w => { const re = kwReC(w); return q.includes(re.n) && re.test(q); });
function insuranceMatch(q, ctx) {
  const I = ctx.content.insurance;
  const life = anyKw(q, LIFE);
  const words = (anyKw(q, INS_WORDS) && !/(cancellation|refund|hotel|booking|privacy) polic/.test(q)) || (!!I?.insurer && has(q, [insShort(I)]));   // or the insurer's name
  const cover = anyKw(q, COVER_WORDS) && !/(cover charge|kuver|(shoulders|knees|head|heads|arms|hair|legs) (are |must be |should be |be )?covered|covered (shoulders|knees|head|arms)|cover (up|her|his|my|our|your|their|the)? ?(hair|head|heads|shoulders|knees|arms|legs|up)|تغطي (شعر|راس)|تغطيه (شعر|راس))/.test(q);
  const cue = has(q, CUE) || ctx.content.meta?.travellers?.some(n => has(q, [n])), info = INFOQ.test(q);
  if (!I) return { life, words, cover, cue, info, best: null, second: null };
  // everyday ways to say "sick" ("زوجتي تعبانة", "Alaa is unwell")
  const qi = q.replace(/(^|\s)(not feeling well|not well|unwell|feeling unwell|feels unwell)(?=\s|$)/g, '$1sick').replace(/(^|\s)(تعبان|تعبانه|تعبانين|مريضه)(?=\s|$)/g, '$1مريض');
  const scored = insKeywords(I).map(({ s, kws }) => {
    let strong = 0, weak = 0;
    for (const k of kws) if (qi.includes(k.w) && k.re.test(qi)) {   // the exact word form beats a stem match by a hair (كسرت كاس = damage, not a fracture)
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
  const bare = (s) => String(s || '').replace(/^(?:covered|partly|not covered)\b\s*([^:]{0,24}):\s*/i, (_, x) => x.trim() ? `${cap(x.trim())}: ` : '').replace(/^./, c => c.toUpperCase());   // "Covered up to USD 1,000: …" keeps the limit
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
  const add = (name, p, d, side = '') => {
    if (!name) return null; const n = norm(name);
    if (!p) return byName.get(n) || null;
    if (!byName.has(n)) {
      const toks = n.split(' ').filter(w => w.length >= 3 && !STOP.has(w));
      const cls = Object.keys(PCLASS).filter(k => PCLASS[k].some(w => toks.includes(norm(w)))).concat(toks.some(w => hotelWords.has(w)) ? ['hotel'] : []);
      const e = { name, n, lat: p[0], lng: p[1], city: d.city, toks: toks.filter(w => !PCW.has(w)), cls: [...new Set(cls)], alt: new Set() };
      byName.set(n, e); pts.push(e);
    }
    const e = byName.get(n);   // the trip label's own words for the place: "Hadrian's Gate, Kaleiçi"
    norm(plainLabel(side)).split(' ').filter(w => w.length >= 4 && !STOP.has(w) && !PCW.has(w) && !e.toks.includes(w)).forEach(w => e.alt.add(w));
    return e;
  };
  for (const d of C.days) for (const t of d.trips || []) {
    const parts = String(t.label || '').split(' → '), la = parts[0], lb = parts.length > 1 ? parts[parts.length - 1] : '';
    const a = add(t.from, ll(t.directions, 'origin'), d, lb ? la : ''), b = add(t.to, ll(t.directions, 'destination') || ll(t.pin, 'query'), d, lb || '');
    if (a && b) legs.push({ a, b, t, d });
  }
  const g = { pts, legs };
  GEO.set(C, g);
  return g;
}
const kmBetween = (a, b) => { const R = 6371, r = Math.PI / 180, dl = (b.lat - a.lat) * r, dg = (b.lng - a.lng) * r;
  const h = Math.sin(dl / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dg / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
// the places a question names: "how far is the ferry from the hotel" → { from: hotel, to: pier }
// "we r at hadrians gate now", "we are still at the shisha in galata": where the question says you are (a trip point, or a planned place of that kind in that area)
const HERE_RE = /(?:^|\s)(?:we are|were|we re|we r|im|i am|i m|we|i)\s+(?:still\s+|now\s+|currently\s+|just\s+)?(?:at|in|near|by|outside)\s+(?:the\s+)?(.+?)(?=\s(?:now|right now|how|what|whats|is|are|can|could|where|which|when|should|do|does|and|so|but|will|any|its|it|is there)(?:\s|$)|$)/;
function herePoint(q, ctx) {
  const m = HERE_RE.exec(q); if (!m) return null;
  const C = ctx.content, G = geoFor(C), ph = ` ${m[1].trim()} `, hit = (w) => new RegExp(`(^|\\s)${reEsc(w)}(\\s|$)`).test(ph);
  const kind = /(shisha|hookah|nargile|lounge)/.test(ph) ? 'shisha' : /(cafe|coffee)/.test(ph) ? 'coffee' : /(restaurant|dinner|lunch|meal)/.test(ph) ? 'meal' : null;
  if (kind) {
    const ws = ph.trim().split(' ').filter(w => w.length >= 4 && !STOP.has(w) && !FOODW.has(w) && w !== 'lounge');
    const vs = C.venues.filter(v => v.kind === kind && v.status !== 'option' && ws.some(w => norm(`${v.name} ${v.area} ${dayAt(ctx, v.day)?.title || ''}`).includes(w)));
    const p = vs.length ? venuePoint(vs.find(v => v.day === ctx.todayInTrip) || vs[0], C) : null;
    if (p) return { e: p, text: m[0] };
  }
  const c = G.pts.map(e => ({ e, sc: e.toks.filter(hit).length + [...e.alt].filter(hit).length * 0.6 })).filter(x => x.sc > 0).sort((a, b) => b.sc - a.sc);
  return c.length && (c.length === 1 || c[0].sc > c[1].sc) ? { e: c[0].e, text: m[0] } : null;
}
function distanceMatch(q0, date, ctx) {
  const C = ctx.content, G = geoFor(C), q1 = withAr(q0);
  if (!G.pts.length) return null;
  // "we are at X …": X is the start; the rest of the question names the end (or "back" = the hotel)
  const here = herePoint(q1, ctx), q = here ? q1.replace(here.text, ' ').replace(/\s+/g, ' ').trim() : q1;
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
    const hit = (w) => new RegExp(`(^|\\s)${reEsc(w)}(\\s|$)`).test(part.text);
    return G.pts.map(e => ({ e, spec: e.toks.filter(hit).length + [...e.alt].filter(hit).length * 0.6, cls: e.cls.filter(c => cls.includes(c)).length }))
      .filter(x => x.spec || x.cls).map(x => ({ ...x, sc: x.spec * 3 + x.cls }));
  };
  const res = parts.map(p => ({ p, c: cand(p) })).filter(x => x.c.length);
  if (here) {
    // the end: the best-named place of the rest (never the start again), else the hotel when the question goes back
    const ends = res.flatMap(x => x.c).filter(c => c.e !== here.e && c.spec > 0).sort((a, b) => b.sc - a.sc);
    const back = /(^|\s)(back|home|hotel|resort|return|فندق)(\s|$)/.test(q), hh = myHotel && kmBetween(myHotel, here.e) < 60 ? myHotel : hotelNear(here.e);
    const to = ends[0]?.e || (back ? hh : null);
    if (to && to !== here.e && kmBetween(here.e, to) <= 400) return { from: here.e, to, here: true };
  }
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
  const legWalk = leg && leg.t.mode === 'walk' && +((/(\d+)\s?min/.exec(leg.t.dur || '') || [])[1] || 0);   // the plan's own walking time wins over the estimate
  const walkMin = legWalk || Math.round(km * 1.25 / 4.5 * 60), taxiMin = [Math.max(5, Math.round(road / (fast ? 50 : 30) * 60 / 5) * 5), Math.max(8, Math.round(road / (fast ? 32 : 20) * 60 / 5) * 5)];
  const fare = meter ? Math.max(meter.min, meter.open + meter.km * road) : null, r10 = (n) => Math.round(n / 10) * 10;
  const fareTxt = fare ? (fare <= meter.min ? `the minimum fare, ₺${fmt(meter.min)}` : `≈ ₺${fmt(r10(fare * 0.9))}–${fmt(r10(fare * 1.15))} on the meter`) : '';
  const walkOk = walkMin <= 15;
  const legTxt = leg ? `${leg.t.modeText}: ${leg.t.label}${leg.t.dur ? ' · ' + leg.t.dur : ''}${leg.t.time ? ` (planned ${leg.t.time} on ${dateLabel(leg.d.date)})` : ` (${dateLabel(leg.d.date)})`}` : '';
  const legDist = leg && /(\d+(?:[.,]\d+)?)\s?(km|m)(?![a-z])/.exec(leg.t.dur || ''), shown = legDist ? `${legDist[1]} ${legDist[2]}` : fmtKm(km);
  // a line in the plan that already gives this distance ("Sütlüce pier … is about 1.5 km away")
  const pool = [...C.bookings.flatMap(b => (Array.isArray(b.notes) ? b.notes : [b.notes]).filter(Boolean).map(t => ({ t, w: b.title }))), ...C.days.flatMap(d => (d.plan || []).map(t => ({ t, w: '' })))];
  const said = pool.find(({ t, w }) => /\d(\.\d)?\s?(km|m)\b/.test(t) && [from, to].every(e => e.toks.some(k => norm(`${t} ${w}`).includes(k))));
  const est = `About ${fmtKm(km)} as the crow flies: ${walkOk ? `a ${walkMin}-minute walk` : `${fareTxt ? `a taxi of about ${taxiMin[0]}–${taxiMin[1]} min, ${fareTxt}` : `about ${taxiMin[0]}–${taxiMin[1]} min by taxi`}`}.`;
  // a taxi leg of the plan: its time, the meter estimate and what the plan allows; a booked transfer: no taxi needed
  // the plan's own taxi time wins over the map estimate everywhere in the answer (no two different durations); its taxi allowance only on that day
  const taxiLeg = leg && /taxi/.test(leg.t.mode), allow = taxiLeg && (!ctx.todayInTrip || leg.d.date === ctx.todayInTrip) && (leg.d.costs || []).find(c => /taxi/i.test(c.label));
  const planMin = taxiLeg && durRange(leg.t.dur); if (planMin) { taxiMin[0] = planMin[0]; taxiMin[1] = planMin[1]; }
  const tr = leg && leg.t.mode === 'shuttle' && TAXIQ.test(q) && transferOf(leg.t, leg.d, C), ready = tr && (/be ready at (\d{1,2}:\d{2})/.exec(leg.t.dur || '') || [])[1];
  const meterTxt = fareTxt && meter ? `${fareTxt}${fare > meter.min ? ` (${from.city || to.city} meter: ₺${meter.open} to open + ₺${meter.km}/km)` : ''}` : fareTxt;
  let quick = tr ? `No taxi needed: your paid shuttle (${tr.who}) takes you ${leg.t.time ? `at ${leg.t.time} ` : ''}on ${dateLabel(leg.d.date)}${ready ? ` (be ready at ${ready})` : ''}. A taxi would be ${fareTxt || 'on the meter'}, about ${taxiMin[0]}–${taxiMin[1]} min.`
    : taxiLeg || m.said ? `${/(fastest|quickest)/.test(q) ? 'Fastest: ' : ''}Taxi ${m.said || from.name} → ${to.name}: ${leg ? `${leg.t.dur} in your plan (${dateLabel(leg.d.date)})` : `about ${taxiMin[0]}–${taxiMin[1]} min`}${meterTxt ? `, ${meterTxt}` : ''}${allow ? `; the plan allows ${allow.value} for ${allow.label.toLowerCase()}` : ''}.`
    : leg && !TAXIQ.test(q) ? legTxt : leg ? `${est} In your plan: ${legTxt}.` : est;
  const back = taxiLeg && !tr && G.legs.slice(G.legs.indexOf(leg) + 1).find(l => l.d === leg.d && l.b.n === leg.a.n && /taxi/.test(l.t.mode));   // later that day, back to where this leg started
  if (back && back.t.dur) quick = quick.replace(/\.$/, `; ${back.t.dur} back from ${back.a.name}.`);
  // "will we make it": the next fixed time today that starts where this ride ends ("be ready at 22:15 for the 22:30 pickup")
  let onDay = null;
  if (/(make it|in time|on time|will we make|can we make|are we late|late for)/.test(q) && ctx.todayInTrip && ctx.nowMin != null) {
    const d = dayAt(ctx, ctx.todayInTrip), now = ctx.nowMin, nx = (d?.trips || []).find(t => t.time && tripMinutes(t) > now && norm(t.from) === to.n);
    const rdy = nx && (toMin((/be ready at (\d{1,2}:\d{2})/.exec(nx.dur || '') || [])[1]) ?? tripMinutes(nx));
    if (nx && rdy != null) {
      // ready time first, then the departure itself: arriving after "be ready at" but before the pickup is "only just", not "no"
      const dep = tripMinutes(nx), a0 = now + taxiMin[0], a1 = now + taxiMin[1], what = nx.mode === 'shuttle' ? 'pickup' : legKind(nx), tr = nx.mode === 'shuttle' && transferOf(nx, d, C);
      const until = factsFor(C).rides.find(r => r.t === nx)?.until ?? dep;   // a booked driver waits a little after the pickup time
      const v = a1 <= rdy ? 'Yes' : a1 <= dep ? 'Only just' : a0 <= until ? `Risky (the driver waits only until about ${hm(until)})` : 'No';
      const tail = v === 'Yes' ? '' : `${rdy < dep && a1 > rdy ? ` That is after the ${hm(rdy)} ready time` : ''}${tr?.b.phone ? `${rdy < dep && a1 > rdy ? ':' : ''} call ${tr.who} on ${tr.b.phone} to say you are on the way` : ''}.`;
      onDay = d.date;
      quick = `${v} — if you leave now: the taxi ${from.name} → ${to.name} takes ${taxiMin[0]}–${taxiMin[1]} min${planMin ? ' in your plan' : ''}, so you reach ${to.name} about ${hm(a0)}–${hm(a1)}; ${rdy !== dep ? `be ready at ${hm(rdy)} for the ${nx.time} ${what}` : `the ${what} is at ${nx.time}`}.${tail === '.' ? '' : tail}${meterTxt ? ` Taxi ${meterTxt}.` : ''}`;
    }
  }
  if (/(card|cash|pay|بطاقه|كاش)/.test(q)) quick += ` ${payLine(q, to, ctx)}`;   // "… and do they take card"
  const rows = [['Distance', legDist ? `${shown} on the route (≈ ${fmtKm(km)} in a straight line)` : `≈ ${fmtKm(km)} in a straight line`], leg && ['In your plan', legTxt], fare && km >= 0.5 && ['Taxi', `${fareTxt} · about ${taxiMin[0]}–${taxiMin[1]} min`],
    km <= 3 && ['On foot', `about ${walkMin} min${walkOk ? '' : ' — over 15 min: take a taxi'}`]].filter(Boolean);
  const blocks = [KV(rows), ...(said ? [P(`Your plan: ${said.t}`)] : []),
    P(`Estimates from the map${meter ? ` and the meter (₺${meter.open} to open, ₺${meter.km} per km, ₺${meter.min} minimum)` : ''}. Tolls are extra; traffic can double the time.`, { muted: true })];
  const card = C.driverCards.find(c => aliasScore(to.n, c.aliases) > 0);
  const href = leg && leg.a.n === from.n ? leg.t.directions : `https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}&travelmode=${walkOk ? 'walking' : 'driving'}`;
  const sg = (C.sights || []).find(s => aliasScore(to.n, sightNames(s)) > 0), vn = !sg && C.venues.find(v => new RegExp(`(^|\\s)${reEsc(vKey(v))}(\\s|$)`).test(to.n));
  return { title: `${from.name} → ${to.name}: about ${shown}`, blocks, quick, distance: { from: from.name, to: to.name, km: +km.toFixed(2) },
           subject: sg ? { kind: 'sight', id: sg.id } : vn ? { kind: 'venue', id: vn.id } : null, date: onDay || (leg ? leg.d.date : undefined),
           actions: [{ act: 'url', href, label: 'Directions', icon: 'navigation' }, ...(card ? [{ act: 'driver', id: card.id, label: 'Show the driver', icon: 'taxi' }] : [])],
           suggestions: ['Taxi rules', 'Hotel address for the driver'] };
}

/* ───────────── paying, the time difference, money left ───────────── */
function payAnswer(q, ctx) {
  const C = ctx.content, pool = [...C.tips.sections.flatMap(s => s.items), ...C.transport.taxi, ...C.transport.card];
  const tipL = (pool.find(x => /^tip\b/i.test(x)) || '').split(/(?<=\.)\s+/)[0].replace(/\.$/, '');   // the content's own tipping rule
  // "do we need cash today": the day's taxis, ticketed sights (card only) and bazaars (cash)
  const day = /(^|\s)(today|tonight|tomorrow)(\s|$)/.test(q) && dayAt(ctx, /tomorrow/.test(q) ? isoAdd(ctx.today, 1) : ctx.todayInTrip);
  if (day) {
    const taxis = (day.trips || []).filter(t => /taxi/.test(t.mode)).length, sg = (C.sights || []).filter(s => s.day === day.date);
    const card = sg.filter(s => /(€|₺)\s?\d/.test(s.price || '')).map(s => s.name.split(' (')[0]), cash = sg.filter(s => /bazaar/i.test(s.name)).map(s => s.name.split(' (')[0]);
    const q2 = `${taxis || cash.length ? `Yes, carry lira cash ${relDay(day.date, ctx)}: ${[taxis && `${taxis} taxi ride${taxis === 1 ? '' : 's'}`, cash.length && `traders at ${cash.join(' and ')}`].filter(Boolean).join(' and ')}` : `Little cash is needed ${relDay(day.date, ctx)}`}.${card.length ? ` ${card.join(', ')}: card only (no cash).` : ''}${tipL ? ` ${tipL}.` : ''}`;
    return { title: 'Card or cash?', blocks: [L([...new Set(pool.filter(x => /(cash|contactless|bank card|card machine|card or |by card|pay in|pay with)/i.test(x)))])], quick: q2, date: day.date, actions: [{ act: 'tab', tab: 'money', label: 'Open Money', icon: 'wallet' }], suggestions: ['Taxi rules', '1,000 TL in AED'] };
  }
  const lines = [...new Set(pool.filter(x => /(cash|contactless|bank card|credit card|card machine|card or |by card|pay in|pay with)/i.test(x)))];
  const where = /(taxi|cab|uber|bitaksi|تاكسي)/.test(q) ? /taxi|bitaksi|uber/i : /(museum|cistern|palace|ticket|متحف)/.test(q) ? /museum|cistern|palace/i
    : /(bazaar|market|shop|سوق)/.test(q) ? /bazaar|trader|shop/i : /(ferry|tram|metro|bus|istanbulkart)/.test(q) ? /ride|istanbulkart|ferry/i : /(restaurant|cafe|shisha|meal|مطعم)/.test(q) ? /tip|bill|service/i : null;
  const rel = where ? lines.filter(x => where.test(x)) : [];
  const taxi = /(taxi|cab|uber|bitaksi|تاكسي)/.test(q), vn = !taxi && findVenue(q, ctx);
  if (vn) return { title: 'Card or cash?', blocks: [L(lines)], quick: `The app has no card information for ${vn.name}. Carry lira cash as a backup${tipL ? ` (${lcFirst(tipL)})` : ''}; pay in lira if you use a card.`, actions: [{ act: 'tab', tab: 'money', label: 'Open Money', icon: 'wallet' }], suggestions: ['Taxi rules'] };
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
function leftAnswer(ctx, date = null) {
  const C = ctx.content, M = C.money, sp = spentSummary(ctx), last = C.days[C.days.length - 1].date;
  // "what is left of today's budget": that day's plan minus what was logged that day; the whole trip comes second
  const dd = date && dayAt(ctx, date);
  if (dd) {
    const rate = +ctx.rate || M.rates.tryPerAed, row = (M.variable || []).find(r => r.date === usedTag(date)), plan = row?.tryRange || (dd.allowAed ? dd.allowAed.map(x => x * rate) : null);
    if (plan) {
      const xs = (ctx.expenses || []).filter(e => e.date === date), spent = xs.reduce((s, e) => s + (e.cur === 'TRY' ? +e.amount : +e.amount * rate), 0);
      const lo = Math.max(0, plan[0] - spent), hi = Math.max(0, plan[1] - spent), r10 = (n) => Math.round(n / 100) * 100, who = date === ctx.today ? 'today' : dateLabel(date);
      const r = leftAnswer(ctx);
      r.quick = `${cap(who)}: plan ₺${fmt(plan[0])}–${fmt(plan[1])}, spent ₺${fmt(spent)}, so about ₺${fmt(r10(lo))}–${fmt(r10(hi))} (AED ${fmt(lo / rate)}–${fmt(hi / rate)}) left for ${who === 'today' ? 'today' : 'that day'}.${spent > plan[1] ? ' You are over the plan for that day.' : ''}`;
      return Object.assign(r, { title: `${cap(who)}: about ₺${fmt(r10(lo))}–${fmt(r10(hi))} left`, date });
    }
  }
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

/* ───────────── reasoning: the clock, the day's trips, venues, sights and bookings together ───────────── */
const MEALQ = /(^|\s)(hungry|starving|famished|peckish|eat|eating)(\s|$)|(for|where|about|plan for) (lunch|dinner|breakfast|food)(\s|$)|(^|\s)(lunch|dinner|breakfast|food) (where|tonight|today|plan)/;
const ROUTEQ = /(how (do|can|should|would) (we|i) (go|get)|how to (go|get)|fastest way|quickest way|fastest|back to (the|our) hotel)/;
const LEAVEQ = /(^|\s)(leave|leaving|depart|head out|set off|get going)(\s|$)/;
const TIMEFORQ = /(time for|time to|enough time|have time|got time|is there time|(^|\s)وقت)/;
const NEARHQ = /(near|close to|around|next to|walking distance from)( the| our)? (hotel|resort)|قريب من فندق/;
const dayAt = (ctx, iso) => (iso && ctx.content.days.find(d => d.date === iso)) || null;
const spanTxt = (m) => { m = Math.max(0, Math.round(m)); const h = Math.floor(m / 60), r = m % 60; return h ? `${h} h${r ? ` ${r} min` : ''}` : `${r} min`; };
// "today", "tonight", "tomorrow (Thu 15 Oct)", "Sat 17 Oct"
const relDay = (iso, ctx, night = false) => iso === ctx.today ? (night ? 'tonight' : 'today') : iso === isoAdd(ctx.today, 1) ? `tomorrow (${dateLabel(iso)})` : dateLabel(iso);
const plainLabel = (s) => String(s || '').replace(/\s*\([^)]*\)/g, '').trim();
// the time the user says it is: "its 6 pm", "it's 18:00", "its 22 35"
function saidClock(q) {
  const m = /(?:^|\s)(?:its|it is|now its|now)\s+(\d{1,2})(?:[:.\s](\d{2}))?\s*(am|pm)?(?=\s|$)/.exec(q);
  if (!m || (!m[2] && !m[3] && +m[1] < 13)) return null;
  let h = +m[1] % 24; if (m[3] === 'pm' && h < 12) h += 12; if (m[3] === 'am' && h === 12) h = 0;
  return h * 60 + (+m[2] || 0);
}
// every trip of a day with its real or estimated minute
const tripClock = (d, ctx) => nextStep(d, -1e4, { content: ctx.content }).timeline.map(x => ({ t: x.trip, min: x.min, est: x.est }));
const legKind = (t) => t.mode === 'walk' ? 'walk' : t.mode === 'shuttle' ? 'booked transfer' : t.mode === 'taxi_home' ? 'taxi back' : String(t.modeText || t.mode).replace(/ (from|to) hotel$/i, '').toLowerCase();
// "taxi from Arise Hotel to Taksim Square (15–25 min)"
const legLine = (t) => `${legKind(t)} from ${t.from} to ${t.to}${t.dur ? ` (${t.dur})` : ''}`;
// "6 min walk (downhill) from Blue Mosque", "taxi from Dolmabahçe Palace, 10–15 min"
function reachText(t) {
  const min = (/(\d+)\s?min/.exec(t.dur || '') || [])[1], slope = (/(downhill|uphill|flat shore road|mostly flat|flat|gentle rise[^·]*)/.exec(t.dur || '') || [])[1];
  return t.mode === 'walk' ? `${min ? min + ' min ' : ''}walk${slope ? ` (${slope.trim()})` : ''} from ${t.from}` : `${legKind(t)} from ${t.from}${t.dur ? `, ${t.dur}` : ''}`;
}
// the paid transfer behind a shuttle trip, and who runs it ("724 Transfer")
function transferOf(t, d, C) {
  const S = C.bookings.filter(b => b.kind === 'transfer'), s = norm(`${t.from} ${t.to} ${t.label}`);
  const b = S.find(x => x.phase && s.includes(norm(x.phase))) || S.find(x => x.phase && norm(d?.city || '').includes(norm(x.phase))) || null;
  return b && { b, who: String(b.via || b.title).split(' · ').pop() };
}
// the day a hotel stay ends (the morning after its last night)
const checkoutIso = (b, ctx) => { const n = ctx.content.days.filter(d => d.hotel === b.id).map(d => d.date).sort().pop(); return n ? isoAdd(n, 1) : null; };
// a sight at the destination that is not open yet when you get there ("Zeruj Port opens at 10:00")
function opensLater(t, iso, dep, ctx) {
  const s = (ctx.content.sights || []).find(x => aliasScore(norm(t.to), sightNames(x)) > 0);
  const sp = s ? spansOn(s, iso) : [];
  return sp.length && !allDay(sp) && sp[0][0] > dep ? `${s.name.split(' (')[0]} opens at ${hm(sp[0][0])}` : '';
}

/* venues in the plan: when and how the day reaches them, what they cost */
const VGEN = new Set(['the', 'cafe', 'lounge', 'old', 'bar', 'and', 'hookah', 'restaurant', 'bistro', 'kahve']);
const vKey = (v) => norm(v.name.split(' (')[0]).split(' ').find(w => w.length >= 3 && !VGEN.has(w)) || norm(v.name).split(' ')[0];
const shortArea = (a) => String(a || '').split(',').map(x => x.trim()).filter(x => x && !/\d|\b(cd|cad|sk|sok|sokak|caddesi|street)\b\.?/i.test(x)).join(', ');
const costTwo = (v) => plainLabel(v.cost) || (v.costLow != null ? `₺${fmt(v.costLow)}${v.costHigh && v.costHigh !== v.costLow ? '–' + fmt(v.costHigh) : ''}` : 'price not known');
const bookText = (v) => `${(b => /^[^a-z]+$/.test(b) ? b.toLowerCase() : b.charAt(0).toLowerCase() + b.slice(1))(String(v.book).replace(/\s*\([^)]*\)/g, '').trim())}${v.phone ? ` on ${v.phone}` : v.whatsapp ? ` on WhatsApp ${v.whatsapp}` : ''}`;
function venueVisit(v, ctx) {
  const d = dayAt(ctx, v.day); if (!d) return {};
  const key = vKey(v), re = new RegExp(`(^|[^\\p{L}])${reEsc(key)}`, 'u'), ts = d.trips || [];
  const i = ts.findIndex(t => re.test(norm(t.to)));
  const inT = i >= 0 ? ts[i] : null, outT = i >= 0 ? ts[i + 1] || null : null;
  // the planned time: a range in the plan line that names the place, a time just after its name, else the trip that gets there
  let at = null;
  // a time that belongs to another leg ("Around 13:50 taxi to Feriye" in the café's line) is not the time of this place
  const other = new Set(ts.filter(t => t !== inT && t.time).map(t => t.time));
  for (const p of [...(d.plan || []), ...(d.fixed || [])]) {
    const n = norm(p), k = n.search(re); if (k < 0) continue;
    const rg = /(\d{1,2}:\d{2})\s*(?:–|-|to)\s*(?:about\s*)?(\d{1,2}:\d{2})/.exec(p);
    if (rg) { at = `${rg[1]}–${rg[2]}`; break; }
    const near = /(\d{1,2}:\d{2})/.exec(n.slice(k, k + 60)); if (near && !other.has(near[1])) { at = near[1]; break; }
  }
  return { d, inT, outT, at: at || inT?.time || null };
}
// "Carlos Terrace, Cankurtaran, Sultanahmet — 6 min walk (downhill) from Blue Mosque; ₺2,500–5,500 for two; reserve the rooftop on +90 …"
function venueLine(v, ctx, { price = false } = {}) {
  const { inT, at } = venueVisit(v, ctx), area = shortArea(v.area);
  const name = `${v.name}${area ? `, ${area}` : ''}`, cost = `${costTwo(v)} for two`;
  return price ? `${name}: ${cost}${at ? ` (at ${at})` : ''}${v.notes ? `. ${dot(v.notes)}` : ''}`
    : `${name}${at ? ` at ${at}` : ''}${inT ? ` — ${reachText(inT)}` : ''}; ${cost}${v.book ? `; ${bookText(v)}` : ''}`;
}
const aedOf = (n, ctx) => Math.round(n / (+ctx.rate || +ctx.content.money?.rates?.tryPerAed || 13.34));
function venueCost(v, ctx) {
  const d = dayAt(ctx, v.day), tot = d?.total && String(d.total).split('·')[0].trim();
  const aed = v.costLow != null ? ` (≈ AED ${fmt(aedOf(v.costLow, ctx))}${v.costHigh && v.costHigh !== v.costLow ? '–' + fmt(aedOf(v.costHigh, ctx)) : ''})` : '';
  return `${v.name}${v.day === ctx.today ? ' (today)' : ` (${dateLabel(v.day)})`}: ${costTwo(v)} for two${aed}${tot && !tot.startsWith(costTwo(v).split(' ')[0]) ? `; the whole day ${tot}` : ''}.${v.notes ? ' ' + dot(v.notes) : ''}`;
}
function venueReach(v, ctx) {
  const { inT, outT } = venueVisit(v, ctx);
  if (!inT) return `${v.name} is at ${v.area || 'the place in your plan'}${v.day ? ` (${dateLabel(v.day)})` : ''}.`;
  const dist = (/(\d+(?:[.,]\d+)?\s?(?:km|m))(?![a-z])/.exec(inT.dur || '') || [])[1], min = (/(\d+)\s?min/.exec(inT.dur || '') || [])[1], slope = (/(downhill|uphill|flat|gentle rise)/.exec(inT.dur || '') || [])[1];
  const how = inT.mode === 'walk' ? `${dist || ''}${min ? ` (${min} min walk${slope ? ', ' + slope : ''})` : ''}`.trim() : `${inT.dur || ''} by ${legKind(inT)}`;
  return `${v.name} is ${how} from ${inT.from}${outT ? `; then the ${legKind(outT)}, ${plainLabel(outT.label)}: ${outT.dur || 'see the plan'}` : ''}.`;
}
// the meal plan of one day: the venue that answers "where do we eat / shisha tonight", or what the plan says instead
function mealPick(iso, kinds, q, ctx) {
  const C = ctx.content, d = dayAt(ctx, iso); if (!d) return null;
  const live = iso === ctx.today && ctx.nowMin != null, now = ctx.nowMin;
  const night = /(tonight|dinner|evening|ليله|عشاء)/.test(q) || (live && now >= 17 * 60);
  const word = /lunch|غداء/.test(q) ? 'Lunch' : /dinner|عشاء/.test(q) ? 'Dinner' : /breakfast|فطور|فطار/.test(q) ? 'Breakfast' : '';
  const when = word ? `${word} ${relDay(iso, ctx, night)}` : cap(relDay(iso, ctx, night));
  const all = C.venues.filter(v => v.day === iso && v.status !== 'option');
  const eatQ = !kinds.length, kindOk = (v) => eatQ ? ['meal', 'breakfast'].includes(v.kind) : kinds.includes(v.kind) || (kinds.includes('meal') && v.kind === 'breakfast');
  const vs = all.filter(kindOk), tOf = (v) => toMin(venueVisit(v, ctx).at);
  const v = live ? vs.find(x => (tOf(x) ?? 1e9) + 60 >= now) || vs[vs.length - 1] : vs.find(x => x.kind === 'meal') || vs[0];
  if (v) {
    const later = eatQ && all.find(x => x.kind === 'shisha' && x !== v && all.indexOf(x) > all.indexOf(v));
    return { v, text: `${when}: ${venueLine(v, ctx, { price: PRICEQ.test(q) }).replace(/\.$/, '')}${later ? `; shisha later at ${later.name}, ${shortArea(later.area)}` : ''}.` };
  }
  const meal = word ? word.toLowerCase() : !live ? 'food' : now < 11 * 60 ? 'breakfast' : now < 16 * 60 ? 'lunch' : 'dinner';
  if (!eatQ) {   // "shisha tomorrow" on a day without one
    const lastV = all[all.length - 1], end = (d.trips || [])[d.trips.length - 1];
    return { v: null, text: `No ${kinds.map(k => (KIND[k] || k).toLowerCase()).join(' or ')} is planned ${iso === ctx.today ? (night ? 'tonight' : 'today') : `on ${dateLabel(iso)}`}${lastV ? `; the day ends with ${lastV.kind === 'meal' ? 'the meal' : 'a stop'} at ${lastV.name}${end && /taxi_home|shuttle/.test(end.mode) ? ', then taxi home' : ''}` : ''}.` };
  }
  const hb = hotelForDate(iso, ctx), inc = (d.costs || []).some(c => /included/i.test(c.value) && /(food|meal)/i.test(c.label));
  if (inc && hb) {
    const board = /inclusive|board/i.test(hb.subtitle || '') ? hb.subtitle : hb.board || '';
    const sh = all.find(x => x.kind === 'shisha');
    return { v: null, text: `You are at ${hb.short || hb.title}: ${meal === 'food' ? 'meals are' : meal + ' is'} included${board ? ` (${board})` : ''}, so eat at the resort. No outside meal is planned ${relDay(iso, ctx)}.${sh ? ` Shisha ${night ? 'tonight' : 'later'} at ${sh.name}.` : ''}` };
  }
  // a free evening: what the plan says about dinner, and the next fixed time
  const say = mealLine(d, meal);
  const nx = live && tripClock(d, ctx).find(x => !x.est && x.min > now);
  const ready = nx && (/be ready at (\d{1,2}:\d{2})/.exec(nx.t.dur || '') || [])[1];
  return { v: null, text: `No restaurant is booked ${relDay(iso, ctx, night)}${d.free ? ' (free day)' : ''}.${say ? ` Your plan: ${dot(say)}` : ''}${nx ? ` Be back by ${ready || hm(nx.min - 15)} for the ${nx.t.time} ${legKind(nx.t)} (${plainLabel(nx.t.label)}).` : ''}` };
}
// the plan's own line about a meal ("keep dinner close to the hotel"): that meal first, never a breakfast line for dinner
function mealLine(d, meal = '') {
  const pool = [...(d.fixed || []), ...(d.plan || [])], m = /lunch|dinner|breakfast/.exec(meal)?.[0] || 'dinner';
  return pool.find(x => new RegExp(m, 'i').test(x)) || pool.find(x => /(eat|meal)/i.test(x) && !/breakfast/i.test(x)) || null;
}
// a venue's position: a trip point with its name, else a venue with coordinates on the same street
function venuePoint(v, C) {
  const G = geoFor(C), key = vKey(v), re = new RegExp(`(^|\\s)${reEsc(key)}(\\s|$)`);
  const p = G.pts.find(e => re.test(e.n)); if (p) return p;
  const street = norm(v.area || '').split(' ').filter(w => w.length >= 5 && !/\d/.test(w));
  for (const o of C.venues) {
    if (o === v) continue;
    const ow = norm(o.area || '');
    if (street.filter(w => ow.includes(w)).length >= 2) { const q = G.pts.find(e => new RegExp(`(^|\\s)${reEsc(vKey(o))}(\\s|$)`).test(e.n)); if (q) return q; }
  }
  return null;
}
const gpsOf = (b) => { const m = /(-?\d+\.\d+),\s*(-?\d+\.\d+)/.exec(b?.gps || ''); return m ? { lat: +m[1], lng: +m[2] } : null; };
const taxiMins = (km) => { const road = km * 1.35, fast = road > 25; return [Math.max(5, Math.round(road / (fast ? 50 : 30) * 60 / 5) * 5), Math.max(8, Math.round(road / (fast ? 32 : 20) * 60 / 5) * 5)]; };
// "shisha near the hotel tonight": what is booked, else the closest saved places
function nearHotelText(iso, kinds, q, ctx) {
  const C = ctx.content, d = dayAt(ctx, iso) || dayAt(ctx, ctx.todayInTrip), hb = hotelForDate(iso || ctx.today, ctx), hp = gpsOf(hb);
  if (!d || !hp) return null;
  const night = /(tonight|evening|dinner|ليله)/.test(q), kindOk = (v) => !kinds.length || kinds.includes(v.kind);
  const booked = C.venues.find(v => v.day === d.date && v.status !== 'option' && kindOk(v));
  const G = geoFor(C), hn = norm(hb.short || hb.title).split(' ')[0];
  const near = C.venues.filter(v => kindOk(v) && dayAt(ctx, v.day)?.city === d.city).map(v => ({ v, p: venuePoint(v, C) })).filter(x => x.p)
    .map(x => ({ ...x, km: kmBetween(hp, x.p) })).sort((a, b) => a.km - b.km).slice(0, 2);
  const ride = (x) => { const l = G.legs.find(l => (l.a === x.p && l.b.n.includes(hn)) || (l.b === x.p && l.a.n.includes(hn))); const tm = l?.t.dur && /\d+–\d+ min/.exec(l.t.dur); return tm ? `about ${tm[0]} by taxi` : `≈ ${fmtKm(x.km)} away, about ${taxiMins(x.km).join('–')} min by taxi`; };
  const kw = kinds.length ? kinds.map(k => (KIND[k] || k).toLowerCase()).join(' or ') : 'places';
  const head = booked ? `${cap(relDay(d.date, ctx, night))}: ${venueLine(booked, ctx)}.` : `Nothing is booked ${relDay(d.date, ctx, night)}${d.free ? ' (free day)' : ''}.`;
  return { v: booked || near[0]?.v || null, text: `${head}${near.length ? ` Closest saved ${kw} to ${hb.short || hb.title}: ${near.map(x => `${x.v.name}, ${shortArea(x.v.area)} (${costTwo(x.v)}, ${ride(x)})`).join(' or ')}.` : ''}` };
}

/* the night we fly out, leaving, time before the next fixed thing, part of the day */
// "tonight (after midnight, so the ticket says Sun 11 Oct)"
function flightWhen(iso, dep, ctx) {
  const night = dep != null && dep < 6 * 60, eve = night ? isoAdd(iso, -1) : iso;
  if (night && iso === ctx.today && ctx.nowMin != null && ctx.nowMin < dep) return `in ${spanTxt(dep - ctx.nowMin)} (${dateLabel(iso)})`;
  const rel = eve === ctx.today ? (night ? 'tonight' : 'today') : eve === isoAdd(ctx.today, 1) ? (night ? 'tomorrow night' : 'tomorrow') : `${night ? 'the night of ' : 'on '}${dateLabel(eve)}`;
  return night ? `${rel} (after midnight, so the ticket says ${dateLabel(iso)})` : rel.startsWith('on ') ? rel : `${rel} (${dateLabel(iso)})`;
}
function departAnswer(ctx) {
  const C = ctx.content, b = C.bookings.find(x => x.id === cfg(ctx).firstFlight), leg = b?.legs?.[0];
  if (!leg) return null;
  const dep = toMin(leg.from), code = (/^[A-Z]{3}/.exec(leg.from) || [''])[0], city = String(b.title || '').split(' → ')[0];
  const r = flightAnswer('', ctx, b);
  // only what the trip data says: the departure, and that no leave-home or airport-arrival time is stored (no invented rule of thumb)
  r.quick = `${leg.flight} leaves ${city}${code ? ` (${code})` : ''} at ${hm(dep)} ${flightWhen(b.dateIso, dep, ctx)}. The plan stores no leave-home time or airport-arrival time, so plan the drive and check-in yourself.`;
  return Object.assign(r, { intent: 'flight', date: b.dateIso, subject: { kind: 'booking', id: b.id } });
}
const LEAVE_W = new Set(['what', 'time', 'when', 'leave', 'leaving', 'depart', 'head', 'should', 'must', 'have', 'need', 'hotel', 'today', 'tomorrow', 'tonight', 'morning', 'resort', 'فندق', 'لازم', 'get', 'going', 'set', 'off'].map(norm));
function leaveAnswer(q, date, ctx, now) {
  const C = ctx.content, iso = date || ctx.todayInTrip, d = dayAt(ctx, iso);
  if (!d?.trips?.length) return null;
  const all = tripClock(d, ctx).filter(x => !x.t.pseudo && x.t.mode !== 'walk');
  const words = q.split(' ').filter(w => w.length >= 4 && !STOP.has(w) && !LEAVE_W.has(w));
  const sg = words.length ? findSight(arPlaces(q), ctx) : null;
  const named = words.length ? all.find(x => words.some(w => new RegExp(`(^|\\s)${reEsc(w)}`).test(norm(`${x.t.to} ${x.t.label}`)))) || (sg && all.find(x => aliasScore(norm(x.t.to), sightNames(sg)) > 0)) : null;
  const live = iso === ctx.today && now != null;
  const x = named || (live ? all.find(y => y.min >= now - 10) : all[0]);
  if (!x) {
    const lx = all[all.length - 1];
    return { title: 'No more departures today', blocks: dayBlocks(d, ctx, { withMap: false }), quick: `Nothing else leaves ${relDay(iso, ctx)}${lx ? `: the last trip was at ${lx.est ? 'about ' : ''}${hm(lx.min)} (${plainLabel(lx.t.label)})` : ''}.`, intent: 'next', date: iso, subject: { kind: 'day', id: iso } };
  }
  const t = x.t, at = x.est ? `about ${hm(x.min)}` : t.time, tr = t.mode === 'shuttle' && transferOf(t, d, C);
  const hb = hotelForDate(isoAdd(iso, -1), ctx), out = hb && checkoutIso(hb, ctx) === iso && norm(t.from).includes(norm(hb.short || hb.title).split(' ')[0]);
  const fl = t.mode === 'shuttle' && all.find(y => y.min > x.min && y.t.mode === 'flight'), flNo = fl && (/[A-Z]{2}\d{2,4}/.exec(`${fl.t.label} ${fl.t.dur}`) || [''])[0];
  let line = tr ? `${at} — the ${tr.who} picks you up at ${t.from}${t.dur ? ` (${t.dur})` : ''}` : `${at} — ${legLine(t)}`;
  if (out && hb.checkout) line += `; check-out ${hb.checkout}`;
  if (fl) line += `; then ${flNo || 'the flight'} at ${fl.t.time}`;
  const op = opensLater(t, iso, x.min, ctx); if (op) line += `; ${op}`;
  if (x.est) line += '. No fixed time in the plan: this is my estimate';
  const rest = tripClock(d, ctx).filter(y => y.min > x.min && !y.t.pseudo).slice(0, 4);
  const blocks = [...(rest.length ? [H('Then'), L(rest.map(y => `${y.est ? '≈ ' : ''}${hm(y.min)} · ${y.t.modeText}: ${y.t.label}${y.t.dur ? ' · ' + y.t.dur : ''}`))] : []), ...dayBlocks(d, ctx, { withMap: false })];
  return { title: `Leave ${relDay(iso, ctx)} at ${at}`, blocks, quick: `${iso === ctx.today ? '' : cap(relDay(iso, ctx)) + ': '}${line}.`, intent: 'next', date: iso, subject: { kind: 'day', id: iso },
           actions: [{ act: 'day', date: iso, label: `Open ${dateLabel(iso)}`, icon: 'days' }, ...(t.directions ? [{ act: 'url', href: t.directions, label: 'Directions', icon: 'navigation' }] : []),
                     ...(tr && tr.b.phone ? [{ act: 'url', href: telOf(tr.b.phone), label: `Call ${tr.who}`, icon: 'phone' }] : [])],
           suggestions: ['What’s next?', `Plan for ${dateLabel(iso)}`] };
}
const NEED = { swim: 45, swimming: 45, pool: 45, beach: 60, coffee: 30, tea: 20, drink: 20, dinner: 75, lunch: 60, meal: 60, eat: 45, food: 45, breakfast: 40, snack: 20,
  shower: 20, nap: 45, rest: 30, walk: 30, shopping: 60, shop: 60, shisha: 60, photos: 20, photo: 20 };
// "do we have time for a swim before the waterfall taxi?": the next fixed thing of that kind, and the gap from now
function timeForAnswer(q, date, ctx, now) {
  const iso = date || ctx.todayInTrip, d = dayAt(ctx, iso);
  if (!d || iso !== ctx.today || now == null) return null;
  const m = /(?:^|\s)(?:before|until|till|قبل)\s+(.+)$/.exec(q); if (!m) return null;
  const after = m[1].split(/\s(?:or|and|then|او|ولا)\s/)[0];
  const MODES = [[/(taxi|cab)/, /taxi/], [/(ferry|boat|vapur|عباره|مركب)/, /ferry/], [/(pick ?up|shuttle|transfer|van|driver|airport)/, /shuttle/], [/(flight|plane|طياره)/, /flight/]];
  const mode = MODES.find(([re]) => re.test(after))?.[1];
  const words = after.split(' ').filter(w => w.length >= 4 && !STOP.has(w) && !/^(taxi|ferry|boat|pick|pickup|shuttle|airport|transfer|flight|plane|driver)$/.test(w));
  const up = tripClock(d, ctx).filter(x => x.min >= now - 5);
  const y = up.find(x => (!mode || mode.test(x.t.mode)) && words.some(w => norm(`${x.t.to} ${x.t.label}`).includes(w))) || (mode && up.find(x => mode.test(x.t.mode))) || (!mode && !words.length ? up[0] : null);
  if (!y) return null;
  const t = y.t, set = (/be ready at (\d{1,2}:\d{2})/.exec(t.dur || '') || [])[1];
  const ready = toMin(set) ?? y.min - (t.mode === 'flight' ? 180 : 10), at = t.time || `≈ ${hm(y.min)}`;
  const what = (/(?:time for|time to|for)\s+(?:a |an |some |the )?([a-z]+)/.exec(q.slice(0, m.index)) || [])[1] || '';
  const need = NEED[what] ?? 30, gap = ready - now;
  const verdict = gap >= need + 10 ? 'Yes' : gap >= need * 0.6 ? 'Just about' : 'No';
  const lead = t.mode === 'ferry' ? `the ferry leaves ${t.from} at ${at}` : t.mode === 'shuttle' ? `the pickup (${plainLabel(t.label)}) is at ${at}` : t.mode === 'flight' ? `the flight (${plainLabel(t.label)}) leaves at ${at}`
    : `the ${legKind(t)} to ${plainLabel(t.to)} is at ${at}`;
  const where = set ? `be ready at ${set}` : `be ${t.mode === 'ferry' ? `at ${t.from}` : t.mode === 'flight' ? 'at the airport' : 'at the lobby'} by about ${hm(ready)}`;
  const say = /(dinner|lunch|eat|meal|food|breakfast)/.test(what) ? mealLine(d, what) : null;
  const quick = `${verdict} — ${lead}, ${spanTxt(y.min - now)} from now; ${where} (${spanTxt(gap)} from now).${say ? ` Your plan: ${dot(say)}` : ''}`;
  const blocks = [L(up.slice(0, 4).map(z => `${z.est ? '≈ ' : ''}${hm(z.min)} · ${z.t.modeText}: ${z.t.label}${z.t.dur ? ' · ' + z.t.dur : ''}`)), ...dayBlocks(d, ctx, { withMap: false })];
  return { title: `${verdict}: ${spanTxt(gap)} until ${set ? 'you must be ready' : 'you must go'}`, blocks, quick, intent: 'next', date: iso, subject: { kind: 'day', id: iso },
           actions: [{ act: 'day', date: iso, label: 'Open today', icon: 'days' }], suggestions: ['What’s next?', 'Plan for today'] };
}
const PARTS = [['this morning', 0, 720], ['morning', 0, 720], ['this afternoon', 720, 1020], ['afternoon', 720, 1020], ['this evening', 1020, 1500], ['tonight', 1020, 1500], ['evening', 1020, 1500]];
// "what do we have this morning", "إيش عندنا الصبح"
function partAnswer(q, date, ctx) {
  const p = PARTS.find(([w]) => has(q, [w])); if (!p) return null;
  if (!/(what do we have|what are we doing|whats on|what is on|what do we do|whats planned|what is planned|(^|\s)plans?(\s|$)|program|schedule)/.test(q) && q.split(' ').length > 3) return null;
  const iso = date || ctx.todayInTrip, d = dayAt(ctx, iso); if (!d) return null;
  const xs = tripClock(d, ctx).filter(x => x.min >= p[1] && x.min < p[2] && !x.t.pseudo), first = xs[0];
  const pl = p[1] === 0 ? d.plan?.[0] : p[1] >= 1020 ? d.plan?.[d.plan.length - 1] : d.plan?.[Math.floor((d.plan?.length || 1) / 2)];
  const pre = iso === ctx.today ? '' : `${cap(relDay(iso, ctx))}: `;
  const r = dayAnswer(d, ctx);
  r.quick = first ? `${pre}${first.est ? '≈ ' : ''}${hm(first.min)} — ${legLine(first.t)}.${pl ? ' ' + dot(pl) : ''}` : `${pre}Nothing timed ${p[0]}.${pl ? ' Your plan: ' + dot(pl) : ''}`;
  return Object.assign(r, { intent: 'day', date: iso, subject: { kind: 'day', id: iso } });
}
function reason(q, { date, sc, ctx, venue, intent }) {
  const C = ctx.content, now = saidClock(q) ?? ctx.nowMin, before = ctx.today < C.days[0].date;
  // (a named flight number or another departure city is that leg, not the first departure: legTimeAns answers it)
  const F = factsFor(C), firstF = F.flights.find(f => f.b.id === cfg(ctx).firstFlight), otherLeg = F.flights.some(f => f.legs.some((x, i) => x.l.flight && has(q, [x.l.flight]) && !(f === firstF && i === 0)));
  if (before && !otherLeg && LEAVEQ.test(q) && /(airport|flight|fly|flying|plane|tonight|what time|مطار|طياره)/.test(q)) return departAnswer(ctx);
  if (TIMEFORQ.test(q) && /(^|\s)(before|until|till|قبل)(\s|$)/.test(q)) { const r = timeForAnswer(q, date, ctx, now); if (r) return r; }
  if (LEAVEQ.test(q) && /(what time|when|time|متي)/.test(q) && !before && !/(flight|fly|plane|طياره)/.test(q) && !venue) { const r = leaveAnswer(q, date, ctx, now); if (r) return r; }
  if (!sc.food && [null, undefined, 'day', 'next', 'search', 'greet'].includes(intent)) { const r = partAnswer(q, date, ctx); if (r) return r; }
  return null;
}
// the taxi home of the day when the question names no start ("kam taxi lel hotel", "back to the hotel from here")
function homeLeg(q, date, ctx) {
  if (!/(hotel|resort|home|فندق)/.test(q) || !(ROUTEQ.test(q) || /(how much|cost|price|fare|how long|far)/.test(q))) return null;   // "taxi to hotel" alone is the driver card
  const iso = date || ctx.todayInTrip, G = geoFor(ctx.content);
  const legs = G.legs.filter(l => l.d.date === iso && (l.t.mode === 'taxi_home' || l.b.cls.includes('hotel')));
  const l = legs.find(x => x.t.mode === 'taxi_home') || legs[legs.length - 1];
  if (!l) return null;
  const said = (/(?:we are|were|we re|im|i am)\s+(?:at|in|near)\s+(?:the\s+)?([a-zÀ-ɏ]{4,})/.exec(q) || [])[1];
  return { from: l.a, to: l.b, said: said && !l.a.n.includes(said) ? cap(said) : null };
}

/* ───────────── conversation memory: a follow-up uses the previous answer's subject and day ───────────── */
const FU_LEAD = /^(?:(?:and|so|ok|okay|then|also|what about|how about|طيب|طب|وماذا عن|و)\s+)+/;
const FU_DATEW = new Set([...DATEW, 'on', 'for', 'then', 'instead', 'i', 'said', 'meant', 'mean', 'not', 'general', 'please', 'what', 'about', 'how', 'no', 'just', 'only', 'now', 'ليله', 'نهارده', 'بكره', 'غدا', 'حين'].map(norm));
const DATE_TOK = new RegExp(`(^|\\s)(?:today|todays|tonight|tonite|tomorrow|tmrw|tmr|yesterday|now|this morning|this evening|this afternoon|day after tomorrow|(?:on |for )?(?:${[...WEEKDAYS.flat(), ...MONTHS.flat()].map(norm).map(reEsc).join('|')})|(?:on |for )?(?:the )?\\d{1,2}(?:st|nd|rd|th)?|يوم|بكره|ليله|نهارده)(?=\\s|$)`, 'g');
const dateWords = (s) => (s.match(DATE_TOK) || []).map(x => x.trim()).join(' ');
function followUp(q, ctx, wantsPdf) {
  const p = ctx.prev, C = ctx.content, S = p.subject || null;
  const lead = FU_LEAD.test(q), corr = /^(?:no|nope|nah|لا)\s+(?:the|i said|i meant|i mean|قصدي|انا قلت)(?:\s|$)|^(?:i said|i meant|i mean|قصدي|اقصد|انا قلت)(?:\s|$)/.test(q);
  const rest = q.replace(FU_LEAD, '').replace(/^(?:no|nope|nah|لا)\s+/, '').replace(/^(?:i said|i meant|i mean|قصدي|اقصد|انا قلت)\s+/, '').trim();
  if (!rest) return null;
  const ws = rest.split(' ');
  const again = (q2, extra = {}) => answer(q2, { ...ctx, prev: null, _again: true, ...extra });
  const done = (r, intent, date, subject) => finish(Object.assign(r, { date: date ?? null, subject: subject ?? null }), intent, { q, date, ctx, wantsPdf });
  // a bare number after a conversion: "and 2000?"; another currency: "and in euros?", "بالدولار"
  if (p.intent === 'convert' && /^\d[\d.\s]*$/.test(rest)) { const c0 = parseConvert(p.q); if (c0) return done(convertAnswer({ amount: +rest.replace(/[^\d.]/g, ''), from: c0.from }, ctx), 'convert'); }
  const cw = p.intent === 'convert' && ws.length <= 4 && curWord(rest);
  if (cw) { const c0 = S?.amount ? { amount: S.amount, from: S.cur } : parseConvert(p.q); if (c0) return done(convertAnswer({ amount: c0.amount, from: c0.from, to: cw }, ctx), 'convert', null, { kind: 'topic', id: 'convert', amount: c0.amount, cur: c0.from }); }
  // "in dirhams?" after an answer that gave a price ("€60 for two at Galata Tower"): that first amount in the asked currency
  const cw2 = p.intent !== 'convert' && ws.length <= 3 && !/\d/.test(rest) && curWord(rest);
  if (cw2) {
    const l0 = lineOf(again(p.q)), mm = /(₺|€|\$|AED\s?)(\d[\d,]*(?:\.\d+)?)(?:\s*[–-]\s*(\d[\d,]*(?:\.\d+)?))?/.exec(l0), from = mm && ({ '₺': 'TRY', '€': 'EUR', $: 'USD' }[mm[1]] || 'AED');
    if (mm && from !== cw2) {
      const num = (x) => +String(x).replace(/,/g, ''), amount = num(mm[2]), r = convertAnswer({ amount, from, to: cw2 }, ctx), what = l0.slice(mm.index).split(/\s\(|[.;]\s|\.$/)[0].trim();
      const hi = mm[3] ? convertAnswer({ amount: num(mm[3]), from, to: cw2 }, ctx).title.split(' ≈ ')[1].replace(/^[^\d]+/, '') : null, rate = (/\(at [^)]+\)/.exec(r.quick || '') || [''])[0];
      r.quick = `${what} ≈ ${r.title.split(' ≈ ')[1]}${hi ? '–' + hi : ''}${rate ? ' ' + rate : ''}.`;
      return done(r, 'convert', null, { kind: 'topic', id: 'convert', amount, cur: from });
    }
  }
  // "until then", "meanwhile": the plan between now and the time the last answer gave
  if (/(until then|till then|meanwhile|in the meantime|before then|until that)/.test(rest)) { const r = untilThen(ctx, p); if (r) return done(r, 'day', r.date, r.subject); }
  // "and after that?" after the next step: the step after it
  if (['next', 'day'].includes(p.intent) && /(after that|then what|and then|what else|after it|and next|after this)/.test(rest) && ctx.todayInTrip) {
    const d = dayAt(ctx, ctx.todayInTrip), st = nextStep(d, ctx.nowMin ?? 0, { doneN: (ctx.progress || {})[d.date] || 0, content: C }), tl = st.timeline.filter(x => !x.started);
    const y = tl[1]; if (y) { const z = tl[2]; return done(Object.assign(dayAnswer(d, ctx), { quick: `Then ${y.est ? '≈ ' : ''}${y.at} · ${y.trip.modeText}: ${plainLabel(y.trip.label)}${y.trip.dur ? ' · ' + y.trip.dur : ''}${z ? `; after that ${z.est ? '≈ ' : ''}${z.at} · ${legKind(z.trip)} to ${plainLabel(z.trip.to)}` : ''}.` }), 'next', d.date, { kind: 'day', id: d.date }); }
  }
  // "which one is the most urgent" after a list of bookings to make
  if (S?.kind === 'todo' && /(urgent|first|earliest|soonest|next|which one|priority|most important)/.test(rest)) {
    const xs = S.id === 'book' ? restoTodos(ctx) : [];
    if (xs.length) return done(Object.assign(todoAnswer(ctx, 'book'), { quick: restoLine(xs[0], ctx) }), 'todo', null, S);
  }
  // only a new day: "and tomorrow?", "and on tuesday?", "no, I said today"
  const nd = ws.every(w => FU_DATEW.has(w) || /^\d{1,2}(st|nd|rd|th)?$/.test(w)) ? findDate(rest, ctx) : null;
  if (nd && (lead || corr || ws.length <= 3)) {
    const sight = S?.kind === 'sight' && (C.sights || []).find(x => x.id === S.id);
    if (sight) return done(sightAnswer(sight, `is it open ${rest}`, nd, ctx), 'open', nd, { kind: 'sight', id: sight.id });
    if (['next', 'day', 'greet', 'search'].includes(p.intent)) return again(`plan ${dateWords(rest)}`, { _date: nd });
    const base = norm(p.q).replace(DATE_TOK, ' ').replace(/\s+/g, ' ').trim();
    return base ? again(`${base} ${dateWords(rest)}`.trim(), { _date: nd }) : null;
  }
  // a correction with a new subject: "no, the istanbul one", "I meant arise"
  if (corr) {
    const add = rest.replace(/(^|\s)(the|one|ones|that|this|not|please)(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim();
    return add && !/(thanks|thank|okay|worries|شكرا)/.test(add) ? again(`${p.q} ${add}`) : null;
  }
  if (p.intent === 'phrases' && lead && ws.length <= 4) return again(`how do i say ${rest}`);
  if (['spent', 'money', 'left', 'daycost'].includes(p.intent) && /(^|\s)(left|remaining|rest|باقي|متبقي)(\s|$)/.test(rest)) {
    const dd = /(^|\s)(today|todays|يوم|اليوم)(\s|$)/.test(rest) ? ctx.todayInTrip : findDate(rest, ctx);
    return done(leftAnswer(ctx, dd), 'left', dd || null, null);
  }
  const b0 = S?.kind === 'booking' && C.bookings.find(x => x.id === S.id);
  // the same question about another booking of the same kind: "and the istanbul one?", "and the dubai flight?"
  if (b0 && ws.length <= 5) {
    const nb = bestByAlias(rest, C.bookings.filter(x => x.kind === b0.kind && x !== b0 && !['cancelled', 'to-cancel'].includes(x.status)));
    if (nb) {
      let q0 = ` ${norm(p.q)} `; for (const w of [...(b0.aliases || []), ...(b0.keywords || []), b0.short || ''].map(norm).filter(Boolean)) q0 = q0.replace(new RegExp(`(^|\\s)${reEsc(w)}(?=\\s|$)`, 'g'), ' ');
      return again(`${q0.trim()} ${norm(nb.short || nb.title)}`.replace(/\s+/g, ' '));
    }
  }
  // the same subject, another detail ("how much for 2", "how far is it?", "call them", "do we need to book?")
  const own = findVenue(rest, ctx) || findSight(arPlaces(rest), ctx) || C.bookings.some(b => has(rest, b.keywords || [])) || C.transport.ferries.some(f => aliasScore(rest, f.aliases) > 0);
  if (own || ws.length > (/(^|\s)(there|it|its|that place|this place|them|they)(\s|$)/.test(rest) ? 10 : 7)) return null;   // a word pointing back allows a longer question
  const A = (re) => re.test(rest);
  const priceQ = PRICEQ.test(rest) || A(/(^|\s)(how much|for 2|for two|two of us)(\s|$)/), farQ = DISTQ.test(rest) || A(/(^|\s)(far|get there|how long|from here)(\s|$)/);
  const callQ = CALLQ.test(rest), bookQ = A(/(^|\s)(book|booking|bookings|reserve|reservation|reservations|احجز|نحجز|حجز)(\s|$)/), whenQ = A(/(^|\s)(when|what time|time|متي)(\s|$)/);
  const openQ = A(/(^|\s)(open|opened|closed|close|closes|hours|مفتوح)(\s|$)/), backQ = A(/(back|refund|return|deposit|يرجع|نسترد)/);
  const altQ = A(/(alternative|alternatives|instead|other option|other place|another (place|one)|backup|plan b|similar)/), walkQ = A(/(walk in|walk-in|without (a )?(booking|reservation)|just show up)/);
  const missQ = MISSQ.test(rest) || A(/(next one|later one|after (it|that))/), lateQ = LATEQ.test(rest), lastOutQ = LASTOUTQ.test(rest);
  const V = vocabFor(C), top = pick(scoreIntents(rest, V), V);
  const dom = S?.kind === 'venue' ? ['food', 'venue'] : S?.kind === 'sight' ? ['open'] : S?.kind === 'ferry' ? ['transport'] : b0 ? ({ flight: ['flight'], hotel: ['hotel', 'driver'], transfer: ['shuttle', 'driver'] }[b0.kind] || []) : [];
  // "how much should we expect to pay there": a word pointing back at the subject keeps it, whatever topic the other words score
  const pointQ = A(/(^|\s)(there|it|its|that place|this place|them|they)(\s|$)/) && (priceQ || farQ || callQ || bookQ || whenQ || openQ);
  const keep = (farQ && ['venue', 'sight'].includes(S?.kind)) || (S?.kind === 'ferry' && (missQ || lateQ || lastOutQ)) || (S?.kind === 'venue' && (altQ || walkQ)) || (pointQ && ['venue', 'sight'].includes(S?.kind));
  if (top && !keep && !['todo', 'money', 'open'].includes(top) && !dom.includes(top)) return null;   // a question with its own topic ("when is sunset") is not about the old subject
  if (S?.kind === 'venue') {
    const v = C.venues.find(x => x.id === S.id); if (!v) return null;
    const sub = { kind: 'venue', id: v.id }, base = (qq) => venueAnswer(v, ctx, qq);
    if (callQ) return done(base('call'), 'venue', v.day, sub);
    if (altQ) { const r = base(''), l = altLine(v, ctx, /(did not book|didnt book|not booked|walk in|no reservation|without)/.test(norm(p.q)) || walkQ); if (l) { r.quick = l; return done(r, 'venue', v.day, sub); } }
    if (walkQ) { const r = base(''); r.quick = walkInLine(v, ctx); return done(r, 'venue', v.day, sub); }
    if (A(/(^|\s)(cheaper|cheapest|less expensive)(\s|$)/)) { const r = base(''); r.quick = cheaperLine(v, ctx); return done(r, 'venue', v.day, sub); }
    if (bookQ) { const r = base(''); r.quick = venueBook(v, ctx); return done(r, 'venue', v.day, sub); }
    if (priceQ) { const r = base(''); r.quick = venueCost(v, ctx); return done(r, 'venue', v.day, sub); }
    if (farQ) { const r = base(''); r.quick = venueReach(v, ctx); return done(r, 'venue', v.day, sub); }
    if (whenQ || openQ || lead) return done(base(whenQ ? 'what time' : rest), 'venue', v.day, sub);
    return null;
  }
  if (S?.kind === 'sight') {
    const s = (C.sights || []).find(x => x.id === S.id); if (!s) return null;
    const sub = { kind: 'sight', id: s.id };
    if (priceQ && s.price) { const r = sightAnswer(s, '', null, ctx); r.quick = /(how much|for 2|for two|both|two of us|كم)/.test(rest) ? sightPrice(s, ctx) : `${s.name.split(' (')[0]}: ${s.price}.`; r.noQuick = false; return done(r, 'open', s.day, sub); }
    if (farQ) {
      // "from here": where the plan has you now; otherwise from the hotel
      const here = A(/(from here|from where we are|we are now)/) && hereOf(ctx), to = sightPoint(s, ctx);
      if (here && to && here !== to) return done(distanceAnswer({ from: here, to }, rest, ctx), 'distance', s.day, sub);
      const nm = sightNames(s), m = distanceMatch(norm(nm[nm.length - 1]), null, ctx); if (m) return done(distanceAnswer(m, rest, ctx), 'distance', s.day, sub);
    }
    if (openQ || whenQ || lead) { const dd = findDate(rest, ctx); return done(sightAnswer(s, `is it open ${rest}`, dd, ctx), 'open', dd || s.day, sub); }
    return null;
  }
  if (b0) {
    const sub = { kind: 'booking', id: b0.id };
    if (b0.kind === 'flight') {
      // "until what time exactly" after a check-in question; "lounge?", "how long is the stop?" about this flight
      const f = factsFor(C).flights.find(x => x.b === b0);
      if (f && CHECKQ.test(norm(p.q)) && A(/(until|till|close|closes|deadline|what time|when|exactly|open|opens|still|now|yet)/)) return done(checkinAnswer(f, rest, ctx), 'flight', b0.dateIso, sub);
      if (f && A(/(^|\s)(lounge|lounges)(\s|$)/)) { const r = loungeAns({ q: `${rest} ${f.legs[0].l.flight.toLowerCase()}`, ctx, date: null }); if (r) return done(r, 'flight', b0.dateIso, sub); }
      return done(flightAnswer(rest, ctx, b0), 'flight', b0.dateIso, sub);
    }
    if (b0.kind === 'transfer') return done(shuttleAnswer(ctx, rest), 'shuttle', null, sub);
    if (b0.kind === 'hotel' && A(/(address|driver|taxi|card|turkish|عنوان)/)) {   // "and the address in Turkish for the taxi"
      const c = C.driverCards.find(x => x.id === b0.driverCard); if (c) return done(driverAnswer(norm(c.aliases?.[0] || c.title), null, ctx), 'driver', null, sub);
    }
    if (b0.kind === 'hotel') {
      const s = backQ && bookingSentence(b0, `${rest} ${norm(p.q)}`);
      if (s) { const r = hotelAnswer(norm(b0.short || b0.title), null, ctx); r.quick = `${/(no refund|non-refundable|not refundable)/i.test(s) && !/paid back/i.test(s) ? 'No: ' : /(paid back|refund|returned|back)/i.test(s) ? 'Yes: ' : ''}${s}`; return done(r, 'hotel', null, sub); }
      return again(`${rest} ${norm(b0.short || b0.title)}`);
    }
  }
  if (S?.kind === 'ferry') {
    const f = C.transport.ferries.find(x => x.id === S.id); if (!f) return null;
    // "if we miss it?", "can we still make it?", "is it the last one?": the leg of today that uses this boat
    if (missQ || lateQ || lastOutQ) {
      const d = dayAt(ctx, ctx.todayInTrip), t = d && (d.trips || []).find(x => x.mode === 'ferry' && ferryOf(x, d, ctx) === f);
      const r = t && legPlan(t, d, ctx, { miss: missQ, late: lateQ && !missQ, last: lastOutQ && !missQ && !lateQ });
      if (r) return done(r, 'transport', d.date, { kind: 'ferry', id: f.id });
    }
    const r = transportAnswer(rest, null, ctx, f), last = ferryLast(f);
    if (priceQ) r.quick = ferryFare(f, ctx);
    else if (/(^|\s)(last|اخر)(\s|$)/.test(rest) && last) r.quick = `Last listed boat back: ${last.text}.${ferryPlanEnd(f, ctx)}`;
    return done(r, 'transport', null, { kind: 'ferry', id: f.id });
  }
  if (S?.kind === 'day' && priceQ) { const d = dayAt(ctx, S.id); if (d) return done(dayCostAnswer(d, ctx), 'daycost', d.date, S); }
  // no subject, but the previous answer was about one day: its main place ("call them" after "dinner tonight")
  if (p.date && (callQ || priceQ) && ['food', 'day', 'next'].includes(p.intent)) {
    const v = C.venues.find(x => x.day === p.date && x.status !== 'option' && (!callQ || x.phone || x.whatsapp));
    if (v) return done(callQ ? venueAnswer(v, ctx, 'call') : Object.assign(venueAnswer(v, ctx), { quick: venueCost(v, ctx) }), 'venue', v.day, { kind: 'venue', id: v.id });
  }
  return null;
}
function venueBook(v, ctx) {
  const { at } = venueVisit(v, ctx), tel = v.phone ? `Call ${v.phone}` : v.whatsapp ? `WhatsApp ${v.whatsapp}` : '';
  return v.book ? `Yes — ${v.name}: ${bookText(v).replace(/ on (WhatsApp )?\+[\d ]+$/, '')}.${tel ? ` ${tel}${at ? ` for ${at} ${relDay(v.day, ctx)}` : ''}.` : ''}`
    : `No booking is listed for ${v.name}${v.notes ? `: ${dot(v.notes)}` : '.'}`;
}
// the booking sentence that answers a detail ("do we get it back?" → the deposit line)
function bookingSentence(b, q) {
  const pool = [b.cancel, b.board, ...(Array.isArray(b.notes) ? b.notes : [b.notes])].filter(Boolean).flatMap(x => String(x).split(/(?<=\.)\s+/));
  const ws = q.split(' ').filter(w => w.length >= 4 && !STOP.has(w)), syn = { back: ['back', 'refund', 'return'], deposit: ['deposit'], refund: ['refund', 'back'] };
  let best = null, bs = 0;
  for (const s of pool) { const n = norm(s), sc = ws.reduce((a, w) => a + ((syn[w] || [w]).some(x => n.includes(x)) ? 1 : 0), 0); if (sc > bs) { best = s; bs = sc; } }
  return best;
}
// ferries: the fare for two, the last boat back, how the planned day ends
function ferryFare(f, ctx) {
  const pp = +String((/₺\s?([\d.,]+)/.exec(f.fare || '') || [])[1] || '').replace(/,/g, '');
  if (!pp) return `${f.line}: ${f.fare || 'fare not listed'}.`;
  const card = ctx.content.transport.cardTitle || 'transport card', route = String(f.line).replace(/\s*\([^)]*\)/g, '').replace(/ → /g, '–');
  // a boat you take one way only (no boat back in the app): the fare for two is one trip each
  if (!(f.back || []).length) return `₺${pp.toFixed(2)} per person (${route}) on the ${card}: ₺${(pp * 2).toFixed(2)} for both of you.`;
  return `₺${pp.toFixed(2)} per person each way with the ${card} (≈ ₺${fmt(pp * 4)} for two, there and back ≈ AED ${fmt(aedOf(pp * 4, ctx))}).`;
}
function ferryLast(f) {
  const b = f.back || []; if (!b.length) return null;
  const x = b[b.length - 1].replace(/\s*\([^)]*\)/g, ''), times = [...x.matchAll(/(\d{1,2}:\d{2})/g)].map(m => m[1]);
  const from = ((/^([^\d]+?)\s+\d/.exec(b[0]) || [])[1] || f.to).trim(), to = ((/→\s*([^\d→]+?)\s+\d{1,2}:\d{2}\s*$/.exec(b[0].replace(/\s*\([^)]*\)/g, '')) || [])[1] || f.from_).trim();
  return { dep: times[0], arr: times[times.length - 1], from, to, text: `${from} ${times[0]} → ${to} ${times[times.length - 1]}` };
}
// a free-day idea that uses this boat: "Kabataş 11:05 → Büyükada 12:50 … return 17:35 → Kabataş 19:25"
function ideaTimes(f, ctx) {
  const nf = norm(f.from_).split(' ')[0], nt = norm(f.to).split(' ')[0];
  for (const d of [dayAt(ctx, ctx.todayInTrip), ...ctx.content.days].filter(Boolean)) for (const s of d.ideas || []) {
    const n = norm(s), o = new RegExp(`${reEsc(nf)} (\\d{1,2}:\\d{2}) ${reEsc(nt)} (\\d{1,2}:\\d{2})`).exec(n); if (!o) continue;
    const b = new RegExp(`(\\d{1,2}:\\d{2}) ${reEsc(nf)} (\\d{1,2}:\\d{2})`).exec(n.slice(o.index + o[0].length));
    return { day: d.date, dep: toMin(o[1]), out: `${o[1]} from ${f.from_} → ${f.to} ${o[2]}`, back: b ? `${b[1]} → ${f.from_} ${b[2]}` : null };
  }
  return null;
}
function ferryPlanEnd(f, ctx) {
  const m = /^(\d{1,2}) ([A-Z][a-z]{2})$/.exec(f.used || ''); if (!m) { const t = ideaTimes(f, ctx); return t?.back ? ` The plan's return is ${t.back}.` : ''; }
  const iso = `${(ctx.content.meta.tripStart || '2026').slice(0, 4)}-${pad2(MON.indexOf(m[2]) + 1)}-${pad2(+m[1])}`, d = dayAt(ctx, iso), last = d?.trips?.[d.trips.length - 1];
  return last && /taxi_home|shuttle/.test(last.mode) ? ` Your plan ends that day by taxi instead: ${plainLabel(last.label)}${last.time ? ` ≈ ${last.time}` : ''}.` : '';
}

/* ───────────── getting around: taxi rules, the card, today's boats, the boat back ───────────── */
const usedTag = (iso) => `${+iso.slice(8)} ${MON[+iso.slice(5, 7) - 1]}`;
// "Kabataş → Büyükada (about 1 h 45 min, ₺151.23 pp): 10:05, 11:05, 12:00, 14:00"
const ferryOut = (f) => { const dur = (/about ([^.]+?)(?: via|\.|,|$)/i.exec(f.note || '') || [])[1]; return `${plainLabel(f.line)} (${[dur && 'about ' + dur, f.fare].filter(Boolean).join(', ')}): ${(f.times || []).map(t => t.split(' → ')[0]).join(', ')}`; };
// the plan's own way on from a place ("taxi Büyükdere → Feriye at 13:50")
function planFrom(w, d) {
  const ts = d?.trips || [], i = ts.findIndex(t => norm(t.to).includes(w)), nx = i >= 0 ? ts.slice(i + 1).find(t => t.mode !== 'walk') : null;
  return nx ? `${legKind(nx)} ${plainLabel(nx.label)}${nx.time ? ` at ${nx.time}` : ''}` : '';
}
function transportSmart(q, date, ctx, { boatQ }) {
  const C = ctx.content, T = C.transport, iso = date || ctx.todayInTrip, d = dayAt(ctx, iso), now = ctx.nowMin ?? 0;
  const taxiLine = (re) => T.taxi.find(x => re.test(x)), sentence = (s, re) => String(s || '').split(/(?<=\.)\s+/).find(x => re.test(x)) || '';
  if (TAXIQ.test(q) && /(extra|surcharge|night|scam|overcharg|allowed|cheat|more money|نصب|زياده)/.test(q)) {   // "the driver wants extra for night"
    const l = taxiLine(/night tariff|surcharge|scam/i), ss = String(l || '').split(/(?<=\.)\s+/);
    const lead = [...ss.filter(x => /(night|surcharge|scam|toll)/i.test(x)), ...ss.filter(x => !/(night|surcharge|scam|toll)/i.test(x))].join(' ');
    return l ? { quick: `${/(allowed|legal|ok|okay|is that|can they|should we)/.test(q) ? 'No: ' : ''}${lead} ${sentence(taxiLine(/taksimetre/i), /taksimetre/i)}`.trim() } : null;
  }
  if (TAXIQ.test(q) && /(^|\s)(app|apps|application|number|تطبيق)(\s|$)/.test(q)) {
    const s = sentence(taxiLine(/bitaksi|uber/i), /bitaksi|uber/i);
    return s ? { quick: `${s} No taxi phone number is stored in the app: book in BiTaksi or take one from a rank.` } : null;
  }
  if (/(istanbulkart|(^|\s)kart(\s|$))/.test(q) && /(balance|left on|on the card|on the istanbulkart|on it|remaining)/.test(q)) { const l = T.card.find(x => /^buy/i.test(x)); return { quick: `The app does not track the card balance: tap the card on any pier or metro machine to see it.${l ? ` The plan: ${lcFirst(l)}` : ''}`, cardFirst: true }; }
  // "can alaa and me use the same istanbulkart": the card's own sharing rule
  if (/(istanbulkart|(^|\s)kart(\s|$)|transport card)/.test(q) && /(same|share|sharing|shared|both|together|one card|two of us|each|own card|me and|and me|2 people|two people)/.test(q)) {
    const s = T.card.flatMap(x => sentences(x)).find(x => /(people|persons|same card|share)/i.test(x));
    if (s) { const l = T.card.flatMap(x => sentences(x)).find(x => /^buy/i.test(x)); return { quick: `${/(\bno\b|one|only|single)/i.test(s) && !/(up to|can)/i.test(s) ? '' : 'Yes — '}${lcFirst(s)}${l && l !== s ? ` ${l}` : ''}`, cardFirst: true }; }
  }
  if (/(istanbulkart|(^|\s)kart(\s|$))/.test(q) && /(buy|load|top up|topup|where|how much|recharge|charge)/.test(q)) { const l = T.card.find(x => /^buy/i.test(x)); return l ? { quick: l, cardFirst: true } : null; }
  if (/(move around|get around|getting around|how do we move|how do we travel)/.test(q) && d?.trips?.length) {
    const fare = (t) => { const f = t.mode === 'ferry' && T.ferries.find(x => x.used === usedTag(iso) && norm(t.from).includes(norm(x.from_).split(' ')[0])); return f?.fare ? ` (${f.fare})` : ''; };
    return { quick: `${cap(relDay(iso, ctx))}: ${d.trips.map(t => `${legKind(t)} ${plainLabel(t.label)}${t.time ? ' ' + t.time : ''}${fare(t)}`).join(', ')}.`, moves: { date: iso, trips: d.trips } };
  }
  if (!boatQ) return null;
  const words = q.split(' ').filter(w => w.length >= 4 && !STOP.has(w) && !['ferry', 'ferries', 'boat', 'boats', 'last', 'back', 'return', 'hotel', 'time', 'times', 'what', 'from', 'whats', 'which', 'side', 'need'].includes(w));
  // a boat back from a named pier ("ferry back from sariyer", "the last boat to our hotel from uskudar")
  const bf = words.map(w => [w, T.ferries.filter(f => (f.back || []).length && norm(f.back[0]).startsWith(w))]).find(([, x]) => x.length);
  if (bf && /(back|return|home|hotel|from|فندق|(^|\s)(من|رجوع|نرجع)(\s|$))/.test(q)) {
    const [w, fs2] = bf, hb = hotelForDate(iso || ctx.today, ctx), home = (hb?.aliases || []).map(norm), toHotel = /(hotel|home|فندق)/.test(q);
    const cand = toHotel ? fs2.filter(f => home.some(a => norm(`${f.from_} ${f.back[0]}`).includes(a))) : fs2, f = (cand.length ? cand : fs2)[0], L0 = ferryLast(f);
    const more = f.back.map(x => (/(\d{1,2}:\d{2})/.exec(x) || [])[1]).filter(t => t && t !== L0.dep && (iso !== ctx.today || toMin(t) >= now - 5));
    const alt = planFrom(w, d);
    // the boats still to come today (all of them on another day), the fare, and how the pier links to the hotel
    const left = f.back.filter(x => { const t = (/(\d{1,2}:\d{2})/.exec(x) || [])[1]; return iso !== ctx.today || !t || toMin(t) >= now - 5; }).map((x, k) => k === 0 && /^\d/.test(x) && L0?.from ? `${L0.from} ${x}` : x);
    const pierNote = toHotel && hb ? sentences(hb.notes).find(s => norm(s).includes(norm(String(f.to).split(/[\s/]/)[0]))) : null;
    const head = /(^|\s)(last|اخر)(\s|$)/.test(q) ? `Last boat ${L0.from} → ${L0.to}${toHotel ? ` (for ${hb.short || hb.title})` : ''} is ${L0.dep}, arriving ${L0.arr}${more.length ? ` (also ${more.join(', ')})` : ''}`
      : left.length ? `${/(^|\s)(is there|are there|any)(\s|$)|^(is|are|can|do|does)\s/.test(q) ? 'Yes — ' : ''}${left.join(' · ')} (${f.line}${f.fare ? `, ${f.fare}` : ''})${pierNote ? `. ${pierNote.replace(/\.$/, '')}` : ''}`
      : `No more boats back today on ${f.line} (the last listed was ${L0.dep}); take a taxi`;
    return { quick: `${head}.${alt ? ` Your plan instead: ${alt}.` : ''}`, ferry: f };
  }
  // today's boat: from or to the pier the question names, the next one, or which side to sit
  const fts = (d?.trips || []).filter(t => t.mode === 'ferry');
  const sideQ = /(^|\s)(side|sit|seat|right|left|نقعد|نجلس)(\s|$)/.test(q), beAt = /(be at|get to|need to be|arrive at|be there)/.test(q);
  const pw = words.find(w => fts.some(t => norm(`${t.from} ${t.to}`).includes(w)));
  if (!fts.length || iso !== ctx.todayInTrip || /(^|\s)(back|return|returning|home|last|first)(\s|$)/.test(q) || !(pw || sideQ || (!words.length && /(what time|when|time|next)/.test(q)))) return null;
  const all = fts.map(t => ({ t, m: tripMinutes(t) ?? 1e9 })), at = (x) => norm(`${x.t.from} ${x.t.to}`).includes(pw);
  const x = pw ? all.find(y => at(y) && y.m >= now - 5) || all.find(at) : all.find(y => y.m >= now - 5) || all[all.length - 1];
  const t = x.t, i = d.trips.indexOf(t), f = T.ferries.find(y => y.used === usedTag(iso) && norm(`${y.from_} ${(y.times || []).join(' ')}`).includes(norm(t.from).split(' ')[0]));
  if (sideQ) {
    const note = `${f?.note || ''} ${t.dur || ''}`, side = (/sit (?:on the )?(right|left)/i.exec(note) || [])[1];
    const rest = String(f?.note || t.dur || '').replace(/\s*sit (on the )?(right|left)\.?/i, '').replace(/\.$/, '').trim();
    if (side) return { quick: `Sit on the ${side.toUpperCase()} side: the ${t.time} boat from ${t.from} ${rest.charAt(0).toLowerCase()}${rest.slice(1)}.`, ferry: f };
  }
  const prev = d.trips[i - 1], pre = prev && /taxi/.test(prev.mode) && prev.time ? `; ${legKind(prev)} from ${prev.from} at ${prev.time}${prev.dur ? ` (${prev.dur})` : ''}` : '';
  // "when and how much for both of us": the fare for the two of you, and the line's own warning
  const pp = f && +String((/₺\s?([\d.,]+)/.exec(f.fare || '') || [])[1] || '').replace(/,/g, ''), fare = pp && /(^|\s)(how much|price|fare|fares|cost|كم)(\s|$)/.test(q)
    ? `: ₺${(pp * 2).toFixed(2)} for both of you (₺${pp.toFixed(2)} each)${/(recheck|sunday|check)/i.test(f.note || '') ? `. ${String(f.note).replace(/\.$/, '')}` : ''}` : '';
  return { quick: `${t.time || '≈ ' + hm(x.m)} from ${t.from} to ${t.to}${t.dur ? ` (${t.dur})` : ''}${beAt && t.time ? `: be at the pier by about ${hm(x.m - 10)}` : ''}${pre}${fare}.`, ferry: f };
}
// where to watch the sunset in the day's plan
function sunsetSpot(d) {
  const ts = d.trips || [], i = ts.findIndex(t => /sunset/i.test(t.label || ''));
  if (i < 0) return null;
  const t = ts[i], nx = ts.slice(i + 1).find(x => x.time);
  return { where: /sunset walk/i.test(t.label) ? `on the walk ${t.from} → ${t.to}` : `at ${t.to}`, then: nx ? `, then the ${nx.time} ${legKind(nx)} ${plainLabel(nx.label)}` : '' };
}
// "Tomorrow (Thu 15 Oct): check out of Concorde by 12:00; the 724 Transfer picks you up at 12:00." / "Not today: …"
function checkoutLine(b, date, ctx, q = '') {
  const out = checkoutIso(b, ctx), by = (/(\d{1,2}:\d{2})/.exec(b.checkout || '') || [])[1] || b.checkout, nm = b.short || b.title, key = norm(nm).split(' ')[0];
  if (!out) return `${b.title}: check-out ${b.checkout}.`;
  const shuttleFrom = (dd) => dd && (dd.trips || []).find(t => t.mode === 'shuttle' && norm(t.from).includes(key));
  if (out === ctx.today || out === date) {
    const sh = shuttleFrom(dayAt(ctx, out)), tr = sh && transferOf(sh, dayAt(ctx, out), ctx.content);
    return `${cap(relDay(out, ctx))}: check out of ${nm} by ${by}${sh ? `; the ${tr ? tr.who : 'transfer'} picks you up at ${sh.time}` : ''}.`;
  }
  // leaving before the check-out day (a night flight): the room is yours until the pickup
  const dep = shuttleFrom(dayAt(ctx, ctx.todayInTrip)), ready = dep && (/be ready at (\d{1,2}:\d{2})/.exec(dep.dur || '') || [])[1];
  // "do we have to leave the room at noon today?": no, and until when it is yours
  const until = factsFor(ctx.content).stays.find(s => s.b === b)?.until;
  if (/^(do|does|must|should|have|has|is|are|can|need) /.test(q) && until) return `No. ${until.replace(/\.$/, '')}${dep && ready ? ` (be ready at ${ready})` : ''}.`;
  return `Not ${date && date !== ctx.today ? 'on ' + dateLabel(date) : 'today'}: ${nm} check-out ${b.checkout} on ${dateLabel(out)}, so the room is yours until then${dep ? `; the airport pickup is tonight at ${dep.time}${ready ? ` (be ready at ${ready})` : ''}` : ''}.`;
}
// "do they take card": the taxi rule, and the museum rule when the place has a ticket
function payLine(q, to, ctx) {
  const pay = payAnswer(TAXIQ.test(q) ? 'taxi' : q, ctx).quick || '';
  const s = (ctx.content.sights || []).find(x => aliasScore(to.n, sightNames(x)) > 0);
  const mus = s && /(€|₺)\s?\d/.test(s.price || '') && ctx.content.tips.sections.flatMap(x => x.items).find(x => /refuse cash/i.test(x));
  return `Paying: ${pay}${mus ? ` ${String(mus).split(/(?<=\.)\s+/)[0]}` : ''}`;
}

/* ───────────── round 2: what the question really asks (party size, a clock time, yes/no) ───────────── */
// "for 2", "both of us": the party size, never a date ("kaytan shisha price for 2" is not 2 Oct)
const PARTY_RE = /(^|\s)(?:for (?:the )?(?:2|two|both(?: of us)?)|both of us|the two of us|two of us|x ?2|2 people|two people|2 persons|لشخصين|للاثنين|لنا الاثنين|احنا الاثنين)(?=\s|$)(?!\s+(?:oct|october|nov|sep|اكتوبر)(?:\s|$))/;
// "the 10:10 boat", "the 3 oclock ferry", "at 12", "at noon": a clock time, never a date
function clockOf(q) {
  let m = /(?:^|\s)(?:at |the |by )?(\d{1,2}):(\d{2})(?=\s|$)/.exec(q);
  if (m && +m[1] < 24 && +m[2] < 60) return { min: +m[1] * 60 + +m[2], text: m[0] };
  m = /(?:^|\s)(?:at |the |by )?(\d{1,2})\s?(oclock|am|pm)(?=\s|$)/.exec(q) || /(?:^|\s)at (\d{1,2})()(?=\s|$)/.exec(q);
  if (m && +m[1] >= 1 && +m[1] <= 12) return { min: (+m[1] === 12 ? (m[2] === 'am' ? 0 : 12) : +m[1] + (m[2] === 'pm' || (m[2] !== 'am' && +m[1] < 8) ? 12 : 0)) * 60, text: m[0] };
  m = /(?:^|\s)(?:at )?(noon|midday|midnight)(?=\s|$)/.exec(q);
  return m ? { min: m[1] === 'midnight' ? 0 : 720, text: m[0] } : null;
}
function frameOf(q) {
  const party = PARTY_RE.test(q) ? 2 : null, clock = clockOf(q);
  let qd = q.replace(PARTY_RE, ' '); if (clock) qd = qd.replace(clock.text, ' ');
  return { party, clock, qd: qd.replace(/\s+/g, ' ').trim(), yesno: /^(is|are|was|were|will|would|does|do|did|has|have|can|could|should|shall|must|may)\s/.test(q) || /(^|\s)(or not|yes or no)(\s|$)/.test(q) };
}

/* ───────────── derived facts: computed once per content (flights, stays, rides, phases) ───────────── */
const FACTS = new WeakMap();
const monIdx = (s) => MON.findIndex(m => m.toLowerCase() === String(s || '').slice(0, 3).toLowerCase());
// "01:30 on Sat 10 Oct" → { iso: '2026-10-10', min: 90 }
const whenOn = (s, y) => { const m = /(\d{1,2}:\d{2})\)?\s+on\s+(?:[A-Z][a-z]{2}\s+)?(\d{1,2})\s+([A-Z][a-z]{2})/.exec(s || ''); return m && monIdx(m[3]) >= 0 ? { iso: `${y}-${pad2(monIdx(m[3]) + 1)}-${pad2(+m[2])}`, min: toMin(m[1]) } : null; };
const sentences = (...xs) => xs.flat().filter(Boolean).flatMap(x => String(x).split(/(?<=[.!?])\s+/)).filter(Boolean);
const legPt = (s) => { const m = /^([A-Z]{3})(?:\s+(T\d))?\s+(\d{1,2}:\d{2})/.exec(s || ''); return m ? { code: m[1], term: m[2] || '', at: m[3], min: toMin(m[3]) } : null; };
const lcFirst = (x) => x ? x.charAt(0).toLowerCase() + x.slice(1) : '';
function factsFor(C) {
  if (FACTS.has(C)) return FACTS.get(C);
  const y = (C.meta?.tripStart || C.days[0].date).slice(0, 4), city = {}, links = C.config?.todoLinks || {};
  for (const c of C.config?.cities || []) if (c.code) city[c.code] = c.city;
  const flights = C.bookings.filter(b => b.kind === 'flight').sort((a, b) => (a.dateIso || '').localeCompare(b.dateIso || '')).map(b => {
    const ends = String(b.title || '').split(' → '), legs = (b.legs || []).map(l => ({ l, from: legPt(l.from), to: legPt(l.to) }));
    if (legs[0]?.from && !city[legs[0].from.code]) city[legs[0].from.code] = ends[0];
    const lt = legs[legs.length - 1]?.to; if (lt && ends.length > 1 && !city[lt.code]) city[lt.code] = ends[ends.length - 1];
    let off = 0, last = -1;   // a time earlier than the one before is the next day
    for (const x of legs) for (const p of [x.from, x.to]) if (p) { if (p.min + off < last) off += 1440; p.abs = p.min + off; last = p.abs; }
    const ss = sentences(b.notes), ci = ss.find(s => /check-?in/i.test(s) && /online/i.test(s)) || '';
    const todo = C.todos.find(t => links[t.id] === b.id && /check-?in/i.test(t.title)) || null;
    const thru = ss.join(' ').match(/(?:tagged through to|checked through to|go(?:es)? straight (?:on )?to|through to) ([A-Z][a-zA-Z]+(?: [A-Z][a-zA-Z]+)*)/);
    return { b, legs, airline: (b.subtitle || '').split(' · ')[0], fno: legs.map(x => x.l.flight).join(' + '), dep: legs[0]?.from || null, arr: lt || null, ci, todo,
      conns: legs.slice(1).map((x, i) => ({ arr: legs[i].to, dep: x.from, inLeg: legs[i].l, outLeg: x.l })).filter(c => c.arr && c.dep).map(c => ({ ...c, code: c.dep.code, gap: c.dep.abs - c.arr.abs })),
      through: thru ? thru[1] : null, ciOpen: whenOn(ci, y) || whenOn(todo?.title, y), ciClose: +((/closes (\d+) min/.exec(ci) || [])[1] || 0) || null, lounge: /lounge/i.test(b.cabin || '') };
  });
  const stays = C.bookings.filter(b => b.kind === 'hotel' && !['cancelled', 'to-cancel'].includes(b.status)).map(b => {
    const ns = C.days.filter(d => d.hotel === b.id).map(d => d.date).sort(), ss = sentences(b.cancel, b.notes);
    return { b, first: ns[0] || null, last: ns[ns.length - 1] || null, out: ns.length ? isoAdd(ns[ns.length - 1], 1) : null, deposit: ss.find(s => /deposit/i.test(s)) || null, until: ss.find(s => /room is yours until/i.test(s)) || null };
  });
  // the booked rides and how long their driver waits ("waits 45 min after landing", "waits only 10 minutes")
  const rides = C.days.flatMap(d => (d.trips || []).filter(t => t.mode === 'shuttle').map(t => {
    const tr = transferOf(t, d, C), fromAir = /airport/i.test(t.from), ss = tr ? sentences(tr.b.notes) : [];
    // the sentence that gives a waiting time ("the driver waits only 10 minutes"), not where they wait ("They wait on the right with a sign")
    const wss = ss.filter(s => /wait/i.test(s) && (fromAir ? /land/i.test(s) : !/land/i.test(s))), w = wss.find(s => /\d+\s?(?:h\b|hours?|min)/i.test(s)) || wss[0] || '';
    const h = /wait[^.]*?(\d+)\s?h(?:ours?)?\s?(\d+)?/i.exec(w), mm = /wait[^.]*?(\d+)\s?min/i.exec(w);
    const wait = h ? +h[1] * 60 + (+h[2] || 0) : mm ? +mm[1] : null;
    const fl = fromAir ? flights.find(f => f.b.dateIso === d.date && f.arr) || null : null, base = fromAir ? fl?.arr.abs ?? tripMinutes(t) : tripMinutes(t);
    return { d, t, tr, fromAir, wait, waitText: w, base, fl, until: wait != null && base != null ? base + wait : null };
  }));
  const phases = []; for (const d of C.days) { const p = phases.find(x => x.city === d.city); if (p) p.to = d.date; else phases.push({ city: d.city, from: d.date, to: d.date }); }
  const f = { flights, stays, rides, phases, city };
  FACTS.set(C, f);
  return f;
}
const dayDiff = (a, b) => Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 864e5);
// minutes from today's midnight ("01:30 on Sun 11 Oct", asked on Sat 10 Oct → 1530)
const absMin = (iso, min, ctx) => dayDiff(ctx.today, iso) * 1440 + min;
const isoAt = (abs, ctx) => isoAdd(ctx.today, Math.floor(abs / 1440));
const dayRel = (iso, ctx) => iso === ctx.today ? 'today' : iso === isoAdd(ctx.today, 1) ? 'tomorrow' : iso === isoAdd(ctx.today, -1) ? 'yesterday' : `on ${dateLabel(iso)}`;
// "00:55 tonight (in 1 h 25 min)", "14:55 today", "00:55 on Sun 25 Oct"
const atWhen = (abs, ctx) => { const now = ctx.nowMin ?? 0, iso = isoAt(abs, ctx); return abs > now && abs - now < 360 && iso !== ctx.today ? `${hm(abs)} tonight (in ${spanTxt(abs - now)})` : `${hm(abs)} ${dayRel(iso, ctx)}`; };
const durRange = (s) => { const r = [...String(s || '').matchAll(/(\d+)(?:\s*[–-]\s*(\d+))?\s?min/g)].pop(); return r ? [+r[1], +(r[2] || r[1])] : null; };
// the flight a question means: its number, a route ("istanbul dubai"), a day ("tonight", "that flight"), the airline, else the next one
function flightFor(q, date, ctx, prevDate = null) {
  const F = factsFor(ctx.content).flights, qa = withAr(q);
  let c = F.filter(f => f.legs.some(x => x.l.flight && has(qa, [x.l.flight])));
  if (c.length === 1) return c[0];
  c = F.filter(f => { const e = String(f.b.title).split(' → ').map(norm); return e.length === 2 && e.every(x => x && has(qa, [x])); });
  if (c.length === 1) return c[0];
  const air = F.filter(f => f.airline && qa.includes(norm(f.airline))), pool = air.length ? air : F, night = /(tonight|night)/.test(qa);
  const iso = date || (/(that|this|the same) (flight|plane|one)/.test(qa) ? prevDate : null);
  if (iso) { const on = pool.filter(f => f.b.dateIso === iso || (night && f.dep && f.dep.min < 360 && f.b.dateIso === isoAdd(iso, 1))); if (on.length) return on[0]; }
  // during the trip, no flight named: the flight of today (or tonight, after midnight) when the cities the question names are its own
  const t0 = ctx.todayInTrip, cityOf = factsFor(ctx.content).city;
  const ends = (f) => [...String(f.b.title).split(' → '), ...f.legs.flatMap(x => [x.from?.code, x.to?.code].map(c => cityOf[c]))].filter(Boolean).map(norm);
  const named = [...new Set(F.flatMap(ends))].filter(n => has(qa, [n]));
  const tod = t0 && pool.find(f => (f.b.dateIso === t0 || (f.dep && f.dep.min < 360 && f.b.dateIso === isoAdd(t0, 1))) && named.every(n => ends(f).includes(n))
    && (named.length || (f.arr && absMin(f.b.dateIso, f.arr.abs, ctx) > (ctx.nowMin ?? 0))));
  if (tod) return tod;
  const dest = pool.filter(f => { const to = norm(String(f.b.title).split(' → ').pop()); return to && has(qa, [to]); });
  const up = (xs) => xs.find(f => f.dep && absMin(f.b.dateIso, f.dep.abs, ctx) >= (ctx.nowMin ?? 0) - 60) || null;
  return up(dest) || dest[0] || up(pool) || pool[pool.length - 1] || null;
}
const flightBase = (f, ctx, quick, intent = 'flight') => Object.assign(flightAnswer('', ctx, f.b), { quick, intent, date: f.b.dateIso || null, subject: { kind: 'booking', id: f.b.id } });

/* the connection: how long, where to go, and whether the bags must be collected */
const LAYQ = /(^|\s)(stop|stopover|stop over|layover|lay over|transit|connection|connecting|change planes?|changing planes?|between (the )?flights|change flights?)(\s|$)/;
const BAGW = /(^|\s)(bag|bags|baggage|luggage|suitcase|suitcases|شنط|شنطه|حقائب|حقيبه|عفش)(\s|$)/;
const LOSTW = /(lost|missing|didnt|did not|never|delayed|damaged|broken|stolen|not arrive|ضاع|ضاعت|ضايع|تاخر|تاخرت|اتاخرت|ما وصل|ماوصل|مفقود|انكسر|انسرق)/;
function topicFor(q, ctx, day = null) {
  const V = vocabFor(ctx.content), sc = scoreIntents(q, V);
  return (ctx.content.topics || []).filter(tp => sc['topic:' + tp.id] && (!day || !tp.day || tp.day === day)).sort((a, b) => sc['topic:' + b.id] - sc['topic:' + a.id])[0] || null;
}
function layoverAns(a) {
  if (!LAYQ.test(a.q) && !BAGW.test(a.q) && !/(passport control|security check|transfer|gate|where do we go|where to go|what do we do)/.test(a.q)) return null;
  const { q, ctx, date } = a, F = factsFor(ctx.content), now = ctx.nowMin ?? 0;
  const lay = LAYQ.test(q) && !/(stop here|bus stop|tram stop|taxi stop|stop at|stops at)/.test(q);
  const named = (c) => { const n = F.city[c.code]; return (n && has(withAr(q), [norm(n)])) || has(q, [c.code.toLowerCase()]); };
  const bags = BAGW.test(q) && !LOSTW.test(q) && /(collect|pick|take|claim|check|again|through|get|where|or|ولا|او|وين|فين|نستلم|ناخذ|ناخد)/.test(q);
  const pool = F.flights.filter(f => f.conns.length && (date ? f.b.dateIso === date : absMin(f.b.dateIso, f.arr.abs, ctx) >= now - 30)), all = pool.flatMap(f => f.conns.map(c => ({ f, c })));
  // what to do at the connection: passport control, the gate, "where do we go now" while you are there
  const gateQ = /(passport control|security check|transfer desk|domestic transfer|international transfer|transfer point|which gate|what gate|the gate|gate for|where do we go|where to go|what do we do)/.test(q);
  const outNamed = (c) => { const n = F.city[legPt(c.outLeg.to)?.code]; return !!n && has(withAr(q), [norm(n)]); };
  const win = all.find(x => now >= absMin(x.f.b.dateIso, x.c.arr.abs - 60, ctx) && now <= absMin(x.f.b.dateIso, x.c.dep.abs, ctx));
  const hit = all.find(x => named(x.c)) || (gateQ && all.find(x => outNamed(x.c))) || ((lay || (gateQ && /(airport|now|here)/.test(q))) ? win || all[0] : null);
  if (!hit || !(lay || (bags && named(hit.c)) || (gateQ && (named(hit.c) || outNamed(hit.c) || hit === win)))) return null;
  const { f, c } = hit, city = F.city[c.code] || c.code, seats = c.outLeg.seats ? ` (seats ${c.outLeg.seats})` : '';
  const landed = absMin(f.b.dateIso, c.arr.abs, ctx) <= now && now <= absMin(f.b.dateIso, c.dep.abs, ctx);
  const thr = f.through && `your checked bags are tagged through to ${f.through} (one ticket): you collect them in ${f.through}, not ${city}`;
  const dur = `${spanTxt(c.gap)} in ${city}: ${c.inLeg.flight} lands ${c.arr.code} ${c.arr.at} and ${c.outLeg.flight} leaves ${c.dep.at}.`;
  const howLong = /(how long|how much time|how many hours)/.test(q);
  const quick = bags && !howLong
    ? (thr ? (landed ? `No, ${thr}. Go to transfers for ${c.outLeg.flight} at ${c.dep.at}${seats}.` : `No — ${thr}. In ${city} you only change planes (land ${c.arr.at}, ${c.outLeg.flight} leaves ${c.dep.at}).`)
      : `The app does not say whether your bags go through to the end: ask at the ${f.airline || 'airline'} desk when you check in.`)
    : gateQ && !howLong ? null
    : howLong || !topicFor(q, ctx) ? `${dur}${thr ? ` ${cap(thr)}.` : ''}${landed ? ` Go to transfers for ${c.outLeg.flight}${seats}.` : ''}`
    : a.fr?.yesno ? `Yes — ${dur}` : null;
  // the trip's own page about this connection (the steps), else the flight booking
  const tp = topicFor(q, ctx, f.b.dateIso) || (ctx.content.topics || []).find(t => t.day === f.b.dateIso && (t.keywords || []).some(k => /(layover|connection|transit)/.test(k)));
  // a yes/no about one step ("do we go through passport control?"): the step that says it
  const step = !quick && gateQ && a.fr?.yesno && tp && topicLine(tp, q);
  if (tp) return Object.assign(topicAnswer(tp, ctx), { quick: quick || (step ? `Yes — ${lcFirst(step)}` : null), noQuick: !quick && !step, intent: 'topic:' + tp.id, date: f.b.dateIso, subject: { kind: 'topic', id: tp.id } });
  return flightBase(f, ctx, quick || dur);
}
// the sentence of a topic page that shares most words with the question
function topicLine(tp, q) {
  const ws = q.split(' ').filter(w => w.length >= 4 && !STOP.has(w) && !GENERIC.has(w)), pool = (tp.intro || []).filter(b => !b.muted).flatMap(b => [...(b.items || []), b.text]).filter(Boolean).flatMap(x => sentences(x));
  let best = null, bs = 0; for (const x of pool) { const n = norm(x), sc = ws.filter(w => n.includes(w)).length; if (sc > bs) { best = x; bs = sc; } }
  return bs >= 1 ? best : null;
}

/* "what time does TK2410 leave istanbul", "when does fz756 land": the named leg's own time (not the first departure) */
function legTimeAns(a) {
  const { q, ctx } = a;
  if (!/(what time|when|time|متي)/.test(q) || !/(leave|leaves|leaving|depart|departs|departure|take off|takes off|fly|land|lands|landing|arrive|arrives|arrival)/.test(q)
    || /(check ?in|checkin|lounge|bag|bags|seat|seats|late|miss|missed|delay|delayed|make it|catch)/.test(q)) return null;
  const F = factsFor(ctx.content);
  for (const f of F.flights) for (let i = 0; i < f.legs.length; i++) {
    const x = f.legs[i]; if (!x.l.flight || !has(q, [x.l.flight])) continue;
    const landQ = /(land|lands|landing|arrive|arrives|arrival)/.test(q) && !/(leave|leaves|leaving|depart|take off|takes off)/.test(q), p = landQ ? x.to : x.from;
    if (!p) return null;
    const iso = isoAt(absMin(f.b.dateIso, p.abs, ctx), ctx), prev = f.legs[i - 1], next = f.legs[i + 1];
    const link = !landQ && prev?.to ? ` — the connection after ${prev.l.flight} lands ${prev.to.code} ${prev.to.at} (${spanTxt(x.from.abs - prev.to.abs)} between them)`
      : landQ && next?.from ? `; then ${next.l.flight} leaves ${next.from.code} ${next.from.at}` : '';
    return flightBase(f, ctx, `${x.l.flight} ${landQ ? 'lands in' : 'leaves'} ${F.city[p.code] || p.code} (${p.code}${p.term ? ' ' + p.term : ''}) at ${p.at} ${iso === ctx.today || iso === isoAdd(ctx.today, 1) ? relDay(iso, ctx) : 'on ' + dateLabel(iso)}${link}.`);
  }
  return null;
}

/* "when do we arrive in antalya", "متى نوصل انطاليا": the first leg that lands in that city */
function arriveAns(a) {
  const { q, ctx } = a, qa = withAr(q);
  if (!/(^|\s)(arrive|arriving|arrival|land|landing|lands|get to|reach)(\s|$)/.test(qa) || !/(when|what time|time|متي)/.test(qa) || /(hotel|resort|restaurant|pier|museum|mosque|palace)/.test(qa)) return null;
  const F = factsFor(ctx.content), code = Object.keys(F.city).find(c => F.city[c] && has(qa, [norm(F.city[c])])); if (!code) return null;
  const y = F.flights.flatMap(f => f.legs.map((x, i) => ({ f, x, i }))).filter(z => z.x.to?.code === code).map(z => ({ ...z, abs: absMin(z.f.b.dateIso, z.x.to.abs, ctx) })).find(z => z.abs >= (ctx.nowMin ?? 0) - 60);
  if (!y) return null;
  const legs = y.f.legs, nx = legs[y.i + 1], route = legs.length > 1 ? legs.map(z => `${z.l.from} → ${z.l.to}`).join(', change, ') : `${y.x.l.from} → ${y.x.l.to}`;
  const quick = `${dateLabel(isoAt(y.abs, ctx))} at ${y.x.to.at} in ${F.city[code]} on ${y.x.l.flight}${nx ? ` (${y.x.l.from} → ${y.x.l.to}); you change there for ${nx.l.flight} at ${nx.from?.at}` : ` (${route})`}.`;
  return flightBase(y.f, ctx, quick);
}

/* online check-in: open yet? until when? (from the booking notes and the linked to-do) */
const CHECKQ = /(^|\s)(check ?in|checkin|check-in)(\s|$)/;
function checkinAns(a) {
  const { q, ctx, date } = a, C = ctx.content;
  if (!CHECKQ.test(q) || /(hotel|room|resort|reception|front desk|فندق)/.test(q) || C.bookings.some(b => b.kind === 'hotel' && has(q, b.keywords || []))) return null;
  const F = factsFor(C);
  const pb = ctx.prev?.subject?.kind === 'booking' && C.bookings.find(b => b.id === ctx.prev.subject.id && b.kind === 'flight');
  if (!/(flight|fly|flying|plane|airline|airlines|online|web|boarding|طيران|طياره)/.test(q) && !F.flights.some(f => (f.airline && q.includes(norm(f.airline))) || f.legs.some(x => has(q, [x.l.flight]))) && !pb) return null;
  if (!/(now|already|yet|can|could|is it open|open|opens|opened|close|closes|closing|closed|until|till|deadline|last|when|what time|time|how long|still)/.test(q)) return null;
  const f = (pb && !/(flight|airline|flydubai|turkish)/.test(q) ? F.flights.find(x => x.b === pb) : null) || flightFor(q, date, ctx, ctx.prev?.date);
  return f ? checkinAnswer(f, q, ctx) : null;
}
function checkinAnswer(f, q, ctx) {
  const F = factsFor(ctx.content), now = ctx.nowMin ?? 0, depAbs = absMin(f.b.dateIso, f.dep.abs, ctx), city = F.city[f.dep.code] || f.dep.code;
  const open = f.ciOpen ? absMin(f.ciOpen.iso, f.ciOpen.min, ctx) : null, close = f.ciClose ? depAbs - f.ciClose : null;
  const via = String(f.b.via || '').replace(/ · /g, ' → ');
  const ride = F.rides.filter(x => !x.fromAir && /airport/i.test(x.t.to) && tripMinutes(x.t) != null).map(x => ({ x, abs: absMin(x.d.date, tripMinutes(x.t), ctx) })).filter(y => y.abs < depAbs && depAbs - y.abs < 720).pop();
  const opened = (abs) => now - abs < 720 ? `${hm(abs)} ${dayRel(isoAt(abs, ctx), ctx)}` : `${hm(abs)} on ${dateLabel(isoAt(abs, ctx))}`;
  const closeQ = /(close|closes|closing|closed|until|till|deadline|last|how long|still)/.test(q), bare = /^(until|till|by) (what|which) time|^(what time|when) exactly/.test(q);
  let quick;
  if (close != null && now > close) quick = `No: online check-in for ${f.fno} closed at ${atWhen(close, ctx)} (${f.ciClose} min before the ${f.dep.at} departure). Check in at the airport desk.`;
  else if (closeQ && close != null) {
    const tail = `${f.ciClose} min before the ${f.dep.at} departure${ride && ride.abs < close && ride.abs > now ? ` (in practice, finish it before the ${ride.x.t.time} pickup ${dayRel(ride.x.d.date, ctx)})` : ''}`;
    quick = bare ? `${atWhen(close, ctx)} — ${tail}.` : `Online check-in for ${f.fno} closes at ${atWhen(close, ctx)} — ${tail}.`;
  } else if (closeQ) {
    const dr = ride && durRange(ride.x.t.dur), at = ride && dr ? ride.abs + dr[0] : null;
    quick = `${f.fno} leaves ${city} at ${f.dep.at} ${dayRel(isoAt(depAbs, ctx), ctx)}${open != null ? `, and online check-in ${open <= now ? `has been open since ${opened(open)}` : `opens at ${atWhen(open, ctx)}`}` : ''}. The app has no closing time for it`
      + `${at != null ? `; your ${ride.x.t.time} pickup gets you to the airport around ${hm(at)}, about ${spanTxt(depAbs - at)} before` : ''}.`;
  } else if (open != null && now < open) quick = `Not yet: online check-in for ${f.fno} opens at ${atWhen(open, ctx)} (in ${spanTxt(open - now)}).`;
  else {
    const hb = (/opens (\d+) h before/.exec(f.ci) || [])[1], pick = ride && (close == null || ride.abs < close) ? `; do it before the ${ride.x.t.time} pickup ${dayRel(ride.x.d.date, ctx)}` : '';
    quick = `Yes, online check-in for ${f.fno} is open${open != null ? `: it opened at ${opened(open)}${hb ? ` (${hb} h before)` : ''}` : ''}${close != null ? ` and closes ${f.ciClose} min before departure, at ${atWhen(close, ctx)}` : ''}${pick}.${via ? ` Do it at ${via}.` : ''}`;
  }
  return flightBase(f, ctx, quick);
}
function loungeAns(a) {
  // "zebra lounge phone number" is a venue: a flight lounge needs a flight word or a flight in the conversation
  if (!/(^|\s)(lounge|lounges)(\s|$)/.test(a.q) || a.venue || !(/(access|airport|flight|plane|fly|business|class|cabin|tk\d|fz\d)/.test(a.q) || a.ctx.prev?.subject?.kind === 'booking')) return null;
  const f = flightFor(a.q, a.date, a.ctx, a.ctx.prev?.date); if (!f) return null;
  const rel = dayRel(f.b.dateIso, a.ctx), whose = rel === 'today' || rel === 'tomorrow' ? `${rel}'s` : 'the';
  return flightBase(f, a.ctx, `${f.lounge ? 'Yes' : 'No lounge access is listed'}: ${whose} ${f.fno} (${f.dep.code} ${f.dep.at} → ${f.arr.code} ${f.arr.at}) is ${f.b.cabin || 'not listed'}.`);
}

/* a booking: is it paid? can we change it? */
const PAIDQ = /(already pa(y|id)|did we pay|have we paid|is (it|that|this|everything|the \w+) (already )?paid|paid already|(is|was) .{0,30} paid|do we (have to |need to |still )?pay (there|at the|at check|on arrival|anything)|pay there|prepaid|pre paid|دفعنا|مدفوع|ندفع هناك)/;
const CHANGEQ = /(change|changing|modify|move the dates|reschedule|refund|refundable|money back|cancel it|if we cancel|can we cancel|استرداد|نغير|تغيير|نلغي)/;
function bookingIn(q, date, ctx) {
  const C = ctx.content, kind = /(flight|plane|airline|طيران)/.test(q) ? 'flight' : /(transfer|shuttle|pickup|van)/.test(q) ? 'transfer'
    : /(hotel|room|resort|stay|booking|reservation|dates|فندق)/.test(q) || C.bookings.some(b => b.kind === 'hotel' && has(q, b.keywords || [])) ? 'hotel' : null;
  if (!kind) return null;
  if (kind === 'flight') return flightFor(q, date, ctx)?.b || null;
  // a booking named by its own words wins even when it is cancelled ("did the swissotel refund come back")
  const named = C.bookings.filter(b => b.kind === kind && has(q, b.keywords || [])), bs = C.bookings.filter(b => b.kind === kind && !['cancelled', 'to-cancel'].includes(b.status));
  return (named.length === 1 ? named[0] : null) || bestByAlias(q, bs) || (kind === 'hotel' ? hotelForDate(date || ctx.todayInTrip || ctx.today, ctx) : bs[0]) || null;
}
const bookingBase = (b, ctx, quick, q = '') => {
  const r = b.kind === 'hotel' ? hotelAnswer(norm(b.short || b.title), null, ctx) : b.kind === 'flight' ? flightAnswer('', ctx, b) : shuttleAnswer(ctx, q);
  return Object.assign(r, { quick, intent: b.kind === 'transfer' ? 'shuttle' : b.kind, subject: { kind: 'booking', id: b.id }, date: b.dateIso || null });
};
function paidLine(b, ctx) {
  const st = factsFor(ctx.content).stays.find(s => s.b === b), pr = String(b.price || ''), amt = pr.split(' · ')[0], when = (/paid (\d{1,2} [A-Z][a-z]{2})/.exec(pr) || [])[1];
  if (b.status === 'cancelled') return `${b.title} is cancelled${b.cancel ? `: ${lcFirst(b.cancel)}` : '.'}`;
  if (b.status !== 'paid' && !/paid/i.test(pr)) return `${b.title} is not marked as paid${pr ? ` (${pr})` : ''}: check the booking${b.via ? ` on ${b.via}` : ''}.`;
  const where = { hotel: 'at the hotel', transfer: 'to the driver', flight: 'at the airport' }[b.kind] || 'there';
  const inc = b.kind === 'hotel' && /included/i.test(b.board || '') ? ` (${lcFirst(String(b.board).split(' (')[0])})` : '';
  return `Yes, ${b.title} is paid: ${amt}${when ? ` on ${when}` : ''}${b.via ? ` via ${b.via}` : ''}${/non-refundable/i.test(pr) ? ' (non-refundable)' : ''}.${st?.deposit ? ` Only the deposit is left: ${lcFirst(st.deposit)}` : ` Nothing to pay ${where}${inc}.`}`;
}
// "how much did we pay for the flights / hotels": the paid bookings of that kind, from the money sheet
function paidKindAns(a) {
  const { q, ctx } = a, M = ctx.content.money;
  if (!M?.settled?.length || !/(how much|total|sum|كم)/.test(q) || !/(paid|pay|spent|cost|دفعنا)/.test(q)) return null;
  const kind = /(flight|flights|plane|tickets|airline|طيران)/.test(q) ? 'flight' : /(hotel|hotels|rooms?|stay|فندق|فنادق)/.test(q) ? 'hotel' : /(transfer|transfers|shuttle|shuttles|pickup)/.test(q) ? 'transfer' : null;
  if (!kind) return null;
  const hs = ctx.content.bookings.filter(b => b.kind === 'hotel').map(b => norm(b.short || b.title).split(' ')[0]);
  const kindOf = (l) => / → /.test(l) ? 'flight' : /(shuttle|transfer)/i.test(l) ? 'transfer' : hs.some(h => norm(l).includes(h)) ? 'hotel' : 'other';
  const xs = M.settled.filter(x => kindOf(x.label) === kind && x.aed), tot = xs.reduce((t, x) => t + x.aed, 0);
  if (!xs.length) return null;
  const word = { flight: 'Flights', hotel: 'Hotels', transfer: 'Airport transfers' }[kind];
  const quick = `${word}: about AED ${fmt(tot)} paid before the trip (${xs.map(x => `${x.label.split(' · ')[0]} AED ${fmt(x.aed)}`).join('; ')}).`;
  return Object.assign(budgetAnswer(ctx, q), { quick, intent: 'money', date: null, subject: null });
}
function paidAns(a) {
  if (!PAIDQ.test(a.q) || /(insurance|insured|تامين)/.test(a.q)) return null;
  const b = bookingIn(a.q, a.date, a.ctx); return b ? bookingBase(b, a.ctx, paidLine(b, a.ctx), a.q) : null;
}
function policyAns(a) {
  const { q, ctx } = a;
  if (!CHANGEQ.test(q) || /(keep the change|exchange|change money|small change|insurance)/.test(q)) return null;
  const b = bookingIn(q, a.date, ctx); if (!b) return null;
  // a cancelled booking: the refund it expects and the to-do that checks it (the app cannot see the card)
  if (b.status === 'cancelled') {
    const key = norm(b.short || b.title).split(' ')[0], rt = ctx.content.todos.find(t => /refund/i.test(t.title) && (norm(t.title).includes(key) || has(norm(t.title), b.keywords || [])));
    const st = rt && tState(rt, ctx);
    const lead = /^cancel/i.test(b.cancel || '') ? `${b.title} was ${lcFirst(b.cancel)}` : `${b.title} is cancelled.${b.cancel ? ' ' + b.cancel : ''}`;
    const quick = `${lead} The app cannot see your card, so check it yourself${rt?.note ? ` (${lcFirst(rt.note).replace(/\.$/, '')})` : ''}${rt ? `: the to-do “${rt.title}” is ${st === 'done' ? 'ticked as done ✓' : tNote(rt, ctx, st)}` : ''}.`;
    return bookingBase(b, ctx, quick, q);
  }
  const y = (ctx.content.meta?.tripStart || '2026').slice(0, 4), s = sentences(b.cancel, b.notes).find(x => /(refund|cancel|change fee|no-show)/i.test(x));
  const st = factsFor(ctx.content).stays.find(x => x.b === b), when = st?.first ? `${+st.first.slice(8)}–${+st.out.slice(8)} ${MON[+st.out.slice(5, 7) - 1]}` : b.dates || '';
  const paid = String(b.price || '').split(' (')[0].replace(' · ', ', ');
  let yes = !/(non-refundable|no refund|not refundable)/i.test(s || '') || /free cancellation/i.test(s || '');
  const dl = s && /free cancellation until/i.test(s) && whenOn(s, y); if (dl && absMin(dl.iso, dl.min, ctx) < (ctx.nowMin ?? 0)) yes = false;
  // tiered fare rules ("full refund more than 12 h before …; TRY 3,500 deducted from 12 h to 1 h before"): judge by the time left
  let lead = null;
  const full = /full refund more than (\d+) h before/i.exec(s || ''), depT = b.kind === 'flight' ? /\d{1,2}:\d{2}/.exec(b.legs?.[0]?.from || '')?.[0] : null;
  if (full && depT && b.dateIso) {
    const left = absMin(b.dateIso, toMin(depT), ctx) - (ctx.nowMin ?? 0), cut = /from \d+ h to (\d+) h before/i.exec(s);
    yes = left > +full[1] * 60;
    lead = yes ? 'Yes, a full refund now' : left > (cut ? +cut[1] : 1) * 60 ? 'Partly: a refund minus the fee' : 'No';
  }
  const quick = s ? `${lead || (yes ? 'Yes' : 'No')} — the ${b.title} booking (${[when, paid].filter(Boolean).join(', ')}): ${lcFirst(s)}${dl && !yes ? ' That window has passed.' : ''}` : `The app has no change or refund rule for ${b.title}: ask ${b.via || 'the provider'}.`;
  return bookingBase(b, ctx, quick, q);
}

/* "reception wants 100 euro cash, is that normal?", "the bill is 2450 lira, is that normal?" */
const NORMQ = /(normal|usual|ok|okay|fair|reasonable|right|correct|too much|too expensive|expensive|rip ?off|ripoff|overcharg\w*|legit|is that|is this|should we pay|طبيعي|معقول|كثير|غالي)/;
const USD_AED = 3.6725;
function sanityAns(a) {
  const { q, ctx, conv, venue } = a, C = ctx.content;
  if (!conv || conv.to || !NORMQ.test(q)) return null;
  const rate = +ctx.rate || 13.34, eur = C.money.rates.tryPerEur, tl = conv.from === 'TRY' ? conv.amount : conv.from === 'AED' ? conv.amount * rate : conv.from === 'EUR' ? conv.amount * eur : conv.amount * USD_AED * rate;
  if (TAXIQ.test(q)) {   // "the taxi wants 900 lira to the hotel": the meter estimate for that ride
    const iso = a.date || ctx.todayInTrip, G = geoFor(C), m = distanceMatch(q, iso, ctx) || (/(hotel|home|resort|فندق)/.test(q) && (() => { const l = G.legs.filter(x => x.d.date === iso && x.t.mode === 'taxi_home').pop(); return l ? { from: l.a, to: l.b } : null; })());
    const meter = m && meterFor(m.from.city || m.to.city, ctx); if (!meter) return null;
    const km = kmBetween(m.from, m.to), fare = Math.max(meter.min, meter.open + meter.km * km * 1.35), r10 = (n) => Math.round(n / 10) * 10, lo = r10(fare * 0.9), hi = r10(fare * 1.15);
    const leg = G.legs.find(l => l.a.n === m.from.n && l.b.n === m.to.n), rule = sentences(C.transport.taxi).filter(x => /(night tariff|surcharge|taksimetre)/i.test(x)).slice(0, 2).join(' ');
    const v = tl <= hi * 1.15 ? 'Yes, that is about right' : tl <= hi * 1.5 ? 'That is a bit high' : 'No, that is too much';
    return Object.assign(transportAnswer('taxi', null, ctx), { quick: `${v}: the meter for ${m.from.name} → ${m.to.name} (≈ ${fmtKm(km * 1.35)} by road) is about ₺${fmt(lo)}–${fmt(hi)}${leg?.t.dur ? `, ${leg.t.dur}` : ''}.${v.startsWith('Yes') ? '' : ` ${rule}`}`, intent: 'transport', date: iso || null, subject: null });
  }
  const F = factsFor(C), hb = hotelForDate(ctx.todayInTrip || ctx.today, ctx);
  if (/(reception|hotel|deposit|front desk|check in|checkin|room|فندق)/.test(q) || (!venue && /(cash)/.test(q))) {
    const s = F.stays.find(x => x.b === hb && x.deposit) || F.stays.find(x => x.deposit);
    if (s) {
      const m = /(€|EUR|₺|AED)\s?([\d,]+)/.exec(s.deposit), same = m && +m[2].replace(/,/g, '') === conv.amount && ({ '€': 'EUR', EUR: 'EUR', '₺': 'TRY', AED: 'AED' })[m[1]] === conv.from;
      return bookingBase(s.b, ctx, `${same ? 'Yes, that is normal' : 'That is not what the booking says'}: your ${s.b.short || s.b.title} booking says to ${lcFirst(s.deposit)}`);
    }
  }
  const kinds = /(shisha|hookah|nargile|شيشه)/.test(q) ? ['shisha'] : /(coffee|tea|قهوه)/.test(q) ? ['coffee'] : /(dinner|lunch|meal|food|restaurant)/.test(q) ? ['meal', 'breakfast'] : null;
  const pick = venue || (/(bill|meal|dinner|lunch|food|restaurant|check|shisha|coffee)/.test(q) ? venueNow(ctx, kinds) : null);
  if (!pick || pick.costLow == null) return null;
  const lo = pick.costLow, hi = pick.costHigh || lo, rng = `₺${fmt(lo)}${hi !== lo ? '–' + fmt(hi) : ''}`, amt = `₺${fmt(tl)}`;
  const rule = C.tips.sections.flatMap(s => s.items).find(x => /service charges?/i.test(x) && /(illegal|banned)/i.test(x));
  const tail = rule ? ` Just check there is no service-charge line: ${lcFirst(String(rule).split(/(?<=\.)\s+/)[0])}` : '';
  const quick = tl <= hi * 1.05 ? `Yes — ${amt} is ${tl >= lo * 0.95 ? 'inside' : 'below'} the ${rng} plan for the ${pick.name} ${(KIND[pick.kind] || pick.kind).toLowerCase()} for two (≈ AED ${fmt(tl / rate)}).${tail}`
    : `That is above the ${rng} plan for ${pick.name} by about ₺${fmt(tl - hi)}: ask for the itemised bill and check every line.${tail}`;
  return Object.assign(venueAnswer(pick, ctx, ''), { quick, intent: 'venue', date: pick.day, subject: { kind: 'venue', id: pick.id } });
}
// the place of the plan you are at now (or the next one today)
function venueNow(ctx, kinds = null) {
  const iso = ctx.todayInTrip; if (!iso) return null;
  const vs = ctx.content.venues.filter(v => v.day === iso && v.status !== 'option' && (!kinds || kinds.includes(v.kind))), now = ctx.nowMin ?? 0;
  const t = (v) => toMin(venueVisit(v, ctx).at) ?? 1e9;
  return vs.filter(v => t(v) <= now + 30).pop() || vs[0] || null;
}

/* the booked driver: is he still waiting? */
const WAITQ = /(still (be )?waiting|still wait|still there|(will|would|does|do) (he|they|the driver|the van|it) (still )?wait|wait for us|how long (will|does|do|would) (he|they|the driver|the van) wait|waiting for us|did (he|they|the driver) leave)/;
function waitAns(a) {
  const { q, ctx } = a; if (!WAITQ.test(q) || !/(driver|transfer|shuttle|pickup|van|he|they|سواق|سائق)/.test(q)) return null;
  const F = factsFor(ctx.content), now = ctx.nowMin ?? 0, rs = F.rides.filter(x => x.wait != null && x.until != null);
  const x = rs.filter(y => y.d.date === ctx.today).find(y => y.until >= now - 120 && y.base <= now + 120) || rs.find(y => y.d.date >= ctx.today);
  if (!x) return null;
  const who = x.tr?.who || 'transfer', ph = x.tr?.b.phone, still = absMin(x.d.date, x.until, ctx) > now;
  const fl = x.fl && /track/i.test(x.waitText) ? `tracks ${x.fl.legs[x.fl.legs.length - 1].l.flight} and ` : '';
  const what = x.fromAir ? `the ${who} driver ${fl}waits ${spanTxt(x.wait)} after landing (${hm(x.base)})` : `the ${who} driver waits only ${spanTxt(x.wait)} after the ${hm(x.base)} pickup`;
  const why = /(bag|bags|suitcase|luggage|belt|baggage|شنط)/.test(`${norm(ctx.prev?.q || '')} ${q}`) ? ' to say you are at the baggage desk' : ' to say where you are';
  const tail = `so until about ${hm(x.until)}${still && x.d.date === ctx.today ? ` (${spanTxt(x.until - now)} from now)` : ''}${ph ? `; call ${ph}${why}` : ''}.`;
  // a pickup at the hotel: the ready time it asks for, and what a missed pickup costs
  const ready = !x.fromAir && (/be ready at (\d{1,2}:\d{2})/.exec(`${x.t.dur || ''} ${x.waitText}`) || [])[1], rm = ready && absMin(x.d.date, toMin(ready), ctx);
  const noShow = !x.fromAir && x.tr && sentences(x.tr.b.cancel, x.tr.b.notes).find(s => /(no-show|missed pickup)/i.test(s));
  const extra = `${ready ? ` Be ready at ${ready}${rm <= now && still ? ` (that was ${spanTxt(now - rm)} ago: go down now)` : ''}.` : ''}${noShow && /(late|miss|اتاخر)/.test(q) ? ' ' + noShow : ''}`;
  const quick = (/how long/.test(q) ? `${cap(what.replace(/^the /, 'The '))}, ${tail}` : `${still ? 'Yes, for now' : 'Probably not any more'} — ${what}, ${tail}`) + extra;
  return Object.assign(shuttleAnswer(ctx, q), { quick, intent: 'shuttle', date: x.d.date, subject: x.tr ? { kind: 'booking', id: x.tr.b.id } : null });
}

/* "how long till our flight", "pickup in how long", "how long until sunset": minutes from now to the next such thing */
const UNTILQ = /(how long (till|until|to go|before|left)|in how long|how much time (till|until|before|left|do we have)|how many (hours|minutes|mins) (till|until|before|to|left)|time (left )?(till|until|before) |كم باقي (علي|ل)|باقي كم (علي|ل)|بعد قديش|بعد كم)/;
function untilAns(a) {
  const { q, ctx } = a; if (!UNTILQ.test(q)) return null;
  const C = ctx.content, F = factsFor(C), now = ctx.nowMin ?? 0, iso = ctx.todayInTrip, d = dayAt(ctx, iso);
  let abs = null, line = '', base = null, about = false;
  if (/(flight|plane|fly|flying|take ?off|departure|طياره|طيران)/.test(q)) {
    const f = flightFor(q, null, ctx); if (!f) return null;
    abs = absMin(f.b.dateIso, f.dep.abs, ctx); about = true; base = flightBase(f, ctx, '', 'countdown');
    line = `${f.legs[0].l.flight} leaves ${F.city[f.dep.code] || f.dep.code} at ${f.dep.at} (${dateLabel(isoAt(abs, ctx))}).`;
  } else if (/(pickup|pick up|van|transfer|shuttle|driver|car|ride)/.test(q)) {
    const x = F.rides.map(y => ({ y, abs: tripMinutes(y.t) != null ? absMin(y.d.date, tripMinutes(y.t), ctx) : null })).find(z => z.abs != null && z.abs >= now - 5); if (!x) return null;
    abs = x.abs; const ready = (/be ready at (\d{1,2}:\d{2})/.exec(x.y.t.dur || '') || [])[1], who = x.y.tr?.who || 'transfer';
    line = ready ? `The van comes at ${x.y.t.time}; be ready at ${ready}, ${spanTxt(absMin(x.y.d.date, toMin(ready), ctx) - now)} from now.` : `The ${who} pickup is at ${x.y.t.time} ${dayRel(x.y.d.date, ctx)} (${plainLabel(x.y.t.label)}).`;
    base = Object.assign(shuttleAnswer(ctx, q), { subject: x.y.tr ? { kind: 'booking', id: x.y.tr.b.id } : null, date: x.y.d.date });
  } else if (/(sunset|غروب)/.test(q) && d) { abs = toMin(d.sunset); line = `Sunset today is at ${d.sunset}.`; base = dayAnswer(d, ctx); }
  else if (/(ferry|boat|vapur|عباره|مركب)/.test(q) && d) {
    const t = (d.trips || []).find(x => x.mode === 'ferry' && (tripMinutes(x) ?? -1) >= now - 5); if (!t) return null;
    abs = tripMinutes(t); line = `The ${t.time} boat leaves ${t.from} (${plainLabel(t.label)}).`; base = dayAnswer(d, ctx);
  } else if (/(taxi|cab|tram|walk)/.test(q) && d) {
    const re = /tram/.test(q) ? /tram/ : /walk/.test(q) ? /walk/ : /taxi/, x = tripClock(d, ctx).find(y => re.test(y.t.mode) && y.min >= now - 5); if (!x) return null;
    abs = x.min; line = `The ${x.est ? 'next' : x.t.time} ${legKind(x.t)} goes to ${plainLabel(x.t.to)}${x.est ? ` (no fixed time: about ${hm(x.min)})` : ''}.`; base = dayAnswer(d, ctx);
  } else if (/(dinner|lunch|meal|shisha|coffee|breakfast)/.test(q) && d) {
    const v = venueNow(ctx, /shisha/.test(q) ? ['shisha'] : /coffee/.test(q) ? ['coffee'] : ['meal', 'breakfast']), at = v && toMin(venueVisit(v, ctx).at);
    if (at == null) return null;
    abs = at; line = `${v.name} at ${venueVisit(v, ctx).at}.`; base = venueAnswer(v, ctx);
  } else return null;
  const left = abs - now;
  const quick = left <= 0 ? `It is time now (${hm(abs)}). ${line}` : `${about ? `About ${spanTxt(Math.round(left / 5) * 5)}` : `In ${spanTxt(left)}`}. ${line}`;
  return Object.assign(base, { quick, intent: 'countdown', date: base.date ?? iso ?? null, subject: base.subject ?? null });
}

/* a leg of the day: missed it, late for it, is it the last one? (ferry timetables, the reach leg, a taxi backup) */
const MISSQ = /(^|\s)(miss|missed|if we miss|didnt make|did not make|too late for|lost the (boat|ferry))(\s|$)/;
const LATEQ = /(can we (still )?(make|catch)|will we (make|catch)|(are|r) we (going to|gonna) (make|catch)|make it (to|for)|are we late|were late|we are late|running late|(in|on) time for)/;
const LASTOUTQ = /(is (it|this|that)( one| boat| ferry)? the last|is the \d{1,2}:\d{2} (boat |ferry )?the last|last one|any later|later (boat|ferry|one))/;
const ferryOf = (t, d, ctx) => ctx.content.transport.ferries.find(y => y.used === usedTag(d.date) && norm(`${y.from_} ${(y.times || []).join(' ')}`).includes(norm(t.from).split(' ')[0])) || null;
const deps = (f) => (f?.times || []).map(s => { const ts = [...s.matchAll(/(\d{1,2}:\d{2})/g)].map(m => toMin(m[1])); return ts.length ? { dep: ts[0], arr: ts.length > 1 ? ts[ts.length - 1] : null } : null; }).filter(Boolean);
function pickLeg(q, d, ctx, clock = null) {
  const re = /(ferry|boat|vapur|عباره|مركب)/.test(q) ? /ferry/ : /(pickup|pick up|van|transfer|shuttle)/.test(q) ? /shuttle/ : /(flight|plane)/.test(q) ? /flight/ : /(taxi|cab)/.test(q) ? /taxi/ : null;
  let c = (d.trips || []).filter(t => (re ? re.test(t.mode) : ['ferry', 'shuttle', 'flight'].includes(t.mode)) && tripMinutes(t) != null);
  if (clock) { const k = c.filter(t => Math.abs(tripMinutes(t) - clock.min) <= 5); if (k.length) c = k; }
  const ws = q.split(' ').filter(w => w.length >= 4 && !STOP.has(w)), pw = c.filter(t => ws.some(w => norm(`${t.to} ${t.from}`).includes(w)));
  if (pw.length) c = pw;
  const now = ctx.nowMin ?? 0;
  return c.find(t => tripMinutes(t) >= now - 60) || c[c.length - 1] || null;
}
function taxiEst(a, b, d, ctx) {
  const G = geoFor(ctx.content), p = G.pts.find(e => e.n === norm(a)), r = G.pts.find(e => e.n === norm(b));
  if (!p || !r) return '';
  const km = kmBetween(p, r), m = taxiMins(km), meter = meterFor(d.city, ctx), fare = meter ? Math.max(meter.min, meter.open + meter.km * km * 1.35) : null;
  return `about ${m[0]}–${m[1]} min${fare ? `, ≈ ₺${fmt(Math.round(fare / 10) * 10)}` : ''}`;
}
function legPlan(t, d, ctx, { miss = false, late = false, last = false } = {}) {
  const now = ctx.nowMin ?? 0, ts = d.trips || [], i = ts.indexOf(t), dep = tripMinutes(t), f = t.mode === 'ferry' ? ferryOf(t, d, ctx) : null;
  const ds = deps(f), later = ds.filter(x => x.dep > dep + 1), nxt = later.find(x => x.dep >= now) || null, gone = ds.filter(x => x.dep < dep && x.dep < now);
  const to = f ? f.to : plainLabel(t.to), direct = /direct/i.test(f?.note || '') ? ' direct' : '';
  const line = (x) => `${hm(x.dep)} → ${to}${x.arr != null ? ` ${hm(x.arr)}` : ''}`;
  // no later boat: a taxi to where the boat was taking you (or the first stop after its pier), then the plan as it was
  const a1 = ts[i + 1], skip = a1 && a1.mode === 'walk' && norm(a1.from) === norm(t.to) ? a1 : null, target = skip ? skip.to : t.to, then = skip && ts[i + 2]?.mode === 'walk' ? ts[i + 2] : null;
  const taxi = `Take a taxi from ${t.from} to ${target}${(() => { const e = taxiEst(t.from, target, d, ctx); return e ? ` (${e})` : ''; })()}${then ? `, then walk ${(/(\d+)\s?min/.exec(then.dur || '') || [])[1] || 'a few'} min to ${then.to} as planned` : ''}.`;
  let quick;
  if (t.mode === 'shuttle') {
    const tr = transferOf(t, d, ctx.content), b = tr?.b, ns = b && sentences(b.cancel, b.notes).find(s => /(no-show|missed)/i.test(s));
    quick = `Call ${tr?.who || 'the transfer company'} now${b?.phone ? ` on ${b.phone}` : ''}${b?.whatsapp ? ` (WhatsApp ${b.whatsapp})` : ''}.${ns ? ` ${ns}` : ''} If the van cannot come, take a taxi (BiTaksi) to ${t.to}.`;
  } else if (late) {
    const pre = ts[i - 1], rr = pre && norm(pre.to) === norm(t.from) ? durRange(pre.dur) : null, [r0, r1] = rr || [10, 15], slack = dep - now;
    const v = slack < 0 ? 'No' : slack < r0 + 2 ? 'Probably not' : slack < r1 + 5 ? 'Only just, if you leave now' : 'Yes';
    const how = pre && rr ? `the ${legKind(pre)} to ${pre.to} takes ${r0 === r1 ? r0 : `${r0}–${r1}`} min and ` : '';
    quick = `${v}. It is ${hm(now)}, ${how}the ${t.mode === 'ferry' ? 'boat' : legKind(t)} leaves at ${hm(dep)}${v === 'Yes' ? `: leave by ${hm(dep - r1 - 5)}` : ''}.`
      + (/^(No|Probably)/.test(v) ? (nxt ? ` The next${direct} boat is ${line(nxt)} (or take a taxi straight to ${to}).` : ` No later boat is listed. ${taxi}`) : '');
  } else if (miss) {
    quick = nxt ? `Next boat: ${line(nxt)}${direct ? ' (direct)' : ''}${gone.length ? ` (the ${gone.map(x => hm(x.dep)).join(' and ')} has already gone)` : ''}.`
      : `The app has only the ${hm(dep)} ${f ? `${f.from_} → ${f.to}` : plainLabel(t.label)} ${t.mode === 'ferry' ? 'boat' : legKind(t)}, with no later time saved. ${taxi}`;
  } else if (last) quick = later.length ? `No, there are later boats: ${later.map(line).join(', ')}.` : `No later boat is listed for ${f ? `${f.from_} → ${f.to}` : plainLabel(t.label)}, so treat the ${hm(dep)} as the last; the backup is a taxi${(() => { const e = taxiEst(t.from, target, d, ctx); return e ? ` (${e})` : ''; })()}.`;
  else return null;
  const r = f ? transportAnswer('', d.date, ctx, f) : dayAnswer(d, ctx);
  return Object.assign(r, { quick, intent: t.mode === 'shuttle' ? 'shuttle' : 'transport', date: d.date, subject: f ? { kind: 'ferry', id: f.id } : { kind: 'day', id: d.date } });
}
function departChoice(q, d, ctx) {
  const ts = [...q.matchAll(/(?:^|\s)(\d{1,2})[:.](\d{2})(?=\s|$)/g)].map(m => +m[1] * 60 + +m[2]); if (ts.length < 2) return null;
  const t = (d.trips || []).find(x => x.mode === 'ferry' && ts.some(m => Math.abs((tripMinutes(x) ?? -99) - m) <= 5)), f = t && ferryOf(t, d, ctx); if (!f) return null;
  const ds = deps(f), dep = tripMinutes(t), other = ds.find(x => ts.some(m => Math.abs(x.dep - m) <= 5) && x.dep !== dep), mine = ds.find(x => x.dep === dep), now = ctx.nowMin ?? 0;
  if (!other) return null;
  const quick = `Take the ${hm(dep)} — the one in your plan${mine?.arr != null ? ` (arrives ${f.to} ${hm(mine.arr)})` : ''}. The ${hm(other.dep)} is the ${other.dep < dep ? 'earlier' : 'later'} option${other.arr != null ? ` (arrives ${hm(other.arr)})` : ''}${d.date === ctx.today && other.dep < now ? ' and has already gone' : ''}.`;
  return Object.assign(transportAnswer('', d.date, ctx, f), { quick, intent: 'transport', date: d.date, subject: { kind: 'ferry', id: f.id } });
}
function legAns(a) {
  const { q, ctx } = a;
  if (/\sor\s/.test(q) && /(boat|ferry|vapur|عباره|مركب)/.test(q)) { const d = dayAt(ctx, a.date || ctx.todayInTrip), r = d && departChoice(q, d, ctx); if (r) return r; }
  const miss = MISSQ.test(q), late = LATEQ.test(q) && !/(check ?in|checkin)/.test(q), last = LASTOUTQ.test(q) && /(boat|ferry|vapur)/.test(q);
  if ((!miss && !late && !last) || !/(ferry|boat|vapur|pickup|pick up|van|transfer|shuttle|flight|plane|عباره|مركب)/.test(q)) return null;
  const d = dayAt(ctx, a.date || ctx.todayInTrip); if (!d) return null;
  const t = pickLeg(q, d, ctx, a.fr?.clock); return t ? legPlan(t, d, ctx, { miss, late, last }) : null;
}

/* the shape of a day: the first thing, what comes after X, when we go back, a one-line summary */
const FIRSTQ = /(first thing|first stop|what first|whats first|start (the day|time|of the day)|when do we start|what time do we start|wake up|get up|early start|how early|up early)/;
function firstAns(a) {
  const { q, ctx } = a; if (!FIRSTQ.test(q)) return null;
  const d = dayAt(ctx, a.date || ctx.todayInTrip); if (!d) return null;
  const C = ctx.content, x = tripClock(d, ctx).find(y => !y.t.pseudo), wake = /(wake|get up|early|how early|up early)/.test(q);
  let quick;
  if (!x) quick = `${dateLabel(d.date)} is a free day: nothing is booked in the morning.${d.fixed?.[0] ? ' ' + dot(d.fixed[0]) : ''}`;
  else {
    const early = !x.est && x.min < 8 * 60 + 30, bf = x.est && /breakfast/i.test(d.plan?.[0] || '') ? 'After hotel breakfast, ' : '';
    const sg = (d.trips || []).map(t => (C.sights || []).find(s => s.day === d.date && aliasScore(norm(t.to), sightNames(s)) > 0)).find(s => s && spansOn(s, d.date).length && !allDay(spansOn(s, d.date)));
    const op = sg ? `; ${sg.name.split(' (')[0]} opens at ${hm(spansOn(sg, d.date)[0][0])}` : '';
    quick = `${wake ? (early ? 'Yes, an early start. ' : 'No early start. ') : ''}${bf}${x.est ? '' : `${x.t.time}: `}${legKind(x.t)} to ${plainLabel(x.t.to)}${x.t.dur ? ` (${x.t.dur})` : ''}${op}.`;
    quick = quick.replace(/(^|\. )([a-z])/g, (m, p, c) => p + c.toUpperCase());
  }
  return Object.assign(dayAnswer(d, ctx), { quick, intent: 'day' });
}
const MEALW = { lunch: 'meal', dinner: 'meal', meal: 'meal', breakfast: 'breakfast', coffee: 'coffee', shisha: 'shisha' };
function afterAns(a) {
  const { q, ctx } = a, m = /(?:^|\s)after (?:the |our |we |that |finishing |visiting )?(.+)$/.exec(q);
  if (!m || !/(what|whats|where|then|next|do we)/.test(q) || /(midnight|sunset|that)$/.test(m[1])) return null;
  const d = dayAt(ctx, a.date || ctx.todayInTrip); if (!d?.trips?.length) return null;
  const ws = m[1].split(' ').filter(w => w.length >= 4 && !STOP.has(w)), kw = Object.keys(MEALW).find(w => m[1].includes(w));
  const mv = kw && ctx.content.venues.find(v => v.day === d.date && v.status !== 'option' && (v.kind === MEALW[kw] || (MEALW[kw] === 'meal' && /^(lunch|dinner)/.test(kw) && v.kind === 'meal')));
  const ts = d.trips, hit = (s) => ws.some(w => norm(s).includes(w));
  // "Grand Bazaar → Nusr-Et": a trip that leaves the place is what comes after it; else the trip after the one that gets there
  const k = mv ? -1 : ts.findIndex(t => hit(plainLabel(t.label).split(' → ')[0]) && !hit(plainLabel(t.label).split(' → ').pop()));
  const j = k >= 0 ? k - 1 : mv ? ts.findIndex(t => norm(t.to).includes(vKey(mv))) : ts.findIndex(t => hit(t.to) || hit(plainLabel(t.label).split(' → ').pop()));
  if (j < -1 || (j < 0 && k < 0)) return null;
  if (!ts[j + 1]) return null;
  const tc = new Map(tripClock(d, ctx).map(x => [x.t, x])), at = (t) => t.time || `≈ ${tc.get(t)?.min != null ? hm(tc.get(t).min) : '?'}`;
  const nx = ts[j + 1], n2 = ts[j + 2], key = norm(plainLabel(nx.to)).split(' ')[0], pl = [...(d.plan || []), ...(d.fixed || [])].find(p => norm(p).includes(key));
  const quick = `${at(nx)}: ${legKind(nx)} to ${plainLabel(nx.to)}${nx.dur ? ` (${nx.dur})` : ''}${n2 ? `; then ${legKind(n2)} to ${plainLabel(n2.to)}${n2.dur ? ` (${n2.dur})` : ''}` : ''}.${pl ? ' ' + dot(pl) : ''}`;
  return Object.assign(dayAnswer(d, ctx), { quick, intent: 'day' });
}
function homeAns(a) {
  const { q, ctx } = a;
  if (!/((go|going|get|head|heading|come|be) back|back (home|to (the |our )?(hotel|resort)|at (the |our )?(hotel|resort))|go home|head home|return to (the |our )?(hotel|resort))/.test(q) || !/(when|what time|time|متي)/.test(q) || /(boat|ferry|flight|fly|plane|abu dhabi|dubai|uae)/.test(q)) return null;
  const iso = a.date || ctx.todayInTrip, d = dayAt(ctx, iso); if (!d) return null;
  const hb = hotelForDate(iso, ctx), hk = norm(hb?.short || hb?.title || 'hotel').split(' ')[0];
  const x = [...tripClock(d, ctx)].reverse().find(y => !y.t.pseudo && (y.t.mode === 'taxi_home' || norm(y.t.to).includes(hk)));
  const pk = !x && (d.trips || []).find(t => t.mode === 'shuttle' && norm(t.from).includes(hk)), ready = pk && (/be ready at (\d{1,2}:\d{2})/.exec(pk.dur || '') || [])[1];
  if (pk) return Object.assign(dayAnswer(d, ctx), { quick: `Be back at ${hb.title} by ${ready || pk.time} for the ${pk.time} pickup to ${pk.to}${ready ? ` (it waits only a few minutes)` : ''}.`, intent: 'next' });
  if (!x) return null;
  const quick = `${x.est ? `≈ ${hm(x.min)}` : x.t.time}: ${x.t.mode === 'taxi_home' ? 'taxi' : legKind(x.t)} from ${x.t.from} back to ${x.t.to}${x.t.dur ? ` (${x.t.dur})` : ''}.${x.est ? ' No fixed time in the plan: this is my estimate.' : ''}`;
  return Object.assign(dayAnswer(d, ctx), { quick, intent: 'next' });
}
const HAVEQ = /(what do we have|whats on|what is on|anything (planned|on)|whats planned|what is planned|what are we doing|what do we do|what can we do|what to do|anything to do)/;
function daySummary(d, ctx) {
  const F = factsFor(ctx.content), st = F.stays.find(s => s.until && s.last === d.date), bits = [];
  for (const t of (d.trips || []).filter(x => x.time)) {
    const ready = (/be ready at (\d{1,2}:\d{2})/.exec(t.dur || '') || [])[1], fno = (/[A-Z]{2}\d{2,4}/.exec(`${t.dur} ${t.label}`) || [])[0];
    bits.push(t.mode === 'shuttle' && ready ? `be ready at ${ready} for the ${t.time} ${/van/.test(t.dur) ? 'van' : 'pickup'} to ${t.to}` : t.mode === 'flight' ? `${fno || 'the flight'} leaves at ${t.time}` : `${t.time} ${legKind(t)} to ${plainLabel(t.to)}`);
  }
  const head = d.free ? `${dateLabel(d.date)} is free.` : `${dateLabel(d.date)}: ${d.title}.`, ideas = (d.ideas || []).map(x => x.split(/[:.]/)[0].trim()).filter(Boolean);
  return `${head}${st ? ' ' + dot(st.until) : ''}${bits.length ? ' ' + cap(bits.slice(0, 4).join('; ')) + '.' : ''}${ideas.length ? ` Ideas: ${ideas.join('; ')}.` : ''}`;
}
function haveAns(a) {
  const { q, ctx } = a; if (!HAVEQ.test(q) || !a.date || PARTS.some(([w]) => has(q, [w]))) return null;
  const d = dayAt(ctx, a.date); return d ? Object.assign(dayAnswer(d, ctx), { quick: daySummary(d, ctx), intent: 'day' }) : null;
}
// "until then", "meanwhile": what the plan has between now and the time the last answer gave
function untilThen(ctx, p) {
  const prevR = answer(p.q, { ...ctx, prev: null, _again: true }), now = ctx.nowMin ?? 0;
  const T = [...`${prevR.quick || ''} ${prevR.title || ''}`.matchAll(/(\d{1,2}:\d{2})/g)].map(m => toMin(m[1])).find(m => m > now);
  const d = dayAt(ctx, ctx.todayInTrip); if (T == null || !d) return null;
  const tc = tripClock(d, ctx).filter(x => !x.t.pseudo && x.min >= now - 10 && x.min < T);
  const hb = hotelForDate(d.date, ctx), hk = norm(hb?.short || '').split(' ')[0];
  const past = (x) => { const ts = [...x.matchAll(/(\d{1,2}:\d{2})/g)].map(m => toMin(m[1])); return ts.length && ts.every(m => m < now) && !ts.includes(T); };
  const pl = (d.plan || []).filter(x => !past(x) && (/(reception|early|rest of the day|resort|hotel|pool|beach|relax)/i.test(x) || (hk && norm(x).includes(hk))));
  const quick = `Until ${hm(T)}: ${tc.length ? tc.map(x => `${x.est ? '≈ ' : ''}${hm(x.min)} ${legKind(x.t)} to ${plainLabel(x.t.to)}`).join('; ') + '.' : pl.length ? pl.slice(0, 2).map(dot).join(' ') : `nothing else is planned; you are at ${hb?.short || 'the hotel'}.`}`;
  return Object.assign(dayAnswer(d, ctx), { quick, intent: 'day' });
}

const STAYQ = /(how long (do|can|will|should|shall) we (stay|spend|have|be)|how much time (do|will|can) we (have|spend|get)|how long (are we|is the visit|is the stop) (at|in))/;
function stayAns(a) {
  const { q, ctx } = a; if (!STAYQ.test(q)) return null;
  const d = dayAt(ctx, a.date || ctx.todayInTrip); if (!d?.trips?.length) return null;
  const ws = q.split(' ').filter(w => w.length >= 4 && !STOP.has(w) && !['long', 'stay', 'spend', 'have', 'time', 'much', 'before', 'after'].includes(w)), cut = q.split(/\s(?:before|until|till)\s/)[0];
  const sg = a.sight || findSight(cut, ctx), al = sg ? sightNames(sg).map(norm).filter(x => x.length >= 4) : [];
  if (sg && /(now|just got|we are at|were at|inside|in there|before they|ask us to leave|kick us out|close)/.test(q)) return null;
  const hit = (s) => { const n = norm(s); return al.some(x => n.includes(x)) || ws.some(w => cut.includes(w) && n.includes(w)); };
  const ts = d.trips, i = ts.findIndex(t => hit(t.to)), nx = ts[i + 1]; if (i < 0 || !nx) return null;
  const tc = new Map(tripClock(d, ctx).map(x => [x.t, x])), arrIn = (t) => toMin((/arrives (\d{1,2}:\d{2})/.exec(t?.dur || '') || [])[1]);
  const start = toMin(ts[i].time) ?? arrIn(ts[i - 1]) ?? tc.get(ts[i])?.min, at = start != null ? arrIn(ts[i]) ?? start + (durRange(ts[i].dur)?.[1] || 0) : null, dep = tc.get(nx);
  if (at == null || !dep || dep.min <= at) return null;
  const sp = sg ? spansOn(sg, d.date) : [], close = sp.length && !allDay(sp) ? `; it closes at ${endHm(sp[sp.length - 1][1])}` : '';
  const quick = `About ${spanTxt(Math.round((dep.min - at) / 5) * 5)} at ${plainLabel(ts[i].to)}: you arrive about ${hm(at)} and the ${legKind(nx)} to ${plainLabel(nx.to)} is at ${dep.est ? 'about ' : ''}${hm(dep.min)}${close}.`;
  return Object.assign(dayAnswer(d, ctx), { quick, intent: 'day' });
}
/* problem situations without a booking: rain, tired, skipping a stop */
function rainAns(a) {
  const { q, ctx } = a; if (!/(^|\s)(rain|raining|rainy|rains|storm|stormy|wet|مطر|تمطر|ممطر)(\s|$)/.test(q) || /(insurance|covered|cover|damage)/.test(q)) return null;
  const d = dayAt(ctx, a.date || ctx.todayInTrip); if (!d) return null;
  const C = ctx.content, sg = (C.sights || []).filter(s => s.day === d.date && s.open && typeof s.open === 'object');
  const inside = sg.filter(s => { const sp = spansOn(s, d.date); return sp.length && !allDay(sp) && !s.outsideOnly; }).map(s => s.name.split(' (')[0]);
  const out = sg.filter(s => { const sp = spansOn(s, d.date); return (sp.length && allDay(sp)) || s.outsideOnly; }).map(s => s.name.split(' (')[0]);
  const walks = (d.trips || []).filter(t => t.mode === 'walk' && (durRange(t.dur)?.[1] ?? 0) >= 10).map(t => `${plainLabel(t.from)} → ${plainLabel(t.to)}`);
  const pack = C.todos.find(t => /rain/i.test(t.title)), hb = hotelForDate(d.date, ctx), resort = !d.trips?.length;
  const quick = resort ? `${cap(relDay(d.date, ctx))} is a ${hb?.short || 'hotel'} day with nothing booked outside, so rain changes little: stay in and use the hotel.`
    : `Rain plan for ${relDay(d.date, ctx)}: ${inside.length ? `keep the indoor stops (${inside.slice(0, 4).join(', ')})` : 'the plan has no indoor sight'}${walks.length ? ` and take a taxi instead of the longer walks (${walks.slice(0, 3).join('; ')})` : ''}.${out.length ? ` Keep the outdoor parts short (${out.slice(0, 3).join(', ')}).` : ''}${pack ? ' You packed a light rain layer.' : ''}`;
  return Object.assign(dayAnswer(d, ctx), { quick, intent: 'day' });
}
function tiredAns(a) {
  const { q, ctx } = a, skip = /(^|\s)(skip|miss out|leave out|drop|not go|dont go|stay in)(\s|$)/.test(q), tired = /(^|\s)(tired|exhausted|worn out|need a rest|need rest|need a break|too much walking|feet hurt)(\s|$)/.test(q);
  if ((!skip && !tired) || (/(sick|fever|pain|injur|doctor|ill)/.test(q))) return null;
  const d = dayAt(ctx, a.date || ctx.todayInTrip); if (!d) return null;
  const C = ctx.content, now = d.date === ctx.today ? ctx.nowMin ?? 0 : 0, tc = tripClock(d, ctx).filter(x => !x.t.pseudo);
  const fixed = tc.find(x => x.min >= now && ['shuttle', 'flight'].includes(x.t.mode)), table = C.venues.find(v => v.day === d.date && v.status !== 'option' && v.book);
  const ws = q.split(' ').filter(w => w.length >= 4 && !STOP.has(w) && !['skip', 'tired', 'exhausted', 'rest', 'need', 'stay', 'hotel', 'today', 'tomorrow'].includes(w));
  const i = skip ? tc.findIndex(x => ws.some(w => norm(`${x.t.to} ${plainLabel(x.t.label)}`).includes(w))) : -1;
  const keep = fixed ? `the only fixed point is the ${fixed.t.time} ${legKind(fixed.t)} (${plainLabel(fixed.t.label)})` : table ? `keep the ${table.name} table (${costTwo(table)} for two)` : 'nothing later is booked';
  let quick;
  if (i >= 0) {
    const x = tc[i], sg = (C.sights || []).find(s => aliasScore(norm(x.t.to), sightNames(s)) > 0), nx = tc[i + 1];
    const then = !nx ? 'Nothing else is planned after it' : nx.t.mode === 'taxi_home' ? `Then you are free until the taxi back (${nx.t.dur || 'see the plan'})` : `The plan goes on with ${plainLabel(nx.t.to)} at ${nx.est ? 'about ' : ''}${hm(nx.min)}: take a taxi there directly or stay in`;
    quick = `Yes, you can skip ${plainLabel(x.t.to)}: ${sg && /^free/i.test(sg.price || '') ? 'it is free and ' : ''}nothing there is booked. ${then}; ${keep}.`;
  } else {
    const here = hereOf(ctx), hb = hotelForDate(d.date, ctx), G = geoFor(C), hp = hb && G.pts.find(e => e.cls.includes('hotel') && e.toks.some(w => norm(hb.title).includes(w)));
    const ride = here && hp && here !== hp ? ` A taxi back to ${hb.short || hb.title} from ${here.name} takes about ${taxiMins(kmBetween(here, hp)).join('–')} min.` : '';
    quick = `Rest is fine: ${keep}.${ride}`;
  }
  return Object.assign(dayAnswer(d, ctx), { quick: cap(quick), intent: 'day' });
}

// a class word of today's plan ("the mansion", "the museum"): the sight of the day that has it in its name
function sightByWord(q, ctx, iso) {
  const ws = q.split(' ').filter(w => w.length >= 5 && !STOP.has(w));
  const xs = (ctx.content.sights || []).filter(s => s.day === iso && ws.some(w => norm(s.name).split(/[\s()-]+/).includes(w)));
  return xs.find(s => !s.outsideOnly) || xs[0] || null;
}
function ifClosedAns(a) {
  const { q, ctx } = a; if (!/(^|\s)(what if|if|in case)(\s|$)/.test(q) || !/(^|\s)(closed|shut|close)(\s|$)/.test(q)) return null;
  const iso0 = a.date || ctx.todayInTrip, s = a.sight || sightByWord(q, ctx, iso0) || (iso0 && sightByWord(q, ctx, isoAdd(iso0, 1))); if (!s?.open) return null;
  const iso = s.day && s.day >= (ctx.todayInTrip || ctx.today) ? s.day : iso0 || s.day, sp = spansOn(s, iso), name = s.name.split(' (')[0];
  const al = sightNames(s).map(norm).filter(x => x.length >= 4), tag = dateLabel(iso).slice(4);
  const alts = (ctx.content.sights || []).filter(o => o !== s && spansOn(o, iso).length && !allDay(spansOn(o, iso)) && (o.day === iso || al.some(x => norm(o.note || '').includes(x)) || String(o.note || '').includes(tag)));
  const head = sp.length ? `It should be open on ${dateLabel(iso)}: ${spanText(sp)}${s.closed ? ` (closed ${s.closed})` : ''}.` : `${name} is closed on ${dateLabel(iso)}${s.closed ? ` (closed ${s.closed})` : ''}.`;
  const alt = alts.length ? ` If it is shut on the day: ${alts.slice(0, 2).map(o => `${o.name.split(' (')[0]} (${spanText(spansOn(o, iso))}${o.price ? `, ${String(o.price).split(/[;(]/)[0].trim()}` : ''})`).join(' or ')}.` : ' If it is shut on the day, the rest of the day’s plan still works.';
  return Object.assign(sightAnswer(s, '', iso, ctx), { quick: `${head}${alt}`, noQuick: false, intent: 'open' });
}
// "something cheaper than the market", "cheaper?": the same kind of place for less, that day first
function cheaperLine(v, ctx) {
  const lo = v.costLow ?? Infinity, same = ctx.content.venues.filter(x => x !== v && x.kind === v.kind && x.costLow != null && x.costLow < lo);
  const day = same.filter(x => x.day === v.day).sort((p, r) => p.costLow - r.costLow), any = same.filter(x => dayAt(ctx, x.day)?.city === dayAt(ctx, v.day)?.city).sort((p, r) => p.costLow - r.costLow);
  const k = (KIND[v.kind] || v.kind).toLowerCase();
  if (day.length) return `Cheaper on ${dateLabel(v.day)}: ${day.slice(0, 2).map(x => `${x.name} (${shortArea(x.area) || x.area}): ${costTwo(x)} for two`).join('; or ')} (vs ${costTwo(v)} at ${v.name}).`;
  return any.length ? `No cheaper ${k} is saved for ${dateLabel(v.day)}. The cheapest ${k} in your ${dayAt(ctx, v.day)?.city || ''} plan is ${any[0].name} (${dateLabel(any[0].day)}): ${costTwo(any[0])} for two.` : `${v.name} is already the cheapest ${k} saved in the plan.`;
}
function cheaperAns(a) {
  const { q, ctx } = a; if (!/(^|\s)(cheaper|cheapest|less expensive|budget option|something cheap)(\s|$)/.test(q)) return null;
  const v = a.venue || (ctx.prev?.subject?.kind === 'venue' && ctx.content.venues.find(x => x.id === ctx.prev.subject.id)); if (!v) return null;
  return Object.assign(venueAnswer(v, ctx, ''), { quick: cheaperLine(v, ctx), intent: 'venue', date: v.day, subject: { kind: 'venue', id: v.id } });
}

/* bookings still to make: which restaurants, which first */
const VKEYS = new WeakMap();
function restoTodos(ctx) {
  const C = ctx.content;
  // a venue is named by its own key word unless another venue shares it ("bosphorus" is in two names: then the whole name)
  if (!VKEYS.has(C)) VKEYS.set(C, C.venues.filter(v => v.status !== 'option').map(v => { const k = vKey(v), n = C.venues.filter(o => norm(o.name).split(' ').includes(k)).length;
    return { v, re: new RegExp(`(^|[^\\p{L}])${reEsc(n > 1 ? norm(v.name.split(' (')[0]) : k)}`, 'u') }; }));
  const ks = VKEYS.get(C);
  return C.todos.filter(t => t.kind === 'book').map(t => { const n = norm(t.title); return { t, st: tState(t, ctx), vs: ks.filter(x => x.re.test(n)).map(x => x.v) }; })
    .filter(x => x.vs.length && !['done', 'missed'].includes(x.st)).sort((a, b) => (a.t.due || '').localeCompare(b.t.due || ''));
}
const shortName = (v) => { const k = vKey(v), ws = v.name.split(' (')[0].split(' '), i = ws.findIndex(w => norm(w) === k); return i >= 0 ? ws.slice(0, i + 1).join(' ') : ws[0]; };
const telOfVenue = (v, t) => v.phone || v.whatsapp || (/(\+\d[\d ]{7,})/.exec(`${t?.note || ''} ${t?.title || ''}`) || [])[1]?.trim() || '';
function restoLine(x, ctx) {
  const v = x.vs[0], what = (/\((dinner|lunch|breakfast)\)/i.exec(x.t.title) || [])[1] || (KIND[v.kind] || 'meal').toLowerCase(), tel = telOfVenue(v, x.t);
  return `${x.vs.map(y => y.name).join(' + ')} (${what} ${dateLabel(v.day)}). Book by ${dateLabel(x.t.due)}${tel ? `: ${/whatsapp/i.test(`${v.book} ${x.t.title}`) && !v.phone ? 'WhatsApp' : 'call'} ${tel}` : ''}.`;
}
function reserveAns(a) {
  const { q, ctx, venue } = a;
  if (venue || !/(^|\s)(reserve|reservation|reservations|book|booking|bookings|احجز|نحجز|حجز)(\s|$)/.test(q) || !/(restaurant|restaurants|table|tables|dinner|dinners|lunch|places|anything|any|مطعم|مطاعم|طاوله)/.test(q)) return null;
  const xs = restoTodos(ctx); if (!xs.length) return null;
  const now = xs.filter(x => ['now', 'overdue'].includes(x.st)), first = now[0] || xs[0], v = first.vs[0], tel = telOfVenue(v, first.t);
  const rest = xs.filter(x => x !== first).map(x => `${x.vs.map(shortName).join(' + ')} (${+x.t.due.slice(8)})`);
  const quick = `${now.length ? `Yes, ${now.length === 1 ? 'one is' : `${now.length} are`} due now.` : 'Not today.'} The first one is ${first.vs.map(y => y.name).join(' + ')} for ${dateLabel(v.day)}, book by ${dateLabel(first.t.due)}${tel ? ` (call ${tel})` : ''}.${rest.length ? ` Then ${rest.join(', ')}.` : ''}`;
  return Object.assign(todoAnswer(ctx, 'book'), { quick, intent: 'todo', date: null, subject: { kind: 'todo', id: 'book' } });
}

/* places: which one of two, which day we see one, is something included, what a meal or a ticket costs */
function choiceAns(a) {
  const { q, ctx } = a; if (!/\sor\s/.test(q) || !/(which|are we|do we|we going|should we)/.test(q)) return null;
  const s = a.sight || findSight(q, ctx); if (!s?.day) return null;
  const d = dayAt(ctx, s.day), t = d && (d.trips || []).find(x => aliasScore(norm(x.to), sightNames(s)) > 0);
  const quick = `${s.name.split(' (')[0]}${s.note ? ` — ${sentences(s.note).slice(0, 2).join(' ')}` : ''}${t ? ` ${cap(legKind(t))}${t.time ? ` at ${t.time}` : ''}${t.dur ? ` (${t.dur})` : ''} on ${dateLabel(s.day)}.` : ''}`;
  return Object.assign(sightAnswer(s, '', s.day, ctx), { quick, noQuick: false, intent: 'open' });
}
const WHENSEEQ = /(which day|what day|when|what time) (?:(?:do|will|are|shall|can) (?:we|i) )?(see|visit|go to|go|going to|pass|be at|head to)(\s|$)|(which|what) day (is|are)/;
function whenSeeAns(a) {
  const { q, ctx } = a; if (!WHENSEEQ.test(q)) return null;
  const s = a.sight || findSight(arPlaces(q), ctx), v = !s && a.venue;
  if (s?.day) {
    const d = dayAt(ctx, s.day), al = sightNames(s).map(norm).filter(x => x.length >= 4);
    const t = (d?.trips || []).find(x => al.some(n => norm(`${x.to} ${x.label} ${x.dur || ''}`).includes(n)));
    const pl = !t && [...(d?.plan || []), ...(d?.fixed || [])].find(p => al.some(n => norm(p).includes(n)));
    const op = t?.time && opensLater(t, s.day, toMin(t.time), ctx), rel = s.day === ctx.today || s.day === isoAdd(ctx.today, 1) ? cap(relDay(s.day, ctx)) : dateLabel(s.day);
    const quick = `${rel}: ${t ? `${t.time ? t.time + ' ' : ''}${legKind(t)} ${plainLabel(t.label)}${t.dur ? ` (${t.dur})` : ''}${op ? `; ${op}` : ''}` : pl || d?.title || ''}.`;
    return Object.assign(sightAnswer(s, '', s.day, ctx), { quick: quick.replace(/\.\.$/, '.'), noQuick: false, intent: 'open' });
  }
  if (v) { const vis = venueVisit(v, ctx); return Object.assign(venueAnswer(v, ctx), { quick: `${dateLabel(v.day)}${vis.at ? ` at ${vis.at}` : ''}: ${v.name}${vis.inT ? ` (${reachText(vis.inT)})` : ''}.`, intent: 'venue' }); }
  return null;
}
const INCLQ = /(included|include|includes|inclusive|extra|pay extra|for free|free of charge|do we pay|cost extra|مشمول|ضمن)/;
function inclAns(a) {
  const { q, ctx } = a; if (!INCLQ.test(q)) return null;
  const kinds = [/(shisha|hookah|nargile|شيشه)/.test(q) && 'shisha', /(coffee|قهوه)/.test(q) && 'coffee'].filter(Boolean);
  if (!kinds.length) return null;
  const C = ctx.content, hb = hotelForDate(a.date || ctx.todayInTrip || ctx.today, ctx), named = C.bookings.find(b => b.kind === 'hotel' && has(q, b.keywords || [])) || hb;
  const hk = norm(named?.short || named?.title || '').split(' ')[0];
  const v = a.venue || (hk && C.venues.find(x => kinds.includes(x.kind) && norm(`${x.area} ${x.name}`).includes(hk)));
  if (!v) return null;
  const inc = /included/i.test(v.cost || ''), rng = v.costLow != null ? `₺${fmt(v.costLow)}${v.costHigh && v.costHigh !== v.costLow ? '–' + fmt(v.costHigh) : ''}` : costTwo(v);
  const quick = `${cap(KIND[v.kind] || v.kind)} is ${inc ? 'included' : `likely extra, about ${rng}${/proxy/i.test(v.cost || '') ? ' (proxy price)' : ''}`}.${v.notes ? ' ' + dot(v.notes) : ''}`;
  return Object.assign(venueAnswer(v, ctx, ''), { quick, intent: 'venue', date: v.day, subject: { kind: 'venue', id: v.id } });
}
function mealCostAns(a) {
  const { q, ctx, venue } = a;
  if (venue || !/(how much|cost|price|كم|بكم)/.test(q) || !/(^|\s)(dinner|lunch|breakfast|meal|eat|food)(\s|$)/.test(q) || /(budget|whole|total|spent|spend|left)/.test(q)) return null;
  const iso = a.date || ctx.todayInTrip, d = dayAt(ctx, iso); if (!d) return null;
  const kind = /breakfast/.test(q) ? 'breakfast' : 'meal', v = ctx.content.venues.find(x => x.day === iso && x.status !== 'option' && x.kind === kind); if (!v) return null;
  const night = /(dinner|tonight)/.test(q), word = /dinner/.test(q) ? 'Dinner' : /lunch/.test(q) ? 'Lunch' : /breakfast/.test(q) ? 'Breakfast' : 'The meal';
  const taxi = (d.costs || []).find(c => /taxi/i.test(c.label));
  const quick = `${word} ${relDay(iso, ctx, night)} at ${v.name}: ${costTwo(v)} for two${taxi ? ` (plus ${lcFirst(taxi.label)}, ${taxi.value})` : ''}.`;
  return Object.assign(venueAnswer(v, ctx, ''), { quick, intent: 'venue', date: v.day, subject: { kind: 'venue', id: v.id } });
}
function sightPrice(s, ctx, party = 2) {
  const p = String(s.price || ''), name = s.name.split(' (')[0];
  if (!p) return `The app has no ticket price for ${name}.`;
  // the first priced clause is the ticket ("€25 per person (…)", "combined ticket ₺2,750; Harem alone ₺1,050")
  const parts = p.split(/;\s*(?![^(]*\))/), i = parts.findIndex(x => /(€|₺|\$)\s?\d/.test(x)), m = i >= 0 && /(€|₺|\$)\s?([\d.,]+)/.exec(parts[i]);
  if (!m || /^free/i.test(p)) return `${name}: ${p}.`;
  // two prices in one clause ("About ₺1,950 day / ₺3,000 night"): both, for two, with the source wording
  const multi = [...parts[i].matchAll(/(€|₺|\$)\s?(\d[\d,]*(?:\.\d+)?)\s*([a-z]+)?/gi)];
  if (multi.length >= 2 && multi.every(x => x[1] === m[1])) {
    const rest = parts.filter((_, k) => k !== i);
    return `${name} for two: ${multi.map(x => `${x[1]}${fmt(+x[2].replace(/,/g, '') * party)}${x[3] && !/^(for|per|each|and|or|pp)$/i.test(x[3]) ? ' ' + x[3] : ''}`).join(' / ')} (per person: ${lcFirst(parts[i].trim())}).${rest.length ? ` Also: ${rest.join('; ')}.` : ''}`;
  }
  const n = +m[2].replace(/,/g, ''), tot = n * party, eur = ctx.content.money.rates.tryPerEur;
  const desc = parts[i].replace(m[0], ' ').replace(/\b(per person|each|pp)\b/gi, ' ').replace(/\s+/g, ' ').replace(/^[\s:·,-]+|[\s:·,-]+$/g, '').replace(/^\((.*)\)$/, '$1');
  const others = parts.filter((_, k) => k !== i), tl = m[1] === '€' ? `, about ₺${fmt(Math.round(tot * eur / 10) * 10)}` : '';
  return `${m[1]}${fmt(tot)} for two at ${name} (${m[1]}${fmt(n)} each${desc ? `: ${lcFirst(desc)}` : ''})${tl}.${others.length ? ` Also: ${others.join('; ')}.` : ''}`;
}
function sightPriceAns(a) {
  const { q, ctx, sight, venue } = a;
  if (!sight || venue || !/(^|\s)(how much|price|prices|cost|costs|fee|fees|كم|بكم|سعر)(\s|$)/.test(q) || /(what time|متي|taxi|cab|uber|ferry|boat|tram|metro|bus|transfer|shuttle|ride|drive|get there|عباره|مركب|فيري|تاكسي|ترام|باص)/.test(q)) return null;
  return Object.assign(sightAnswer(sight, '', null, ctx), { quick: sightPrice(sight, ctx), noQuick: false, intent: 'open' });
}

/* venues: open late? walk in? alternatives nearby */
function venueHours(v, q, date, ctx) {
  const d = dayAt(ctx, v.day), key = vKey(v), lines = d ? [...(d.plan || []), ...(d.fixed || [])].filter(p => norm(p).includes(key)) : [];
  const text = [v.notes, ...lines].filter(Boolean).join(' '), iso = date || v.day, wd = WEEKDAY_EN[dowOf(iso)], area = shortArea(v.area).split(', ').pop() || v.area;
  const close = /closes (?:at )?(\d{1,2}:\d{2})(?: on (\w+?)s?\b)?/i.exec(text), from = sentences(text).find(s => /(from|opens(?: at)?) \d{1,2}:\d{2}/i.test(s));
  const wdNote = sentences(text).find(s => /(confirm|check)/i.test(s) && new RegExp(wd, 'i').test(s));
  if (close) {
    const cm = toMin(close[1]), late = /(late|tonight|evening|after|still|now)/.test(q), other = sentences(v.notes || '').filter(s => !/closes/i.test(s)).map(s => s.replace(/\.$/, '')).join('; ');
    const tonight = ctx.content.venues.find(x => x.day === v.day && x !== v && x.status !== 'option' && x.kind === 'shisha'), dd = dayAt(ctx, v.day);
    return `${late && cm < 21 * 60 ? 'No — ' : ''}${v.name} in ${area} closes at ${close[1]}${close[2] ? ` on ${close[2]}` : ''}${v.cost ? ` (${costTwo(v)} there${other ? `; ${lcFirst(other)}` : ''})` : ''}.${tonight ? ` Tonight's plan is ${tonight.name} for shisha${dd?.sunset ? ` after the ${dd.sunset} sunset` : ''}.` : ''}`;
  }
  if (wdNote) return `Not confirmed. The app note for ${v.name} (${v.area}) says: ${lcFirst(wdNote)} ${v.phone || v.whatsapp ? `Call ${v.phone || v.whatsapp} to check.` : `No phone is saved, so ask in ${area} before going.`}`;
  if (from) { const vis = venueVisit(v, ctx), t = vis.inT; return `${v.name}: ${dot(from)}${t?.time ? ` Your ${legKind(t)} at ${t.time} takes ${t.dur}.` : ''}`; }
  return null;
}
function venueAlts(v, ctx, walkIn = false) {
  const C = ctx.content, aw = norm(shortArea(v.area) || v.area || '').split(' ').filter(w => w.length >= 4), vp = venuePoint(v, C);
  return C.venues.filter(x => x !== v && x.day === v.day && x.kind === v.kind).map(x => {
    const free = /(no reservations|walk-in|walk in)/i.test(x.notes || '') ? 1 : 0, same = aw.some(w => norm(x.area || '').includes(w)) ? 1 : 0, xp = vp && venuePoint(x, C);
    return { x, free, sc: (walkIn ? free * 3 : free * 0.5) + same * 2 - (xp ? kmBetween(vp, xp) : 5) / 5 + (x.phone ? 0.2 : 0) };
  }).sort((p, r) => r.sc - p.sc);
}
function walkInLine(v, ctx) {
  const alt = venueAlts(v, ctx, true).find(y => y.free)?.x, tel = [v.whatsapp && `WhatsApp ${v.whatsapp}`, v.phone && v.phone !== v.whatsapp && `call ${v.phone}`].filter(Boolean).join(' or ');
  if (!v.book) return `Yes: no booking is listed for ${v.name}${v.notes ? ` (${v.notes.replace(/\.$/, '')})` : ''}.`;
  const ask = String(v.book).replace(/\s*\([^)]*\)/g, '').trim(), askL = /^[^a-z]+$/.test(ask) ? ask.toLowerCase() : lcFirst(ask);
  return `Not guaranteed: ${v.name} asks you to ${askL}.${tel ? ` ${cap(tel)} now or ask at the door.` : ' Ask at the door.'}${alt ? ` Walk-in fallback: ${alt.name} (${/no reservations/i.test(alt.notes) ? 'no reservations' : 'walk-in'}).` : ''}`;
}
function altLine(v, ctx, walkIn) {
  const xs = venueAlts(v, ctx, walkIn); if (!xs.length) return null;
  const [p, s] = xs, x = p.x, nr = /(no reservations|walk-in)/i.test(x.notes || '');
  return `${x.name} (${x.area}): ${nr ? 'walk-in, no reservations, ' : ''}${costTwo(x)} for two${x.phone && !nr ? `; call ${x.phone}` : ''}.${s ? ` Or ${s.x.name}${s.x.phone ? ` (${s.x.phone})` : ''}.` : ''}`;
}

/* names in Arabic script or with a typo ("زيروج بورت", "ashk kahve", "kilic ali pasha") → the content's own spelling */
const AR_SK = { 'ب': 'b', 'ت': 't', 'ث': 's', 'ج': 'k', 'ح': 'h', 'خ': 'k', 'د': 'd', 'ذ': 'z', 'ر': 'r', 'ز': 'z', 'س': 's', 'ش': 's', 'ص': 's', 'ض': 'd', 'ط': 't', 'ظ': 'z', 'غ': 'k', 'ف': 'f', 'ق': 'k', 'ك': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n', 'ه': 'h', 'پ': 'b', 'گ': 'k', 'ڤ': 'f' };
const skel = (w) => (AR.test(w) ? [...w.replace(/ه$/, '')].map(c => AR_SK[c] || '').join('')
  : w.replace(/sh|ch/g, 's').replace(/th/g, 't').replace(/[aeiouyw]/g, '').replace(/p/g, 'b').replace(/v/g, 'f').replace(/[cgjqx]/g, 'k').replace(/[^a-z]/g, '')).replace(/(.)\1+/g, '$1');
const NAMEIX = new WeakMap();
function nameIndex(C) {
  if (NAMEIX.has(C)) return NAMEIX.get(C);
  const out = [], seen = new Set();
  const add = (text) => { const n = norm(text), toks = n.split(' ').filter(Boolean); if (!toks.length || seen.has(n)) return; seen.add(n); const sk = toks.map(skel); if (sk.some(s => !s) || sk.join('').length < 3) return; out.push({ n, toks, sk }); };
  for (const s of C.sights || []) sightNames(s).forEach(x => add(x.split(' (')[0]));
  for (const v of C.venues) { add(v.name.split(' (')[0]); add(v.name.split(' (')[0].replace(/^the /i, '')); }
  const PLAIN = new Set(['pier', 'hotel', 'airport', 'resort', 'square', 'mosque', 'market', 'palace', 'tower', 'gate', 'church', 'mall', 'college', 'waterfront', 'cafe', 'old']);
  const places = [...C.days.flatMap(d => (d.trips || []).flatMap(t => [t.from, t.to])), ...C.transport.ferries.flatMap(f => [f.from_, f.to].flatMap(x => String(x).split(/\s*\/\s*/)))];
  for (const x of places) { const w = norm(plainLabel(x)).split(' ')[0]; if (w && w.length >= 5 && !PLAIN.has(w)) add(w); }
  NAMEIX.set(C, out);
  return out;
}
function canonNames(q, C) {
  const toks = q.split(' '), ar = AR.test(q), { known } = wordsFor(C), out = toks.slice();
  if (!ar && toks.every(w => known.has(w) || COMMON.has(w) || STOP.has(w) || w.length < 4 || !/^[a-z]+$/.test(w))) return q;
  for (const e of nameIndex(C).sort((x, y) => y.toks.length - x.toks.length)) {
    for (let i = 0; i + e.toks.length <= toks.length; i++) {
      let ok = true, exact = 0, arab = 0;
      for (let k = 0; k < e.toks.length && ok; k++) {
        const w = toks[i + k], t = e.toks[k];
        if (w === t) { exact++; continue; }
        if (AR.test(w)) { arab++; ok = skel(w) === e.sk[k] && (e.toks.length > 1 || (e.sk[k].length >= 3 && w.length >= 5)); continue; }
        ok = w.length >= 4 && t.length >= 4 && w[0] === t[0] && !known.has(w) && skel(w) === e.sk[k];
      }
      if (!ok || (!arab && exact === e.toks.length) || (!arab && !exact && e.toks.length > 1) || (!arab && e.toks.length === 1 && e.toks[0].length < 5)) continue;
      out.splice(i, e.toks.length, e.n, ...Array(e.toks.length - 1).fill(''));
      for (let k = 0; k < e.toks.length; k++) toks[i + k] = '\u0000';
    }
  }
  return out.filter(w => w !== '').join(' ');
}

/* where the plan has you now: the end of the last trip that has started, else today's hotel */
function hereOf(ctx) {
  const d = dayAt(ctx, ctx.todayInTrip), G = geoFor(ctx.content); if (!d) return null;
  const st = nextStep(d, ctx.nowMin ?? 0, { doneN: (ctx.progress || {})[d.date] || 0, content: ctx.content });
  const last = st.timeline.filter(x => x.started && !x.trip.pseudo).pop(), hb = hotelForDate(d.date, ctx);
  return (last && G.pts.find(e => e.n === norm(last.trip.to))) || (hb && G.pts.find(e => e.cls.includes('hotel') && e.toks.some(w => norm(hb.title).includes(w)))) || null;
}
const sightPoint = (s, ctx) => geoFor(ctx.content).pts.find(e => aliasScore(e.n, sightNames(s)) > 0) || null;

/* compound questions: "where is lunch and is it far from the tower" → answer each part; the second one as a follow-up of the first */
const SPLIT_RE = /\s(?:and|also|plus)\s+(?=(?:is|are|do|does|did|can|could|will|would|should|how|what|whats|when|where|which|who)\s)/;
const STRONG_SKIP = new Set(['Yes', 'No', 'The', 'Today', 'Tonight', 'Tomorrow', 'Your', 'You', 'Then', 'Call', 'Not', 'It', 'In', 'At', 'On', 'If', 'And', 'Or', 'A', 'An', 'Booking', 'About']);
const strongToks = (s) => [...new Set((String(s || '').match(/[\p{L}\p{N}][\p{L}\p{N}:.,]*[\p{L}\p{N}]|\p{N}/gu) || []).map(t => t.replace(/[.,]+$/, '').replace(/,/g, '')).filter(t => /\d/.test(t) || (/^\p{Lu}/u.test(t) && !STRONG_SKIP.has(t))))];
// the whole answer covers a part when it has the part's first price, else most of its names, numbers and times
const covers = (big, small) => {
  const h = String(big || '').replace(/,/g, ''), m = /(?:₺|€|\$|AED )\s?([\d.,]+)/.exec(String(small || '')); if (m && h.includes(m[1].replace(/,/g, ''))) return true;
  const t = strongToks(small); if (!t.length) return true; return t.filter(x => h.includes(x)).length / t.length >= 0.6;
};
const lineOf = (r) => r.quick || (r.blocks || []).find(b => b.text && b.label !== 'Quick answer')?.text || '';
const UNSURE = /^(I could not find|Here is what I found|Hi! I know)/;
function compound(q, ctx) {
  const m = SPLIT_RE.exec(q); if (!m) return null;
  const a = q.slice(0, m.index).trim(), b = q.slice(m.index + m[0].length).trim();
  if (a.split(' ').length < 2 || b.split(' ').length < 2) return null;
  const sub = { ...ctx, _part: true }, r0 = answer(q, sub), r1 = answer(a, sub);
  const r2 = answer(b, { ...sub, prev: { q: a, intent: r1.intent || null, date: r1.date || null, subject: r1.subject || null, title: r1.title || '' } });
  const l0 = lineOf(r0), l1 = lineOf(r1), l2 = lineOf(r2);
  const offDay = r2.date && r1.date && r2.date !== r1.date && !DATE_TOK.test(b);
  DATE_TOK.lastIndex = 0;
  const first = (x) => String(x).split(/(?<=[.;])\s/)[0];
  if (!l2 || UNSURE.test(r2.title || '') || r2.intent === 'search' || (offDay && !UNSURE.test(r0.title || '')) || covers(l0, first(l2))) return r0;
  const base = (covers(l0, l1) && !UNSURE.test(r0.title || '')) || UNSURE.test(r1.title || '') ? r0 : r1, lb = lineOf(base);
  if (covers(lb, first(l2))) return base;
  const text = `${lb.trim()}${/[.!?]$/.test(lb.trim()) ? '' : '.'} ${l2}`, qb = (base.blocks || []).find(x => x.label === 'Quick answer');
  if (qb) qb.text = text; else { const nb = CALL(text, 'sea', 'Quick answer'); base.blocks = [nb, ...(base.blocks || [])]; if (base.pdf) base.pdf = { ...base.pdf, blocks: [nb, ...base.pdf.blocks] }; }
  return Object.assign(base, { quick: text, subject: r2.subject || base.subject || null, date: r2.date ?? base.date ?? null });
}

/* late for a table ("we are late for feriye"): its time, the number to tell them, how long the way there takes */
function lateVenueAns(a) {
  const { q, ctx, venue: v } = a; if (!v || !/(we are late|were late|running late|will be late|be late|late for|stuck in traffic|delayed)/.test(q)) return null;
  const vis = venueVisit(v, ctx), at = toMin(String(vis.at || '').split('–')[0]), now = ctx.nowMin ?? 0, tel = v.whatsapp ? `WhatsApp ${v.whatsapp}` : v.phone ? `call ${v.phone}` : null;
  const when = at != null && v.day === ctx.today ? `Your table at ${v.name} is at ${hm(at)} (${at > now ? `in ${spanTxt(at - now)}` : `${spanTxt(now - at)} ago`})` : `${v.name} is in your plan ${relDay(v.day, ctx)}${vis.at ? ` at ${vis.at}` : ''}`;
  const quick = `${when}: ${tel ? `${tel} to say you are on your way` : 'no phone is saved, so just go'}${vis.inT ? `; the ${legKind(vis.inT)} from ${vis.inT.from} takes ${vis.inT.dur}` : ''}.`;
  return Object.assign(venueAnswer(v, ctx, ''), { quick: cap(quick), intent: 'venue', date: v.day, subject: { kind: 'venue', id: v.id } });
}

/* the insurance: valid where and from when (territory, entry stamp, leaving the country) */
const INS_VALQ = /(valid|validity|work|works|working|active|start|starts|begin|begins|from when|until when|till when|ends?|expire|expires|from now|when we arrive|dubai|abu dhabi|uae|emirates|on the way|transit|on the plane|at home)/;
function insValidAns(a) {
  const { q, ctx, ins } = a, I = ctx.content.insurance;
  if (!I?.valid || !ins?.words || (ins.best && ins.best.strong >= 1) || !INS_VALQ.test(q)) return null;
  const F = factsFor(ctx.content), now = ctx.nowMin ?? 0, ff = F.flights.find(f => f.b.id === cfg(ctx).firstFlight), hf = F.flights.find(f => f.b.id === cfg(ctx).homeFlight);
  const inAbs = ff?.legs[0]?.to ? absMin(ff.b.dateIso, ff.legs[0].to.abs, ctx) : null, outAbs = hf?.dep ? absMin(hf.b.dateIso, hf.dep.abs, ctx) : null;
  const away = /(dubai|abu dhabi|uae|emirates|at home|on the way|transit|on the plane|in the plane)/.test(q), terr = I.valid.territory || '';
  const lead = away ? `No — the ${insShort(I)} policy covers ${terr || 'this country only'}.` : inAbs != null && now < inAbs ? 'From arrival, not now:' : outAbs != null && now > outAbs ? 'Not any more:' : `Yes, you are covered now (${terr}).`;
  return Object.assign(insuranceOverview(ctx, ''), { quick: `${lead} ${I.valid.note || `Valid ${dateLabel(I.valid.from)} – ${dateLabel(I.valid.to)}.`}`, intent: 'insurance', date: null, subject: null });
}

/* "does alaa need to cover her hair in hagia sophia": the place's own dress note, and the mosque rule for a mosque */
const DRESSQ = /(cover (up|her|his|my|our|the)? ?(hair|head|heads|shoulders|knees|arms|legs)|headscarf|head scarf|scarf|hijab|veil|dress code|(^|\s)wear(\s|$)|shorts|sleeveless|حجاب|طرحه|ايشارب|نلبس|تلبس|تغطي شعر)/;
function dressAns(a) {
  const { q, ctx, sight: s } = a; if (!s || a.venue || !DRESSQ.test(q)) return null;
  const rule = /(cover|headscarf|scarf|sleeve|shoulder|knee|dress)/i, own = sentences(s.note).filter(x => rule.test(x));
  const mosque = /(mosque|camii|prayer)/i.test(`${s.name} ${s.hours || ''} ${s.price || ''} ${s.prayerNote || ''}`);
  const tip = mosque ? sentences(ctx.content.tips.sections.find(x => x.id === 'mosque')?.items.find(x => rule.test(x)) || '')[0] : null;
  if (!own.length && !tip) return null;
  const yes = /(need|must|have to|has to|should|required|لازم)/.test(q) && [...own, tip || ''].some(x => /(cover|headscarf)/i.test(x)) ? 'Yes — ' : '';
  const quick = `${yes}${own.length ? `${s.name.split(' (')[0]}: ${own.join(' ')}` : ''}${tip ? `${own.length ? ' ' : `${s.name.split(' (')[0]}: `}Mosque rule: ${lcFirst(tip)}` : ''}`;
  return Object.assign(sightAnswer(s, '', null, ctx), { quick, noQuick: false, intent: 'open', date: s.day || null, subject: { kind: 'sight', id: s.id } });
}

/* "pierre loti is right there, should we go up", "can we add the cistern today and how much", "is X worth a quick stop": the place's facts, not the day plan */
const ADDQ = /(should we|shall we|worth|can we add|could we add|add it|add (this|that|the)|fit (it )?in|squeeze|quick stop|pop in|stop by|drop by)/;
function sightAddAns(a) {
  const { q, ctx, sight: s } = a; if (!s || a.venue || !ADDQ.test(q)) return null;
  const iso = a.date || ctx.todayInTrip || s.day || ctx.today, name = s.name.split(' (')[0], known = !!s.open && typeof s.open === 'object';
  const sp = known ? spansOn(s, iso) : null, never = known && DKEY.every((_, i) => !spansWd(s, i).length);
  const ns = sentences(s.note), np = ns.find(x => /not in the plan/i.test(x)), why = np && (/\(([^)]+)\)/.exec(np) || [])[1];
  const lead = never ? `No — ${name} is not open to visitors during your trip.${s.hours ? ' ' + dot(s.hours) : ''}${np ? ' ' + np : ''}`
    : s.day && !np ? (s.day === iso ? `${name} is already in your plan for ${relDay(iso, ctx)}.` : `${name} is in your plan on ${dateLabel(s.day)}.`)
    : `${name} is not in your plan${why ? ` (${why})` : ''}.`;
  let hours = '';
  if (!never && sp) {
    const m = ctx.nowMin, live = iso === ctx.today && !!ctx.todayInTrip && m != null;
    if (!sp.length) hours = ` It is closed on ${dateLabel(iso)}${s.closed ? ` (closed ${s.closed})` : ''}.`;
    else if (allDay(sp)) hours = ' Open any time.';
    else if (live) { const cur = sp.find(([x, y]) => x <= m && m < y), later = sp.find(([x]) => x > m); hours = cur ? ` Open now (${hm(m)}), until ${untilHm(cur[1])}${sp.length > 1 ? ` (today ${spanText(sp)})` : ''}.` : later ? ` Closed right now; it opens at ${hm(later[0])} (today ${spanText(sp)}).` : ` Closed for today (${spanText(sp)}).`; }
    else hours = ` Open ${spanText(sp)} on ${dateLabel(iso)}.`;
  } else if (!never && s.hours) hours = ` Hours: ${dot(s.hours)}`;
  const priceQ = /(^|\s)(how much|price|prices|cost|costs|ticket|tickets|fee|fees|كم|بكم|سعر)(\s|$)/.test(q), pay = priceQ && ns.find(x => /(cash|card)/i.test(x));
  const quick = `${lead}${hours}${!never && priceQ ? ` ${sightPrice(s, ctx)}` : ''}${pay ? ` ${pay}` : ''}`;
  return Object.assign(sightAnswer(s, '', iso, ctx), { quick, noQuick: false, intent: 'open', date: iso, subject: { kind: 'sight', id: s.id } });
}

/* "bread and dips on the table we didn't order, do we have to pay?": the bill rule from the tips */
const UNORDQ = /(didnt order|did not order|never ordered|not ordered|didnt ask for|did not ask for|without (us )?ordering|we didnt want|unrequested|they brought|they put|on the table)/;
function unorderedAns(a) {
  const { q, ctx } = a; if (!UNORDQ.test(q) || !/(pay|charge|charged|bill|free|cost|ندفع|نحاسب)/.test(q)) return null;
  const items = ctx.content.tips.sections.flatMap(s => s.items.map(x => ({ s, x }))), hit = items.find(y => /(unrequested|not ordered|nibbles)/i.test(y.x));
  if (!hit) return null;
  const ss = sentences(hit.x), key = ss.find(x => /(unrequested|nibbles)/i.test(x)), law = ss.find(x => /(illegal|banned)/i.test(x) && x !== key);
  const say = items.flatMap(y => sentences(y.x)).find(x => /servis ücreti|yasak/i.test(x));
  const r = tipsAnswer(norm(hit.s.title), ctx);
  return Object.assign(r, { quick: `No — ${lcFirst(key)}${law ? ` ${law}` : ''}${say ? ` ${say}` : ''}`, intent: 'tips', date: null, subject: null });
}

/* the reasoning layer: each handler reads the question's shape and answers from the facts, or passes */
const SMART = [insValidAns, lateVenueAns, dressAns, sightAddAns, unorderedAns, ifClosedAns, cheaperAns, paidKindAns, layoverAns, legTimeAns, arriveAns, stayAns, rainAns, tiredAns, checkinAns, loungeAns, paidAns, policyAns, sanityAns, waitAns, untilAns, legAns, firstAns, afterAns, homeAns, reserveAns, choiceAns, whenSeeAns, inclAns, mealCostAns, sightPriceAns, haveAns];
// something happened (insurance): only the handlers about the policy and the waiting driver may answer instead
function smart(a) { for (const h of a.intent === 'insurance' ? [insValidAns, layoverAns, waitAns] : SMART) { const r = h(a); if (r) return r; } return null; }
