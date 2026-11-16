// Heart "thermometer" gauge: frosty and icy below your zone, a lively flame in it,
// a tall hyper flame with embers above it. One shader on one plane, so it's cheap on Quest.
import * as THREE from 'three';

const vertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

const fragment = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime, uLevel, uZoneLo, uZoneHi, uCold, uFlame, uHyper, uSignal;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }
  float sdRoundBox(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }

  void main() {
    // Plane is 0.5 m wide x 1.5 m tall; work in metres centred on the plane.
    vec2 p = (vUv - 0.5) * vec2(0.5, 1.5);
    const float TOP = 0.50, BOT = -0.48;
    vec2 tubeC = vec2(0.0, (TOP + BOT) * 0.5);
    vec2 bulbC = vec2(0.0, -0.56);

    float glass = min(sdRoundBox(p - tubeC, vec2(0.065, (TOP - BOT) * 0.5), 0.065), length(p - bulbC) - 0.115);
    float inner = min(sdRoundBox(p - tubeC, vec2(0.042, (TOP - BOT) * 0.5 - 0.02), 0.042), length(p - bulbC) - 0.092);

    float fillY = mix(BOT, TOP - 0.03, clamp(uLevel, 0.0, 1.0));
    fillY += 0.005 * sin(p.x * 70.0 + uTime * 5.0) * (uFlame + uHyper + 0.3);
    float liquid = step(inner, 0.0) * step(p.y, fillY);

    // Liquid colour: icy blue -> warm orange -> hot red; grey with no signal.
    vec3 coldCol = mix(vec3(0.25, 0.55, 1.0), vec3(0.75, 0.95, 1.0), smoothstep(-0.6, 0.4, p.y));
    vec3 warmCol = mix(vec3(1.0, 0.35, 0.05), vec3(1.0, 0.8, 0.25), smoothstep(-0.6, 0.4, p.y));
    vec3 hotCol = mix(vec3(0.9, 0.05, 0.1), vec3(1.0, 0.55, 0.3), smoothstep(-0.6, 0.4, p.y));
    float wSum = uCold + uFlame + uHyper + 1e-4;
    vec3 liqCol = (coldCol * uCold + warmCol * uFlame + hotCol * uHyper) / wSum;
    liqCol = mix(vec3(0.45), liqCol, clamp(wSum * 1.2, 0.0, 1.0) * uSignal);

    vec4 col = vec4(0.0);

    // Glass body: faint fill, bright rim.
    float body = step(glass, 0.0);
    col = mix(col, vec4(0.75, 0.85, 1.0, 0.12), body);
    float rim = smoothstep(0.007, 0.0, abs(glass));
    col = mix(col, vec4(0.85, 0.92, 1.0, 0.75), rim);

    // Liquid, with a soft highlight stripe.
    float stripe = smoothstep(0.02, 0.0, abs(p.x + 0.018)) * 0.35;
    col = mix(col, vec4(liqCol + stripe, 0.95), liquid);

    // Target zone band beside the tube.
    float zLo = mix(BOT, TOP - 0.03, uZoneLo), zHi = mix(BOT, TOP - 0.03, uZoneHi);
    float band = step(0.085, p.x) * step(p.x, 0.115) * step(zLo, p.y) * step(p.y, zHi);
    col = mix(col, vec4(0.3, 1.0, 0.45, 0.85), band);
    float tick = step(0.08, p.x) * step(p.x, 0.13) * smoothstep(0.004, 0.0, abs(p.y - (zLo + zHi) * 0.5));
    col = mix(col, vec4(1.0), tick);

    // Frost: crystalline growth hugging the glass, plus drifting sparkles.
    if (uCold > 0.01) {
      float n = fbm(p * 38.0 + vec2(0.0, uTime * 0.05));
      float crystals = smoothstep(0.52, 0.72, n) * smoothstep(0.09, 0.0, glass + 0.01);
      float veins = smoothstep(0.02, 0.0, abs(fbm(p * 22.0) - 0.5)) * smoothstep(0.06, 0.0, abs(glass));
      float frost = clamp(crystals + veins * 0.8, 0.0, 1.0) * uCold;
      col = mix(col, vec4(0.85, 0.95, 1.0, 0.9), frost);
      vec2 g = floor(p * 90.0 + vec2(0.0, -uTime * 3.0));
      float spark = step(0.992, hash(g)) * step(glass, 0.12) * (0.5 + 0.5 * sin(uTime * 8.0 + hash(g) * 30.0));
      col = mix(col, vec4(1.0), spark * uCold);
    }

    // Flames licking up from the liquid surface.
    float heat = uFlame + uHyper;
    if (heat > 0.01) {
      float h = 0.17 * uFlame + 0.36 * uHyper;          // flame height
      float speed = 1.4 + 2.6 * uHyper;
      vec2 fp = vec2(p.x, p.y - fillY);
      float t = clamp(fp.y / max(h, 1e-3), 0.0, 1.0);
      float wob = (fbm(vec2(fp.x * 12.0, fp.y * 8.0 - uTime * speed)) - 0.5) * (0.07 + 0.05 * uHyper);
      float width = mix(0.075 + 0.07 * uHyper, 0.0, pow(t, 0.7));
      float shape = smoothstep(width, width * 0.25, abs(fp.x + wob)) * step(-0.01, fp.y) * (1.0 - t);
      float flick = fbm(vec2(fp.x * 20.0, fp.y * 14.0 - uTime * speed * 1.7));
      float flame = clamp(shape * (0.9 + flick) * (1.3 + 0.5 * uHyper), 0.0, 1.0) * clamp(heat, 0.0, 1.0);
      vec3 flameCol = mix(vec3(1.0, 0.92, 0.55), vec3(1.0, 0.35, 0.05), t);
      flameCol = mix(flameCol, mix(vec3(1.0, 1.0, 0.95), vec3(0.95, 0.1, 0.2), t), uHyper);
      col = mix(col, vec4(flameCol, 1.0), flame);
      // Hyper embers floating up.
      vec2 eg = floor(vec2(p.x * 40.0, p.y * 40.0 - uTime * 6.0));
      float ember = step(0.985, hash(eg)) * step(fillY, p.y) * step(p.y, fillY + h * 1.6) * step(abs(p.x), 0.16);
      col = mix(col, vec4(1.0, 0.6, 0.2, 1.0), ember * uHyper);
    }

    // Warm glow around the glass when burning (stronger when hyper).
    float glow = smoothstep(0.12, 0.0, glass) * (1.0 - step(glass, 0.0)) * (0.35 * uFlame + 0.6 * uHyper);
    glow *= 0.75 + 0.25 * sin(uTime * (6.0 + 8.0 * uHyper));
    col.rgb = mix(col.rgb, mix(vec3(1.0, 0.55, 0.15), vec3(1.0, 0.2, 0.15), uHyper), glow * (1.0 - col.a));
    col.a = max(col.a, glow * 0.6);

    if (col.a < 0.01) discard;
    gl_FragColor = col;
  }
`;

export class HeartThermometer {
  constructor() {
    this.uniforms = {
      uTime: { value: 0 }, uLevel: { value: 0 }, uZoneLo: { value: 0.5 }, uZoneHi: { value: 0.6 },
      uCold: { value: 0 }, uFlame: { value: 0 }, uHyper: { value: 0 }, uSignal: { value: 0 },
    };
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 1.5),
      new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, uniforms: this.uniforms, transparent: true, depthWrite: false }),
    );
    this.level = 0;
  }

  /**
   * look: {cold, flame, hyper} targets (0..1). Values ease toward their targets so the
   * gauge melts / ignites smoothly instead of snapping.
   */
  update(dt, { bpm, hasSignal, target, halfWidth, minBpm = 50, maxBpm = 190, look }) {
    const u = this.uniforms;
    const map = (b) => Math.min(1, Math.max(0, (b - minBpm) / (maxBpm - minBpm)));
    const a = 1 - Math.exp(-dt * 2.5);
    if (hasSignal) this.level += (map(bpm) - this.level) * a;
    u.uLevel.value = this.level;
    u.uZoneLo.value = map(target - halfWidth);
    u.uZoneHi.value = map(target + halfWidth);
    const k = 1 - Math.exp(-dt * 1.5);
    u.uCold.value += (look.cold - u.uCold.value) * k;
    u.uFlame.value += (look.flame - u.uFlame.value) * k;
    u.uHyper.value += (look.hyper - u.uHyper.value) * k;
    u.uSignal.value += ((hasSignal ? 1 : 0) - u.uSignal.value) * k;
    u.uTime.value += dt;
  }
}
