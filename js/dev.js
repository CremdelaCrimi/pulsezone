// Developer tuning panel (desktop): change the game's numbers without editing code.
// Values are saved in this browser (localStorage) and applied on "Apply & restart".
// To change the defaults for every device, edit EASY / HARD / ACTIVITIES / defaultZoneSettings
// in js/core.js, e.g. in the GitHub web editor at https://github.dev/CremdelaCrimi/pulsezone.
import { EASY, HARD, ACTIVITIES, defaultZoneSettings } from './core.js?v49';

const KEY = 'pulsezone.tuning';

const FIELDS = {
  difficulty: [
    ['spawnInterval', 'Seconds between spawns', 0.2, 5, 0.05],
    ['orbSpeed', 'Orb speed (m/s)', 0.5, 8, 0.1],
    ['horizontalSpread', 'Left/right spread (m)', 0, 1, 0.05],
    ['verticalSpread', 'Up/down spread (m)', 0, 1, 0.05],
    ['minPunchSpeed', 'Min punch speed (m/s)', 0, 4, 0.1],
    ['crossBodyChance', 'Cross-body orb chance', 0, 1, 0.05],
  ],
  controller: [
    ['kp', 'Response to BPM gap (Kp)', 0, 0.05, 0.001],
    ['ki', 'Build-up when stuck (Ki)', 0, 0.003, 0.00005],
    ['kd', 'Anticipation of HR trend (Kd)', 0, 2, 0.05],
    ['maxIntensityChangePerSecond', 'Max intensity change / s', 0.005, 0.2, 0.005],
    ['zoneHalfWidth', 'Zone width (± BPM)', 2, 20, 1],
  ],
};

export function defaultTuning() {
  const zs = defaultZoneSettings();
  return {
    easy: Object.fromEntries(FIELDS.difficulty.map(([k]) => [k, EASY[k]])),
    hard: Object.fromEntries(FIELDS.difficulty.map(([k]) => [k, HARD[k]])),
    weights: Object.fromEntries(ACTIVITIES.map((a) => [a.key, a.base])),
    controller: Object.fromEntries(FIELDS.controller.map(([k]) => [k, zs[k]])),
    boostRiseSeconds: 45,
  };
}

export function loadTuning() {
  const d = defaultTuning();
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    for (const part of ['easy', 'hard', 'weights', 'controller']) Object.assign(d[part], saved[part] || {});
    if (typeof saved.boostRiseSeconds === 'number') d.boostRiseSeconds = saved.boostRiseSeconds;
  } catch { /* ignore */ }
  return d;
}

export function saveTuning(t) { try { localStorage.setItem(KEY, JSON.stringify(t)); } catch { /* ignore */ } }

/**
 * Build the panel. hooks: { tuning, onApply(tuning), onDownloadLog(), onResetLearning(), getRanking() }
 */
export function createDevPanel(hooks) {
  const el = document.createElement('div');
  el.id = 'dev';
  el.innerHTML = `
    <style>
      #dev { position: fixed; top: 16px; right: 16px; width: min(380px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow: auto;
             background: #0a0c12f0; border: 1px solid #2b3242; border-radius: 12px; padding: 12px 14px; font: 13px/1.45 system-ui, sans-serif; color: #dfe3ea; z-index: 10; }
      #dev h3 { margin: 12px 0 6px; font-size: 13px; color: #8d95a5; text-transform: uppercase; letter-spacing: .06em; }
      #dev h2 { margin: 0 0 4px; font-size: 16px; }
      #dev .row { display: grid; grid-template-columns: 1fr 70px 70px; gap: 6px; align-items: center; margin: 3px 0; }
      #dev .row2 { display: grid; grid-template-columns: 1fr 90px; gap: 6px; align-items: center; margin: 3px 0; }
      #dev .head { color: #8d95a5; font-size: 11px; }
      #dev input { width: 100%; box-sizing: border-box; background: #121621; color: #dfe3ea; border: 1px solid #2b3242; border-radius: 6px; padding: 4px 6px; }
      #dev button { margin: 4px 4px 0 0; }
      #dev .note { color: #8d95a5; font-size: 12px; }
      #dev pre { white-space: pre-wrap; background: #121621; padding: 6px; border-radius: 6px; font-size: 11px; max-height: 120px; overflow: auto; }
    </style>
    <button id="devClose" class="secondary" style="float:right">✕</button>
    <h2>Developer tuning</h2>
    <div class="note">Saved in this browser. Apply restarts the workout. For code changes, open the
      <a href="https://github.dev/CremdelaCrimi/pulsezone" target="_blank" rel="noopener">GitHub web editor</a>.</div>
    <h3>Difficulty (easy → hard ends)</h3>
    <div class="row head"><span></span><span>easy</span><span>hard</span></div>
    <div id="devDiff"></div>
    <h3>Activity mix (relative amounts)</h3>
    <div id="devMix"></div>
    <h3>Heart-rate controller</h3>
    <div id="devCtl"></div>
    <div class="row2"><span>Seconds stuck before max challenge boost</span><input id="devBoost" type="number" step="5" min="10" max="300" /></div>
    <div>
      <button id="devApply">Apply &amp; restart</button>
      <button id="devReset" class="secondary">Reset to defaults</button>
      <button id="devCopy" class="secondary">Copy settings JSON</button>
    </div>
    <h3>Data</h3>
    <div class="note">Every workout is logged once per second (heart rate, intensity, challenge boost, reps of each activity).</div>
    <button id="devLog" class="secondary">Download last workout (CSV)</button>
    <button id="devForget" class="secondary">Reset learned heart-rate data</button>
    <pre id="devRank"></pre>
  `;
  document.body.appendChild(el);
  const $ = (id) => el.querySelector('#' + id);
  const t = hooks.tuning;

  const num = (val, step, min, max) => `<input type="number" step="${step}" min="${min}" max="${max}" value="${val}">`;
  $('devDiff').innerHTML = FIELDS.difficulty.map(([k, label, min, max, step]) =>
    `<div class="row" data-k="${k}"><span>${label}</span>${num(t.easy[k], step, min, max)}${num(t.hard[k], step, min, max)}</div>`).join('');
  $('devMix').innerHTML = ACTIVITIES.map((a) =>
    `<div class="row2" data-k="${a.key}"><span>${a.label}</span>${num(t.weights[a.key], 0.05, 0, 5)}</div>`).join('');
  $('devCtl').innerHTML = FIELDS.controller.map(([k, label, min, max, step]) =>
    `<div class="row2" data-k="${k}"><span>${label}</span>${num(t.controller[k], step, min, max)}</div>`).join('');
  $('devBoost').value = t.boostRiseSeconds;

  const read = () => {
    const out = defaultTuning();
    el.querySelectorAll('#devDiff .row').forEach((r) => {
      const [e, h] = r.querySelectorAll('input');
      out.easy[r.dataset.k] = Number(e.value);
      out.hard[r.dataset.k] = Number(h.value);
    });
    el.querySelectorAll('#devMix .row2').forEach((r) => { out.weights[r.dataset.k] = Number(r.querySelector('input').value); });
    el.querySelectorAll('#devCtl .row2').forEach((r) => { out.controller[r.dataset.k] = Number(r.querySelector('input').value); });
    out.boostRiseSeconds = Number($('devBoost').value) || 45;
    return out;
  };

  $('devApply').addEventListener('click', () => { const v = read(); saveTuning(v); hooks.onApply(v); });
  $('devReset').addEventListener('click', () => { const v = defaultTuning(); saveTuning(v); el.remove(); hooks.onApply(v); createDevPanel({ ...hooks, tuning: v }); });
  $('devCopy').addEventListener('click', async () => {
    const text = JSON.stringify(read(), null, 2);
    try { await navigator.clipboard.writeText(text); $('devCopy').textContent = 'Copied!'; } catch { $('devRank').textContent = text; }
  });
  $('devLog').addEventListener('click', () => hooks.onDownloadLog());
  $('devForget').addEventListener('click', () => { hooks.onResetLearning(); $('devForget').textContent = 'Learned data reset'; });
  $('devClose').addEventListener('click', () => { el.style.display = 'none'; });

  const showRank = () => {
    const r = hooks.getRanking();
    $('devRank').textContent = 'What raises your heart rate (BPM per 10 reps/min · reps):\n' +
      r.map((x) => `${x.label.padEnd(18)} ${x.bpmPer10.toFixed(1).padStart(5)} · ${x.reps}`).join('\n');
  };
  showRank();
  setInterval(showRank, 3000);
  return el;
}
