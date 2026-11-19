// Cuts the ElevenLabs takes into coach clips by an explicit piece -> line map (2026-11-19, placeholder voice).
//   node tools/voice-cut.cjs <work dir with take1.wav, take2.wav and their .segs.json> <out dir>
// Writes <out>/<id>.wav, done.json (id -> ms) and jobs.txt for tools/voice-transcode.ps1 (WAV -> MP3).
// The map was worked out from Windows speech recognition anchors (System.Speech, the lines as a grammar) plus line
// lengths: take 1 has "Overshot." / "Short." split and two pieces holding two lines each; take 2 splits two lines at
// their dash. Lines that couldn't be placed for certain are left out and play from the Windows bank.
const fs = require('fs');
const path = require('path');
const ch = JSON.parse(fs.readFileSync(path.join(__dirname, '../../voice-takes/chunks.json'), 'utf8'));
const work = process.argv[2];
const range = (a, b, off) => Array.from({ length: b - a + 1 }, (_, i) => [a + i, a + i, a + i + off]);
const MAP = [
  // take 1: [firstSeg, lastSeg, lineIndex]; lines with no entry stay on the Windows voice
  [...range(0, 17, 0), [18, 19, 18], ...range(20, 64, -1), ...range(66, 73, 0), [75, 75, 76], [76, 76, 77], [77, 77, 78], [78, 79, 79], [80, 80, 80], [81, 81, 81]],
  // take 2: lines 65-71 (rope + step cues) are ambiguous and skipped; 72 (step left) skipped to keep the step cues in one voice
  [...range(0, 64, 0), [74, 75, 73], [76, 76, 74], [77, 77, 75], [78, 78, 76]],
];
const out = process.argv[3]; fs.mkdirSync(out, { recursive: true });
function readWav(f) {
  const b = fs.readFileSync(f); let o = 12, fmt, data;
  while (o < b.length) { const id = b.toString('ascii', o, o + 4), sz = b.readUInt32LE(o + 4);
    if (id === 'fmt ') fmt = { ch: b.readUInt16LE(o + 10), rate: b.readUInt32LE(o + 12) };
    if (id === 'data') { data = b.subarray(o + 8, o + 8 + sz); break; } o += 8 + sz + (sz & 1); }
  const n = data.length / 2 / fmt.ch, x = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let c = 0; c < fmt.ch; c++) s += data.readInt16LE((i * fmt.ch + c) * 2); x[i] = s / fmt.ch / 32768; }
  return { rate: fmt.rate, x };
}
function writeWav(f, x, rate) {
  const b = Buffer.alloc(44 + x.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + x.length * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))), 44 + i * 2);
  fs.writeFileSync(f, b);
}
const done = {}, jobs = [];
for (const k of [0, 1]) {
  const { rate, x } = readWav(`${work}/take${k + 1}.wav`), segs = JSON.parse(fs.readFileSync(`${work}/take${k + 1}.wav.segs.json`)), fr = rate / 100;
  const lead = Math.round(rate * 0.04), tail = Math.round(rate * 0.12), fade = Math.round(rate * 0.01);
  for (const [a, b, li] of MAP[k]) {
    const id = ch[k][li]; if (!id) throw new Error(`no line ${li} in take ${k + 1}`);
    const i0 = Math.max(0, segs[a][0] * fr - lead), i1 = Math.min(x.length, segs[b][1] * fr + tail);
    const y = x.slice(i0, i1); let pk = 0; for (const v of y) pk = Math.max(pk, Math.abs(v));
    const g = 0.89 / pk; for (let i = 0; i < y.length; i++) y[i] *= g * Math.min(1, i / fade, (y.length - 1 - i) / fade);
    writeWav(`${out}/${id}.wav`, y, rate); done[id] = Math.round(y.length / rate * 1000);
    jobs.push(require("path").win32.normalize(out+"/"+id+".wav")+String.fromCharCode(9)+require("path").win32.normalize(out+"/"+id+".mp3"));
  }
}
fs.writeFileSync(`${out}/done.json`, JSON.stringify(done, null, 1));
fs.writeFileSync(`${out}/jobs.txt`, jobs.join('\r\n'));
const all = ch.flat(); console.log('clips', Object.keys(done).length, 'of', all.length, '| skipped:', all.filter((i) => !done[i]).join(', '));
