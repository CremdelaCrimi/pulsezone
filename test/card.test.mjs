// Summary-card checks for js/card.js.
// Run:  node test/card.test.mjs     (exit code 0 = all passed)
// Node has no canvas, so drawCard() draws on a fake one: a Proxy that takes any property write and
// any method call and keeps a log. That is all these checks need: what text was drawn, where, in
// which colour, and that nothing left the 1080 x 1350 card. (How it LOOKS needs a real browser.)
import { existsSync, readFileSync } from 'node:fs';
import { drawCard, cardBlob, cardBlobSync, CARD_W, CARD_H } from '../js/card.js';
import { summarizeWorkout } from '../js/core.js';
import { latestRecord } from '../js/tcx.js';

let failures = 0;
const check = (ok, what) => {
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${what}`);
  if (!ok) failures++;
};

// ---------------------------------------------------------------- the fake canvas
const fontPx = (font) => Number((/(\d+(?:\.\d+)?)px/.exec(String(font)) || [0, 10])[1]);
function fakeCanvas({ context = true, dataUrl } = {}) {
  const calls = []; // { name, args } plus the drawing state at that moment
  const state = { textAlign: 'start', font: '10px sans-serif' };
  let path = [], dash = [];
  const ctx = new Proxy(state, {
    set(target, prop, value) { target[prop] = value; return true; },
    get(target, prop) {
      if (typeof prop === 'symbol' || prop in target) return target[prop];
      return (...args) => {
        if (prop === 'beginPath') path = [];
        if (prop === 'moveTo' || prop === 'lineTo') path.push([args[0], args[1]]);
        if (prop === 'setLineDash') dash = args[0];
        const painted = prop === 'fill' || prop === 'stroke';
        calls.push({ name: prop, args, textAlign: target.textAlign, font: target.font, fillStyle: target.fillStyle,
          strokeStyle: target.strokeStyle, dash, path: painted ? path.slice() : null });
        // About the width of bold system type: enough for the card's fitting code to have work to do.
        if (prop === 'measureText') return { width: Array.from(String(args[0])).length * fontPx(target.font) * 0.55 };
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return { addColorStop() {} };
        return undefined;
      };
    },
  });
  const canvas = { width: 0, height: 0, getContext: (kind) => (context && kind === '2d' ? ctx : null) };
  if (dataUrl) canvas.toDataURL = typeof dataUrl === 'function' ? dataUrl : () => dataUrl;
  return { canvas, calls };
}

/** Draw one card on a fresh fake canvas. */
function draw(rec) {
  const f = fakeCanvas();
  let threw = null, out = null;
  try { out = drawCard(f.canvas, rec); } catch (e) { threw = e; }
  const textCalls = f.calls.filter((c) => c.name === 'fillText');
  const texts = textCalls.map((c) => String(c.args[0]));
  return { ...f, threw, out, textCalls, texts, has: (s) => texts.some((t) => t.includes(s)) };
}

/** Everything drawn outside the card, or drawn in a way that could run off it (as a list of complaints). */
function strays(calls) {
  const bad = [];
  const inX = (x) => Number.isFinite(x) && x >= 0 && x <= CARD_W;
  const inY = (y) => Number.isFinite(y) && y >= 0 && y <= CARD_H;
  const point = (x, y) => inX(x) && inY(y);
  for (const c of calls) {
    const a = c.args;
    let ok = true;
    if (c.name === 'fillText' || c.name === 'strokeText') {
      const [, x, y, maxW] = a, px = fontPx(c.font);
      const reach = c.textAlign === 'center' ? [x - maxW / 2, x + maxW / 2] : c.textAlign === 'right' || c.textAlign === 'end' ? [x - maxW, x] : [x, x + maxW];
      ok = Number.isFinite(maxW) && maxW > 0 && inX(reach[0]) && inX(reach[1]) && inY(y - px) && inY(y + px);
    } else if (['fillRect', 'strokeRect', 'clearRect', 'rect', 'roundRect'].includes(c.name)) {
      ok = point(a[0], a[1]) && point(a[0] + a[2], a[1] + a[3]);
    } else if (c.name === 'moveTo' || c.name === 'lineTo') {
      ok = point(a[0], a[1]);
    } else if (c.name === 'arc') {
      ok = point(a[0] - a[2], a[1] - a[2]) && point(a[0] + a[2], a[1] + a[2]);
    } else if (c.name === 'ellipse') {
      ok = point(a[0] - a[2], a[1] - a[3]) && point(a[0] + a[2], a[1] + a[3]);
    } else if (['arcTo', 'quadraticCurveTo', 'bezierCurveTo'].includes(c.name)) {
      for (let i = 0; i + 1 < a.length - (c.name === 'arcTo' ? 1 : 0); i += 2) ok = ok && point(a[i], a[i + 1]);
    } else if (['translate', 'scale', 'rotate', 'transform', 'setTransform', 'drawImage', 'putImageData'].includes(c.name)) {
      ok = false; // a transform would make every logged coordinate meaningless; images are not allowed at all
    }
    if (!ok) bad.push(`${c.name}(${a.map((v) => (typeof v === 'string' ? JSON.stringify(v.slice(0, 24)) : v)).join(', ')}) align=${c.textAlign}`);
  }
  return bad;
}
const JUNK = /NaN|undefined|null|Infinity|\[object|function|Invalid|\n|\t/;
const junkText = (texts) => texts.find((t) => JUNK.test(t)) || '';

// ---------------------------------------------------------------- a record in the game's shape
// Like workoutRecord() in game.js: rows are arrays in `cols` order, and the five columns the card
// reads are not the first five (logRow() writes about forty).
const COLS = ['t', 'phase', 'bpm', 'source', 'status', 'target', 'intensity', 'boost', 'hits', 'note'];
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const localNoon = (y, m, d) => new Date(y, m - 1, d, 12, 0, 0).toISOString(); // the same calendar day in any time zone

function makeLog({ warm = 30, train = 240, cool = 70, target = 125, mishaps = true } = {}) {
  const log = [];
  for (let t = 0; t < warm + train + cool; t++) {
    let phase, bpm, tgt;
    if (t < warm) {
      phase = 'WarmUp'; tgt = Math.round(95 + (target - 95) * (t / warm)); bpm = Math.round(88 + 30 * (t / warm));
    } else if (t < warm + train) {
      const u = t - warm;
      phase = 'Training'; tgt = Math.round(target + 5 * Math.sin((2 * Math.PI * u) / 120)); bpm = Math.round(target + 14 * Math.sin((2 * Math.PI * u) / 90));
    } else {
      phase = 'CoolDown'; tgt = target; bpm = Math.round(target - 0.5 * (t - warm - train));
    }
    let status = Math.abs(bpm - tgt) <= 5 ? 'InZone' : bpm < tgt ? 'Below' : 'Above';
    if (mishaps && t >= 100 && t < 104) { bpm = ''; status = 'NoSignal'; }     // the readings drop out for 4 s
    if (mishaps && t >= 104 && t < 108) status = 'NoSignal';                   // then a stale reading, still no signal
    if (mishaps && t >= 150 && t < 155) { bpm = 166; status = 'SafetyBrake'; } // and a spike over the ceiling
    log.push({ t, phase, bpm, source: 'phone', status, target: tgt, intensity: '0.500', boost: '0.00', hits: t, note: '' });
  }
  return log;
}
const toRows = (log) => log.map((r) => COLS.map((c) => r[c]));
function makeRecord(over = {}, logOpts = {}) {
  const log = makeLog(logOpts);
  const summary = Object.assign(summarizeWorkout(log), { score: 12480, streak: 95, reactor: 2, combo: 31, kcal: 214, real: true, profile: 'waves' });
  return {
    date: localNoon(2026, 11, 19), version: 'v58', summary,
    name: 'Harbour Lights', shape: 'waves', level: { level: 4, title: 'Ember' },
    badges: [{ id: 'zone50', name: 'Zone 50' }, { id: 'streak2', name: 'Streak 2:00' }],
    settings: { targetBpm: 125, minutes: 4, warmUp: 30, profile: 'steady', challenge: 'normal', gameType: 'punch', moves: {} },
    cols: COLS, rows: toRows(log), events: [],
    ...over,
  };
}
const ZONE_COLOR = { InZone: '#4dff73', Below: '#59b3ff', Above: '#ff9933', SafetyBrake: '#ff3333', NoSignal: '#999999' }; // game.js
const BAND = 'rgba(77,255,115,0.16)';

// ---------------------------------------------------------------- checks
console.log('\n== a full record');
const full = makeRecord();
const sum = full.summary;
check(sum.recovery > 0 && sum.inZoneSeconds > 60 && sum.peakBpm === 166, `the made-up workout is a sensible one (${sum.pct}% in zone, recovery ${sum.recovery})`);
const card = draw(full);
check(!card.threw, `draws without throwing${card.threw ? `: ${card.threw.stack}` : ''}`);
check(card.out === card.canvas, 'returns the canvas it drew on');
check(card.canvas.width === 1080 && card.canvas.height === 1350 && CARD_W === 1080 && CARD_H === 1350, 'canvas set to 1080 x 1350');
check(card.has('PULSEZONE'), 'brand line');
check(card.texts.includes('Harbour Lights'), 'workout name');
check(card.has('Waves') && card.has('Thu 19 Nov 2026'), `shape and local date: ${card.texts.find((t) => t.includes('2026'))}`);
check(card.texts.includes(mmss(sum.inZoneSeconds)) && card.texts.includes(`${sum.pct}%`), `time in zone: ${mmss(sum.inZoneSeconds)} and ${sum.pct}%`);
check(card.texts.includes(`${sum.avgBpm} / ${sum.peakBpm}`), `average / peak: ${sum.avgBpm} / ${sum.peakBpm}`);
check(card.texts.includes('214 kcal'), 'calories');
check(card.texts.includes('1:35'), 'longest streak as m:ss');
check(card.texts.includes('12,480'), 'score');
check(card.texts.includes(`-${sum.recovery} BPM`) && card.texts.includes('1-min recovery'), `1-minute recovery: -${sum.recovery} BPM`);
check(card.has('Level 4') && card.has('Ember'), 'level and its title');
check(card.has('Badges earned: Zone 50, Streak 2:00'), 'badges earned');
check(card.texts.includes('heart-rate-adaptive VR workout'), 'footer');
check(!junkText(card.texts), `no NaN / undefined / null in the text ${junkText(card.texts)}`);

console.log('\n== the graph');
const strokes = card.calls.filter((c) => c.name === 'stroke');
for (const [status, colour] of Object.entries(ZONE_COLOR)) {
  check(strokes.some((c) => c.strokeStyle === colour && c.path.length >= 2), `heart-rate line drawn in the ${status} colour ${colour}`);
}
const dotted = strokes.filter((c) => c.strokeStyle === ZONE_COLOR.NoSignal && c.dash.length);
check(dotted.length === 1 && dotted[0].path.length === 2, 'the 4 s with no reading are bridged by one dotted grey stretch');
const bands = card.calls.filter((c) => c.name === 'fill' && c.fillStyle === BAND);
check(bands.length === 1 && bands[0].path.length === 2 * full.rows.length, 'one target band with a top and a bottom point for every second');
check(new Set(bands[0].path.map((p) => Math.round(p[1]))).size > 4, 'the band follows the moving target (it is not a flat strip)');
const shadesOf = (d) => d.calls.filter((c) => c.name === 'fillRect' && c.fillStyle === 'rgba(255,255,255,0.05)');
const shades = shadesOf(card);
check(shades.length === 2 && shades[0].args[0] < shades[1].args[0], 'warm-up and cool-down shaded, one block each');
const panel = card.calls.find((c) => c.name === 'fill' && c.fillStyle === '#141826').path[0]; // the panel's top-left corner, as drawn
const linePoints = strokes.filter((c) => Object.values(ZONE_COLOR).includes(c.strokeStyle)).flatMap((c) => c.path);
check(linePoints.length > 300 && linePoints.every(([x, y]) => x > 40 && x < 1040 && y > panel[1] && y < 800), 'the line stays inside the graph panel');
check(['In zone', 'Below', 'Above', 'Safety brake', 'No signal', 'Target zone', 'Warm-up / cool-down'].every((k) => card.texts.includes(k)), 'legend names every colour and shading on the card');
check(card.texts.includes('0:00') && card.texts.includes(mmss(full.rows.length - 1)), 'time axis from 0:00 to the last second');
const calm = draw(makeRecord({}, { mishaps: false }));
check(!calm.texts.includes('Safety brake') && !calm.texts.includes('No signal') && calm.texts.includes('In zone'), 'legend leaves out colours the workout never used');
const allTraining = draw(makeRecord({}, { warm: 0, cool: 0 }));
check(shadesOf(allTraining).length === 0 && !allTraining.texts.includes('Warm-up / cool-down') && allTraining.texts.includes('Target zone'), 'no warm-up or cool-down in the log -> no shading, and none in the legend');

console.log('\n== thin and odd records never throw');
const log = makeLog();
const noBpmLog = log.map((r) => ({ ...r, bpm: 0, status: 'NoSignal' }));
const blankBpmLog = log.map((r) => ({ ...r, bpm: '', status: 'NoSignal' }));
const cases = {
  'null': null,
  'undefined': undefined,
  'an empty record {}': {},
  'an array': [],
  'a string': 'not a record',
  'a number': 42,
  'no rows (rows: [])': makeRecord({ rows: [] }),
  'no rows key at all': makeRecord({ rows: undefined, cols: undefined }),
  'rows but no cols': makeRecord({ cols: undefined }),
  'cols without target': { ...full, cols: COLS.map((c) => (c === 'target' ? 'goal' : c)) },
  'rows with bpm 0': makeRecord({ rows: toRows(noBpmLog), summary: summarizeWorkout(noBpmLog) }),
  'rows with blank bpm': makeRecord({ rows: toRows(blankBpmLog), summary: summarizeWorkout(blankBpmLog) }),
  'summary: null (saved mid-workout)': makeRecord({ summary: null }),
  'summary: {}': makeRecord({ summary: {} }),
  'summary of junk': makeRecord({ summary: { pct: 'lots', inZoneSeconds: null, avgBpm: {}, peakBpm: [], kcal: NaN, score: Infinity, streak: true, recovery: 'x' } }),
  'settings missing': makeRecord({ settings: undefined }),
  'one row': makeRecord({ rows: toRows(log.slice(0, 1)), summary: summarizeWorkout(log.slice(0, 1)) }),
  'two rows': makeRecord({ rows: toRows(log.slice(0, 2)), summary: summarizeWorkout(log.slice(0, 2)) }),
  'a 5-second workout': makeRecord({ rows: toRows(log.slice(0, 5)), summary: summarizeWorkout(log.slice(0, 5)) }),
  'rows as objects (the game log itself)': makeRecord({ rows: log, cols: undefined }),
  'junk among the rows': makeRecord({ rows: [null, 5, 'x', [], {}, ...toRows(log), undefined, [NaN, 7, 'abc', {}, null]] }),
  'one reading only': makeRecord({ rows: toRows(noBpmLog.map((r, i) => (i === 50 ? { ...r, bpm: 120 } : r))) }),
  'absurd values': makeRecord({ rows: toRows(log.map((r, i) => ({ ...r, bpm: i % 2 ? 65535 : 1, target: i % 3 ? 100000 : -5, t: i % 5 ? r.t : -1e9 }))) }),
  'a long name': makeRecord({ name: 'The Longest Workout Name Anybody Ever Typed Into A Fitness Game '.repeat(6) }),
  'a name of the wrong type': makeRecord({ name: { toString: () => 'x' } }),
  'shape: "constructor"': makeRecord({ shape: 'constructor' }),
  'shape: "__proto__" all the way down': makeRecord({ shape: '__proto__', summary: { ...sum, profile: 'toString' }, settings: { profile: 'valueOf' } }),
  'date: "not a date"': makeRecord({ date: 'not a date' }),
  'no date': makeRecord({ date: undefined }),
  'level and badges of the wrong type': makeRecord({ level: 'high', badges: 'many' }),
  'badges of junk': makeRecord({ badges: [null, 7, {}, { name: 5 }, { name: '' }, []] }),
  'recovery negative (heart rate rose)': makeRecord({ summary: { ...sum, recovery: -6 } }),
  'a saved file with no workouts': { app: 'PulseZone', version: 'v58', saved: full.date, workouts: [] },
  'a saved file of junk': { app: 'PulseZone', workouts: [7] },
  'a full record': full,
};
const drawn = Object.entries(cases).map(([label, rec]) => ({ label, ...draw(rec) }));
const threw = drawn.filter((d) => d.threw);
check(threw.length === 0, `${drawn.length} records, none throws${threw.map((d) => `\n      ${d.label}: ${d.threw.stack}`).join('')}`);
check(drawn.every((d) => d.out === d.canvas && d.canvas.width === 1080 && d.canvas.height === 1350), 'every one returns a 1080 x 1350 canvas');
check(drawn.every((d) => d.has('PULSEZONE') && d.texts.includes('heart-rate-adaptive VR workout')), 'every one still carries the brand line and the footer');
const junky = drawn.filter((d) => junkText(d.texts));
check(junky.length === 0, `none prints NaN / undefined / null / [object${junky.map((d) => `\n      ${d.label}: ${JSON.stringify(junkText(d.texts))}`).join('')}`);

console.log('\n== nothing leaves the card');
const strayed = drawn.map((d) => ({ label: d.label, bad: strays(d.calls) })).filter((d) => d.bad.length);
check(strayed.length === 0, `every fillText, rect, line and arc of all ${drawn.length} cards is inside 1080 x 1350${strayed.map((d) => `\n      ${d.label}: ${d.bad.slice(0, 3).join(' | ')}`).join('')}`);
const allText = drawn.flatMap((d) => d.textCalls);
check(allText.length > 400 && allText.every((c) => c.args.length === 4 && Number.isFinite(c.args[3]) && c.args[3] > 0 && c.args[3] <= CARD_W), `every one of the ${allText.length} fillText calls passes a maxWidth`);
check(drawn.every((d) => d.calls.some((c) => c.name === 'fillRect' && c.args.join() === '0,0,1080,1350')), 'the whole card is painted (no transparent corners in the PNG)');
check(strays([{ name: 'fillText', args: ['x', 1000, 50, 200], textAlign: 'left', font: '20px a' }]).length === 1
  && strays([{ name: 'fillRect', args: [1000, 0, 100, 10] }]).length === 1 && strays([{ name: 'lineTo', args: [NaN, 5] }]).length === 1, '(the stray detector itself catches text, rects and lines that run off)');

console.log('\n== what the thin ones show');
const by = Object.fromEntries(drawn.map((d) => [d.label, d]));
const empty = by['an empty record {}'];
check(empty.texts.includes('PulseZone workout'), 'no name -> "PulseZone workout"');
check(empty.texts.includes('No heart-rate readings this time'), 'no rows -> the graph says so');
check(empty.texts.includes('-- / --') && empty.texts.filter((t) => t === '--').length === 4, 'no numbers -> dashes (time in zone, calories, streak, score)');
check(!empty.texts.some((t) => /\d{4}/.test(t)) && !empty.has('%'), 'and no date or percentage made up');
const noRows = by['no rows (rows: [])'];
check(noRows.texts.includes('No heart-rate readings this time') && noRows.texts.includes(mmss(sum.inZoneSeconds)) && noRows.texts.includes('214 kcal'), 'no rows but a summary -> its numbers are still shown');
const zeros = by['rows with bpm 0'];
check(zeros.texts.includes('No heart-rate readings this time') && zeros.texts.includes('-- / --'), 'bpm 0 everywhere -> no line, average / peak as dashes');
check(!zeros.calls.some((c) => c.name === 'stroke' && Object.values(ZONE_COLOR).includes(c.strokeStyle)), 'and no heart-rate line');
check(by['one reading only'].texts.includes('No heart-rate readings this time'), 'a single reading is not a line either');
const mid = by['summary: null (saved mid-workout)'];
check(mid.texts.includes(mmss(sum.inZoneSeconds)) && mid.texts.includes(`${sum.pct}%`) && mid.texts.includes(`${sum.avgBpm} / ${sum.peakBpm}`), 'no summary -> time in zone, average and peak worked out from the rows');
check(mid.texts.filter((t) => t === '--').length === 3, 'and dashes for what only the game knows (calories, streak, score)');
const objs = by['rows as objects (the game log itself)'];
check(objs.texts.join('|') === card.texts.join('|'), 'rows as objects draw the same card as rows as arrays');
check(by['two rows'].calls.some((c) => c.name === 'stroke' && c.path.length === 2 && Object.values(ZONE_COLOR).includes(c.strokeStyle)), 'two rows -> a one-segment line');
check(by['recovery negative (heart rate rose)'].texts.includes('+6 BPM'), 'a heart rate that rose in cool-down reads +6 BPM, not --6');

console.log('\n== recovery only when there is one');
const noRecovery = draw(makeRecord({ summary: { ...sum, recovery: null } }));
check(!noRecovery.texts.some((t) => /recovery/i.test(t)) && !noRecovery.texts.some((t) => /BPM$/.test(t) && /^[-+]/.test(t)), 'recovery null -> no recovery label or number');
check(noRecovery.texts.includes(mmss(sum.inZoneSeconds)) && noRecovery.texts.includes('12,480'), 'the rest of the numbers are still there');
const { recovery: _dropped, ...oldSummary } = sum;
check(draw(makeRecord({ summary: oldSummary })).texts.includes(`-${sum.recovery} BPM`), 'a summary from before v57 (no recovery key) -> worked out from the rows');
const shortCool = makeLog({ cool: 20 });
check(!draw(makeRecord({ rows: toRows(shortCool), summary: null })).texts.some((t) => /recovery/i.test(t)), 'cool-down under a minute and no summary -> none');

console.log('\n== names, shapes and dates');
const long = by['a long name'];
const titleOf = (d, start) => d.textCalls.find((c) => String(c.args[0]).startsWith(start));
const longTitle = titleOf(long, 'The Longest Workout'), shortTitle = titleOf(card, 'Harbour Lights');
check(!!longTitle && longTitle.args[3] > 0 && longTitle.args[3] <= 1080 - longTitle.args[1], `a long name is passed with a maxWidth (${longTitle?.args[3]} from x = ${longTitle?.args[1]})`);
check(String(longTitle.args[0]).endsWith('…') && String(longTitle.args[0]).length < 80, `and is cut to fit: "${longTitle.args[0]}"`);
check(fontPx(longTitle.font) < fontPx(shortTitle.font) && fontPx(longTitle.font) >= 40, `in smaller type first (${fontPx(shortTitle.font)}px -> ${fontPx(longTitle.font)}px)`);
check(by['a name of the wrong type'].texts.includes('PulseZone workout'), 'a name that is not a string -> "PulseZone workout"');
check(draw(makeRecord({ name: '' })).texts.includes('PulseZone workout'), 'an empty name (weekly plan off) -> "PulseZone workout"');
check(draw(makeRecord({ name: '', summary: { ...sum, name: 'Tide Runner' } })).texts.includes('Tide Runner'), 'a name carried on the summary is found too');
check(draw(makeRecord({ name: '  Storm\n\tFront  ' })).texts.includes('Storm Front'), 'line breaks and stray spaces in a name are tidied');
check(draw(makeRecord({ shape: 'build' })).has('Build & peak') && draw(makeRecord({ shape: 'steady' })).has('Steady'), 'shape names: Steady / Waves / Build & peak');
check(draw(makeRecord({ shape: undefined })).has('Waves'), 'no shape on the record -> the summary\'s profile');
check(draw(makeRecord({ shape: undefined, summary: null })).has('Steady'), 'nor on the summary -> the settings\' profile');
check(by['shape: "constructor"'].texts.includes('Thu 19 Nov 2026') && draw(makeRecord({ shape: 'intervals' })).texts.includes('Thu 19 Nov 2026'),
  'a shape this version does not know is left out, not guessed from the settings (the date stands alone)');
check(draw(makeRecord({ date: localNoon(2027, 1, 3) })).has('Sun 3 Jan 2027'), 'date format: Sun 3 Jan 2027');
check(by['date: "not a date"'].texts.includes('Waves') && by['no date'].texts.includes('Waves'), 'a missing or broken date is left out (the shape stands alone)');

console.log('\n== level and badges line');
const plain = draw(makeRecord({ level: null, badges: [] }));
check(!plain.has('Level') && !plain.has('earned'), 'no level, no badges -> no line');
check(draw(makeRecord({ badges: [] })).has('Level 4  ·  Ember'), 'level alone');
check(draw(makeRecord({ level: 7, badges: [] })).has('Level 7'), 'a bare level number works too');
check(draw(makeRecord({ level: null, badges: [{ id: 'first', name: 'First workout' }] })).texts.includes('Badge earned: First workout'), 'one badge alone: "Badge earned: ..."');
const five = ['One', 'Two', 'Three', 'Four', 'Five'].map((n) => ({ id: n, name: `Badge ${n}` }));
check(draw(makeRecord({ level: null, badges: five })).texts.includes('Badges earned: Badge One, Badge Two, Badge Three +2 more'), 'five badges: the first three and "+2 more"');
const badgeLine = (d) => d.texts.find((t) => t.startsWith('Badges earned')) || '';
const beside = badgeLine(draw(makeRecord({ badges: five })));
check(/^Badges earned: Badge One(, Badge Two)?(, Badge Three)? \+[234] more$/.test(beside), `beside a level there is less room: whole names, the rest as a count: "${beside}"`);
const wordy = badgeLine(draw(makeRecord({ level: { level: 12, title: 'Furnace' }, badges: [1, 2, 3].map((n) => ({ id: `b${n}`, name: `A rather long badge name ${n}` })) })));
check(/^Badges earned: A rather long.*… \+2 more$/.test(wordy), `a name too long for the line gives way, the count stays: "${wordy}"`);
const onSummary = draw(makeRecord({ level: undefined, badges: undefined, summary: { ...sum, level: { level: 9, title: 'Blaze' }, badges: [{ id: 'hour', name: 'An hour in the zone' }] } }));
check(onSummary.has('Level 9  ·  Blaze') && onSummary.has('An hour in the zone'), 'level and badges carried on the summary are found too');

console.log('\n== the saved file');
const older = makeRecord({ name: 'Long Road', date: localNoon(2026, 11, 17) });
const file = { app: 'PulseZone', version: 'v58', saved: '2026-11-19T12:30:00.000Z', workouts: [older, full] };
const fromFile = draw(file);
check(fromFile.texts.includes('Harbour Lights') && !fromFile.texts.includes('Long Road'), 'drawCard takes the saved file { workouts: [...] } and draws the latest workout');
check(draw(latestRecord(file)).texts.join('|') === fromFile.texts.join('|'), 'the same card as drawing latestRecord(file)');
const fixture = new URL('./fixtures/workout-v54-synthetic.json', import.meta.url);
if (existsSync(fixture)) {
  const saved = JSON.parse(readFileSync(fixture, 'utf8')), s54 = latestRecord(saved).summary;
  const old = draw(saved);
  check(!old.threw && strays(old.calls).length === 0 && !junkText(old.texts), 'the v54 fixture (the game\'s real column layout) draws cleanly and in bounds');
  check(old.texts.includes('PulseZone workout') && old.has('Steady') && old.texts.includes(mmss(s54.inZoneSeconds)) && old.texts.includes(`${s54.pct}%`)
    && old.texts.includes(`${s54.avgBpm} / ${s54.peakBpm}`) && old.texts.includes(`${s54.kcal} kcal`), `and shows its numbers (${mmss(s54.inZoneSeconds)}, ${s54.pct}%, ${s54.avgBpm} / ${s54.peakBpm}, ${s54.kcal} kcal)`);
} else {
  console.log('  [SKIP] test/fixtures/workout-v54-synthetic.json is not here');
}

console.log('\n== PNG blob');
check(drawCard(null, full) === null && drawCard({}, full) === null, 'drawCard without a canvas -> null, no throw');
const blind = fakeCanvas({ context: false });
check(drawCard(blind.canvas, full) === null && blind.calls.length === 0, 'a canvas with no 2D context -> null, nothing drawn');
check(typeof document === 'undefined' && cardBlobSync(full) === null && (await cardBlob(full)) === null, 'no document (Node) -> cardBlob resolves to null');
// A 1 x 1 PNG stands in for the browser's encoder.
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const made = [];
const withDocument = async (canvasOpts, fn) => {
  globalThis.document = { createElement: (tag) => { const f = fakeCanvas(canvasOpts); made.push({ tag, ...f }); return f.canvas; } };
  try { return await fn(); } finally { delete globalThis.document; }
};
const blob = await withDocument({ dataUrl: `data:image/png;base64,${PNG_B64}` }, () => cardBlob(full));
check(blob instanceof Blob && blob.type === 'image/png', 'with a canvas -> a Blob of type image/png');
const bytes = blob ? new Uint8Array(await blob.arrayBuffer()) : new Uint8Array();
check(bytes.length === Buffer.from(PNG_B64, 'base64').length && Buffer.from(bytes).equals(Buffer.from(PNG_B64, 'base64')), `holding exactly the PNG bytes the canvas encoded (${bytes.length})`);
check([0x89, 0x50, 0x4e, 0x47].every((b, i) => bytes[i] === b), 'starting with the PNG signature');
const last = made[made.length - 1];
check(last.tag === 'canvas' && last.canvas.width === 1080 && last.canvas.height === 1350 && last.calls.some((c) => c.name === 'fillText' && c.args[0] === 'Harbour Lights'), 'from a 1080 x 1350 canvas it created and drew the card on');
check((await withDocument({ dataUrl: () => { throw new Error('blocked'); } }, () => cardBlob(full))) === null, 'a canvas that refuses to export -> null, no rejection');
check((await withDocument({ dataUrl: 'data:,' }, () => cardBlob(full))) === null, 'a canvas that exports nothing -> null');
check((await withDocument({ context: false }, () => cardBlob(full))) === null, 'no 2D context -> null');
check((await withDocument({ dataUrl: `data:image/png;base64,${PNG_B64}` }, () => cardBlob(null))) instanceof Blob, 'even an empty record gives a card (the page decides whether to offer it)');

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
