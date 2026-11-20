// Move figures (v61): little animated stick figures of each move, for the move picker's previews
// (same rig as the Move Lab page). A pose is a hip drop d (m), a torso lean (degrees; in side view
// a forward hinge), a rise onto the toes, hands relative to the chest point (or absolute with abs),
// optional feet / knees. Frames ease from one pose to the next over b beats.
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => 0.5 - 0.5 * Math.cos(Math.PI * t);
const F = [[-0.17, 0], [0.17, 0]];
const G = [[-0.1, 0.08], [0.1, 0.08]]; // guard: fists by the chin
const hold = (p, b) => [{ ...p, b }, { ...p, b: 0.5 }];

/** One entry per picker card: what it shows and what it says. */
export const MOVE_FIGS = {
  punch: { view: 'front', prop: 'punch', frames: [{ d: .05, h: G, b: .5 }, { d: .07, lean: 4, h: [[-.03, .07, 1], G[1]], b: .5 }, { d: .05, h: G, b: .5 }, { d: .08, lean: -5, h: [G[0], [.03, .07, 1]], b: .5 }, { d: .05, h: G, b: .5 }, { d: .12, h: [G[0], [.12, -.18]], b: .3 }, { d: .03, h: [G[0], [.04, .26, .6]], b: .7 }] },
  squatPunch: { view: 'front', prop: 'punch', frames: [{ d: .36, h: [[-.12, -.05], [.12, -.05]], b: 1 }, { d: 0, h: [G[0], [.05, .42, .5]], b: 1 }, { d: .36, h: [[-.12, -.05], [.12, -.05]], b: 1 }, { d: .02, lean: -4, h: [[-.02, .1, .7], G[1]], b: 1 }] },
  hammer: { view: 'front', prop: null, frames: [{ d: .06, h: [[-.16, .2], [.16, .2]], b: .5 }, { d: .1, h: [[-.16, -.28], [.16, .2]], b: .5 }, { d: .06, h: [[-.16, .2], [.16, .2]], b: .5 }, { d: .1, h: [[-.16, .2], [.16, -.28]], b: .5 }] },
  trace: { view: 'front', prop: 'grip', frames: [{ d: .05, h: [[-.3, .14], [-.22, .14]], b: 1 }, { d: .12, h: [[.2, -.04], [.28, -.04]], b: 1 }, { d: .22, h: [[-.26, -.26], [-.18, -.26]], b: 1 }, { d: .05, h: [[.18, .18], [.26, .18]], b: 1 }] },
  guard: { view: 'front', prop: null, frames: [{ d: .05, h: [[-.07, .24], [.07, .24]], b: .75 }, { d: .05, h: [[-.07, .24], [.07, .24]], b: .25 }, { d: .2, h: [[-.12, -.12], [.12, -.12]], b: .75 }, { d: .2, h: [[-.12, -.12], [.12, -.12]], b: .25 }, { d: .06, lean: -5, h: [G[0], [.03, .07, 1]], b: .5 }, { d: .05, h: G, b: .5 }] },
  bag: { view: 'front', prop: 'speedbag', frames: [{ d: .04, h: [[-.07, .2, .5], [.07, .12, .5]], b: .25 }, { d: .04, h: [[-.07, .12, .5], [.07, .2, .5]], b: .25 }] },
  ropes: { view: 'front', prop: 'ropes', frames: [{ d: .17, h: [[-.2, -.28], [.2, -.62]], b: .5 }, { d: .17, h: [[-.2, -.62], [.2, -.28]], b: .5 }] },
  heavy: { view: 'front', prop: 'punch', frames: [{ d: .08, h: G, b: .5 }, { d: .1, lean: 6, h: [[-.02, .05, 1], G[1]], b: .5 }, { d: .08, h: G, b: .4 }, { d: .14, lean: -10, h: [G[0], [.02, .05, 1]], b: .6 }] },
  sled: { view: 'side', prop: 'poles', frames: [{ d: .04, h: [[.36, .12], [.4, .1]], f: [[-.04, 0], [.06, 0]], b: 1 }, { d: .16, lean: 34, h: [[-.2, -.55], [-.16, -.58]], f: [[-.04, 0], [.06, 0]], b: 1 }] },
  barrage: { view: 'front', prop: null, frames: [{ d: .05, h: G, b: .5 }, { d: .3, lean: -16, h: G, b: .75 }, { d: .05, h: G, b: .5 }, { d: .3, lean: 16, h: G, b: .75 }, { d: .05, h: G, b: .5 }, { d: .38, h: G, b: 1 }] },
  knee: { view: 'side', prop: 'bar', frames: [{ d: 0, rise: .02, h: [[.12, .58], [.16, .58]], f: [[0, 0], [.04, 0]], b: 1 }, { d: .02, lean: 12, h: [[.18, -.12], [.22, -.1]], f: [[0, 0], [.22, .48]], k: [null, [.34, .78]], b: 1 }] },
  press: { view: 'front', prop: 'ball', frames: [{ d: .36, h: [[-.13, -.22], [.13, -.22]], b: 1 }, { d: 0, rise: .03, h: [[-.12, .56], [.12, .56]], b: 1 }] },
  chop: { view: 'front', prop: 'grip', frames: [{ d: .04, lean: -6, h: [[.26, .36], [.34, .4]], b: 1 }, { d: .3, lean: 10, h: [[-.32, -.72], [-.24, -.76]], b: 1 }, { d: .04, lean: 6, h: [[-.34, .4], [-.26, .36]], b: 1 }, { d: .3, lean: -10, h: [[.24, -.76], [.32, -.72]], b: 1 }] },
  // v62 hammer swing: hinge with the hands low between the knees, then snap up with the arms out at chest height.
  kettle: { view: 'side', prop: 'grip', frames: [{ d: .12, lean: 44, h: [[.08, -.66], [.1, -.66]], b: .6 }, { d: .12, lean: 44, h: [[.08, -.66], [.1, -.66]], b: .2 }, { d: 0, h: [[.5, .02], [.52, .02]], b: .5 }, { d: 0, h: [[.5, .02], [.52, .02]], b: .3 }] },
  tiptoe: { view: 'front', prop: 'star', frames: [{ d: 0, h: [[-.2, -.5], [.2, -.5]], b: .5 }, { d: 0, rise: .06, h: [[-.2, -.5], [.16, .64]], b: 1 }, { d: 0, h: [[-.2, -.5], [.2, -.5]], b: .5 }, { d: 0, rise: .06, h: [[-.16, .64], [.2, -.5]], b: 1 }] },
  duck: { view: 'front', prop: 'duckbar', frames: [...hold({ d: .02, h: G }, 1), ...hold({ d: .42, h: G }, 1)] },
  squatSide: { view: 'front', prop: null, frames: [{ d: .03, h: G, b: .75 }, { d: .32, lean: -14, h: G, b: .75 }, { d: .03, h: G, b: .75 }, { d: .32, lean: 14, h: G, b: .75 }] },
  lean: { view: 'front', prop: null, frames: [{ d: .02, h: G, b: .75 }, { d: .04, lean: -22, h: G, b: .75 }, { d: .02, h: G, b: .75 }, { d: .04, lean: 22, h: G, b: .75 }] },
  pose: { view: 'front', prop: null, frames: [...hold({ d: 0, h: [[-.36, .5], [.36, .5]] }, 1.5), ...hold({ d: 0, h: [[-.58, .02], [.58, .02]] }, 1.5), ...hold({ d: .36, h: [[-.14, .52], [.14, .52]] }, 1.5)] },
};

function ik(a, b, l1, l2, pick) {
  const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1e-6;
  const max = l1 + l2 - 1e-3, min = Math.abs(l1 - l2) + 1e-3, dc = Math.min(max, Math.max(min, d));
  const th = Math.atan2(dy, dx), al = Math.acos((l1 * l1 + dc * dc - l2 * l2) / (2 * l1 * dc));
  const c1 = [a[0] + l1 * Math.cos(th + al), a[1] + l1 * Math.sin(th + al)], c2 = [a[0] + l1 * Math.cos(th - al), a[1] + l1 * Math.sin(th - al)];
  return [pick(c1, c2), [a[0] + (dx / d) * Math.min(d, max), a[1] + (dy / d) * Math.min(d, max)]];
}
function mix(p, q, t) {
  const o = { d: lerp(p.d || 0, q.d || 0, t), lean: lerp(p.lean || 0, q.lean || 0, t), rise: lerp(p.rise || 0, q.rise || 0, t), abs: p.abs, h: [], f: [], k: [] };
  for (let i = 0; i < 2; i++) {
    const a = p.h[i], b = q.h[i];
    o.h[i] = [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2] || 0, b[2] || 0, t)];
    const fa = (p.f || F)[i], fb = (q.f || F)[i];
    o.f[i] = [lerp(fa[0], fb[0], t), lerp(fa[1], fb[1], t)];
    const ka = p.k?.[i], kb = q.k?.[i];
    o.k[i] = ka && kb ? [lerp(ka[0], kb[0], t), lerp(ka[1], kb[1], t)] : ka && !kb ? (t < .5 ? ka : null) : !ka && kb ? (t >= .5 ? kb : null) : null;
  }
  return o;
}
/** The pose of a figure `beats` into its loop. */
export function poseAt(fig, beats) {
  const total = fig.frames.reduce((s, f) => s + f.b, 0);
  let t = ((beats % total) + total) % total, i = 0;
  while (t >= fig.frames[i].b) { t -= fig.frames[i].b; i = (i + 1) % fig.frames.length; }
  return mix(fig.frames[i], fig.frames[(i + 1) % fig.frames.length], ease(t / fig.frames[i].b));
}
/** Joint positions (m, x right, y up) for a pose. */
export function bodyOf(p, view) {
  const side = view === 'side', lean = (p.lean * Math.PI) / 180, up = [Math.sin(lean), Math.cos(lean)];
  const hip = [0, 0.95 - p.d + p.rise], at = (o, k) => [o[0] + up[0] * k, o[1] + up[1] * k];
  const chest = at(hip, 0.5), neck = at(hip, 0.56), head = at(hip, 0.7), perp = [up[1], -up[0]];
  const sh = side ? [chest, chest] : [[chest[0] - perp[0] * .17, chest[1] - perp[1] * .17], [chest[0] + perp[0] * .17, chest[1] + perp[1] * .17]];
  const hj = side ? [hip, hip] : [[hip[0] - .1, hip[1]], [hip[0] + .1, hip[1]]];
  const out = { hip, chest, neck, head, sh, arms: [], legs: [], hands: [] };
  for (let i = 0; i < 2; i++) {
    const s = i ? 1 : -1;
    const hand = p.abs ? [p.h[i][0], p.h[i][1]] : [chest[0] + p.h[i][0], chest[1] + p.h[i][1]];
    const [el, hEnd] = ik(sh[i], hand, .3, .29, side ? (a, b) => (a[1] < b[1] ? a : b) : (a, b) => (s * a[0] > s * b[0] ? a : b));
    out.arms.push([sh[i], el, hEnd]); out.hands.push([...hEnd, p.h[i][2] || 0]);
    const foot = [p.f[i][0], p.f[i][1] + (p.f[i][1] < .05 ? p.rise : 0)];
    const knee = p.k[i] ? [p.k[i][0], p.k[i][1] + p.rise] : ik(hj[i], foot, .47, .47, side ? (a, b) => (a[0] > b[0] ? a : b) : (a, b) => (s * a[0] > s * b[0] ? a : b))[0];
    out.legs.push([hj[i], knee, foot]);
  }
  return out;
}

/** Draw a figure into a 2D context box (x, y, w, h). colors: { fig, dim, left, right, prop, floor }. */
export function drawFigure(g, key, beats, x, y, w, h, colors) {
  const fig = MOVE_FIGS[key];
  if (!fig) return;
  const p = poseAt(fig, beats), b = bodyOf(p, fig.view);
  const sc = h / 2.55, ox = x + w / 2, oy = y + h * 0.93;
  const P = (q) => [ox + q[0] * sc, oy - q[1] * sc];
  const lw = Math.max(3, sc * 0.05);
  const line = (pts, col, wid) => { g.strokeStyle = col; g.lineWidth = wid; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); pts.forEach((q, i) => { const [px, py] = P(q); if (i) g.lineTo(px, py); else g.moveTo(px, py); }); g.stroke(); };
  const dot = (q, r, col, a = 1) => { const [px, py] = P(q); g.globalAlpha = a; g.fillStyle = col; g.beginPath(); g.arc(px, py, r * sc, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1; };
  const far = fig.view === 'side' ? 0 : -1;
  g.strokeStyle = colors.floor; g.lineWidth = 2; g.beginPath(); g.moveTo(x + w * .12, oy + 1); g.lineTo(x + w * .88, oy + 1); g.stroke();
  if (fig.prop === 'duckbar') line([[-.6, 1.62], [.6, 1.62]], colors.prop, lw * .8);
  if (fig.prop === 'bar') { const yb = b.chest[1] + .62; line([[b.chest[0] - .25, Math.max(yb, b.hands[0][1])], [b.chest[0] + .45, Math.max(yb, b.hands[1][1])]], colors.prop, lw * .6); }
  if (fig.prop === 'speedbag') dot([0, 1.86], .1, colors.prop, .85);
  for (let i = 0; i < 2; i++) if (i === far) { line(b.legs[i], colors.dim, lw); line(b.arms[i], colors.dim, lw); }
  line([b.hip, b.neck], colors.fig, lw * 1.15);
  for (let i = 0; i < 2; i++) if (i !== far) line(b.legs[i], colors.fig, lw);
  if (fig.view === 'front') line([b.sh[0], b.sh[1]], colors.fig, lw);
  dot(b.head, .1, colors.fig);
  for (let i = 0; i < 2; i++) if (i !== far) line(b.arms[i], colors.fig, lw);
  const mid = [(b.hands[0][0] + b.hands[1][0]) / 2, (b.hands[0][1] + b.hands[1][1]) / 2];
  if (fig.prop === 'ball') dot([mid[0], mid[1] + .02], .13, colors.prop, .9);
  if (fig.prop === 'ropes') for (let i = 0; i < 2; i++) {
    const [x0, y0] = P(b.hands[i]); g.strokeStyle = colors.prop; g.lineWidth = lw * .5; g.beginPath(); g.moveTo(x0, y0);
    for (let k = 1; k <= 16; k++) { const t = k / 16; g.lineTo(x0 + (i ? 1 : -1) * t * w * .2, lerp(y0, oy, t) + Math.sin(t * 9 - beats * 6 + i * 3) * sc * .05 * (1 - t)); }
    g.stroke();
  }
  if (fig.prop === 'poles') for (let i = 0; i < 2; i++) { const hn = b.hands[i]; line([[hn[0] + .03, hn[1] + .08], [hn[0] - .45 + (p.lean / 34) * .1, Math.max(0, hn[1] - 1.05)]], i === far ? colors.dim : colors.prop, lw * .45); }
  if (fig.prop === 'star') { const up = b.hands[0][1] > b.hands[1][1] ? b.hands[0] : b.hands[1]; if (up[1] > b.head[1]) dot([up[0], up[1] + .1], .07, colors.prop, .9); }
  for (let i = 0; i < 2; i++) dot(b.hands[i], .055 + .04 * b.hands[i][2], i ? colors.right : colors.left, i === far ? .45 : 1);
}
