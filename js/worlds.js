// PulseZone worlds (v58): every named workout gets its own look, because players drift away when
// every day looks the same. A world is a palette (sky, floor, lane rails, floor stripes, sun) plus a
// little scenery on the horizon: a glow band and a ring of silhouettes.
//
// Three rules shape everything in here:
//  - DARK. The orbs must stay the brightest things in view and a headset is no place for a bright
//    sky: skies sit near the classic one's luminance, the glow peaks at a few percent of white and
//    the silhouettes are, with the snow caps as the one exception, darker than the sky behind them.
//  - CHEAP. 'grid' draws nothing extra. Every other world is two draw calls: one additive band and
//    one merged mesh of flat shapes with vertex colours (its lamps included). Everything is built
//    once; update() allocates nothing.
//  - OUT OF THE WAY. Nothing is nearer than 30 m, and the horizon dead ahead is left open and dim:
//    the far end of the lane, the boss and the incoming orbs are there.
//
// The game keeps animating the sky itself (act tint, the warm in-zone tint, the red hit flash) and
// the rail emissive (it flares orange in the zone). So a WorldView never writes scene.background,
// the fog colour or railMat.emissive: it offers `sky`, `fog` and `railGlow`, colours it cross-fades
// in place, for the game to start from. It does own the floor, rail and stripe colours and the sun's.
import * as THREE from 'three';

/**
 * The palettes: hex colours as you would type them (sRGB).
 *   sky, fog        the base sky. The game tints it and copies the result to the fog, so they match.
 *   floor           floor albedo. It is lit, so on screen it is darker and a little bluer than the hex.
 *   rail, railGlow  lane rail colour and its resting emissive (the game flares the emissive in the zone)
 *   stripe          the moving floor stripes (unlit)
 *   glow, haze      the horizon band: its colour on the horizon, and higher up where it thins out
 *   shape           the ink the silhouettes are drawn in
 *   sun             tint of the directional light: near white, so blue and orange orbs keep their colours
 * 'grid' is the look the game has always had, to the digit, and has no scenery.
 */
export const WORLDS = {
  grid: { name: 'Grid', sky: 0x0b0d18, fog: 0x0b0d18, floor: 0x141826, rail: 0x3f7fe6, railGlow: 0x1a3d80, stripe: 0x233050, glow: 0x000000, haze: 0x000000, shape: 0x000000, sun: 0xffffff },
  harbour: { name: 'Harbour', sky: 0x061218, fog: 0x061218, floor: 0x0e1c22, rail: 0x28968c, railGlow: 0x0c4a46, stripe: 0x16343c, glow: 0x6e4018, haze: 0x3c222c, shape: 0x03090c, sun: 0xfff0e2 },
  reactor: { name: 'Reactor Yard', sky: 0x0c0808, fog: 0x0c0808, floor: 0x221614, rail: 0xd9482a, railGlow: 0x782212, stripe: 0x46241e, glow: 0x782c0e, haze: 0x400e0a, shape: 0x050303, sun: 0xffe9e0 },
  snow: { name: 'Snowfield', sky: 0x0e121c, fog: 0x0e121c, floor: 0x1e2430, rail: 0x5f8cb4, railGlow: 0x284260, stripe: 0x2e3a50, glow: 0x3c4868, haze: 0x1e223e, shape: 0x04070b, sun: 0xe6eeff },
  dojo: { name: 'Dojo', sky: 0x100b08, fog: 0x100b08, floor: 0x241811, rail: 0xaf7a2c, railGlow: 0x5c3a10, stripe: 0x422c1a, glow: 0x583c1e, haze: 0x321c0e, shape: 0x0a0604, sun: 0xffeeda },
};

const FADE = 2;        // seconds for one world to give way to the next
const GLOW_R = 45;     // the glow band is a cylinder this far out (the camera's far plane is 100)
const GLOW_Y0 = -0.6;  // ...from just under the floor's level
const GLOW_Y1 = 17.4;  // ...to about 19 degrees up, where it has long faded to nothing
const GAP = 10.5;      // degrees either side of dead ahead that the silhouettes leave open
const COLOURS = ['sky', 'fog', 'floor', 'rail', 'railGlow', 'stripe', 'sun']; // what a world change cross-fades
const RAD = Math.PI / 180;
const TAU = Math.PI * 2;

/**
 * Each world's glow band and the function that draws its silhouettes.
 *   peak, drop    the band is brightest `peak` metres up (just over the land line) and is gone `drop` below that
 *   core, coreH   how much of it is a tight band on the horizon, and that band's height scale (m)
 *   hazeH, mixH   height scale of the wide haze above it, and of the fade from `glow` to `haze` colour
 *   base, lobes   brightness all round, plus [bearing, width, gain] bumps (degrees; 0 = ahead, + = right)
 *   dip           how far it dims dead ahead (0..1), so orbs, the boss and the scoreboard keep their contrast
 *   breath        optional slow swell of the band: [depth 0..1, seconds]
 */
const SCENERY = {
  harbour: { peak: 0.8, drop: 0.9, core: 0.55, coreH: 1.5, hazeH: 5, mixH: 2.6, base: 0.22, lobes: [[40, 26, 0.85], [-46, 24, 0.6]], dip: 0.5, build: buildHarbour },
  reactor: { peak: 0.9, drop: 0.9, core: 0.5, coreH: 2.2, hazeH: 6.5, mixH: 3.2, base: 0.16, lobes: [[-33, 22, 0.9], [32, 22, 0.8], [-110, 40, 0.35], [120, 40, 0.3]], dip: 0.55, breath: [0.14, 7], build: buildReactor },
  snow: { peak: 0.7, drop: 0.8, core: 0.3, coreH: 3, hazeH: 9, mixH: 3.5, base: 0.45, lobes: [[-60, 50, 0.55]], dip: 0.4, build: buildSnow },
  dojo: { peak: 0.6, drop: 0.6, core: 0.3, coreH: 2.5, hazeH: 8, mixH: 4, base: 0.55, lobes: [[38, 28, 0.45], [-38, 28, 0.45]], dip: 0.55, build: buildDojo },
};

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const ease = (t) => t * t * (3 - 2 * t);
const scratch = new THREE.Color();
/** Hex -> [r, g, b, a] in the renderer's working (linear) space, which is what vertex colours are read as. */
const lin = (hex, a = 1) => { scratch.setHex(hex); return [scratch.r, scratch.g, scratch.b, a]; };
const fade = (c, a = 0) => [c[0], c[1], c[2], a]; // the same colour at another opacity
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];

// ---------------------------------------------------------------- drawing silhouettes

/**
 * Collects one world's silhouettes as plain triangles with a colour and an opacity at every corner.
 * They are all flat cut-outs standing on circles round the player: 30 m and more away, in one unlit
 * colour, a cut-out and a solid cannot be told apart, and a cut-out costs a handful of triangles.
 * Nothing writes depth, so later triangles simply paint over earlier ones: draw far things first.
 */
class Shapes {
  constructor() { this.pos = []; this.col = []; this.at(0, 35); }

  /** Move the pen: bearing in degrees (0 = dead ahead, + = the player's right) and distance in metres. `flip` -1 mirrors what is drawn next, `scale` sizes it. */
  at(az, d, flip = 1, scale = 1) { this.az = az * RAD; this.d = d; this.fx = flip * scale; this.fy = scale; return this; }

  _p(a, y, c) { this.pos.push(Math.sin(a) * this.d, y, -Math.cos(a) * this.d); this.col.push(c[0], c[1], c[2], c[3]); }

  /** One corner: s metres along the horizon from the pen (to the right) and y metres up; c = [r, g, b, a]. */
  v(s, y, c) { this._p(this.az + (s * this.fx) / this.d, y * this.fy, c); }
  tri(s0, y0, c0, s1, y1, c1, s2, y2, c2) { this.v(s0, y0, c0); this.v(s1, y1, c1); this.v(s2, y2, c2); }
  quad(s0, y0, c0, s1, y1, c1, s2, y2, c2, s3, y3, c3) { this.tri(s0, y0, c0, s1, y1, c1, s2, y2, c2); this.tri(s0, y0, c0, s2, y2, c2, s3, y3, c3); }
  box(s0, y0, s1, y1, c) { this.quad(s0, y0, c, s1, y0, c, s1, y1, c, s0, y1, c); }

  /** A straight member of thickness w between two points: booms, stays, braces. */
  beam(s0, y0, s1, y1, w, c) {
    const dx = s1 - s0, dy = y1 - y0, k = w / 2 / Math.hypot(dx, dy), nx = -dy * k, ny = dx * k;
    this.quad(s0 - nx, y0 - ny, c, s1 - nx, y1 - ny, c, s1 + nx, y1 + ny, c, s0 + nx, y0 + ny, c);
  }

  /** A soft round patch, colour c within `core` of its radius and fading to nothing at the rim: lamp halos, steam. */
  blob(s, y, rx, ry, c, core = 0, n = 12) {
    const rim = fade(c);
    for (let i = 0; i < n; i++) {
      const x0 = Math.cos((i / n) * TAU), y0 = Math.sin((i / n) * TAU), x1 = Math.cos(((i + 1) / n) * TAU), y1 = Math.sin(((i + 1) / n) * TAU);
      this.tri(s, y, c, s + x0 * rx * core, y + y0 * ry * core, c, s + x1 * rx * core, y + y1 * ry * core, c);
      this.quad(s + x0 * rx * core, y + y0 * ry * core, c, s + x0 * rx, y + y0 * ry, rim, s + x1 * rx, y + y1 * ry, rim, s + x1 * rx * core, y + y1 * ry * core, c);
    }
  }

  /** The same three, with corners given by bearing (degrees) at the pen's distance: for things that run along the horizon. */
  ptri(a0, y0, c0, a1, y1, c1, a2, y2, c2) { this._p(a0 * RAD, y0, c0); this._p(a1 * RAD, y1, c1); this._p(a2 * RAD, y2, c2); }
  pquad(a0, y0, c0, a1, y1, c1, a2, y2, c2, a3, y3, c3) { this.ptri(a0, y0, c0, a1, y1, c1, a2, y2, c2); this.ptri(a0, y0, c0, a2, y2, c2, a3, y3, c3); }
  /** A straight span between two bearings, from height y0 up to y1: beams, rails, eaves. */
  span(a0, a1, y0, y1, c) { this.pquad(a0, y0, c, a1, y0, c, a1, y1, c, a0, y1, c); }

  /**
   * The land line: a low wall right round the horizon, d metres out and top(bearing) metres high.
   * Everything else in a world stands on it or behind it, so nothing seems to float when the game
   * tints or flashes the sky. It is solid down to y = 0 and fades out below that (there is no ground
   * out there to meet), and it sinks and fades toward the gap ahead, where the fogged far end of the
   * lane would otherwise show against it as a lighter block.
   */
  ring(d, c, top) {
    const STEP = 3, clear = fade(c);
    this.d = d;
    const edge = (a) => { // a runs 0..360 clockwise from dead ahead
      const k = smooth(0, 5, Math.min(a, 360 - a) - GAP);
      return [top(a > 180 ? a - 360 : a) * k, fade(c, c[3] * k)];
    };
    for (let a = GAP; a < 360 - GAP; a += STEP) {
      const b = Math.min(a + STEP, 360 - GAP), [ya, ca] = edge(a), [yb, cb] = edge(b);
      this.pquad(a, 0, ca, b, 0, cb, b, yb, cb, a, ya, ca);
      this.pquad(a, -1.6, clear, b, -1.6, clear, b, 0, cb, a, 0, ca);
    }
  }

  geometry() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.pos), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.col), 4)); // 4 = with opacity
    return geo;
  }
}

/** A lamp: a small lit square in a soft halo. Ordinary blending, so it can live in the silhouette mesh. */
function lamp(b, s, y, c, size = 0.3, halo = 0.9) {
  b.blob(s, y, halo, halo, fade(c, 0.22));
  b.box(s - size / 2, y - size / 2, s + size / 2, y + size / 2, c);
}

// ---------------------------------------------------------------- harbour: masts and cranes against an amber dawn

/** Ship-to-shore container crane, side on, boom reaching toward +s. */
function gantry(b, ink, light) {
  b.box(-3.4, 0.6, -2.8, 10.5, ink); b.box(2.8, 0.6, 3.4, 10.5, ink);                 // legs
  b.beam(-3.1, 3.3, 3.1, 3.3, 0.35, ink);                                              // sill beam
  b.beam(-3.1, 3.5, 3.1, 10.3, 0.24, ink); b.beam(3.1, 3.5, -3.1, 10.3, 0.24, ink);   // cross bracing
  b.box(-3.8, 10.5, 3.8, 11.3, ink);                                                   // portal beam
  b.box(-7.5, 11.3, 13.5, 12, ink);                                                    // boom
  b.box(-6.2, 12, -2.6, 13.6, ink);                                                    // machinery house
  b.beam(0.4, 12, 1.2, 17, 0.4, ink); b.beam(2.6, 12, 1.2, 17, 0.3, ink);             // A-frame
  b.beam(1.2, 17, 13.2, 12, 0.2, ink); b.beam(1.2, 17, -7.2, 12, 0.2, ink);           // stays
  b.box(6.2, 10.5, 7.6, 11.3, ink); b.box(6.78, 7.2, 7.02, 10.5, ink); b.box(5.4, 5.9, 8.4, 7.2, ink); // trolley, hoist rope, a container on the hook
  lamp(b, 1.2, 17.3, light);
}

/** Dockside luffing crane, jib raised toward +s. */
function jibCrane(b, ink, light) {
  b.quad(-1.6, 0.6, ink, 1.6, 0.6, ink, 0.9, 7.5, ink, -0.9, 7.5, ink);               // pedestal
  b.box(-2.6, 7.5, 1.6, 9.4, ink); b.box(-3.5, 7.9, -2.5, 9, ink);                    // slewing house, counterweight
  b.beam(1, 9, 11.5, 17.5, 0.42, ink);                                                 // jib
  b.beam(-1.6, 9.4, -0.6, 13.2, 0.3, ink); b.beam(0.6, 9.4, -0.6, 13.2, 0.26, ink);   // A-frame
  b.beam(-0.6, 13.2, 11.5, 17.5, 0.16, ink);                                           // pendant
  b.box(11.4, 10.5, 11.6, 17.5, ink); b.box(11.1, 9.9, 11.9, 10.5, ink);              // hoist rope, hook block
  b.box(0.6, 8.3, 1.3, 8.9, light);                                                    // the cab's lit window
}

/** A moored sailing boat, bow toward +s: hull, cabin, mast with spreaders, boom and two stays. */
function boat(b, h, len, ink) {
  const l = len / 2;
  b.quad(-l, -0.1, ink, l, -0.1, ink, l + 0.6, 0.95, ink, -l - 0.15, 0.85, ink);
  b.box(-1.1, 0.9, 0.7, 1.5, ink);
  b.box(-0.08, 0.9, 0.08, h, ink);
  b.box(-0.75, h * 0.58, 0.75, h * 0.58 + 0.1, ink);
  b.beam(-2.6, 2.05, 0, 2.15, 0.26, ink); // boom, with the sail furled on it
  b.beam(0, h, l + 0.5, 0.95, 0.09, ink); b.beam(0, h, -l, 0.9, 0.09, ink);
}

function buildHarbour(b, w) {
  const ink = lin(w.shape), amber = lin(0x8a5a24), red = lin(0x8c2a1c);
  b.ring(39, ink, () => 0.8); // the quay, ending in two breakwaters either side of the harbour mouth
  // Sheds and a stack of containers on the quay.
  b.at(24.5, 38.5); b.box(-3.5, 0.6, 3.5, 3.3, ink); b.tri(-3.9, 3.3, ink, 3.9, 3.3, ink, 0, 4.3, ink);
  b.at(-27, 38.5); b.box(-4.5, 0.6, 4.5, 2.9, ink); b.tri(-4.9, 2.9, ink, 4.9, 2.9, ink, 0, 3.7, ink);
  b.at(67, 38.5); b.box(-9.2, 0.6, -3.1, 5.9, ink); b.box(-3, 0.6, 3, 8.5, ink); b.box(3.1, 0.6, 9.2, 3.3, ink);
  b.at(-108, 38.5); b.box(-8, 0.6, 8, 3.6, ink); b.tri(-8.5, 3.6, ink, 8.5, 3.6, ink, 0, 5, ink);
  b.at(118, 38.5); b.box(-7, 0.6, 7, 3.2, ink);
  b.at(176, 38.5); b.box(-10, 0.6, 10, 4, ink);
  // A beacon on each breakwater head, and lamps along the quay.
  for (const az of [-14.2, 14.2]) { b.at(az, 38.5); b.quad(-0.6, 0.3, ink, 0.6, 0.3, ink, 0.38, 3.2, ink, -0.38, 3.2, ink); lamp(b, 0, 3.45, amber, 0.3, 1); }
  for (const az of [31.5, 58, 100, 112, 160, -37, -58, -66, -98, -118, -165]) { b.at(az, 38.5); b.box(-0.07, 0.6, 0.07, 4.4, ink); lamp(b, 0, 4.55, amber); }
  // Cranes, far ones first, their booms and jibs reaching toward the water in front of you.
  gantry(b.at(-136, 39, 1, 0.6), ink, red);
  jibCrane(b.at(146, 39, -1, 0.65), ink, amber);
  gantry(b.at(88, 39, -1, 0.62), ink, red);
  jibCrane(b.at(-84, 39, 1, 0.7), ink, amber);
  gantry(b.at(47, 37, -1, 0.8), ink, red);
  jibCrane(b.at(-46, 37, 1, 0.8), ink, amber);
  // The marina: masts either side of the harbour mouth, bows toward it.
  for (const [az, d, h, len] of [[-24, 34.5, 8, 5.5], [-20.5, 35.5, 11.5, 7.5], [-17, 34, 9.2, 6], [23.5, 35.5, 12, 7.5], [20, 34, 8.4, 5.5], [16.5, 35, 10.5, 7]]) boat(b.at(az, d, az < 0 ? 1 : -1), h, len, ink);
}

// ---------------------------------------------------------------- reactor: cooling towers over a red-orange glow

// A cooling tower's outline, bottom to top: [height, radius] as fractions of its height and base radius.
const TOWER = [[0, 1], [0.15, 0.875], [0.3, 0.775], [0.45, 0.7], [0.6, 0.65], [0.72, 0.63], [0.82, 0.635], [0.92, 0.655], [1, 0.69]];

/** One cooling tower: lit a little along both edges by the glow behind it, with steam and warning lights if asked. */
function coolingTower(b, h, r, ink, rim, steam, light) {
  const y0 = 0.6, lean = b.az < 0 ? -1 : 1; // steam drifts away from the lane, so the sky over it stays clear
  for (let i = 0; i + 1 < TOWER.length; i++) {
    const ya = y0 + (h - y0) * TOWER[i][0], yb = y0 + (h - y0) * TOWER[i + 1][0], ra = r * TOWER[i][1], rb = r * TOWER[i + 1][1];
    b.quad(-ra, ya, rim, -ra / 2, ya, ink, -rb / 2, yb, ink, -rb, yb, rim);
    b.quad(-ra / 2, ya, ink, ra / 2, ya, ink, rb / 2, yb, ink, -rb / 2, yb, ink);
    b.quad(ra / 2, ya, ink, ra, ya, rim, rb, yb, rim, rb / 2, yb, ink);
  }
  // Seen from the ground, the near lip of the mouth stands higher than its sides: that bow is what
  // makes a flat cut-out read as a round tower.
  const rt = r * TOWER[TOWER.length - 1][1], bow = ((h - 1.6) * rt) / (b.d - rt);
  const lip = (s) => h + bow * Math.sqrt(Math.max(0, 1 - (s / rt) ** 2)), shade = (s) => mixc(ink, rim, Math.max(0, (2 * Math.abs(s)) / rt - 1));
  for (let i = 0; i < 8; i++) {
    const s0 = rt * (i / 4 - 1), s1 = rt * ((i + 1) / 4 - 1);
    b.quad(s0, h, shade(s0), s1, h, shade(s1), s1, lip(s1), shade(s1), s0, lip(s0), shade(s0));
  }
  if (steam) {
    b.blob(lean * 0.4, h + 1.7, rt * 0.95, 1.9, mixc(steam, rim, 0.5), 0.35);
    b.blob(lean * 1.8, h + 4.2, rt * 1.25, 2.6, steam, 0.35);
    b.blob(lean * 4.2, h + 7.2, rt * 1.6, 3.1, steam, 0.35);
    b.blob(lean * 7.4, h + 9.8, rt * 1.9, 3.3, fade(steam, steam[3] * 0.6), 0.35);
  }
  if (light) { lamp(b, -rt * 0.9, h + 0.25, light, 0.26, 0.8); lamp(b, rt * 0.9, h + 0.25, light, 0.26, 0.8); }
}

function buildReactor(b, w) {
  const ink = lin(w.shape), rim = lin(0x24100a), red = lin(0x96241a), steam = lin(0x1c1210, 0.42);
  b.ring(39.5, ink, (a) => 1 + 0.15 * Math.sin(a * 0.21)); // the berm round the yard
  // Towers, far ones first: [bearing, distance, height, base radius, steam and lights?]
  for (const [az, d, h, r, live] of [[110, 39, 9, 4, 0], [-108, 39, 10, 4.2, 0], [150, 38.5, 10, 4.4, 0], [-140, 38.5, 9, 4, 0], [-80, 38, 11, 4.6, 1], [74, 37.5, 10, 4.2, 1],
    [21.5, 38, 11.5, 4.6, 1], [-23, 37, 12.5, 4.7, 1], [41, 35.5, 13, 5, 1], [-44, 35, 10.5, 4.3, 1]]) {
    coolingTower(b.at(az, d), h, r, ink, rim, live ? steam : null, live ? red : null);
  }
  // The containment dome, the turbine hall and two stacks.
  b.at(57.5, 37.5); b.box(-3.2, 0.6, 3.2, 4.4, ink);
  for (let i = 0; i < 10; i++) b.tri(0, 4.4, ink, Math.cos((i / 10) * Math.PI) * 3.2, 4.4 + Math.sin((i / 10) * Math.PI) * 3, ink, Math.cos(((i + 1) / 10) * Math.PI) * 3.2, 4.4 + Math.sin(((i + 1) / 10) * Math.PI) * 3, ink);
  b.at(-58.5, 38); b.box(-5.5, 0.6, 5.5, 3.6, ink);
  for (const [az, h] of [[-64.5, 15], [65.5, 13.5]]) {
    b.at(az, 38);
    b.quad(-0.75, 0.6, ink, 0.75, 0.6, ink, 0.45, h, ink, -0.45, h, ink);
    lamp(b, 0, h + 0.2, red, 0.26, 0.8); lamp(b, 0, h * 0.55, red, 0.22, 0.6);
  }
}

// ---------------------------------------------------------------- snow: pale peaks at dusk

/**
 * A mountain range at one distance. Each peak is two facets, one catching the last light and one in
 * shade, both darkening to their feet: the caps are the only things in any world paler than the sky.
 * peaks: [bearing, height, half-width in degrees, skew of the summit -1..1]
 */
function range(b, d, peaks, lit, shade, litFoot, shadeFoot, dusk) {
  b.at(0, d);
  for (const [az, h, half, skew] of peaks) {
    const apex = az + skew * half, foot = az + skew * half * 0.3, left = az - half, right = az + half;
    const lightOnLeft = ((az - dusk + 540) % 360) - 180 > 0; // the peak is clockwise of the afterglow, so its left side faces it
    const lt = lightOnLeft ? lit : shade, lf = lightOnLeft ? litFoot : shadeFoot, rt = lightOnLeft ? shade : lit, rf = lightOnLeft ? shadeFoot : litFoot;
    b.ptri(left, 0, lf, foot, 0, lf, apex, h, lt);
    b.ptri(foot, 0, rf, right, 0, rf, apex, h, rt);
    b.pquad(left, -1.5, fade(lf), foot, -1.5, fade(lf), foot, 0, lf, left, 0, lf);
    b.pquad(foot, -1.5, fade(rf), right, -1.5, fade(rf), right, 0, rf, foot, 0, rf);
  }
}

function pine(b, h, ink) {
  const k = h / 3.9;
  b.box(-0.09 * k, 0.3, 0.09 * k, 0.9 * k, ink);
  b.tri(-0.95 * k, 0.75 * k, ink, 0.95 * k, 0.75 * k, ink, 0, 2.2 * k, ink);
  b.tri(-0.75 * k, 1.65 * k, ink, 0.75 * k, 1.65 * k, ink, 0, 3.05 * k, ink);
  b.tri(-0.5 * k, 2.55 * k, ink, 0.5 * k, 2.55 * k, ink, 0, 3.9 * k, ink);
}

function buildSnow(b, w) {
  const ink = lin(w.shape), dusk = SCENERY.snow.lobes[0][0]; // the afterglow's bearing
  // The far range: the big peaks first, then the shoulders in front of them. The saddles let the dusk band through.
  range(b, 40, [[-38, 12, 12, 0.2], [34, 12.5, 12, -0.25], [-66, 10.5, 11, -0.15], [62, 11, 11, 0.2], [-100, 10, 13, 0.1], [98, 10.5, 12, -0.1], [-150, 9.5, 15, 0.2], [150, 9, 14, -0.2], [180, 8, 16, 0],
    [-23, 7.5, 7.5, -0.3], [22, 7, 7, 0.3], [-15.5, 4.2, 5, 0.2], [15.5, 4, 5, -0.2], [-52, 7.5, 8, 0.3], [48, 7, 8, -0.3], [-82, 7.5, 9, 0.2], [80, 7, 9, -0.2], [-125, 7.5, 12, 0], [124, 7, 11, 0.1]],
  lin(0x404a64), lin(0x222838), lin(0x0c0f17), lin(0x080a10), dusk);
  // Nearer, darker foothills.
  range(b, 35.5, [[-20, 3, 7, 0.2], [19, 2.8, 6.5, -0.2], [-34, 4.4, 9, -0.2], [31, 4.2, 8.5, 0.25], [-52, 3.4, 10, 0.1], [49, 3.6, 10, -0.1], [-75, 4.2, 13, 0.2], [72, 4.4, 12, -0.2],
    [-104, 3.6, 15, 0], [102, 3.4, 14, 0], [-138, 4, 17, 0.1], [137, 4.2, 16, -0.1], [178, 3.6, 19, 0]],
  lin(0x1e2434), lin(0x10141e), lin(0x07090e), lin(0x05070b), dusk);
  b.ring(33, lin(0x141924), (a) => 0.6 + 0.2 * Math.sin(a * 0.13) + 0.1 * Math.sin(a * 0.41)); // the edge of the snowfield
  // Pines along it, small enough to make the peaks look big: [bearing, height]
  for (const [az, h] of [[-13.8, 3.4], [-15.2, 4.4], [-16.9, 3], [-19.4, 4], [-20.6, 3.2], [-24, 4.6], [-25.4, 3.3], [-41, 3.8], [-42.5, 4.8], [-44.2, 3.4], [-61, 4.2], [-63, 3.2], [-88, 4], [-90, 4.6], [-128, 4.2],
    [13.5, 4.2], [14.9, 3.2], [17.2, 4.6], [18.4, 3.4], [22, 3.9], [25.2, 4.4], [30.2, 3.6], [45, 4.2], [46.6, 3.3], [64, 4.6], [66, 3.5], [92, 4.2], [131, 3.8], [170, 4.4]]) pine(b.at(az, 32), h, ink);
  // One cabin with a lit window: the only warm thing out there.
  const window = lin(0x8a5a24);
  b.at(27.5, 32.2);
  b.box(-1.3, 0.4, 1.3, 1.9, ink); b.tri(-1.7, 1.9, ink, 1.7, 1.9, ink, 0, 3, ink); b.box(0.6, 2.3, 0.9, 3.1, ink);
  lamp(b, 0, 1.2, window, 0.4, 0.9);
}

// ---------------------------------------------------------------- dojo: a lantern-lit hall of dark wood

/** A lantern hung on a post, its light box y metres up: base, paper box (brighter in the middle, like a flame behind paper), little roof. */
function lantern(b, y, ink, paper, edge) {
  b.blob(0, y + 0.35, 1.5, 1.5, fade(paper, 0.2));
  b.box(-0.46, y - 0.14, 0.46, y, ink);
  b.tri(-0.34, y, edge, 0.34, y, edge, 0, y + 0.35, paper); b.tri(0.34, y, edge, 0.34, y + 0.7, edge, 0, y + 0.35, paper);
  b.tri(0.34, y + 0.7, edge, -0.34, y + 0.7, edge, 0, y + 0.35, paper); b.tri(-0.34, y + 0.7, edge, -0.34, y, edge, 0, y + 0.35, paper);
  b.quad(-0.62, y + 0.7, ink, 0.62, y + 0.7, ink, 0.2, y + 1, ink, -0.2, y + 1, ink);
}

function buildDojo(b, w) {
  const ink = lin(w.shape), paper = lin(0x8c602c), edge = lin(0x54341a), D = 34;
  const side = [13, 21, 29, 37.5, 46.5, 56, 66, 77, 89, 102, 116, 131, 147, 164];
  const posts = [...side.map((a) => -a).reverse(), ...side, 180]; // clockwise, from behind your left shoulder round to dead behind
  b.ring(36, ink, () => 0.6); // the plinth the hall stands on
  // Between each pair of posts: lintel, tie beam, eave and a paper screen's lattice (the glow band is
  // the light behind the paper). The bay dead ahead is the open gate: the lane runs out through it.
  b.at(0, D);
  for (let i = 0; i < posts.length; i++) {
    const a0 = posts[i], a1 = i + 1 < posts.length ? posts[i + 1] : posts[0] + 360;
    b.span(a0, a1, 7, 7.6, ink);
    if (a0 === -side[0]) continue;
    b.span(a0, a1, 5.5, 5.8, ink);
    b.span(a0, a1, 7.6, 8.9, ink);
    b.span(a0, a1, 2.3, 2.43, ink); b.span(a0, a1, 4, 4.13, ink);
    for (const f of [1 / 3, 2 / 3]) { const am = a0 + (a1 - a0) * f; b.span(am - 0.1, am + 0.1, 0.5, 5.5, ink); }
  }
  b.span(-16.5, 16.5, 8.5, 9.3, ink); // the gate's top beam, overhanging its posts,
  b.span(-0.45, 0.45, 7.6, 8.5, ink); // and the strut that carries it
  for (const az of posts) {
    const gate = Math.abs(az) === side[0], half = gate ? 0.45 : 0.3;
    b.at(az, D);
    b.box(-half, 0.4, half, gate ? 8.5 : 7, ink);
    if (gate) b.quad(-half, -1.2, fade(ink), half, -1.2, fade(ink), half, 0.4, ink, -half, 0.4, ink); // the plinth has sunk away here: let the gate posts fade out too
  }
  for (const az of posts) if (Math.abs(az) > side[0] && Math.abs(az) < 95) lantern(b.at(az, D - 0.2), 3, ink, paper, edge);
}

// ---------------------------------------------------------------- the glow band

/** One open cylinder round the player, shared by every world (each maps its own texture onto it). */
function bandGeometry(n = 48) {
  const pos = new Float32Array((n + 1) * 6), uv = new Float32Array((n + 1) * 4), index = [];
  for (let i = 0; i <= n; i++) {
    const az = (-180 + (360 * i) / n) * RAD, x = Math.sin(az) * GLOW_R, z = -Math.cos(az) * GLOW_R, u = 1 - i / n; // u = 0.5 - bearing / 360: the seam is behind you
    pos.set([x, GLOW_Y0, z, x, GLOW_Y1, z], i * 6);
    uv.set([u, 0, u, 1], i * 4);
    if (i < n) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 2, i * 2 + 1, i * 2 + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(index);
  return geo;
}

/**
 * A world's glow as a small texture: bearing across (dead ahead in the middle, the seam behind you),
 * height up. It is black wherever there is no glow and is drawn additively, so the sky the game is
 * animating always shows through and is only ever added to.
 */
function bandTexture(w, s) {
  const W = 256, H = 128, data = new Uint8Array(W * H * 4);
  const rgb = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255], core = rgb(w.glow), haze = rgb(w.haze);
  const amount = new Float32Array(W), warm = new Float32Array(W);
  for (let i = 0; i < W; i++) {
    const az = (0.5 - (i + 0.5) / W) * 360;
    let a = s.base;
    for (const [at, width, gain] of s.lobes) a += gain * Math.exp(-0.5 * (((((az - at + 540) % 360) - 180) / width) ** 2));
    warm[i] = Math.min(1, a);
    amount[i] = warm[i] * (1 - s.dip * Math.exp(-0.5 * ((az / 13) ** 2)));
  }
  for (let j = 0; j < H; j++) {
    const y = GLOW_Y0 + ((GLOW_Y1 - GLOW_Y0) * (j + 0.5)) / H, up = y - s.peak;
    let level = up < 0 ? smooth(-s.drop, 0, up) : (s.core * Math.exp(-up / s.coreH) + (1 - s.core) * Math.exp(-up / s.hazeH)) * (1 - smooth(GLOW_Y1 - 8, GLOW_Y1, y));
    if (j === 0 || j === H - 1) level = 0; // black edge rows: the band must not end in a line
    const tint = up < 0 ? 1 : Math.exp(-up / s.mixH);
    for (let i = 0; i < W; i++) {
      const o = (j * W + i) * 4, k = tint * warm[i], l = level * amount[i];
      data[o] = Math.round(l * (haze[0] + (core[0] - haze[0]) * k));
      data[o + 1] = Math.round(l * (haze[1] + (core[1] - haze[1]) * k));
      data[o + 2] = Math.round(l * (haze[2] + (core[2] - haze[2]) * k));
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, W, H);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping; // so the seam behind you blends across
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------- the view

export class WorldView {
  /**
   * scene: where the scenery goes. floorMat, railMat, stripeMat: the game's own materials, whose
   * `color` this recolours (never railMat.emissive: see `railGlow`). sun: the directional light, for
   * its colour. Starts in 'grid', which changes nothing.
   */
  constructor(scene, { floorMat, railMat, stripeMat, sun } = {}) {
    this._out = { floor: floorMat ? floorMat.color : null, rail: railMat ? railMat.color : null, stripe: stripeMat ? stripeMat.color : null, sun: sun ? sun.color : null };
    this._key = 'grid';
    this._t = 1; // 0..1 through the colour cross-fade
    this._now = {}; this._from = {}; this._to = {};
    for (const n of COLOURS) { this._now[n] = new THREE.Color(WORLDS.grid[n]); this._from[n] = this._now[n].clone(); this._to[n] = this._now[n].clone(); }

    this._views = [];
    const band = bandGeometry();
    for (const key of Object.keys(SCENERY)) {
      const w = WORLDS[key], s = SCENERY[key], shapes = new Shapes();
      s.build(shapes, w);
      // Both are see-through materials on purpose: opacity is how a world fades in and out, and the
      // render orders put them first among the transparent things, band then silhouettes, so that
      // everything in the game (walls, the scoreboard, the boss) draws over them and never behind.
      const glowMat = new THREE.MeshBasicMaterial({ map: bandTexture(w, s), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide, dithering: true });
      const shapeMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, depthWrite: false, fog: false, side: THREE.DoubleSide, dithering: true });
      const glow = new THREE.Mesh(band, glowMat), shape = new THREE.Mesh(shapes.geometry(), shapeMat), group = new THREE.Group();
      glow.renderOrder = -30; shape.renderOrder = -29;
      group.name = `world-${key}`;
      for (const o of [glow, shape, group]) { o.frustumCulled = false; o.matrixAutoUpdate = false; } // they surround the player and never move
      group.add(glow, shape);
      scene.add(group);
      this._views.push({ key, group, glowMat, shapeMat, vis: 0, breath: s.breath ? s.breath[0] : 0, breathS: s.breath ? s.breath[1] : 1, phase: 0 });
    }
    // Every world is drawn once, fully see-through, on the first frame: that compiles the two shaders
    // and uploads the textures while the page is still loading, not as a hitch in the headset the
    // first time a world fades in.
    this._warm = 2;
    this._paint();
  }

  /** The world we are in, or on the way to. */
  get key() { return this._key; }
  /** The world's base sky right now (cross-fading during a change): start the sky tinting from this. Updated in place. */
  get sky() { return this._now.sky; }
  /** The world's fog colour right now. Every palette keeps it equal to `sky`. */
  get fog() { return this._now.fog; }
  /** The lane rails' resting emissive right now: the game lerps railMat.emissive from this toward its in-zone orange. Updated in place. */
  get railGlow() { return this._now.railGlow; }

  /**
   * Change world over about 2 s (or at once with `instant`): the colours cross-fade while the old
   * world's scenery fades out, then the new one's fades in. An unknown key means 'grid'. Asking for
   * the world we are already in (or heading for) changes nothing.
   */
  set(key, instant = false) {
    if (!Object.hasOwn(WORLDS, key)) key = 'grid';
    if (key === this._key && !instant) return;
    const w = WORLDS[key];
    this._key = key;
    for (let i = 0; i < COLOURS.length; i++) { const n = COLOURS[i]; this._from[n].copy(this._now[n]); this._to[n].setHex(w[n]); }
    this._t = 0;
    if (instant) {
      this._t = 1;
      for (let i = 0; i < COLOURS.length; i++) this._now[COLOURS[i]].copy(this._to[COLOURS[i]]);
      this._paint();
      for (let i = 0; i < this._views.length; i++) { const v = this._views[i]; v.vis = v.key === key ? 1 : 0; this._show(v, 0); }
    }
  }

  /** Call every frame with the frame time in seconds. */
  update(dt) {
    dt = dt > 0 ? Math.min(dt, 0.25) : 0; // also turns NaN into 0
    if (this._t < 1) {
      this._t = Math.min(1, this._t + dt / FADE);
      const k = ease(this._t);
      for (let i = 0; i < COLOURS.length; i++) { const n = COLOURS[i]; this._now[n].lerpColors(this._from[n], this._to[n], k); }
      this._paint();
    }
    // Scenery takes turns: the old world's leaves in the first half of the change and the new one's
    // arrives in the second, so two worlds are never drawn (or seen through each other) at once.
    const views = this._views, step = dt / (FADE / 2);
    let clear = true;
    for (let i = 0; i < views.length; i++) {
      const v = views[i];
      if (v.key !== this._key && v.vis > 0) { v.vis = Math.max(0, v.vis - step); if (v.vis > 0) clear = false; }
    }
    for (let i = 0; i < views.length; i++) {
      const v = views[i];
      if (v.key === this._key && clear && v.vis < 1) v.vis = Math.min(1, v.vis + step);
      this._show(v, dt);
    }
    if (this._warm > 0) this._warm--;
  }

  _paint() {
    const now = this._now, out = this._out;
    if (out.floor) out.floor.copy(now.floor);
    if (out.rail) out.rail.copy(now.rail);
    if (out.stripe) out.stripe.copy(now.stripe);
    if (out.sun) out.sun.copy(now.sun);
  }

  _show(v, dt) {
    const on = v.vis > 0 || this._warm > 0;
    v.group.visible = on;
    if (!on) return;
    const o = ease(v.vis);
    if (v.breath) v.phase = (v.phase + dt / v.breathS) % 1;
    v.glowMat.opacity = o * (1 - v.breath * (0.5 - 0.5 * Math.cos(v.phase * TAU)));
    v.shapeMat.opacity = o;
  }
}
