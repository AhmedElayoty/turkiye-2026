/* Voice: record a voice note in the browser (iPhone home-screen app included), turn it into a small WAV for the AI,
   and read answers aloud. No dependencies, no network: the transcription itself is done by ai.js. */

export const canRecord = () => !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
const pickType = () => ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find(t => MediaRecorder.isTypeSupported?.(t)) || '';

// start() asks for the microphone; the handle's stop() resolves the recording, cancel() throws it away
export async function startRecording({ maxMs = 120000, onTick } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const type = pickType();
  const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const chunks = []; const t0 = Date.now();
  rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
  const done = new Promise((res) => { rec.onstop = () => res(); });
  const release = () => stream.getTracks().forEach(t => t.stop());
  const tick = setInterval(() => { const ms = Date.now() - t0; onTick?.(ms); if (ms >= maxMs && rec.state === 'recording') rec.stop(); }, 250);
  rec.start(1000);
  let cancelled = false;
  return {
    async stop() {
      if (rec.state === 'recording') rec.stop();
      await done; clearInterval(tick); release();
      if (cancelled) return null;
      const blob = new Blob(chunks, { type: rec.mimeType || type || 'audio/mp4' });
      return { blob, mime: blob.type, ms: Date.now() - t0 };
    },
    cancel() { cancelled = true; if (rec.state === 'recording') rec.stop(); clearInterval(tick); release(); },
  };
}

// 16 kHz mono 16-bit WAV: every AI accepts it and a minute is under 2 MB. Undecodable audio comes back unchanged.
export async function toWav(blob) {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ac = new AC(), ab = await blob.arrayBuffer();
    const buf = await new Promise((res, rej) => ac.decodeAudioData(ab, res, rej));   // callback form: older Safari has no promise
    ac.close?.();
    const rate = 16000, len = Math.max(1, Math.ceil(buf.duration * rate));
    const off = new OfflineAudioContext(1, len, rate);
    const src = off.createBufferSource(); src.buffer = buf; src.connect(off.destination); src.start();
    const pcm = (await off.startRendering()).getChannelData(0);
    const out = new DataView(new ArrayBuffer(44 + pcm.length * 2));
    const str = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); out.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
    out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true); out.setUint32(24, rate, true);
    out.setUint32(28, rate * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true); str(36, 'data'); out.setUint32(40, pcm.length * 2, true);
    for (let i = 0; i < pcm.length; i++) { const v = Math.max(-1, Math.min(1, pcm[i])); out.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true); }
    return { bytes: new Uint8Array(out.buffer), mime: 'audio/wav', seconds: buf.duration };
  } catch {
    return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type || 'audio/mp4', seconds: null };
  }
}

/* reading answers aloud: Arabic text gets an Arabic voice, everything else English */
const plain = (s) => String(s || '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*_`#>|]/g, ' ').replace(/\s+/g, ' ').trim();
export const canSpeak = () => 'speechSynthesis' in window;
export function speak(text, { onEnd } = {}) {
  if (!canSpeak()) return false;
  const t = plain(text).slice(0, 4000); if (!t) return false;
  speechSynthesis.cancel();
  const ar = /[؀-ۿ]/.test(t), u = new SpeechSynthesisUtterance(t);
  u.lang = ar ? 'ar-SA' : 'en-GB';
  const v = speechSynthesis.getVoices().find(x => x.lang?.toLowerCase().startsWith(ar ? 'ar' : 'en-gb')) || speechSynthesis.getVoices().find(x => x.lang?.toLowerCase().startsWith(ar ? 'ar' : 'en'));
  if (v) u.voice = v;
  u.rate = ar ? 0.95 : 1; u.onend = u.onerror = () => onEnd?.();
  speechSynthesis.speak(u); return true;
}
export const stopSpeaking = () => { try { speechSynthesis.cancel(); } catch {} };
export const speaking = () => canSpeak() && speechSynthesis.speaking;
