// Summary card (v58): one picture of a workout to share or keep. It is drawn on the phone bridge
// page because the phone is where sharing happens; the headset has nowhere to send a picture.
// 2D canvas only (system fonts, no images, nothing to fetch), so it also works with no connection.
//
// Input is the game's workout record (workoutRecord() in game.js):
//   { date, version, summary, settings, cols, rows, events } and from v58 name, shape, level, badges.
// Any of it can be missing: a record from an older version, a workout saved while it was still
// running (summary: null), a 20-second test. A card with a few dashes on it beats a share button
// that does nothing, so nothing here throws on a thin record and every string is fitted to the card.
// node test/card.test.mjs checks that with a fake canvas.
import { summarizeWorkout } from './core.js?v60';
import { latestRecord } from './tcx.js?v60';

export const CARD_W = 1080, CARD_H = 1350; // 4:5 portrait: the tallest picture a feed shows uncropped

// The game's own colours (the scene and the end board in game.js), so the card looks like the game.
const SKY = '#0b0d18', PANEL = '#141826', TRACK = '#262a38';
const INK = '#e6e9ef', SOFT = '#c9ced8', MUTED = '#8d95a5', WHITE = '#ffffff', GOLD = '#ffc04d', ACCENT = '#4fd1c5';
const ZONE_COLOR = { InZone: '#4dff73', Below: '#59b3ff', Above: '#ff9933', SafetyBrake: '#ff3333', NoSignal: '#999999' };
const BAND = 'rgba(77,255,115,0.16)', BAND_LINE = 'rgba(77,255,115,0.5)', SHADE = 'rgba(255,255,255,0.05)';
const SHAPE_TITLE = { steady: 'Steady', waves: 'Waves', build: 'Build & peak' };
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// The zone is the target plus or minus this many BPM. The record doesn't carry the game's setting
// (settings.zoneHalfWidth is used if a later version adds it), so this is the game's default.
const ZONE_HALF = 5;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const grouped = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
/** A real number, or NaN: '' (the log's "no reading"), null, booleans and objects are not numbers. */
const num = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (typeof v !== 'string' || v.trim() === '') return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};
/** A string from the record made safe to draw: one line, trimmed, not endless. '' for anything else. */
const words = (v, max) => (typeof v === 'string' ? Array.from(v.replace(/\s+/g, ' ').trim()).slice(0, max).join('') : '');
/** map[key] for the map's own keys only (a record that says shape: "constructor" must not print a function). */
const own = (map, key) => (typeof key === 'string' && Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined);

/**
 * "Thu 19 Nov 2026" in the phone's own time zone; '' for a missing or broken date. Spelled out by
 * hand because toLocaleDateString() orders and punctuates it differently from phone to phone.
 */
function cardDate(v) {
  const d = new Date(typeof v === 'string' || typeof v === 'number' ? v : NaN);
  if (!Number.isFinite(d.getTime())) return '';
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * The per-second rows as { t, phase, bpm, status, target }, whichever way they are stored: the
 * record keeps arrays in `cols` order (smaller to send to the phone), the game's own log keeps
 * objects. bpm is 0 where there was no reading; target is NaN where it is unknown.
 */
function cardRows(rec) {
  const cols = Array.isArray(rec.cols) ? rec.cols : [];
  const at = Object.fromEntries(['t', 'phase', 'bpm', 'status', 'target'].map((k) => [k, cols.indexOf(k)]));
  const out = [];
  (Array.isArray(rec.rows) ? rec.rows : []).forEach((row, i) => {
    if (!row || typeof row !== 'object') return;
    const get = Array.isArray(row) ? (k) => (at[k] >= 0 ? row[at[k]] : undefined) : (k) => row[k];
    const t = num(get('t')), bpm = num(get('bpm')), target = num(get('target'));
    out.push({
      t: Number.isFinite(t) ? t : i, // no clock in the row: one row is one second
      phase: words(get('phase'), 20), status: words(get('status'), 20),
      bpm: bpm > 0 ? bpm : 0, target: target > 0 ? target : NaN,
    });
  });
  return out;
}

/** The numbers on the card: the game's summary where it has them, otherwise what the rows can tell. */
function cardStats(sum, rows) {
  let fromRows = {};
  // summarizeWorkout spreads the readings into Math.max, which overflows on an absurdly long log.
  if (rows.length) { try { fromRows = summarizeWorkout(rows) || {}; } catch { fromRows = {}; } }
  const pick = (k) => { const v = num(sum[k]); return Number.isFinite(v) ? v : num(fromRows[k]); };
  return {
    inZone: pick('inZoneSeconds'), pct: pick('pct'), avg: pick('avgBpm'), peak: pick('peakBpm'),
    // A null recovery in the summary means "no number this time" (cool-down under a minute), so it
    // is not worked out again; only a summary from before v57, or none at all, falls back to the rows.
    recovery: 'recovery' in sum ? num(sum.recovery) : num(fromRows.recovery),
    kcal: num(sum.kcal), streak: num(sum.streak), score: num(sum.score), // only the game knows these
  };
}

/**
 * Draw the card for one workout onto `canvas` (resized to 1080 x 1350). Takes a record or the saved
 * file that wraps it ({ workouts: [rec] }). Returns the canvas, or null if it has no 2D context.
 */
export function drawCard(canvas, data) {
  if (!canvas || typeof canvas.getContext !== 'function') return null;
  canvas.width = CARD_W; canvas.height = CARD_H;
  const g = canvas.getContext('2d');
  if (!g) return null;

  const found = latestRecord(data) || data;
  const rec = found && typeof found === 'object' ? found : {};
  const sum = rec.summary && typeof rec.summary === 'object' ? rec.summary : {};
  const set = rec.settings && typeof rec.settings === 'object' ? rec.settings : {};
  const rows = cardRows(rec);
  const st = cardStats(sum, rows);
  const L = 72, R = CARD_W - 72; // the margins everything lines up on

  const width = (s, weight, px) => { g.font = `${weight} ${px}px ${FONT}`; return g.measureText(s).width; };
  /**
   * The only place text is drawn. Shrinks the type (as far as minPx), then cuts the string with an
   * ellipsis, until it fits maxW: a workout's name can be anything. maxWidth is passed as well, as
   * the last guard that nothing leaves the card. Returns the width it took.
   */
  const text = (s, x, y, maxW, weight, px, fill, align = 'left', minPx = px) => {
    if (!s || !(maxW > 0)) return 0;
    let size = px, w = width(s, weight, size);
    while (w > maxW && size > minPx) { size = Math.max(minPx, size - 2); w = width(s, weight, size); }
    if (w > maxW) {
      const chars = Array.from(s);
      let keep = clamp(Math.floor((chars.length * maxW) / w), 1, chars.length - 1);
      const cut = () => `${chars.slice(0, keep).join('').trimEnd()}…`;
      while (keep > 1 && width(cut(), weight, size) > maxW) keep--;
      s = cut(); w = Math.min(width(s, weight, size), maxW);
    }
    g.fillStyle = fill; g.textAlign = align;
    g.fillText(s, x, y, maxW);
    return w;
  };
  const line = (xa, ya, xb, yb, stroke, thick) => {
    g.strokeStyle = stroke; g.lineWidth = thick;
    g.beginPath(); g.moveTo(xa, ya); g.lineTo(xb, yb); g.stroke();
  };
  /** A filled rounded box, as an arcTo path: roundRect() is missing on iPhones before iOS 16. */
  const box = (x, y, w, h, r, fill) => {
    if (!(w > 0) || !(h > 0)) return;
    const k = Math.min(r, w / 2, h / 2);
    g.beginPath(); g.moveTo(x + k, y);
    g.arcTo(x + w, y, x + w, y + h, k); g.arcTo(x + w, y + h, x, y + h, k);
    g.arcTo(x, y + h, x, y, k); g.arcTo(x, y, x + w, y, k);
    g.closePath(); g.fillStyle = fill; g.fill();
  };
  const dot = (x, y, r, fill) => { g.fillStyle = fill; g.beginPath(); g.arc(x, y, r, 0, 2 * Math.PI); g.fill(); };

  g.textBaseline = 'middle'; g.lineJoin = 'round'; g.lineCap = 'round';
  g.fillStyle = SKY; g.fillRect(0, 0, CARD_W, CARD_H);
  const glow = g.createLinearGradient(0, 0, 0, 440); // the lane's blue fading out, like the game's fog
  glow.addColorStop(0, 'rgba(63,127,230,0.22)'); glow.addColorStop(1, 'rgba(63,127,230,0)');
  g.fillStyle = glow; g.fillRect(0, 0, CARD_W, 440);

  // Brand line: a heartbeat blip and the name in small capitals.
  g.strokeStyle = ACCENT; g.lineWidth = 5;
  g.beginPath(); g.moveTo(L, 80);
  for (const [dx, y] of [[20, 80], [30, 60], [44, 100], [56, 70], [62, 80], [84, 80]]) g.lineTo(L + dx, y);
  g.stroke();
  g.letterSpacing = '7px'; // where the browser has it; elsewhere the letters just sit closer together
  text('PULSEZONE', L + 104, 81, R - L - 104, 700, 30, INK);
  g.letterSpacing = '0px';

  // What it was and when. The shape is the first one the record names; one this version doesn't
  // know is left out rather than guessed from the settings.
  text(words(rec.name, 120) || words(sum.name, 120) || 'PulseZone workout', L, 172, R - L, 800, 76, WHITE, 'left', 44);
  const shape = own(SHAPE_TITLE, [rec.shape, sum.profile, set.profile].find((v) => typeof v === 'string' && v)) || '';
  text([shape, cardDate(rec.date)].filter(Boolean).join('  ·  '), L, 240, R - L, 500, 34, SOFT);

  // The graph: heart rate (coloured by zone) over time, on the target band, warm-up / cool-down shaded.
  // Same picture as the game's end board (drawSummary in game.js), from the record instead of the live log.
  box(40, 284, CARD_W - 80, 482, 28, PANEL);
  const x0 = 132, x1 = 1000, y0 = 320, y1 = 628;
  const beats = [];
  rows.forEach((r, i) => { if (r.bpm > 0) beats.push({ r, i }); });
  if (beats.length < 2) {
    text('No heart-rate readings this time', CARD_W / 2, 525, 880, 500, 32, MUTED, 'center');
  } else {
    const half = num(set.zoneHalfWidth) > 0 ? num(set.zoneHalfWidth) : ZONE_HALF;
    let tMin = Infinity, tMax = -Infinity, lo = Infinity, hi = -Infinity; // loops, not Math.min(...rows): a long log would overflow the call
    for (const r of rows) {
      tMin = Math.min(tMin, r.t); tMax = Math.max(tMax, r.t);
      if (r.bpm > 0) { lo = Math.min(lo, r.bpm); hi = Math.max(hi, r.bpm); }
      if (r.target > 0) { lo = Math.min(lo, r.target - half); hi = Math.max(hi, r.target + half); }
    }
    lo -= 5; hi += 5;
    const X = (t) => clamp(x0 + ((t - tMin) / Math.max(1, tMax - tMin)) * (x1 - x0), x0, x1);
    const Y = (b) => clamp(y1 - ((b - lo) / Math.max(1, hi - lo)) * (y1 - y0), y0, y1);

    // Warm-up and cool-down: one shaded block each (a block per second overlaps into stripes).
    let shaded = false;
    for (let i = 0; i < rows.length; i++) {
      const phase = rows[i].phase;
      if (phase !== 'WarmUp' && phase !== 'CoolDown') continue;
      let j = i;
      while (j + 1 < rows.length && rows[j + 1].phase === phase) j++;
      const xa = X(rows[i].t), xb = j + 1 < rows.length ? X(rows[j + 1].t) : x1;
      if (xb > xa) { g.fillStyle = SHADE; g.fillRect(xa, y0, xb - xa, y1 - y0); shaded = true; }
      i = j;
    }

    // A few round BPM values up the side.
    const raw = (hi - lo) / 5, mag = 10 ** Math.floor(Math.log10(raw));
    const step = Math.max(5, [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw);
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
      const y = Y(v);
      if (y < y0 + 16 || y > y1 - 16) continue; // too close to the frame to read
      line(x0, y, x1, y, 'rgba(255,255,255,0.07)', 1);
      text(String(Math.round(v)), x0 - 14, y, 72, 500, 24, MUTED, 'right');
    }
    text('BPM', x0 - 14, y0 - 16, 72, 500, 20, MUTED, 'right');
    line(x0, y1, x1, y1, 'rgba(255,255,255,0.16)', 2);

    // The target band follows the target second by second (warm-up ramp, waves, build).
    const band = (run) => {
      if (run.length < 2) return;
      g.beginPath();
      run.forEach((r, k) => (k ? g.lineTo(X(r.t), Y(r.target + half)) : g.moveTo(X(r.t), Y(r.target + half))));
      for (let k = run.length - 1; k >= 0; k--) g.lineTo(X(run[k].t), Y(run[k].target - half));
      g.closePath(); g.fillStyle = BAND; g.fill();
      g.strokeStyle = BAND_LINE; g.lineWidth = 2; g.setLineDash([10, 10]);
      g.beginPath();
      run.forEach((r, k) => (k ? g.lineTo(X(r.t), Y(r.target)) : g.moveTo(X(r.t), Y(r.target))));
      g.stroke(); g.setLineDash([]);
    };
    let run = [];
    for (const r of rows) { if (r.target > 0) run.push(r); else { band(run); run = []; } }
    band(run);

    // The heart-rate line, coloured by the zone it was in. One path per stretch of a colour, so the
    // joins are round. Seconds with no reading are bridged with grey dots: no signal, not a guess.
    const seen = new Set();
    let open = '';
    g.lineWidth = 6;
    for (let k = 1; k < beats.length; k++) {
      const a = beats[k - 1], b = beats[k], gap = b.i - a.i > 1;
      const zone = !gap && own(ZONE_COLOR, b.r.status) ? b.r.status : 'NoSignal';
      const stretch = zone + (gap ? ' gap' : '');
      if (stretch !== open) {
        if (open) g.stroke();
        open = stretch; seen.add(zone);
        g.strokeStyle = ZONE_COLOR[zone]; g.setLineDash(gap ? [1, 13] : []);
        g.beginPath(); g.moveTo(X(a.r.t), Y(a.r.bpm));
      }
      g.lineTo(X(b.r.t), Y(b.r.bpm));
    }
    g.stroke(); g.setLineDash([]);

    text('0:00', x0, y1 + 28, 200, 500, 24, MUTED);
    text(mmss(tMax - tMin), x1, y1 + 28, 200, 500, 24, MUTED, 'right');

    // What the colours mean, for someone who has never seen the game: the line's colours on one
    // row (only the ones on this card), the shaded areas on the next.
    const lines = [['In zone', 'InZone'], ['Below', 'Below'], ['Above', 'Above'], ['Safety brake', 'SafetyBrake'], ['No signal', 'NoSignal']]
      .filter(([, zone]) => seen.has(zone));
    const slot = Math.min(312, (R - L) / lines.length);
    lines.forEach(([label, zone], k) => {
      dot(L + k * slot + 9, y1 + 66, 9, ZONE_COLOR[zone]);
      text(label, L + k * slot + 30, y1 + 67, slot - 42, 500, 24, SOFT, 'left', 18);
    });
    const areas = [['Target zone', 'rgba(77,255,115,0.45)']];
    if (shaded) areas.push(['Warm-up / cool-down', 'rgba(255,255,255,0.22)']);
    areas.forEach(([label, colour], k) => {
      box(L + k * 312, y1 + 93, 18, 18, 4, colour);
      text(label, L + k * 312 + 30, y1 + 103, 270, 500, 24, SOFT, 'left', 18);
    });
  }

  // The numbers. Time in zone is what the game is about, so it leads; recovery sits beside it when
  // there is one (it needs a full minute of cool-down), which keeps the grid below even either way.
  const hasRecovery = Number.isFinite(st.recovery);
  text('Time in zone', L, 814, 520, 500, 30, MUTED);
  if (hasRecovery) text('1-min recovery', R, 814, 330, 500, 30, MUTED, 'right');
  g.textBaseline = 'alphabetic'; // two type sizes on one line have to share a baseline
  const tw = text(st.inZone >= 0 ? mmss(st.inZone) : '--', L, 916, 340, 800, 96, ZONE_COLOR.InZone);
  if (st.pct >= 0) text(`${Math.round(st.pct)}%`, L + tw + 28, 916, (hasRecovery ? 640 : R) - (L + tw + 28), 700, 56, WHITE);
  if (hasRecovery) text(`${st.recovery >= 0 ? '-' : '+'}${Math.abs(Math.round(st.recovery))} BPM`, R, 916, 330, 800, 72, WHITE, 'right');
  g.textBaseline = 'middle';
  box(L, 942, R - L, 14, 7, TRACK);
  if (st.pct > 0) box(L, 942, ((R - L) * clamp(st.pct, 0, 100)) / 100, 14, 7, ZONE_COLOR.InZone);

  const tile = (label, value, col, row) => {
    const x = col ? 552 : L, y = 1004 + row * 110;
    text(label, x, y, 444, 500, 28, MUTED);
    text(value, x, y + 50, 444, 700, 60, WHITE);
  };
  tile('Avg / peak BPM', `${st.avg > 0 ? Math.round(st.avg) : '--'} / ${st.peak > 0 ? Math.round(st.peak) : '--'}`, 0, 0);
  tile('Calories', st.kcal >= 0 ? `${grouped(st.kcal)} kcal` : '--', 1, 0);
  tile('Longest streak', st.streak >= 0 ? mmss(st.streak) : '--', 0, 1);
  tile('Score', st.score >= 0 ? grouped(st.score) : '--', 1, 1);

  // One line for the level and the badges this workout earned (v58), when the record has them.
  const lv = rec.level ?? sum.level, lvN = num(lv && typeof lv === 'object' ? lv.level : lv);
  const title = lv && typeof lv === 'object' ? words(lv.title, 24) : '';
  const bx = L + (lvN >= 1 ? text(`Level ${Math.round(lvN)}${title ? `  ·  ${title}` : ''}`, L, 1232, 420, 700, 30, GOLD) + 36 : 0);
  const badges = Array.isArray(rec.badges) && rec.badges.length ? rec.badges : Array.isArray(sum.badges) ? sum.badges : [];
  const names = badges.map((b) => words(typeof b === 'string' ? b : b?.name, 28)).filter(Boolean);
  if (names.length) {
    // As many whole names as the line holds (three at most) and the rest as a count. If even one
    // is too long, the name gives way, not the count after it.
    let n = Math.min(3, names.length), first = names[0];
    const said = () => `${names.length === 1 ? 'Badge' : 'Badges'} earned: ${[first, ...names.slice(1, n)].join(', ')}${names.length > n ? ` +${names.length - n} more` : ''}`;
    while (n > 1 && width(said(), 500, 24) > R - bx) n--;
    while (first.length > 4 && width(said(), 500, 24) > R - bx) first = `${first.slice(0, -2).trimEnd()}…`;
    text(said(), bx, 1232, R - bx, 500, 28, SOFT, 'left', 24);
  }

  line(L, 1270, R, 1270, 'rgba(255,255,255,0.10)', 2);
  text('heart-rate-adaptive VR workout', CARD_W / 2, 1304, R - L, 500, 26, MUTED, 'center');
  return canvas;
}

/**
 * The card as a PNG blob, made on the spot (null if this browser has no canvas to draw on).
 * toDataURL rather than toBlob on purpose: toBlob answers in a later task, and an iPhone only
 * opens the share sheet straight from the tap that asked for it.
 */
export function cardBlobSync(rec) {
  try {
    if (typeof document === 'undefined' || typeof Blob === 'undefined' || typeof atob !== 'function') return null;
    const canvas = document.createElement('canvas');
    if (!drawCard(canvas, rec)) return null;
    const url = canvas.toDataURL('image/png');
    if (typeof url !== 'string' || !url.startsWith('data:image/png;base64,')) return null;
    const bin = atob(url.slice(url.indexOf(',') + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: 'image/png' });
  } catch {
    return null; // a blocked or broken canvas: the caller says so instead of failing
  }
}

/** The card as a Promise of a PNG blob (null if this browser has no canvas). Never rejects. */
export function cardBlob(rec) {
  return Promise.resolve(cardBlobSync(rec));
}
