// cloud.js · "your things" synced through a GitHub repository, end-to-end encrypted.
// Plain ES module: no DOM, no dependencies. The app seals and opens bytes; this module never sees the key.
// On the data branch: mine.enc (the whole state, sealed) and files/<id>.enc (each added document, sealed).

const COLS = ['docs', 'notes', 'todos', 'expenses', 'done', 'progress', 'settings'];
const VERSION = 1;                                  // newest mine.v this build understands
const MINE = 'mine.enc';
const API_VERSION = '2022-11-28';
const JSON_T = 'application/vnd.github+json', RAW_T = 'application/vnd.github.raw+json', OBJ_T = 'application/vnd.github.object+json';
const GAP = 1000;                                   // at least 1 s between writes (GitHub: write serially)
const RETRIES = 3;                                  // sha conflicts: re-pull, merge, retry
const T_REQ = 20000, T_FILE = 300000;               // timeouts (ms); uploads also get 1 s per 64 KB
const MAX_FILE = 20 * 1024 * 1024;                  // documents up to 20 MB
const F_JSON = 0, F_GZIP = 1;                       // first byte of the sealed state

/* ───────────── merge: pure, deterministic, commutative, associative, idempotent ───────────── */
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const put = (o, k, v) => { if (k === '__proto__') Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true }); else o[k] = v; return o; };
// canonical JSON (sorted keys): the last tie-break, so every phone picks the same entry
const canon = (x) => Array.isArray(x) ? `[${x.map(canon).join(',')}]`
  : isObj(x) ? `{${Object.keys(x).filter(k => x[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + canon(x[k])).join(',')}}`
  : JSON.stringify(x) ?? 'null';
const cmp = (x, y) => x < y ? -1 : x > y ? 1 : 0;
const tOf = (e) => isObj(e) && typeof e.t === 'number' && isFinite(e.t) ? e.t : -Infinity;
const delOf = (e) => isObj(e) && !!e.del;
// newer t wins; same t: the deletion wins; still tied: the larger canonical JSON
const newest = (x, y) => (cmp(tOf(x), tOf(y)) || cmp(delOf(x), delOf(y)) || cmp(canon(x), canon(y))) < 0 ? y : x;
const num = (x) => typeof x === 'number' && isFinite(x);
// top level: collections merge entry by entry, numbers (v, updated) take the max, anything else the larger canonical JSON
const join = (x, y) => isObj(x) && isObj(y) ? mergeMap(x, y, newest) : num(x) && num(y) ? (y > x ? y : x) : cmp(canon(x), canon(y)) < 0 ? y : x;
// keys keep a's order, then b's new ones: merging in nothing new gives back a JSON-identical copy of a
function mergeMap(a, b, pick) {
  const out = {};
  for (const k of Object.keys(a)) put(out, k, has(b, k) ? pick(a[k], b[k]) : a[k]);
  for (const k of Object.keys(b)) if (!has(a, k)) put(out, k, b[k]);
  return out;
}
export const merge = (a, b) => mergeMap(isObj(a) ? a : {}, isObj(b) ? b : {}, join);
export const emptyMine = () => ({ v: VERSION, updated: 0, ...Object.fromEntries(COLS.map(c => [c, {}])) });
const sameData = (a, b) => canon({ ...a, updated: 0 }) === canon({ ...b, updated: 0 });   // 'updated' alone is no change
const isBlank = (m) => Object.values(m).every(v => !isObj(v) || !Object.keys(v).length);

/* ───────────── errors ───────────── */
class CloudError extends Error {
  constructor(code, message, extra) { super(message); this.name = 'CloudError'; this.code = code; if (extra) Object.assign(this, extra); }
}
const fail = (code, message, extra) => new CloudError(code, message, extra);
const CODES = ['offline', 'auth', 'forbidden', 'rate', 'notfound', 'conflict', 'too_large', 'other'];
export function friendlyCloudError(err) {
  if (err && err.name === 'CloudError' && CODES.includes(err.code)) return { code: err.code, message: err.message };
  if (err && (err.name === 'AbortError' || err.name === 'TimeoutError')) return { code: 'offline', message: 'GitHub did not answer in time. Check the internet and try again.' };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { code: 'offline', message: 'No internet. It syncs when you are back online.' };
  const s = err && typeof err.status === 'number' ? err.status : 0;
  if (s === 401) return { code: 'auth', message: 'GitHub does not accept the token. Paste a new one in Settings → Cloud sync.' };
  if (s === 403 || s === 429) return { code: s === 429 ? 'rate' : 'forbidden', message: s === 429 ? 'GitHub asks to slow down. It tries again in a minute.' : 'The token cannot save to the repository.' };
  if (s === 404) return { code: 'notfound', message: 'The cloud repository was not found.' };
  return { code: 'other', message: 'Cloud sync did not work. Try again in a minute.' };
}

/* ───────────── bytes ───────────── */
const enc = new TextEncoder(), dec = new TextDecoder();
const u8 = (x) => x instanceof Uint8Array ? x : ArrayBuffer.isView(x) ? new Uint8Array(x.buffer, x.byteOffset, x.byteLength) : new Uint8Array(x);
const withFlag = (f, b) => { const o = new Uint8Array(b.length + 1); o[0] = f; o.set(b, 1); return o; };
// chunks of 3 × 8192 bytes: each encodes on its own, no huge argument lists, fine for 20 MB
const b64 = (b) => { const p = []; for (let i = 0; i < b.length; i += 0x6000) p.push(btoa(String.fromCharCode.apply(null, b.subarray(i, i + 0x6000)))); return p.join(''); };
const hex = (b) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
// git blob sha = sha1("blob <size>\0" + bytes): what the contents API wants back as `sha`
async function blobSha(b) {
  const h = enc.encode(`blob ${b.length}\0`), all = new Uint8Array(h.length + b.length);
  all.set(h); all.set(b, h.length);
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-1', all)));
}
const viaStream = (b, ts) => new Response(new Blob([b]).stream().pipeThrough(ts)).arrayBuffer().then(x => new Uint8Array(x));
async function gzip(b) { if (typeof CompressionStream !== 'function') return null; try { return await viaStream(b, new CompressionStream('gzip')); } catch { return null; } }
const gunzip = (b) => typeof DecompressionStream === 'function' ? viaStream(b, new DecompressionStream('gzip')) : inflateGz(b);

// small inflate (RFC 1951/1952) for browsers without DecompressionStream (iOS 15), so they can read what newer phones wrote
const LB = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LX = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DB = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DX = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
function huff(lens) {                                // canonical Huffman: counts per length + symbols in code order
  const count = new Uint16Array(16), offs = new Uint16Array(16), sym = new Uint16Array(lens.length);
  for (const l of lens) count[l]++;
  count[0] = 0;
  for (let i = 1; i < 16; i++) offs[i] = offs[i - 1] + count[i - 1];
  lens.forEach((l, s) => { if (l) sym[offs[l]++] = s; });
  return { count, sym };
}
function inflateGz(src) {
  if (src[0] !== 0x1f || src[1] !== 0x8b || src[2] !== 8) throw new Error('not gzip');
  const flg = src[3]; let pos = 10;
  if (flg & 4) pos += 2 + (src[pos] | src[pos + 1] << 8);
  if (flg & 8) while (src[pos++]);
  if (flg & 16) while (src[pos++]);
  if (flg & 2) pos += 2;
  let out = new Uint8Array(Math.max(1024, src.length * 4)), n = 0, bit = 0, bits = 0;
  const get = (k) => {
    while (bits < k) { if (pos >= src.length) throw new Error('truncated'); bit |= src[pos++] << bits; bits += 8; }
    const v = bit & ((1 << k) - 1); bit >>>= k; bits -= k; return v;
  };
  const room = (k) => { if (n + k > out.length) { const o = new Uint8Array(Math.max(out.length * 2, n + k)); o.set(out.subarray(0, n)); out = o; } };
  const decode = (h) => {
    let code = 0, first = 0, index = 0;
    for (let l = 1; l < 16; l++) {
      code |= get(1); const c = h.count[l];
      if (code - c < first) return h.sym[index + code - first];
      index += c; first = (first + c) << 1; code <<= 1;
    }
    throw new Error('bad code');
  };
  let last;
  do {
    last = get(1); const type = get(2);
    if (type === 0) {
      bit = bits = 0;                                // stored block: skip to the byte boundary
      const len = src[pos] | src[pos + 1] << 8; pos += 4;
      if (pos + len > src.length) throw new Error('truncated');
      room(len); out.set(src.subarray(pos, pos + len), n); n += len; pos += len;
    } else if (type === 1 || type === 2) {
      let lit, dist;
      if (type === 1) {
        const l = []; for (let i = 0; i < 288; i++) l.push(i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8);
        lit = huff(l); dist = huff(new Array(30).fill(5));
      } else {
        const nl = get(5) + 257, nd = get(5) + 1, nc = get(4) + 4, cl = new Array(19).fill(0);
        for (let i = 0; i < nc; i++) cl[CL_ORDER[i]] = get(3);
        const ch = huff(cl), lens = [];
        while (lens.length < nl + nd) {
          const s = decode(ch);
          if (s < 16) { lens.push(s); continue; }
          if (s === 16 && !lens.length) throw new Error('bad lengths');
          const v = s === 16 ? lens[lens.length - 1] : 0, r = s === 16 ? 3 + get(2) : s === 17 ? 3 + get(3) : 11 + get(7);
          for (let i = 0; i < r; i++) lens.push(v);
        }
        if (lens.length > nl + nd) throw new Error('bad lengths');
        lit = huff(lens.slice(0, nl)); dist = huff(lens.slice(nl));
      }
      for (;;) {
        let s = decode(lit);
        if (s < 256) { room(1); out[n++] = s; continue; }
        if (s === 256) break;
        s -= 257; if (s > 28) throw new Error('bad length');
        const len = LB[s] + get(LX[s]), ds = decode(dist);
        if (ds > 29) throw new Error('bad distance');
        const d = DB[ds] + get(DX[ds]);
        if (d > n) throw new Error('bad distance');
        room(len); for (let i = 0; i < len; i++, n++) out[n] = out[n - d];
      }
    } else throw new Error('bad block');
  } while (!last);
  return out.slice(0, n);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ───────────── the cloud ───────────── */
export function createCloud({ owner, repo, branch = 'cloud', seal, open, getToken, fetchImpl = (u, o) => fetch(u, o),
  apiBase = 'https://api.github.com', rawBase = 'https://raw.githubusercontent.com' } = {}) {
  if (!owner || !repo || typeof seal !== 'function' || typeof open !== 'function') throw new Error('createCloud needs owner, repo, seal and open');
  const doFetch = fetchImpl;                         // called unbound: window.fetch needs that
  const api = String(apiBase).replace(/\/+$/, ''), rawRoot = String(rawBase).replace(/\/+$/, '');
  const segs = (p) => String(p).split('/').map(encodeURIComponent).join('/');
  const R = `${api}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const urlOf = (p, ref = true) => `${R}/contents/${segs(p)}${ref ? `?ref=${encodeURIComponent(branch)}` : ''}`;
  const rawUrl = (p) => `${rawRoot}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${segs(branch)}/${segs(p)}`;
  const refUrl = (git) => `${R}/git/${git}/heads/${segs(branch)}`;
  const fileOf = (id) => {
    const s = String(id ?? '');
    if (!/^[\w.-]{1,128}$/.test(s) || /^\.+$/.test(s)) throw fail('other', 'This document has an unusual name and cannot be synced.');
    return `files/${s}.enc`;
  };
  const token = async () => { try { const t = await getToken?.(); return typeof t === 'string' && t.trim() ? t.trim() : null; } catch { return null; } };
  const MSG = {
    noToken: 'Add the GitHub token in Settings → Cloud sync to save to the cloud.',
    badToken: 'GitHub does not accept the token any more (expired, deleted or mistyped). Paste a new one in Settings → Cloud sync.',
    cannotSave: `The token cannot save to ${repo}: on github.com edit the token, select that repository and set Contents to “Read and write”.`,
    cannotSee: `The token cannot see ${repo}: on github.com edit the token and select that repository.`,
    noRepo: `Cannot find the repository ${owner}/${repo}, or the token cannot see it: on github.com check the name and that the token includes it.`,
    noBranch: `The repository ${repo} has no branch “${branch}”: on github.com create it (or add a README to the repository), then try again.`,
    empty: `The repository ${repo} is empty: on github.com open it and add a README file, then try again.`,
    key: 'The cloud copy was saved with a different passphrase, so this phone cannot read it.',
    damaged: 'The cloud copy is damaged and cannot be read.',
    newer: 'The cloud copy was saved by a newer version of the app. Update the app (Settings → Check for updates), then sync.',
    tooLarge: 'This document is too large for cloud sync (over 20 MB). It stays on this phone.',
    conflict: 'Another phone kept saving at the same moment. It tries again shortly.',
    noFile: 'This document is not in the cloud yet. Open the app on the phone that added it, so it can upload it.',
  };

  // one request, body included, inside one timeout; network failures become 'offline'
  async function call(url, { method = 'GET', tok = null, accept = JSON_T, body, timeout = T_REQ } = {}) {
    const headers = {};
    if (accept) headers.Accept = accept;
    if (tok) { headers.Authorization = `Bearer ${tok}`; headers['X-GitHub-Api-Version'] = API_VERSION; }
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timeout);
    try {
      const r = await doFetch(url, { method, headers, body, cache: 'no-store', signal: ctl.signal });
      const b = method === 'HEAD' ? new Uint8Array(0) : new Uint8Array(await r.arrayBuffer());
      return { status: r.status, ok: r.ok, headers: r.headers, body: b };
    } catch (e) {
      throw fail('offline', ctl.signal.aborted ? 'GitHub did not answer in time. Check the internet and try again.' : 'No connection to GitHub. It syncs when you are back online.');
    } finally { clearTimeout(timer); }
  }
  const jsonOf = (r) => { try { return JSON.parse(dec.decode(r.body)); } catch { return null; } };
  const ghMsg = (r) => String(jsonOf(r)?.message || '');
  const isRate = (r) => r.status === 429 || (r.status === 403 && (r.headers.get('x-ratelimit-remaining') === '0' || /rate limit/i.test(ghMsg(r))));
  const NO_REF = /no commit found for the ref|branch .*not found|reference does not exist/i, EMPTY = /repository is empty/i;
  function fromRes(r) {
    const s = r.status, m = ghMsg(r), x = { status: s };
    if (isRate(r)) {
      const wait = +r.headers.get('retry-after') || Math.max(0, (+r.headers.get('x-ratelimit-reset') || 0) - Date.now() / 1000);
      return fail('rate', `GitHub asks to slow down (too many requests from this network). It tries again ${wait > 90 ? `in about ${Math.ceil(wait / 60)} min` : 'in a minute'}.`, { ...x, retryAfter: Math.ceil(wait) });
    }
    if (s === 401) return fail('auth', MSG.badToken, x);
    if (s === 403) return fail('forbidden', MSG.cannotSave, x);
    if (NO_REF.test(m)) return fail('notfound', MSG.noBranch, x);
    if (EMPTY.test(m)) return fail('notfound', MSG.empty, x);
    if (s === 404) return fail('notfound', MSG.noRepo, { ...x, missing: true });
    if (s === 413 || (s === 422 && /too large|too big|exceed/i.test(m))) return fail('too_large', MSG.tooLarge, x);
    if (s === 409 || s === 422) return fail('conflict', MSG.conflict, x);
    return fail('other', `GitHub answered ${s}. Try again in a minute.`, x);
  }

  // GET bytes: { bytes|null, anon, stale }. A dead token reads anonymously (public repo); rate limits fall back to raw.
  // The contents API re-encodes files it takes for text (a sealed file can look like UTF-16), so the bytes come from the
  // git blob of the file's sha, which is always exact, and are checked against the file's size.
  async function read(path, { fresh = false, timeout = T_REQ } = {}) {
    let tok = await token(), r = await call(urlOf(path), { tok, accept: OBJ_T });
    if (tok && r.status === 401 && !fresh) { tok = null; r = await call(urlOf(path), { accept: OBJ_T }); }
    if (r.status === 404 && !NO_REF.test(ghMsg(r)) && !EMPTY.test(ghMsg(r))) return { bytes: null, anon: !tok };
    const raw = async () => {                        // raw.githubusercontent.com: exact bytes, may be a few minutes old
      const w = await call(rawUrl(path), { accept: null, timeout });
      if (w.status === 404) return { bytes: null, anon: true, stale: true };
      if (!w.ok) throw fromRes(w);
      return { bytes: w.body, anon: true, stale: true };
    };
    if (!fresh && isRate(r)) return raw();
    if (!r.ok) throw fromRes(r);
    const meta = jsonOf(r) || {};
    if (!meta.sha) throw fail('other', 'GitHub answered strangely. Try again in a minute.');
    let b = await call(`${R}/git/blobs/${meta.sha}`, { tok, accept: 'application/vnd.github.raw', timeout });
    if (!fresh && isRate(b)) return raw();
    if (!b.ok) throw fromRes(b);
    if (typeof meta.size === 'number' && b.body.length !== meta.size) {   // a proxy changed it after all: the JSON form is base64
      const j = await call(`${R}/git/blobs/${meta.sha}`, { tok, accept: JSON_T, timeout });
      if (!j.ok) throw fromRes(j);
      const c = String(jsonOf(j)?.content || '').replace(/\s+/g, '');
      b = { body: Uint8Array.from(atob(c), ch => ch.charCodeAt(0)) };
      if (b.body.length !== meta.size) throw fail('other', MSG.damaged, { reason: 'damaged' });
    }
    return { bytes: b.body, anon: !tok };
  }
  // HEAD: blob sha (ETag), '' when it exists but the ETag is not a sha, null when missing
  async function head(path) {
    const r = await call(urlOf(path), { method: 'HEAD', tok: await token(), accept: RAW_T });
    if (r.status === 404) return null;
    if (!r.ok) throw fromRes(r);
    const e = (r.headers.get('etag') || '').replace(/^W\//, '').replace(/"/g, '');
    return /^[0-9a-f]{40}$/.test(e) ? e : '';
  }
  async function shaJson(path) {
    const r = await call(urlOf(path), { tok: await token(), accept: OBJ_T });
    if (r.status === 404) return null;
    if (!r.ok) throw fromRes(r);
    return jsonOf(r)?.sha || null;
  }
  async function openBytes(b) { try { return u8(await open(b)); } catch { throw fail('other', MSG.key, { reason: 'key' }); } }
  async function decodeMine(sealed) {
    const p = await openBytes(sealed);
    let m = null;
    try { m = JSON.parse(dec.decode(p[0] === F_GZIP ? await gunzip(p.subarray(1)) : p[0] === F_JSON ? p.subarray(1) : p)); } catch {}
    if (!isObj(m)) throw fail('other', MSG.damaged, { reason: 'damaged' });
    if (+m.v > VERSION) throw fail('other', MSG.newer, { reason: 'newer' });
    const out = { ...emptyMine(), ...m };
    for (const c of COLS) if (!isObj(out[c])) out[c] = {};
    return out;
  }
  async function encodeMine(m) {
    const json = enc.encode(JSON.stringify(m)), gz = await gzip(json);
    return u8(await seal(gz ? withFlag(F_GZIP, gz) : withFlag(F_JSON, json)));
  }

  // writes: one at a time, at least GAP ms apart
  let queue = Promise.resolve(), lastWrite = 0;
  const serial = (fn) => { const run = queue.then(() => fn()); queue = run.catch(() => {}); return run; };
  async function write(url, method, payload, timeout = T_REQ) {
    const tok = await token();
    if (!tok) throw fail('auth', MSG.noToken, { reason: 'no_token' });
    const wait = lastWrite + GAP - Date.now();
    if (wait > 0) await sleep(wait);
    try {
      const r = await call(url, { method, tok, body: JSON.stringify(payload), timeout });
      if (!r.ok) throw fromRes(r);
      return jsonOf(r) || {};
    } finally { lastWrite = Date.now(); }
  }
  const putBytes = (path, bytes, sha, message) =>
    write(urlOf(path, false), 'PUT', { message, content: b64(bytes), branch, ...(sha ? { sha } : {}) }, T_REQ + Math.ceil(bytes.length / 65536) * 1000);
  const needToken = async () => { if (!(await token())) throw fail('auth', MSG.noToken, { reason: 'no_token' }); };
  const backoff = () => sleep(250 + Math.random() * 750);

  return {
    // what is in the cloud now: { data: mine|null, sha, readOnly } (+ stale when it came from the raw fallback)
    async pull() {
      const got = await read(MINE);
      if (!got.bytes) return { data: null, sha: null, readOnly: got.anon, ...(got.stale ? { stale: true } : {}) };
      const data = await decodeMine(got.bytes);
      return { data, sha: got.stale ? null : await blobSha(got.bytes), readOnly: got.anon, ...(got.stale ? { stale: true } : {}) };
    },
    // pull, merge, put; on a sha conflict pull and merge again. No commit when the cloud already has everything
    async push(local) {
      await needToken();
      return serial(async () => {
        for (let i = 0; ; i++) {
          const got = await read(MINE, { fresh: true });
          const remote = got.bytes ? await decodeMine(got.bytes) : null, sha = got.bytes ? await blobSha(got.bytes) : null;
          const next = merge(remote || emptyMine(), local);
          if (remote ? sameData(next, remote) : isBlank(next)) return { data: remote, sha };
          try {
            const r = await putBytes(MINE, await encodeMine(next), sha, 'sync');
            return { data: next, sha: r.content?.sha || null };
          } catch (e) {
            if (e.code !== 'conflict' || i >= RETRIES) throw e;
            await backoff();
          }
        }
      });
    },
    // seal + upload files/<id>.enc once (an existing file is left alone)
    async putFile(id, bytes) {
      const path = fileOf(id), b = u8(bytes);
      if (b.length > MAX_FILE) throw fail('too_large', MSG.tooLarge);
      await needToken();
      return serial(async () => {
        if (await head(path) !== null) return;
        const sealed = u8(await seal(b));
        try { await putBytes(path, sealed, null, 'file'); }
        catch (e) { if (!(e.code === 'conflict' && await head(path) !== null)) throw e; }   // another phone just uploaded it
      });
    },
    async getFile(id) {
      const got = await read(fileOf(id), { timeout: T_FILE });
      if (!got.bytes) throw fail('notfound', MSG.noFile, { reason: 'no_file' });
      return openBytes(got.bytes);
    },
    async deleteFile(id) {
      const path = fileOf(id);
      await needToken();
      return serial(async () => {
        for (let i = 0; ; i++) {
          const h = i ? await shaJson(path) : await head(path), sha = h === '' ? await shaJson(path) : h;
          if (!sha) return;
          try { await write(urlOf(path, false), 'DELETE', { message: 'file', sha, branch }); return; }
          catch (e) {
            if (e.missing) return;                   // already gone
            if (e.code !== 'conflict' || i >= RETRIES) throw e;
            await backoff();
          }
        }
      });
    },
    // token works, repository visible, branch there, token may write: { ok, canWrite, user?, message? }
    async check() {
      const tok = await token();
      if (!tok) return { ok: false, canWrite: false, message: 'Paste a GitHub token first.' };
      let r = await call(`${api}/user`, { tok });
      if (r.status === 401) return { ok: false, canWrite: false, message: 'GitHub does not accept this token: it may be mistyped, expired or deleted. Copy it again from github.com.' };
      if (!r.ok) throw fromRes(r);
      const user = jsonOf(r)?.login || undefined;
      r = await call(R, { tok });
      if (r.status === 404) return { ok: false, canWrite: false, user, message: MSG.cannotSee };
      if (!r.ok) throw fromRes(r);
      r = await call(refUrl('ref'), { tok });
      if (r.status === 409 || EMPTY.test(ghMsg(r))) return { ok: false, canWrite: false, user, message: MSG.empty };
      if (r.status === 404) return { ok: false, canWrite: false, user, message: MSG.noBranch };
      if (!r.ok) throw fromRes(r);
      const at = jsonOf(r)?.object?.sha;
      if (!at) throw fail('other', 'GitHub answered strangely. Try again in a minute.');
      // write test without a commit: move the branch to where it already is (422 = it just moved on: also allowed)
      r = await serial(async () => {
        const wait = lastWrite + GAP - Date.now();
        if (wait > 0) await sleep(wait);
        try { return await call(refUrl('refs'), { method: 'PATCH', tok, body: JSON.stringify({ sha: at, force: false }) }); }
        finally { lastWrite = Date.now(); }
      });
      if (r.ok || r.status === 422) return { ok: true, canWrite: true, user };
      if ((r.status === 403 || r.status === 404) && !isRate(r)) return { ok: true, canWrite: false, user, message: MSG.cannotSave };
      throw fromRes(r);
    },
  };
}
