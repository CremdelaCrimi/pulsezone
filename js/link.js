// Phone <-> headset link over WebRTC (PeerJS). The public PeerJS server only introduces the
// two devices; heart-rate messages then travel directly between them. Needs window.Peer
// (peerjs.min.js loaded as a classic script before this module).

const PREFIX = 'pulsezone-hr-';
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L confusion
const CODE_KEY = 'pulsezone.code';

export function newCode(len = 6) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}

export const normalizeCode = (s) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Pull the pairing code out of whatever the player typed or pasted: the bare code ("FKGS5G"),
 * or the whole bridge link ("https://.../bridge.html?code=FKGS5G").
 */
export function codeFromInput(text) {
  const t = String(text || '').trim();
  const m = t.match(/[?&#]code=([A-Za-z0-9]+)/i);
  if (m) return normalizeCode(m[1]);
  if (/^https?:|\//i.test(t)) return ''; // a link without a code in it
  return normalizeCode(t).slice(0, 8);
}
const peerIdFor = (code) => PREFIX + normalizeCode(code).toLowerCase();

function storageGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function storageSet(key, v) { try { localStorage.setItem(key, v); } catch { /* private mode */ } }

/**
 * Headset side. Shows a pairing code and receives {t:'hr', bpm} and {t:'status', text} messages.
 * state: 'starting' | 'waiting' | 'linked' | 'offline'
 */
export class HostLink {
  constructor({ onBpm = () => {}, onBridgeStatus = () => {}, onChange = () => {} } = {}) {
    this.onBpm = onBpm;
    this.onBridgeStatus = onBridgeStatus;
    this.onChange = onChange;
    this.code = normalizeCode(storageGet(CODE_KEY)) || newCode();
    this.state = 'starting';
    this.error = '';
    this.conns = new Set();
    this.peer = null;
    this.lastSeen = 0;
  }

  start() {
    // WebRTC can take a long time to notice a phone that vanished (screen locked, page closed),
    // so the bridge pings every 2 s and we treat 8 s of silence as gone.
    setInterval(() => {
      if (this.state === 'linked' && performance.now() - this.lastSeen > 8000) {
        for (const c of this.conns) c.close();
        this.conns.clear();
        this.set('waiting');
      }
    }, 2000);
    if (typeof window.Peer !== 'function') {
      this.set('offline', 'Could not load the connection library (check internet)');
      return;
    }
    this.open();
  }

  open() {
    this.peer?.destroy();
    this.set('starting');
    const peer = new window.Peer(peerIdFor(this.code), { debug: 1 });
    this.peer = peer;
    peer.on('open', () => {
      storageSet(CODE_KEY, this.code);
      this.set(this.conns.size ? 'linked' : 'waiting');
    });
    peer.on('connection', (conn) => this.adopt(conn));
    peer.on('disconnected', () => { if (!peer.destroyed) setTimeout(() => peer.reconnect(), 2000); });
    peer.on('error', (err) => {
      if (err.type === 'unavailable-id') {
        // Someone (or a stale tab of ours) holds this code: pick a new one.
        this.code = newCode();
        setTimeout(() => this.open(), 200);
      } else if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error') {
        this.set('offline', 'No connection to the pairing server - retrying');
        setTimeout(() => this.open(), 5000);
      } else {
        console.warn('PulseZone link error', err.type, err);
      }
    });
  }

  adopt(conn) {
    conn.on('open', () => {
      this.lastSeen = performance.now();
      this.conns.add(conn);
      this.set('linked');
      conn.send({ t: 'hello', from: 'game' });
    });
    conn.on('data', (msg) => {
      if (!msg || typeof msg !== 'object') return;
      this.lastSeen = performance.now();
      if (!this.conns.has(conn)) { this.conns.add(conn); this.set('linked'); }
      if (msg.t === 'hr' && typeof msg.bpm === 'number') this.onBpm(msg.bpm, msg);
      else if (msg.t === 'status') this.onBridgeStatus(String(msg.text || ''));
    });
    const drop = () => {
      this.conns.delete(conn);
      if (this.state === 'linked' && !this.conns.size) this.set('waiting');
    };
    conn.on('close', drop);
    conn.on('error', drop);
  }

  set(state, error = '') {
    this.state = state;
    this.error = error;
    this.onChange(this);
  }
}

/**
 * Phone side. Connects to the game with its code, sends heart rate, reconnects by itself.
 * state: 'idle' | 'connecting' | 'linked' | 'not-found' | 'offline'
 */
export class BridgeLink {
  constructor({ onChange = () => {} } = {}) {
    this.onChange = onChange;
    this.code = normalizeCode(storageGet(CODE_KEY + '.bridge'));
    this.state = 'idle';
    this.peer = null;
    this.conn = null;
    this.retryTimer = 0;
    setInterval(() => this.send({ t: 'ping' }), 2000);
  }

  connect(code) {
    this.code = normalizeCode(code);
    if (!this.code) return;
    storageSet(CODE_KEY + '.bridge', this.code);
    clearTimeout(this.retryTimer);
    if (typeof window.Peer !== 'function') { this.set('offline'); return; }
    if (!this.peer || this.peer.destroyed) {
      this.peer = new window.Peer({ debug: 1 });
      this.peer.on('open', () => this.dial());
      this.peer.on('disconnected', () => { if (!this.peer.destroyed) setTimeout(() => this.peer.reconnect(), 2000); });
      this.peer.on('error', (err) => {
        if (err.type === 'peer-unavailable') this.set('not-found');
        else if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error') this.set('offline');
        else console.warn('PulseZone bridge error', err.type, err);
        this.retry();
      });
      this.set('connecting');
    } else if (this.peer.open) {
      this.dial();
    }
  }

  dial() {
    this.conn?.close();
    this.set(this.state === 'not-found' ? 'not-found' : 'connecting');
    const conn = this.peer.connect(peerIdFor(this.code), { serialization: 'json', reliable: true });
    this.conn = conn;
    conn.on('open', () => this.set('linked'));
    const lost = () => {
      if (this.conn !== conn) return;
      if (this.state === 'linked') this.set('connecting');
      this.retry();
    };
    conn.on('close', lost);
    conn.on('error', lost);
  }

  retry() {
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => { if (this.peer?.open) this.dial(); }, 3000);
  }

  send(msg) {
    if (this.state === 'linked' && this.conn?.open) this.conn.send(msg);
  }

  set(state) {
    this.state = state;
    this.onChange(this);
  }
}
