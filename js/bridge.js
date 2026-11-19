// Phone bridge: Charge 6 (Web Bluetooth, via the Bluefy browser on iPhone) -> game on the Quest.
import { parseHeartRateMeasurement } from './core.js?v59';
import { BridgeLink, normalizeCode, codeFromInput } from './link.js?v9';
import { workoutToTcx, latestRecord } from './tcx.js?v59';
import { cardBlobSync } from './card.js?v59';

const $ = (id) => document.getElementById(id);
const ui = {
  code: $('code'), linkBtn: $('linkBtn'), linkDot: $('linkDot'), linkText: $('linkText'),
  bleBtn: $('bleBtn'), bleAllBtn: $('bleAllBtn'), bleDot: $('bleDot'), bleText: $('bleText'),
  bpm: $('bpm'), fake: $('fake'), noBle: $('noBle'), awake: $('awake'),
};

const hasBle = !!(navigator.bluetooth && navigator.bluetooth.requestDevice);
ui.noBle.hidden = hasBle;
ui.bleBtn.disabled = ui.bleAllBtn.disabled = !hasBle;

// ------------------------------------------------------------------ link to the game
const link = new BridgeLink({ onChange: renderLink, onData: onGameData });

// ------------------------------------------------------------------ workout data from the game
// At the end of each workout the game sends its log in pieces; we join them and offer a file to save.
const WK_KEY = 'pulsezone.lastWorkout';
const wkParts = {};
let lastWorkout = null;
try { lastWorkout = JSON.parse(localStorage.getItem(WK_KEY) || 'null'); } catch { lastWorkout = null; }
function showWorkout() {
  $('wkBox').hidden = !lastWorkout;
  $('wkSave').disabled = $('wkTcx').disabled = $('wkCard').disabled = !lastWorkout;
  if (lastWorkout) $('wkText').textContent = `Latest workout: ${lastWorkout.label}`;
}
function onGameData(msg) {
  if (msg.t !== 'wk' || typeof msg.part !== 'string') return;
  const w = wkParts[msg.id] || (wkParts[msg.id] = { got: 0, parts: [] });
  if (w.parts[msg.i] == null) { w.parts[msg.i] = msg.part; w.got++; }
  if (w.got < msg.n) return;
  delete wkParts[msg.id];
  lastWorkout = { name: String(msg.name), label: String(msg.label), text: w.parts.join('') };
  try { localStorage.setItem(WK_KEY, JSON.stringify(lastWorkout)); } catch { /* too big to keep: still saveable now */ }
  showWorkout();
}
async function saveWorkout() {
  if (!lastWorkout) return;
  const file = new File([lastWorkout.text], lastWorkout.name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'PulseZone workout' }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = file.name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
$('wkSave').addEventListener('click', saveWorkout);
// Export (v57): the same workout as a Garmin TCX file for Strava / Garmin Connect / other apps.
async function exportTcx() {
  if (!lastWorkout) return;
  let rec = null;
  try { rec = latestRecord(JSON.parse(lastWorkout.text)); } catch { rec = null; }
  const xml = rec ? workoutToTcx(rec) : '';
  if (!xml) { $('wkText').textContent = 'This workout has no heart-rate data to export.'; return; }
  const name = `pulsezone-${String(rec.date || '').slice(0, 16).replace(/[:T]/g, '-') || 'workout'}.tcx`;
  const file = new File([xml], name, { type: 'application/vnd.garmin.tcx+xml' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'PulseZone workout (TCX)' }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = file.name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
$('wkTcx').addEventListener('click', exportTcx);
// Summary card (v58): the same workout as a picture to share or keep, made here because the phone
// is where sharing happens. The PNG is made in the same turn as the tap (cardBlobSync, nothing
// awaited before share): iPhone only opens the share sheet straight from a tap.
async function saveCard() {
  if (!lastWorkout) return;
  let rec = null;
  try { rec = latestRecord(JSON.parse(lastWorkout.text)); } catch { rec = null; }
  if (!rec || !Array.isArray(rec.rows) || !rec.rows.length) { $('wkText').textContent = 'This workout has no heart-rate data to export.'; return; }
  const png = cardBlobSync(rec);
  if (!png) { $('wkText').textContent = 'This browser could not make the picture.'; return; }
  const name = `pulsezone-${String(rec.date || '').slice(0, 16).replace(/[:T]/g, '-') || 'workout'}.png`;
  const file = new File([png], name, { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'PulseZone workout' }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = file.name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
$('wkCard').addEventListener('click', saveCard);
showWorkout();
const LINK_TEXT = {
  idle: ['', 'Type the code shown in the game'],
  connecting: ['warn', 'Looking for the game...'],
  linked: ['good', 'Linked to the game'],
  'not-found': ['bad', 'Game not found - check the code and that the game is open'],
  offline: ['bad', 'No internet connection - retrying'],
};
function renderLink() {
  const [cls, text] = LINK_TEXT[link.state] || LINK_TEXT.idle;
  ui.linkDot.className = 'dot ' + cls;
  ui.linkText.textContent = text;
  if (link.state === 'linked') sendStatus();
}

const fromUrl = normalizeCode(new URLSearchParams(location.search).get('code'));
ui.code.value = fromUrl || link.code || '';
// Accept the bare code or the whole bridge link pasted in; show just the code.
function linkFromBox() {
  const code = codeFromInput(ui.code.value);
  ui.code.value = code;
  if (code) link.connect(code);
  else { ui.linkDot.className = 'dot bad'; ui.linkText.textContent = 'Enter the 6-letter phone code shown in the game'; }
}
ui.code.addEventListener('paste', () => setTimeout(linkFromBox, 0)); // auto-link on paste
ui.linkBtn.addEventListener('click', linkFromBox);
ui.code.addEventListener('keydown', (e) => { if (e.key === 'Enter') linkFromBox(); });
if (ui.code.value) link.connect(ui.code.value);

// ------------------------------------------------------------------ Bluetooth heart rate
let device = null;
let wantConnected = false;
let reconnectDelay = 1000;
let bleState = 'Not connected';
let lastBpmAt = 0;

function setBle(cls, text) {
  bleState = text;
  ui.bleDot.className = 'dot ' + cls;
  ui.bleText.textContent = text;
  sendStatus();
}

function sendStatus() {
  link.send({ t: 'status', text: ui.fake.checked ? 'Test mode - fake heart rate from phone' : bleState });
}

function onBpm(bpm, extra = {}) {
  lastBpmAt = performance.now();
  ui.bpm.textContent = String(bpm);
  link.send({ t: 'hr', bpm, ...extra });
}

async function chooseDevice(showAll) {
  try {
    const options = showAll
      ? { acceptAllDevices: true, optionalServices: ['heart_rate'] }
      : { filters: [{ services: ['heart_rate'] }], optionalServices: ['heart_rate'] };
    const picked = await navigator.bluetooth.requestDevice(options);
    try { localStorage.setItem(DEV_KEY, picked.id || picked.name || ''); } catch { /* private mode */ }
    if (device && device !== picked) device.gatt?.disconnect();
    if (device !== picked) picked.addEventListener('gattserverdisconnected', onDisconnected);
    device = picked;
    wantConnected = true;
    reconnectDelay = 1000;
    await connectGatt();
  } catch (err) {
    if (err && err.name === 'NotFoundError') setBle('', 'No device chosen');
    else setBle('bad', 'Bluetooth error: ' + (err?.message || err));
  }
}

async function connectGatt() {
  if (!device) return;
  const name = device.name || 'heart-rate monitor';
  try {
    setBle('warn', `Connecting to ${name}...`);
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService('heart_rate');
    const ch = await service.getCharacteristic('heart_rate_measurement');
    ch.addEventListener('characteristicvaluechanged', (e) => {
      const m = parseHeartRateMeasurement(e.target.value);
      if (!m) return;
      if (!m.hasSkinContact) { setBle('warn', `${name}: no skin contact - tighten the band`); return; }
      if (!bleState.startsWith('Live')) setBle('good', `Live from ${name}`);
      if (!ui.fake.checked) onBpm(m.bpm, m.rrIntervalsSeconds.length ? { rr: m.rrIntervalsSeconds } : {});
    });
    await ch.startNotifications();
    reconnectDelay = 1000;
    setBle('good', `Connected to ${name}, waiting for heart rate...`);
  } catch (err) {
    const msg = String(err?.message || err);
    if (/heart_rate|service/i.test(msg) && /not found|no services/i.test(msg)) {
      setBle('bad', `${name} isn't sharing heart rate. Turn on heart-rate sharing and try again.`);
      wantConnected = false;
      device.gatt?.disconnect();
    } else {
      setBle('bad', `Couldn't connect to ${name}: ${msg}`);
      scheduleReconnect();
    }
  }
}

function onDisconnected() {
  if (!wantConnected) return;
  setBle('warn', 'Connection lost - reconnecting...');
  scheduleReconnect();
}

function scheduleReconnect() {
  if (!wantConnected) return;
  setTimeout(connectGatt, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, 15000);
}

// Less setup each session (v55): reconnect the monitor you picked last time without the chooser,
// where the browser allows it (Web Bluetooth getDevices). Otherwise tap the button as before.
const DEV_KEY = 'pulsezone.bridge.device';
async function autoReconnect() {
  if (!navigator.bluetooth?.getDevices || device) return;
  try {
    const want = localStorage.getItem(DEV_KEY);
    const list = await navigator.bluetooth.getDevices();
    const d = list.find((x) => want && (x.id === want || x.name === want)) || (list.length === 1 ? list[0] : null);
    if (!d || device) return;
    device = d;
    d.addEventListener('gattserverdisconnected', onDisconnected);
    wantConnected = true;
    reconnectDelay = 1000;
    setBle('warn', `Reconnecting to ${d.name || 'your heart-rate monitor'} from last time...`);
    await connectGatt();
  } catch { /* not allowed here: the Connect button still works */ }
}
autoReconnect();

ui.bleBtn.addEventListener('click', () => chooseDevice(false));
ui.bleAllBtn.addEventListener('click', () => chooseDevice(true));

// ------------------------------------------------------------------ test mode
let fakeT = 0;
setInterval(() => {
  if (!ui.fake.checked) return;
  fakeT += 1;
  // Slow wave between ~85 and ~135 BPM, like someone working out.
  const bpm = Math.round(110 + 25 * Math.sin(fakeT / 20) + (Math.random() * 4 - 2));
  onBpm(bpm, { fake: true });
}, 1000);
ui.fake.addEventListener('change', () => {
  if (!ui.fake.checked) ui.bpm.textContent = '--';
  sendStatus();
});

// Show "--" if readings stop.
setInterval(() => {
  if (lastBpmAt && performance.now() - lastBpmAt > 8000) ui.bpm.textContent = '--';
}, 2000);

// ------------------------------------------------------------------ keep the screen on
// iPhone pauses web pages when the screen locks, which cuts off the heart rate. Try the Wake Lock
// API first; otherwise play an invisible, silent looping video (which also keeps iOS awake).
// The reliable fix is iPhone Settings > Display & Brightness > Auto-Lock > Never.
let awakeVideo = null;
let awakeMode = 'off';
async function keepAwake() {
  try {
    if (navigator.wakeLock) {
      await navigator.wakeLock.request('screen');
      awakeMode = 'wake lock';
      renderAwake();
      return;
    }
  } catch { /* fall through to the video trick */ }
  try {
    if (!awakeVideo) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 2;
      const g = canvas.getContext('2d');
      setInterval(() => { g.fillStyle = `rgb(${(Math.random() * 255) | 0},0,0)`; g.fillRect(0, 0, 2, 2); }, 500);
      awakeVideo = document.createElement('video');
      awakeVideo.muted = true;
      awakeVideo.playsInline = true;
      awakeVideo.setAttribute('playsinline', '');
      awakeVideo.setAttribute('muted', '');
      awakeVideo.srcObject = canvas.captureStream(2);
      awakeVideo.style.cssText = 'position:fixed;right:0;bottom:0;width:2px;height:2px;opacity:0.01;pointer-events:none';
      document.body.appendChild(awakeVideo);
    }
    await awakeVideo.play();
    awakeMode = 'video';
  } catch {
    awakeMode = 'off';
  }
  renderAwake();
}
function renderAwake() {
  ui.awake.textContent = awakeMode === 'off'
    ? 'This browser may let the screen lock. Use Guided Access below so it stays on.'
    : 'Trying to keep the screen on. For a whole workout, use Guided Access below.';
}
// Must start from a tap on iPhone.
for (const el of [ui.linkBtn, ui.bleBtn, ui.bleAllBtn, ui.fake]) el.addEventListener('click', keepAwake);
keepAwake();

// When the phone wakes up again: reconnect everything straight away.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    link.send({ t: 'status', text: 'Phone screen locked - heart rate paused' });
    return;
  }
  keepAwake();
  if (link.code && link.state !== 'linked') link.connect(link.code);
  if (wantConnected && device && !device.gatt?.connected) { reconnectDelay = 1000; connectGatt(); }
  sendStatus();
});

// For automated testing.
window.pzBridge = { link, get bleState() { return bleState; } };
