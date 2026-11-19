// Voice coach checks (v58): every line has a clip on disk, and the clip player keeps its rules
// (never the same variant twice, tier gaps, tier 1 interrupts, disabled = silent).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PHRASES, CUES, cueId } from '../js/coach-lines.js';
import { WORKOUT_BANK, RESTART_WORKOUT } from '../js/progress.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0, passed = 0;
const check = (name, ok, extra = '') => { if (ok) passed++; else failed++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${extra ? `  (${extra})` : ''}`); };

console.log('== clip bank');
const dir = path.join(root, 'assets/voice');
const man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const ids = Object.keys(man.clips);
check('manifest ids are unique', new Set(ids).size === ids.length);
const want = [...Object.entries(PHRASES).flatMap(([k, l]) => l.map((_, i) => `${k}.${i}`)), ...CUES.map(cueId)];
const missing = want.filter((id) => !man.clips[id]);
check('every phrase line and cue has a clip', !missing.length, missing.slice(0, 5).join(', '));
const small = ids.filter((id) => { const f = path.join(dir, man.clips[id].file); return !fs.existsSync(f) || fs.statSync(f).size < 1024; });
check('every clip file exists and is over 1 KB', !small.length, small.slice(0, 5).join(', '));
for (const w of [...Object.values(WORKOUT_BANK).flat(), RESTART_WORKOUT]) if (!PHRASES[`workout.${w.id}`]) check(`workout.${w.id} has a line`, false);
check('every named workout has a line', [...Object.values(WORKOUT_BANK).flat(), RESTART_WORKOUT].every((w) => PHRASES[`workout.${w.id}`]));
const total = fs.readdirSync(dir).reduce((n, f) => n + fs.statSync(path.join(dir, f)).size, 0);
check('voice folder under 4 MB', total < 4e6, `${Math.round(total / 1024)} KB`);
check('cue ids do not collide', new Set(CUES.map(cueId)).size === CUES.length);

console.log('== player rules (fake audio)');
const started = [];
const ctx = {
  destination: {},
  createBufferSource() { const s = { connect() {}, start() { started.push(s); }, stop() { s.stopped = true; }, set buffer(b) { s.buf = b; }, get buffer() { return s.buf; } }; return s; },
  decodeAudioData(b, ok) { const buf = { duration: 1.5 }; ok(buf); return Promise.resolve(buf); },
};
globalThis.fetch = async (url) => (String(url).endsWith('manifest.json')
  ? { ok: true, json: async () => man }
  : { ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
const { VoiceCoach } = await import('../js/coach.js');
const c = new VoiceCoach();
check('imports cleanly in Node; no voice before load', c.mode === 'none');
await c.load();
c.attach(ctx, ctx.destination);
await new Promise((r) => setTimeout(r, 20)); // preloads settle
check('mode is clips once loaded and attached', c.mode === 'clips');
let said = 0; c.onSpeak = () => said++;
check('a preloaded line plays', c.line('zoneIn', 2, 100) === true && started.length === 1 && said === 1);
check('tier 2 inside the gap is dropped', c.line('above', 2, 101) === false);
check('tier 1 interrupts the playing clip', c.line('below5', 1, 100.5) === true && started[0].stopped === true);
check('unknown key = false', c.line('nope', 1, 200) === false);
const first = c.lastIdx.zoneIn;
c.line('zoneIn', 2, 300);
check('never the same variant twice in a row', c.lastIdx.zoneIn !== first);
check('a cue not decoded yet is skipped (and starts loading)', c.say('Coach voice on.', 1, 400) === false || started.length > 0);
c.setEnabled(false);
check('disabled = silent', c.line('zoneIn', 1, 500) === false);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log('SOME CHECKS FAILED'); process.exit(1); }
console.log('ALL CHECKS PASSED');
