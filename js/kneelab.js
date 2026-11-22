// Knee lab (v61): a 75-second guided test of what the headset can tell about your legs.
// Five steps (stand still, jog, high knees, knee pads, cross crunch). Every detector from
// kneetrack.js runs live and pings when it fires, so you can see what it catches and what it
// misses; the raw motion is recorded and sent to the phone page as a file, so the thresholds can
// be checked against real moves. The workout is paused while it runs.
// Start: board -> Diag -> Test 4 -> Knee lab. Open the game with ?kneelab to also ask the Quest
// browser for body tracking (its estimated skeleton, legs included, if it shares one).
import { KNEE, StepCounter, KneeBump, CrunchDetector, KneeLift, headAngles, kneeOf, LEG_JOINT } from './kneetrack.js?v63';

export const LAB_STEPS = Object.freeze([
  { key: 'still', secs: 6, title: 'STAND STILL', text: 'Measuring your normal height and stance.' },
  { key: 'jog', secs: 12, title: 'JOG IN PLACE', text: 'Easy jog on the spot, knees low.' },
  { key: 'high', secs: 12, title: 'HIGH KNEES', text: 'Knees up to hip height, on the spot.' },
  { key: 'pads', secs: 15, title: 'KNEE PADS', text: 'Fists on the two pads. Drive each knee up into the fist above it.' },
  { key: 'crunch', secs: 15, title: 'CROSS CRUNCH', text: 'Hands behind your head. Elbow to the opposite knee, side to side.' },
]);
export const LAB_READY = 3; // seconds of "get ready" before each step
export const labSeconds = () => LAB_STEPS.reduce((s, x) => s + x.secs + LAB_READY, 0);

const mm = (v) => (Number.isFinite(v) ? Math.round(v * 1000) : null);
const COLS = ['ms', 'step', 'go', 'hx', 'hy', 'hz', 'yaw', 'pitch', 'roll', 'lx', 'ly', 'lz', 'rx', 'ry', 'rz', 'lvy', 'rvy', 'klx', 'kly', 'klz', 'krx', 'kry', 'krz', 'ev'];

export class KneeLab {
  constructor(THREE, scene) {
    this.THREE = THREE; this.scene = scene;
    this.active = false; this.result = null; this.onDone = null;
    this.canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    if (!this.canvas) return; // Node: logic only
    this.canvas.width = 1024; this.canvas.height = 640;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.panel = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.8125), new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false }));
    this.panel.renderOrder = 999; // always readable, even with the scoreboard behind it
    this.group = new THREE.Group(); this.group.add(this.panel); this.group.visible = false;
    this.padMat = [0, 1].map(() => new THREE.MeshBasicMaterial({ color: 0x6dffd8, transparent: true, opacity: 0.55 }));
    this.pads = [0, 1].map((i) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.02, 28), this.padMat[i]); m.visible = false; this.group.add(m); return m; });
    scene.add(this.group);
  }

  /** Begin. head {x,y,z}, quat {x,y,z,w}, standing (eye height standing tall), t (s). */
  start({ head, quat, standing, t, bodyShared }) {
    const { yaw } = headAngles(quat);
    const a = (yaw * Math.PI) / 180;
    this.fwd = { x: -Math.sin(a), z: -Math.cos(a) }; this.right = { x: Math.cos(a), z: -Math.sin(a) };
    this.origin = { x: head.x, z: head.z };
    this.standing = standing; this.t0 = t; this.active = true; this.result = null;
    this.steps = new StepCounter(); this.bumpL = new KneeBump(); this.bumpR = new KneeBump(); this.crunch = new CrunchDetector();
    this.liftL = new KneeLift(); this.liftR = new KneeLift(); this.kneeBase = { l: [], r: [] };
    this.counts = LAB_STEPS.map(() => ({ steps: 0, cadMax: 0, ampSum: 0, bumpL: 0, bumpR: 0, crunchL: 0, crunchR: 0, liftL: 0, liftR: 0, kneePeakL: 0, kneePeakR: 0 }));
    this.rows = []; this.events = []; this.bodyShared = !!bodyShared; this.jointNames = null; this.bodyFrames = 0;
    this.pad = [-1, 1].map((s) => ({ x: head.x + this.fwd.x * 0.3 + this.right.x * 0.17 * s, y: standing - 0.68, z: head.z + this.fwd.z * 0.3 + this.right.z * 0.17 * s }));
    if (this.group) {
      this.group.visible = true;
      this.panel.position.set(head.x + this.fwd.x * 1.7, standing + 0.05, head.z + this.fwd.z * 1.7);
      this.panel.lookAt(head.x, standing + 0.05, head.z);
      this.pads.forEach((p, i) => p.position.set(this.pad[i].x, this.pad[i].y, this.pad[i].z));
    }
    this.lastDraw = -9; this.lastStepIdx = -1;
  }
  stop() { this.active = false; if (this.group) { this.group.visible = false; this.pads.forEach((p) => { p.visible = false; }); } }

  /** Where the lab is at `t`: step index, in its ready phase or going, seconds left. idx = steps.length when done. */
  phaseAt(t) {
    let e = t - this.t0;
    for (let i = 0; i < LAB_STEPS.length; i++) {
      if (e < LAB_READY) return { idx: i, go: false, left: LAB_READY - e };
      e -= LAB_READY;
      if (e < LAB_STEPS[i].secs) return { idx: i, go: true, left: LAB_STEPS[i].secs - e };
      e -= LAB_STEPS[i].secs;
    }
    return { idx: LAB_STEPS.length, go: false, left: 0 };
  }

  /**
   * One frame. L / R fists {x,y,z}, vyL / vyR their upward speed (m/s), body = { jointName: {x,y,z} }
   * from body tracking or null. Returns this frame's detections: [{ type, side }].
   */
  update({ t, dt, head, quat, L, R, vyL = 0, vyR = 0, body = null }) {
    if (!this.active) return [];
    const ph = this.phaseAt(t);
    if (ph.idx >= LAB_STEPS.length) { this.finish(); return []; }
    const key = LAB_STEPS[ph.idx].key, c = this.counts[ph.idx];
    const { yaw, pitch, roll } = headAngles(quat);
    const out = [];
    if (this.steps.update(head.y, t, dt) && ph.go) { c.steps++; c.ampSum += this.steps.amp; out.push({ type: 'step' }); }
    if (ph.go) c.cadMax = Math.max(c.cadMax, this.steps.cadence(t));
    if (this.bumpL.update(L, this.pad[0], vyL, t) && ph.go) { c.bumpL++; out.push({ type: 'bump', side: 'left' }); }
    if (this.bumpR.update(R, this.pad[1], vyR, t) && ph.go) { c.bumpR++; out.push({ type: 'bump', side: 'right' }); }
    const cr = this.crunch.update({ head, yaw, roll, L, R, standing: this.standing, t });
    if (cr && ph.go) { c[cr === 'left' ? 'crunchL' : 'crunchR']++; out.push({ type: 'crunch', side: cr, ...this.crunch.last }); }
    // Body tracking: the knees' heights, with their standing height taken during STAND STILL.
    let kl = null, kr = null;
    if (body) {
      this.bodyShared = true; this.bodyFrames++;
      if (!this.jointNames) this.jointNames = Object.keys(body);
      kl = kneeOf(body, 'left'); kr = kneeOf(body, 'right');
      if (key === 'still' && ph.go) { if (kl) this.kneeBase.l.push(kl.y); if (kr) this.kneeBase.r.push(kr.y); }
      else if (ph.idx > 0) {
        const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
        if (this.liftL.base == null && this.kneeBase.l.length) this.liftL.setBase(avg(this.kneeBase.l));
        if (this.liftR.base == null && this.kneeBase.r.length) this.liftR.setBase(avg(this.kneeBase.r));
        if (kl && this.liftL.update(kl.y) && ph.go) { c.liftL++; out.push({ type: 'lift', side: 'left' }); }
        if (kr && this.liftR.update(kr.y) && ph.go) { c.liftR++; out.push({ type: 'lift', side: 'right' }); }
        if (kl && this.liftL.base != null) c.kneePeakL = Math.max(c.kneePeakL, kl.y - this.liftL.base);
        if (kr && this.liftR.base != null) c.kneePeakR = Math.max(c.kneePeakR, kr.y - this.liftR.base);
      }
    }
    const ev = out.map((e) => `${e.type[0]}${e.side ? e.side[0] : ''}`).join(' ');
    for (const e of out) this.events.push({ ms: Math.round((t - this.t0) * 1000), step: key, ...e });
    this.rows.push([Math.round((t - this.t0) * 1000), ph.idx, ph.go ? 1 : 0, mm(head.x), mm(head.y), mm(head.z), Math.round(yaw * 10), Math.round(pitch * 10), Math.round(roll * 10),
      mm(L.x), mm(L.y), mm(L.z), mm(R.x), mm(R.y), mm(R.z), Math.round(vyL * 100), Math.round(vyR * 100),
      mm(kl?.x), mm(kl?.y), mm(kl?.z), mm(kr?.x), mm(kr?.y), mm(kr?.z), ev]);
    if (this.group) {
      this.pads.forEach((p, i) => { p.visible = key === 'pads'; this.padMat[i].opacity = (i ? this.bumpR : this.bumpL).on ? 0.95 : 0.4; });
      if (t - this.lastDraw > 0.1 || out.length || ph.idx !== this.lastStepIdx) { this.lastDraw = t; this.lastStepIdx = ph.idx; this.draw(ph, c, t, kl, kr); }
    }
    return out;
  }

  finish() {
    this.active = false;
    this.result = {
      app: 'PulseZone', kind: 'kneelab', date: new Date().toISOString(), standing: +this.standing.toFixed(3), thresholds: { ...KNEE },
      body: { shared: this.bodyShared, frames: this.bodyFrames, joints: this.jointNames || [], legJoints: (this.jointNames || []).filter((n) => LEG_JOINT.test(n)) },
      steps: LAB_STEPS.map((s, i) => ({ key: s.key, title: s.title, secs: s.secs, ...this.counts[i], ampAvg: this.counts[i].steps ? +(this.counts[i].ampSum / this.counts[i].steps).toFixed(3) : 0 })),
      cols: COLS, rows: this.rows, events: this.events,
    };
    if (this.group) { this.pads.forEach((p) => { p.visible = false; }); this.drawResult(); setTimeout(() => { if (!this.active) this.group.visible = false; }, 20000); }
    try { this.onDone?.(this.result); } catch { /* ignore */ }
  }

  // ------------------------------------------------------------ panel
  draw(ph, c, t, kl, kr) {
    const g = this.canvas.getContext('2d'), W = 1024, H = 640;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(8,18,16,0.92)'; g.beginPath(); g.roundRect(0, 0, W, H, 28); g.fill();
    g.strokeStyle = '#6dffd8'; g.lineWidth = 4; g.stroke();
    const s = LAB_STEPS[ph.idx];
    g.textAlign = 'left'; g.fillStyle = '#93a49e'; g.font = '600 30px system-ui, sans-serif';
    g.fillText(`KNEE LAB · step ${ph.idx + 1} of ${LAB_STEPS.length}${ph.go ? '' : ' · get ready'}`, 48, 66);
    g.fillStyle = ph.go ? '#6dffd8' : '#ffffff'; g.font = '800 84px system-ui, sans-serif';
    g.fillText(s.title, 48, 160);
    g.textAlign = 'right'; g.font = '800 96px system-ui, sans-serif'; g.fillStyle = '#ffffff';
    g.fillText(String(Math.ceil(ph.left)), W - 48, 160);
    g.textAlign = 'left'; g.fillStyle = '#e6efec'; g.font = '500 36px system-ui, sans-serif';
    wrap(g, s.text, 48, 218, W - 96, 44);
    const line = (label, value, y, hi) => {
      g.fillStyle = hi ? '#6dffd8' : '#93a49e'; g.font = '600 32px system-ui, sans-serif'; g.fillText(label, 48, y);
      g.fillStyle = '#ffffff'; g.font = '700 38px system-ui, sans-serif'; g.fillText(value, 420, y);
    };
    line('Head bounce steps', `${c.steps}  ·  ${this.steps.cadence(t)}/min  ·  ${(this.steps.amp * 100).toFixed(1)} cm`, 350, s.key === 'jog' || s.key === 'high');
    line('Knee bumps', `L ${c.bumpL}   R ${c.bumpR}${s.key === 'pads' ? `   ${this.bumpL.on ? 'L on pad' : ''} ${this.bumpR.on ? 'R on pad' : ''}` : ''}`, 410, s.key === 'pads');
    line('Crunches', `L ${c.crunchL}   R ${c.crunchR}`, 470, s.key === 'crunch');
    const bt = !this.bodyShared ? 'not shared (open with ?kneelab)'
      : kl || kr ? `knees L ${fmtCm(kl, this.liftL)}  R ${fmtCm(kr, this.liftR)}  ·  lifts ${c.liftL + c.liftR}` : 'on, but no knee joint found';
    line('Body tracking', bt, 530, false);
    g.fillStyle = '#93a49e'; g.font = '500 26px system-ui, sans-serif';
    g.fillText('Each detection pings. Note what it misses.', 48, 600);
    this.tex.needsUpdate = true;
  }
  drawResult() {
    const g = this.canvas.getContext('2d'), W = 1024, H = 640;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(8,18,16,0.94)'; g.beginPath(); g.roundRect(0, 0, W, H, 28); g.fill();
    g.strokeStyle = '#6dffd8'; g.lineWidth = 4; g.stroke();
    g.textAlign = 'left'; g.fillStyle = '#6dffd8'; g.font = '800 64px system-ui, sans-serif'; g.fillText('KNEE LAB DONE', 48, 100);
    g.fillStyle = '#93a49e'; g.font = '600 28px system-ui, sans-serif';
    const head = ['', 'steps', 'bumps L/R', 'crunch L/R', 'knee lifts'], xs = [48, 380, 540, 730, 900];
    head.forEach((h, i) => g.fillText(h, xs[i], 170));
    this.result.steps.forEach((s, r) => {
      const y = 225 + r * 58;
      g.fillStyle = '#ffffff'; g.font = '700 32px system-ui, sans-serif';
      [s.title, String(s.steps), `${s.bumpL} / ${s.bumpR}`, `${s.crunchL} / ${s.crunchR}`, this.bodyShared ? String(s.liftL + s.liftR) : '-'].forEach((v, i) => g.fillText(v, xs[i], y));
    });
    g.fillStyle = '#e6efec'; g.font = '500 28px system-ui, sans-serif';
    g.fillText(this.bodyShared ? `Body tracking: on (${this.result.body.legJoints.length} leg joints)` : 'Body tracking: not shared by the browser', 48, 545);
    g.fillText('Saved. On the phone page: Save workout file.', 48, 595);
    this.tex.needsUpdate = true;
  }
}

function fmtCm(k, lift) { return k && lift.base != null ? `${k.y - lift.base >= 0 ? '+' : ''}${Math.round((k.y - lift.base) * 100)}` : '?'; }
function wrap(g, text, x, y, w, lh) {
  let lineText = '';
  for (const word of text.split(' ')) {
    const test = lineText ? `${lineText} ${word}` : word;
    if (g.measureText(test).width > w && lineText) { g.fillText(lineText, x, y); y += lh; lineText = word; } else lineText = test;
  }
  if (lineText) g.fillText(lineText, x, y);
}
