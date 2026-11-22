// Voice coach (v57, clips in v58). From the VR fitness research (Supernatural, Les Mills, FitXR,
// Litesport): a voice is the strongest "someone is with me" signal a workout has.
// v58: the Quest browser has no speech voices, so every line is also a pre-rendered clip in
// assets/voice (tools/make-voice.ps1) played through the game's own Web Audio. Browser speech is
// only the fallback for text with no clip (lines built from numbers or names). Never talks over
// itself; tier 1 (do this now) may interrupt.
// Voice packs (v59): a second clip bank (assets/voice-eleven, ElevenLabs placeholder takes) layered
// over the Windows one. A line the pack doesn't have plays from the Windows bank, so a pack can be
// partial. Board: Sound row -> voice name.
import { PHRASES, CUES, cueId, PRELOAD } from './coach-lines.js?v63';

const GAP = { 1: 1.0, 2: 3.5, 3: 6 }; // seconds between lines by tier (1 = do this now, 2 = news, 3 = praise)
const CUE_SET = new Set(CUES);
const hasWindow = typeof window !== 'undefined';
/** Clip banks. 'zira' is the full Windows bank (the base); others sit on top of it. */
export const VOICE_PACKS = Object.freeze({
  zira: Object.freeze({ dir: 'assets/voice/', label: 'Zira' }),
  eleven: Object.freeze({ dir: 'assets/voice-eleven/', label: 'Jerry' }), // ElevenLabs placeholder takes (2026-11-19)
});

export class VoiceCoach {
  constructor() {
    this.speechOk = hasWindow && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
    this.enabled = true;
    this.lastAt = -99; this.lastTier = 3;
    this.voice = null;
    this.lastIdx = {};
    this.spoken = 0;
    this.ctx = null; this.dest = null;
    this.manifest = null; this.base = 'assets/voice/';
    this.buffers = new Map(); // clip URL -> AudioBuffer | Promise (loading) | null (failed)
    this.pack = 'zira'; this.overlay = null; this.packToken = 0; // the chosen voice pack's manifest, over the base bank
    this.playing = null;      // the clip's source node, so tier 1 can cut it off
    this.playingUntil = 0;
    this.onSpeak = null;      // callback(seconds): the game ducks the music under the coach
    if (this.speechOk) {
      this.pickVoice();
      try { window.speechSynthesis.addEventListener('voiceschanged', () => this.pickVoice()); } catch { /* ignore */ }
    }
  }

  get mode() { return this.manifest && this.ctx ? 'clips' : this.speechAvailable ? 'speech' : 'none'; }
  get available() { return this.mode !== 'none' || !!this.manifest; }
  get speechAvailable() { return this.speechOk && !!(this.voice || this.voices().length); }
  voices() { try { return window.speechSynthesis.getVoices() || []; } catch { return []; } }
  pickVoice() {
    const all = this.voices().filter((v) => /^en/i.test(v.lang));
    const score = (v) => (v.localService ? 2 : 0) + (/female|zira|samantha|karen|moira|google uk english female|libby|sonia/i.test(v.name) ? 3 : 0) + (/en-(gb|us|au)/i.test(v.lang) ? 1 : 0);
    this.voice = all.sort((a, b) => score(b) - score(a))[0] || null;
  }

  /** Where clips play: the game's audio context and an output node (after a user gesture). */
  attach(ctx, destination) {
    this.ctx = ctx; this.dest = destination;
    this.preload();
  }
  /** Fetch the clip list. Fails silently (offline, missing): the coach falls back to speech. */
  async load(base = 'assets/voice/') {
    this.base = base;
    try {
      const r = await fetch(`${base}manifest.json`);
      if (!r.ok) return false;
      const m = await r.json();
      this.manifest = m && m.clips ? m : null;
      this.preload();
      return !!this.manifest;
    } catch { return false; }
  }
  /** Pick a voice pack (falls back to the base bank line by line). Resolves true once its clip list loaded. */
  async setPack(name) {
    const key = VOICE_PACKS[name] ? name : 'zira';
    const token = ++this.packToken;
    this.pack = key; this.overlay = null;
    if (key === 'zira') { this.preload(); return true; }
    try {
      const dir = VOICE_PACKS[key].dir;
      const r = await fetch(`${dir}manifest.json`);
      const m = r.ok ? await r.json() : null;
      if (token !== this.packToken) return false; // switched again meanwhile
      this.overlay = m && m.clips ? { dir, clips: m.clips } : null;
      this.preload();
      return !!this.overlay;
    } catch { return false; }
  }
  get packLabel() { return VOICE_PACKS[this.pack].label; }
  /** Where a clip lives: the chosen pack if it has it, else the base bank. */
  urlFor(id) {
    const o = this.overlay?.clips[id];
    if (o) return this.overlay.dir + o.file;
    const c = this.manifest?.clips[id];
    return c ? this.base + c.file : null;
  }
  preload() {
    if (!this.manifest || !this.ctx) return;
    for (const k of PRELOAD.keys) for (let i = 0; this.manifest.clips[`${k}.${i}`]; i++) this.fetchClip(`${k}.${i}`);
    for (const c of PRELOAD.cues) this.fetchClip(cueId(c));
  }
  fetchClip(id) {
    const url = this.urlFor(id);
    if (!url || !this.ctx) return null;
    if (this.buffers.has(url)) return this.buffers.get(url);
    const p = fetch(url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))))
      .then((b) => new Promise((res, rej) => { const q = this.ctx.decodeAudioData(b, res, rej); if (q && q.then) q.then(res, rej); }))
      .then((buf) => { this.buffers.set(url, buf); return buf; })
      .catch(() => { this.buffers.set(url, null); return null; });
    this.buffers.set(url, p);
    return p;
  }

  /** Call from a user gesture once: some browsers only allow speech after one. */
  warm() { if (this.speechOk && !this.warmed) { this.warmed = true; try { window.speechSynthesis.cancel(); } catch { /* ignore */ } } }
  setEnabled(on) { this.enabled = !!on; if (!on) this.stop(); }
  stop() {
    if (this.playing) { try { this.playing.stop(); } catch { /* already ended */ } this.playing = null; }
    this.playingUntil = 0;
    if (this.speechOk) try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
  }
  busy(now) { return now < this.playingUntil || (this.speechOk && window.speechSynthesis.speaking); }

  /** Say one of the phrases for a key (never the same one twice in a row). */
  line(key, tier = 2, now = performance.now() / 1000) {
    const list = PHRASES[key];
    if (!list) return false;
    let i = Math.floor(Math.random() * list.length);
    if (list.length > 1 && i === this.lastIdx[key]) i = (i + 1) % list.length;
    this.lastIdx[key] = i;
    return this.speak(`${key}.${i}`, list[i], tier, now);
  }

  /** Speak a call-out: its clip when it's a known cue, otherwise browser speech. */
  say(text, tier = 2, now = performance.now() / 1000) {
    if (!text) return false;
    const t = String(text).trim();
    return this.speak(CUE_SET.has(t) ? cueId(t) : null, t, tier, now);
  }

  speak(id, text, tier, now) {
    if (!this.enabled) return false;
    if (now - this.lastAt < GAP[tier] && !(tier === 1 && tier < this.lastTier)) return false;
    if (this.busy(now)) { if (tier === 1) this.stop(); else return false; }
    const url = id && this.urlFor(id);
    if (url && this.ctx) {
      const buf = this.buffers.get(url);
      // Not decoded yet: start loading and skip this one. A cue a second late is worse than none.
      if (!(buf && typeof buf.duration === 'number')) { if (buf === undefined) this.fetchClip(id); return false; }
      try {
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        src.connect(this.dest || this.ctx.destination);
        src.start();
        src.onended = () => { if (this.playing === src) { this.playing = null; this.playingUntil = 0; } };
        this.playing = src; this.playingUntil = now + buf.duration;
      } catch { return false; }
      return this.done(now, tier, buf.duration);
    }
    if (!this.speechAvailable) return false;
    const clean = text.replace(/\s*·\s*/g, ', ').replace(/->/g, ' to ').replace(/\bx(\d)\b/g, 'times $1').replace(/[+]\d+/g, '').replace(/\s+/g, ' ').trim();
    if (!clean || clean.length > 90) return false;
    try {
      const u = new SpeechSynthesisUtterance(clean);
      if (this.voice) u.voice = this.voice;
      u.rate = 1.06; u.pitch = 1.0; u.volume = 1;
      window.speechSynthesis.speak(u);
    } catch { return false; }
    return this.done(now, tier, clean.length / 14);
  }
  done(now, tier, seconds) {
    this.lastAt = now; this.lastTier = tier; this.spoken++;
    try { this.onSpeak?.(seconds); } catch { /* ignore */ }
    return true;
  }
}
