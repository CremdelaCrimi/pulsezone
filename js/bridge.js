// Phone bridge: Charge 6 (Web Bluetooth, via the Bluefy browser on iPhone) -> game on the Quest.
import { parseHeartRateMeasurement } from './core.js';
import { BridgeLink, normalizeCode } from './link.js';

const $ = (id) => document.getElementById(id);
const ui = {
  code: $('code'), linkBtn: $('linkBtn'), linkDot: $('linkDot'), linkText: $('linkText'),
  bleBtn: $('bleBtn'), bleAllBtn: $('bleAllBtn'), bleDot: $('bleDot'), bleText: $('bleText'),
  bpm: $('bpm'), fake: $('fake'), noBle: $('noBle'),
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
ui.linkBtn.addEventListener('click', () => link.connect(ui.code.value));
ui.code.addEventListener('keydown', (e) => { if (e.key === 'Enter') link.connect(ui.code.value); });
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

// Keep the screen on where supported.
async function keepAwake() {
  try { await navigator.wakeLock?.request('screen'); } catch { /* not supported or denied */ }
}
keepAwake();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') keepAwake(); });

// For automated testing.
window.pzBridge = { link, get bleState() { return bleState; } };
