// Move picker (v61): choose the moves for this workout before it starts. A grid of move cards;
// aim a controller at one and the panel beside it plays a looping figure of the move with a line on
// how to do it; trigger switches it on or off. Opens when you enter VR (the workout waits), and from
// the board (Pick moves). Gio: "a nice choose-the-workout-types ... when you aim at it, a quick
// video of the move as reference before starting".
import { MOVE_FIGS, drawFigure } from './movefig.js?v62';
// v62 (Gio: "very blurry and goes left and right"): drawn at 2x resolution with anisotropic filtering,
// 7 columns (room for the hammer swing), and game.js keeps it anchored where it opened.

/** Picker cards: each switches one or more moveset keys together. */
export const PICK_CARDS = Object.freeze([
  { id: 'punch', name: 'Boxing numbers', keys: ['jab', 'swing', 'power'], cat: 'Orbs', text: 'Called combos: 1 jab, 2 cross, 3-4 hooks, 5-6 uppercuts. Odd = lead hand; switch stance and they flip.' },
  { id: 'squatPunch', name: 'Squat punches', keys: ['low', 'pair'], cat: 'Orbs', text: 'A low orb, then a high one: squat, then punch up or hook.' },
  { id: 'hammer', name: 'Hammer fists', keys: ['hammer'], cat: 'Orbs', text: 'Two drum pads: hammer down with the bottom of your fist, left then right.' },
  { id: 'trace', name: 'Rope tracing', keys: ['trace', 'sweep'], cat: 'Orbs', text: 'Follow the glowing rope with one hand, or both hands together.' },
  { id: 'guard', name: 'Guard & counter', keys: ['guard'], cat: 'Orbs', text: 'Block where the shot is coming, high or low, then counter-punch.' },
  { id: 'bag', name: 'Speed bag', keys: ['bag'], cat: 'Bursts', text: 'A few seconds of quick little punches, rolling your fists on the bag.' },
  { id: 'ropes', name: 'Battle ropes', keys: ['ropes'], cat: 'Bursts', text: 'Fast alternate waves in a half squat, finished with a two-fisted slam.' },
  { id: 'heavy', name: 'Heavy bag', keys: ['heavy'], cat: 'Bursts', text: 'Big punches into the heavy bag. Hard hits count as HEAVY.' },
  { id: 'sled', name: 'Sled run', keys: ['sled'], cat: 'Bursts', text: 'Ski poles: reach forward, pull both down and back past your hips, then tuck.' },
  { id: 'barrage', name: 'Missiles', keys: ['barrage'], cat: 'Bursts', text: 'Duck and weave: dip to the side away from the pair, or duck under the row.' },
  { id: 'knee', name: 'Knee drive', keys: ['knee'], cat: 'Body', text: 'Grab the bar overhead, pull it down and drive a knee up. Alternate legs.' },
  { id: 'press', name: 'Wall ball', keys: ['press'], cat: 'Body', text: 'Squat, drive up, press the ball to the ring on the beat. 10-15 s, then the ropes.' },
  { id: 'chop', name: 'Tree chop', keys: ['chop'], cat: 'Body', text: 'Hands together by one shoulder, swing across through the trunk.' },
  { id: 'kettle', name: 'Hammer swing', keys: ['kettle'], cat: 'Body', text: 'Hinge at the hips and grab the hammer low with both hands, then snap your hips and swing it up onto the bag top.' },
  { id: 'tiptoe', name: 'Tiptoe reach', keys: ['tiptoe'], cat: 'Body', text: 'Up on your toes and touch the star, one hand at a time.' },
  { id: 'duck', name: 'Duck walls', keys: ['duck'], cat: 'Walls', text: 'A bar slides in at head height: squat under it.' },
  { id: 'squatSide', name: 'Side squats', keys: ['squatSide'], cat: 'Walls', text: 'Squat and dip your head to the open side, left or right. Feet stay put.' },
  { id: 'lean', name: 'Lean walls', keys: ['lean', 'pillar'], cat: 'Walls', text: 'Lean your upper body left or right around the wall or the pillar.' },
  { id: 'pose', name: 'Pose walls', keys: ['pose'], cat: 'Walls', text: 'Hold the shape cut in the wall: a Y, a T, or a squat with arms up.' },
]);
/** Is a card on (any of its moves on)? */
export const cardOn = (card, moves) => card.keys.some((k) => !!moves[k]);

const GW = 1340, GH = 960, PW = 480, PH = 720;
const COLS = 7, CW = 170, CH = 200, GAP = 14, X0 = 30, Y0 = 130;
const SS = 2, PSS = 1.5; // supersampling: the canvases are drawn at 2x (grid) and 1.5x (preview) for sharp text
const CAT = { Orbs: '#6ea2ff', Bursts: '#ff9a4d', Body: '#6dffd8', Walls: '#f2c14e' };
const FIG = { fig: '#e6efec', dim: '#3d4f49', left: '#3fa9ff', right: '#ff7a3d', prop: '#6dffd8', floor: 'rgba(147,164,158,0.5)' };

export class MovePicker {
  /** hooks: { moves() -> settings.moves, toggle(keys, on), start(), close() } */
  constructor(THREE, hooks, { anisotropy = 1 } = {}) {
    this.hooks = hooks; this.isOpen = false; this.hover = null; this.shown = PICK_CARDS[0]; this.key = ''; this.lastPrev = -1;
    this.buttons = [];
    const mk = (w, h, mw, mh, ss) => {
      const c = document.createElement('canvas'); c.width = Math.round(w * ss); c.height = Math.round(h * ss);
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = anisotropy;
      const g = c.getContext('2d'); g.scale(ss, ss); // draw in the same layout units as before
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(mw, mh), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false }));
      mesh.renderOrder = 998; // over the scoreboard and the lane
      return { c, g, tex, mesh };
    };
    this.grid = mk(GW, GH, 1.2 * GW / 1280, 0.9, SS);
    this.prev = mk(PW, PH, 0.6, 0.9, PSS);
    this.grid.mesh.position.set(-0.34, 0, 0);
    this.prev.mesh.position.set(0.64, 0, 0.08); this.prev.mesh.rotation.y = -0.28;
    this.group = new THREE.Group(); this.group.add(this.grid.mesh, this.prev.mesh); this.group.visible = false;
  }
  open() { this.isOpen = true; this.group.visible = true; this.key = ''; this.drawGrid(); }
  close() { this.isOpen = false; this.group.visible = false; this.hover = null; }

  // ------------------------------------------------------------ pointing
  at(uv) {
    const x = uv.x * GW, y = (1 - uv.y) * GH;
    return this.buttons.find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h)?.id || null;
  }
  setHoverUv(uv) {
    const id = uv ? this.at(uv) : null;
    if (id !== this.hover) { this.hover = id; const card = PICK_CARDS.find((c) => c.id === id); if (card) this.shown = card; }
  }
  clickUv(uv) {
    const id = this.at(uv);
    if (!id) return false;
    const moves = this.hooks.moves();
    if (id === 'start') this.hooks.start();
    else if (id === 'close') this.hooks.close();
    else if (id === 'all') { const allOn = PICK_CARDS.every((c) => cardOn(c, moves)); this.hooks.toggle(PICK_CARDS.flatMap((c) => c.keys), !allOn); }
    else { const card = PICK_CARDS.find((c) => c.id === id); if (card) { this.shown = card; this.hooks.toggle(card.keys, !cardOn(card, moves)); } }
    this.key = '';
    return true;
  }

  /** Every frame while open: redraws the grid when something changed, the preview at ~30 fps. */
  update(time) {
    if (!this.isOpen) return;
    const moves = this.hooks.moves();
    const key = `${this.hover}|${PICK_CARDS.map((c) => (cardOn(c, moves) ? 1 : 0)).join('')}`;
    if (key !== this.key) { this.key = key; this.drawGrid(); }
    if (time - this.lastPrev >= 1 / 24) { this.lastPrev = time; this.drawPreview(time * 2, moves); } // 120 BPM
  }

  // ------------------------------------------------------------ drawing
  drawGrid() {
    const { g } = this.grid, moves = this.hooks.moves();
    this.buttons = [];
    g.clearRect(0, 0, GW, GH);
    g.fillStyle = '#080e0d'; g.beginPath(); g.roundRect(0, 0, GW, GH, 30); g.fill();
    g.strokeStyle = '#6dffd8'; g.lineWidth = 4; g.stroke();
    g.textAlign = 'left'; g.fillStyle = '#ffffff'; g.font = '800 58px system-ui, sans-serif'; g.fillText('PICK YOUR MOVES', X0, 78);
    g.fillStyle = '#93a49e'; g.font = '500 28px system-ui, sans-serif'; g.textAlign = 'right';
    g.fillText('Aim to preview · trigger to switch on / off', GW - X0, 76);
    PICK_CARDS.forEach((c, i) => {
      const x = X0 + (i % COLS) * (CW + GAP), y = Y0 + Math.floor(i / COLS) * (CH + GAP);
      const on = cardOn(c, moves), hov = this.hover === c.id;
      g.fillStyle = on ? 'rgba(109,255,216,0.16)' : 'rgba(255,255,255,0.04)';
      g.beginPath(); g.roundRect(x, y, CW, CH, 18); g.fill();
      g.strokeStyle = hov ? '#ffffff' : on ? '#6dffd8' : 'rgba(147,164,158,0.35)'; g.lineWidth = hov ? 5 : 3; g.stroke();
      g.fillStyle = CAT[c.cat]; g.beginPath(); g.roundRect(x + 12, y + 12, 10, 26, 4); g.fill();
      g.textAlign = 'left'; g.fillStyle = '#93a49e'; g.font = '600 20px system-ui, sans-serif'; g.fillText(c.cat.toUpperCase(), x + 30, y + 32);
      g.textAlign = 'right'; g.fillStyle = on ? '#6dffd8' : '#93a49e'; g.font = '800 22px system-ui, sans-serif'; g.fillText(on ? 'ON' : 'OFF', x + CW - 14, y + 32);
      g.globalAlpha = on ? 1 : 0.45;
      drawFigure(g, c.id, 0.35, x + 20, y + 40, CW - 40, 104, FIG);
      g.globalAlpha = 1;
      g.textAlign = 'center'; g.fillStyle = on ? '#ffffff' : '#b9c4c0'; g.font = '700 25px system-ui, sans-serif';
      g.fillText(c.name, x + CW / 2, y + CH - 22, CW - 16);
      this.buttons.push({ id: c.id, x, y, w: CW, h: CH });
    });
    const n = PICK_CARDS.filter((c) => cardOn(c, moves)).length;
    const btn = (id, label, x, w, main) => {
      const y = 806, h = 116, hov = this.hover === id;
      g.fillStyle = main ? '#6dffd8' : 'rgba(255,255,255,0.08)'; g.beginPath(); g.roundRect(x, y, w, h, 22); g.fill();
      g.strokeStyle = hov ? '#ffffff' : main ? '#6dffd8' : 'rgba(147,164,158,0.5)'; g.lineWidth = hov ? 6 : 3; g.stroke();
      g.textAlign = 'center'; g.fillStyle = main ? '#06110e' : '#e6efec'; g.font = `800 ${main ? 46 : 34}px system-ui, sans-serif`;
      g.fillText(label, x + w / 2, y + h / 2 + (main ? 16 : 12));
      this.buttons.push({ id, x, y, w, h });
    };
    btn('all', PICK_CARDS.every((c) => cardOn(c, moves)) ? 'All off' : 'All on', X0, 210, false);
    btn('close', 'Back', X0 + 230, 170, false);
    g.textAlign = 'left'; g.fillStyle = '#93a49e'; g.font = '600 30px system-ui, sans-serif';
    g.fillText(n ? `${n} of ${PICK_CARDS.length} on` : 'Nothing on: plain punches', X0 + 430, 875);
    btn('start', 'START WORKOUT', GW - X0 - 470, 470, true);
    this.grid.tex.needsUpdate = true;
  }
  drawPreview(beats, moves) {
    const { g } = this.prev, c = this.shown, on = cardOn(c, moves);
    g.clearRect(0, 0, PW, PH);
    g.fillStyle = '#080e0d'; g.beginPath(); g.roundRect(0, 0, PW, PH, 30); g.fill();
    g.strokeStyle = CAT[c.cat]; g.lineWidth = 4; g.stroke();
    g.textAlign = 'left'; g.fillStyle = CAT[c.cat]; g.font = '700 24px system-ui, sans-serif'; g.fillText(c.cat.toUpperCase(), 32, 52);
    g.fillStyle = '#ffffff'; g.font = '800 46px system-ui, sans-serif'; g.fillText(c.name, 32, 106, PW - 64);
    g.fillStyle = 'rgba(109,255,216,0.08)'; g.fillRect(24, 128, PW - 48, 380);
    if (MOVE_FIGS[c.id]) drawFigure(g, c.id, beats, 24, 128, PW - 48, 380, FIG);
    g.fillStyle = '#e6efec'; g.font = '500 24px system-ui, sans-serif';
    let y = 548, line = '';
    for (const w of c.text.split(' ')) { const t = line ? `${line} ${w}` : w; if (g.measureText(t).width > PW - 64 && line) { g.fillText(line, 32, y); y += 32; line = w; } else line = t; }
    if (line) g.fillText(line, 32, y);
    g.fillStyle = on ? '#6dffd8' : '#93a49e'; g.font = '800 28px system-ui, sans-serif';
    g.fillText(on ? 'ON · trigger to switch off' : 'OFF · trigger to switch on', 32, PH - 30);
    this.prev.tex.needsUpdate = true;
  }
}
