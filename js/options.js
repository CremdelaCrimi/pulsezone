// In-VR options panel on the left: a canvas-textured board you point at with a controller laser
// (trigger = click). Also works on desktop with the mouse. The game pauses while it's open.
import * as THREE from 'three';

const W = 1024, H = 2000;

export class OptionsPanel {
  /**
   * @param {object} hooks
   *   getState(): { target, minutes, warmUp, source, sound, volume, challenge, ranking, paused }
   *   act(id): perform a button action (see ids below)
   */
  constructor(hooks) {
    this.hooks = hooks;
    this.open = false;
    this.canvas = document.createElement('canvas');
    this.canvas.width = W; this.canvas.height = H;
    this.g = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.9, (0.9 * H) / W), new THREE.MeshBasicMaterial({ map: this.tex, transparent: true }));
    this.mesh.visible = false;
    this.buttons = [];
    this.hover = null;
    this.key = '';

    // Small "Y = options" tab, always visible under the heat gauge.
    const tc = document.createElement('canvas');
    tc.width = 512; tc.height = 128;
    const tg = tc.getContext('2d');
    tg.fillStyle = 'rgba(8,10,18,0.7)'; tg.beginPath(); tg.roundRect(4, 4, 504, 120, 28); tg.fill();
    tg.strokeStyle = '#4fd1c5'; tg.lineWidth = 4; tg.stroke();
    tg.fillStyle = '#e6e9ef'; tg.font = '600 52px system-ui, sans-serif'; tg.textAlign = 'center'; tg.textBaseline = 'middle';
    tg.fillText('Y  ·  Options', 256, 66);
    const tt = new THREE.CanvasTexture(tc); tt.colorSpace = THREE.SRGBColorSpace;
    this.tab = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.125), new THREE.MeshBasicMaterial({ map: tt, transparent: true }));
  }

  toggle(force) {
    this.open = force ?? !this.open;
    this.mesh.visible = this.open;
    this.key = '';
    if (this.open) this.draw();
  }

  /** Map a raycast hit (uv) to a button id and run it. Returns true if a button was hit. */
  clickUv(uv) {
    const id = this.buttonAt(uv);
    if (id) { this.hooks.act(id); this.key = ''; this.draw(); return true; }
    return false;
  }

  setHoverUv(uv) {
    const id = uv ? this.buttonAt(uv) : null;
    if (id !== this.hover) { this.hover = id; this.key = ''; }
  }

  buttonAt(uv) {
    const x = uv.x * W, y = (1 - uv.y) * H;
    const b = this.buttons.find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
    return b ? b.id : null;
  }

  draw() {
    if (!this.open) return;
    const s = this.hooks.getState();
    const key = JSON.stringify([s, this.hover]);
    if (key === this.key) return;
    this.key = key;
    const g = this.g;
    this.buttons = [];
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(10,12,20,0.92)';
    g.beginPath(); g.roundRect(6, 6, W - 12, H - 12, 36); g.fill();
    g.strokeStyle = '#2b3242'; g.lineWidth = 4; g.stroke();
    g.textBaseline = 'middle';

    g.fillStyle = '#e6e9ef'; g.font = '700 58px system-ui, sans-serif'; g.textAlign = 'left';
    g.fillText('Options', 50, 70);
    g.fillStyle = '#ffd34d'; g.font = '32px system-ui, sans-serif'; g.textAlign = 'right';
    g.fillText('workout paused', W - 50, 72);

    let y = 150;
    const label = (text) => { g.fillStyle = '#8d95a5'; g.font = '32px system-ui, sans-serif'; g.textAlign = 'left'; g.fillText(text, 50, y + 36); };
    const button = (id, text, x, w, active = false) => {
      const hovered = this.hover === id;
      g.fillStyle = active ? '#4fd1c5' : hovered ? '#34405a' : '#222837';
      g.beginPath(); g.roundRect(x, y, w, 72, 16); g.fill();
      if (hovered) { g.strokeStyle = '#4fd1c5'; g.lineWidth = 3; g.stroke(); }
      g.fillStyle = active ? '#062421' : '#e6e9ef'; g.font = '600 34px system-ui, sans-serif'; g.textAlign = 'center';
      g.fillText(text, x + w / 2, y + 37, w - 14);
      this.buttons.push({ id, x, y, w, h: 72 });
    };
    const value = (text, x, w) => { g.fillStyle = '#ffffff'; g.font = '700 40px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText(text, x + w / 2, y + 37); };

    const R = 90; // row height
    label('Target heart rate'); button('target-', '−', 520, 100); value(`${s.target} BPM`, 630, 230); button('target+', '+', 870, 100); y += R;
    const warm = s.warmUp === 0 ? 'Off' : s.warmUp < 60 ? `${s.warmUp} s` : `${+(s.warmUp / 60).toFixed(1)} min`;
    label('Warm-up'); button('warmup-', '−', 520, 100); value(warm, 630, 230); button('warmup+', '+', 870, 100); y += R;
    label('Workout length'); button('minutes-', '−', 520, 100); value(`${s.minutes} min`, 630, 230); button('minutes+', '+', 870, 100); y += R;
    label('Workout shape'); button('shape-steady', 'Steady', 430, 170, s.profile === 'steady'); button('shape-waves', 'Waves', 615, 170, s.profile === 'waves');
    button('shape-build', 'Build', 800, 170, s.profile === 'build'); y += R;
    label('Heart rate from'); button('src-phone', 'Phone', 520, 215, s.source === 'phone'); button('src-sim', 'Simulator', 755, 215, s.source === 'sim'); y += R;
    label('Game type'); button('mode-punch', 'Punch', 520, 215, s.gameType === 'punch'); button('mode-touch', 'Touch', 755, 215, s.gameType === 'touch'); y += R;
    // Moveset: tap to switch each move on/off (highlighted = on).
    label('Orbs'); button('move-jab', 'Punch', 175, 120, s.moves.jab); button('move-low', 'Squat', 305, 130, s.moves.low);
    button('move-swing', 'Hook/upper', 445, 190, s.moves.swing && s.gameType === 'punch'); button('move-hammer', 'Hammer', 645, 160, s.moves.hammer && s.gameType === 'punch');
    button('move-trace', 'Rope', 815, 160, s.moves.trace); y += R;
    label('More'); button('move-power', 'Power', 175, 165, s.moves.power && s.gameType === 'punch'); button('move-pair', 'Squat+punch', 350, 230, s.moves.pair);
    button('move-guard', 'Guard', 590, 215, s.moves.guard); button('move-sweep', '2 ropes', 815, 160, s.moves.sweep); y += R;
    label('Bursts'); button('move-bag', 'Speed', 175, 150, s.moves.bag); button('move-ropes', 'Ropes', 335, 150, s.moves.ropes);
    button('move-heavy', 'Heavy', 495, 150, s.moves.heavy); button('move-sled', 'Sled', 655, 150, s.moves.sled); button('move-barrage', 'Missiles', 815, 160, s.moves.barrage); y += R;
    label('Walls'); button('move-duck', 'Duck', 175, 140, s.moves.duck); button('move-squatSide', 'Side squat', 325, 200, s.moves.squatSide);
    button('move-lean', 'Lean', 535, 130, s.moves.lean); button('move-pillar', 'Pillar', 675, 140, s.moves.pillar);
    button('move-shift', 'Shift', 825, 150, s.moves.shift); y += R;
    label('Music & sounds'); button('sound', s.sound ? 'On' : 'Off', 520, 140, s.sound); button('vol-', 'Vol −', 680, 140); button('vol+', 'Vol +', 830, 140); y += R;
    label(s.songAvailable ? 'Music style' : 'Music style (no song file yet)');
    button('music-song', 'Song', 520, 215, s.musicStyle === 'song' && s.songAvailable); button('music-synth', 'Synth', 755, 215, s.musicStyle === 'synth' || !s.songAvailable); y += R;
    // Test tools for headset sessions: a diagnostics line on the scoreboard, and send-me-this-move buttons.
    // Test tools only show when Diag is on, so normal workouts get a tidy board.
    label('Test'); button('diag', s.diag ? 'Diag on' : 'Diag (test tools)', 175, s.diag ? 150 : 300, s.diag);
    if (s.diag) {
      button('test-guard', 'Guard', 335, 150); button('test-sweep', '2 ropes', 495, 150); button('test-hammer', 'Hammer', 655, 150); button('test-combo', 'Combo', 815, 160); y += R;
      label('Test 2'); button('test-heavy', 'Heavy', 175, 126); button('test-sled', 'Sled', 309, 126); button('test-barrage', 'Missiles', 443, 126);
      button('test-bag', 'Speed', 577, 126); button('test-ropes', 'Ropes', 711, 126); button('test-wall', 'Walls', 845, 130); y += R;
      label('Note'); button('note-slam', 'Slam missed', 175, 200, false); button('note-guard', 'Guard picky', 385, 200, false);
      button('note-fast', 'Too fast', 595, 180, false); button('note-great', 'Felt great', 785, 190, false);
    }
    y += R;
    label('Challenge'); button('ch-gentle', 'Gentle', 430, 170, s.challenge === 'gentle'); button('ch-normal', 'Normal', 615, 170, s.challenge === 'normal'); button('ch-hard', 'Hard', 800, 170, s.challenge === 'hard'); y += R + 10;

    // What raises your heart rate (learned).
    g.fillStyle = '#e6e9ef'; g.font = '600 36px system-ui, sans-serif'; g.textAlign = 'left';
    g.fillText('What raises YOUR heart rate', 50, y + 20);
    g.fillStyle = '#8d95a5'; g.font = '26px system-ui, sans-serif';
    g.fillText('estimated BPM added per 10 reps/min · reps this workout', 50, y + 62);
    y += 95;
    const max = Math.max(1, ...s.ranking.map((r) => r.bpmPer10));
    for (const r of s.ranking.slice(0, 4)) {
      g.fillStyle = '#c9ced8'; g.font = '30px system-ui, sans-serif'; g.textAlign = 'left';
      g.fillText(r.label, 50, y + 22);
      g.fillStyle = '#262a38'; g.beginPath(); g.roundRect(400, y + 6, 430, 32, 10); g.fill();
      g.fillStyle = `hsl(${20 + 160 * (1 - r.bpmPer10 / max)} 85% 55%)`;
      g.beginPath(); g.roundRect(400, y + 6, Math.max(14, 430 * (r.bpmPer10 / max)), 32, 10); g.fill();
      g.fillStyle = '#ffffff'; g.font = '28px system-ui, sans-serif'; g.textAlign = 'right';
      g.fillText(`${r.bpmPer10.toFixed(0)} · ${r.reps}`, W - 50, y + 22);
      y += 46;
    }
    y += 22;
    button('restart', 'Restart', 50, 290); button('end', 'End workout', 367, 290); button('close', 'Close', 684, 290, true);

    this.tex.needsUpdate = true;
  }
}
