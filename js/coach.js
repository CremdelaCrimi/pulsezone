// Voice coach (v57). From the VR fitness research (Supernatural, Les Mills, FitXR, Litesport):
// a voice is the strongest "someone is with me" signal a workout has, and our playtester's
// top quit reason after setup friction was "no coach voice or music identity". This uses the
// browser's own speech (Web Speech API) so it costs no audio files: short lines, tied to what the
// heart rate is doing, never talking over itself. If the browser has no voices, it stays silent.

const PHRASES = {
  zoneIn: ['In the zone. Hold this pace.', 'That\'s it, you\'re in. Keep it smooth.', 'Locked in. Stay right there.'],
  below: ['Heart rate\'s dropping. Pick it up.', 'Bring it back up. Bigger moves.', 'Push a little harder.'],
  above: ['Ease off. Let it settle.', 'Lighter now. Breathe.', 'Back it down a touch.'],
  climbing: ['Heart rate\'s climbing. Keep going.', 'It\'s rising. Hold this.'],
  charge: ['Charge! Thirty seconds, all out.', 'Everything you\'ve got. Thirty seconds.'],
  coast: ['Coast. Light moves, let it rise.', 'Ease off and let your heart catch up.'],
  landingPerfect: ['Perfect landing. Right in the zone.', 'Nailed it. Right where we wanted.'],
  landingNearly: ['Nearly. Just outside the zone.'],
  landingOver: ['Overshot. Breathe it back down.'],
  landingShort: ['Short. Next charge, push harder.'],
  streak30: ['Thirty seconds in the zone. Keep it rolling.'],
  streak60: ['One full minute in the zone. Beautiful.'],
  streak120: ['Two minutes in the zone. That\'s the workout.'],
  heavy: ['Heavy hit!', 'Big one!', 'That\'s power.'],
  pose: ['Hold the shape.', 'Hold it... hold it.'],
  finale: ['Last act. Empty the tank.'],
  last30: ['Thirty seconds left. Finish strong.'],
  coolDown: ['Cool-down. Slow reaches overhead, and breathe. Four in, six out.', 'Easy now. Reach up slow, breathe out long.'],
  recovery: ['Keep breathing. Let the heart rate come down.'],
  finish: ['Workout done. Great work.', 'That\'s the session. Nice work today.'],
  warmUp: ['Warm-up. Easy punches, get the blood moving.'],
  training: ['Training starts now. Let\'s climb to your zone.'],
};
const GAP = { 1: 1.0, 2: 3.5, 3: 6 }; // seconds between lines by tier (1 = do this now, 2 = news, 3 = praise)

export class VoiceCoach {
  constructor() {
    this.ok = typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
    this.enabled = true;
    this.lastAt = -99; this.lastTier = 3;
    this.voice = null;
    this.lastIdx = {};
    this.spoken = 0;
    if (this.ok) {
      this.pickVoice();
      try { window.speechSynthesis.addEventListener('voiceschanged', () => this.pickVoice()); } catch { /* ignore */ }
    }
  }
  get available() { return this.ok && !!(this.voice || this.voices().length); }
  voices() { try { return window.speechSynthesis.getVoices() || []; } catch { return []; } }
  pickVoice() {
    const all = this.voices().filter((v) => /^en/i.test(v.lang));
    const score = (v) => (v.localService ? 2 : 0) + (/female|zira|samantha|karen|moira|google uk english female|libby|sonia/i.test(v.name) ? 3 : 0) + (/en-(gb|us|au)/i.test(v.lang) ? 1 : 0);
    this.voice = all.sort((a, b) => score(b) - score(a))[0] || null;
  }
  /** Call from a user gesture once: some browsers only allow speech after one. */
  warm() { if (this.ok && !this.warmed) { this.warmed = true; try { window.speechSynthesis.cancel(); } catch { /* ignore */ } } }
  setEnabled(on) { this.enabled = !!on; if (!on) this.stop(); }
  stop() { if (this.ok) try { window.speechSynthesis.cancel(); } catch { /* ignore */ } }

  /** Say one of the phrases for a key (never the same one twice in a row). */
  line(key, tier = 2) {
    const list = PHRASES[key];
    if (!list) return false;
    let i = Math.floor(Math.random() * list.length);
    if (list.length > 1 && i === this.lastIdx[key]) i = (i + 1) % list.length;
    this.lastIdx[key] = i;
    return this.say(list[i], tier);
  }

  /** Speak text (tier 1 may interrupt; lower tiers wait their turn and are dropped if too soon). */
  say(text, tier = 2, now = performance.now() / 1000) {
    if (!this.ok || !this.enabled || !text) return false;
    const clean = String(text).replace(/\s*·\s*/g, ', ').replace(/->/g, ' to ').replace(/\bx(\d)\b/g, 'times $1').replace(/[+]\d+/g, '').replace(/\s+/g, ' ').trim();
    if (!clean || clean.length > 90) return false;
    const speaking = window.speechSynthesis.speaking;
    if (now - this.lastAt < GAP[tier] && !(tier === 1 && tier < this.lastTier)) return false;
    if (speaking) { if (tier === 1) this.stop(); else return false; }
    try {
      const u = new SpeechSynthesisUtterance(clean);
      if (this.voice) u.voice = this.voice;
      u.rate = 1.06; u.pitch = 1.0; u.volume = 1;
      window.speechSynthesis.speak(u);
    } catch { return false; }
    this.lastAt = now; this.lastTier = tier; this.spoken++;
    return true;
  }
}
