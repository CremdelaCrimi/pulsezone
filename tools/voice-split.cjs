// Finds the spoken lines in a long voice take (WAV from tools/voice-transcode.ps1) by its pauses.
//   node tools/voice-split.cjs take1.wav              -> take1.wav.segs.json (10 ms frames: [start, end] per piece)
//   node tools/voice-split.cjs take1.wav out - 0      -> also out/seg-000.wav ... (to listen, or to check with a recognizer)
// Env: TH (dB, default -50), GAP (frames of 10 ms, default 90 = 0.9 s). A count that matches the line list can still hide
// a merged line plus a split one (it did in take 1), so check pieces before trusting the count: see tools/voice-cut.cjs.
const fs = require('fs');
function readWav(f) {
  const b = fs.readFileSync(f); let o = 12, fmt, data;
  while (o < b.length) { const id = b.toString('ascii', o, o + 4), sz = b.readUInt32LE(o + 4);
    if (id === 'fmt ') fmt = { ch: b.readUInt16LE(o + 10), rate: b.readUInt32LE(o + 12), bits: b.readUInt16LE(o + 22) };
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
const [, , file, outDir, idsFile, chunk] = process.argv;
const { rate, x } = readWav(file);
const fr = Math.round(rate * 0.01), nf = Math.floor(x.length / fr), db = new Float32Array(nf);
for (let f = 0; f < nf; f++) { let s = 0; for (let i = f * fr; i < (f + 1) * fr; i++) s += x[i] * x[i]; db[f] = 10 * Math.log10(s / fr + 1e-12); }
const TH = +(process.env.TH||-50), MINGAP = +(process.env.GAP||90); // frames of 10 ms: a pause of 0.9 s or more ends a line
const segs = []; let start = -1, quiet = 0;
for (let f = 0; f < nf; f++) {
  if (db[f] > TH) { if (start < 0) start = f; quiet = 0; }
  else if (start >= 0 && ++quiet >= MINGAP) { segs.push([start, f - quiet + 1]); start = -1; quiet = 0; }
}
if (start >= 0) segs.push([start, nf - quiet]);
const gaps = segs.slice(1).map((s, i) => (s[0] - segs[i][1]) / 100);
console.log(file, 'lines', segs.length, 'shortest gap', Math.min(...gaps).toFixed(2), 'longest line', Math.max(...segs.map((s) => (s[1] - s[0]) / 100)).toFixed(2));
if (!outDir) { fs.writeFileSync(file + '.segs.json', JSON.stringify(segs)); process.exit(); }
const ids = idsFile === '-' ? segs.map((_, i) => 'seg-' + String(i).padStart(3, '0')) : JSON.parse(fs.readFileSync(idsFile, 'utf8'))[+chunk];
if (ids.length !== segs.length) { console.log('COUNT MISMATCH', ids.length, segs.length); process.exit(1); }
const lead = Math.round(rate * 0.04), tail = Math.round(rate * 0.12), fade = Math.round(rate * 0.01);
const out = {};
segs.forEach(([a, b], k) => {
  const i0 = Math.max(0, a * fr - lead), i1 = Math.min(x.length, b * fr + tail);
  const y = x.slice(i0, i1); let pk = 0; for (const v of y) pk = Math.max(pk, Math.abs(v));
  const g = 0.89 / pk; for (let i = 0; i < y.length; i++) { const e = Math.min(1, i / fade, (y.length - 1 - i) / fade); y[i] *= g * e; }
  writeWav(`${outDir}/${ids[k]}.wav`, y, rate); out[ids[k]] = Math.round(y.length / rate * 1000);
});
fs.writeFileSync(`${outDir}/ms-${chunk}.json`, JSON.stringify(out));
console.log('wrote', segs.length);
