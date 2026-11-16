// Phone bridge: Charge 6 (Web Bluetooth, via the Bluefy browser on iPhone) -> game on the Quest.
import { parseHeartRateMeasurement } from './core.js?v10';
import { BridgeLink, normalizeCode, codeFromInput } from './link.js?v8';

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
const link = new BridgeLink({ onChange: renderLink });
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
