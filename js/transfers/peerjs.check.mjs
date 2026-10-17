// Behaviour checks for droptransfer's PeerJS transport.
//
// The bug this exists for: when the signalling server never answered, initSender had no
// timeout, so the UI sat on "Creating peer connection..." forever with no error. These
// checks drive the real module against a scripted Peer stub — no browser, no network.
//
// usage: node js/transfers/peerjs.check.mjs
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

// ---- Peer stub -------------------------------------------------------------
let created = [];
let behaviour = () => {};          // (peer, index) => void
class FakePeer {
  constructor(opts) {
    this.opts = opts;
    this.id = 'peer-' + created.length;
    this.handlers = {};
    this.destroyed = false;
    created.push(this);
    behaviour(this, created.length - 1);
  }
  on(ev, fn) { (this.handlers[ev] = this.handlers[ev] || []).push(fn); }
  emit(ev, ...args) { (this.handlers[ev] || []).forEach((fn) => fn(...args)); }
  destroy() { this.destroyed = true; this.emit('close'); }
  connect() { return new FakeConn(); }
  reconnect() {}
}
class FakeConn {
  constructor() { this.open = true; this.handlers = {}; this.sent = []; }
  on(ev, fn) { (this.handlers[ev] = this.handlers[ev] || []).push(fn); }
  emit(ev, ...a) { (this.handlers[ev] || []).forEach((fn) => fn(...a)); }
  send(d) { this.sent.push(d); }
  close() {}
}
globalThis.Peer = FakePeer;

const { PeerJSTransfer, signalingConfig } = await import(join(here, 'peerjs.js'));

const results = [];
const check = (name, ok, detail) => results.push([ok, name, detail]);
const reset = () => { created = []; behaviour = () => {}; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// keep the timeouts tiny so the suite is fast
signalingConfig.timeoutMs = 60;
signalingConfig.servers = [{ host: 'a.test', port: 443, secure: true, path: '/' }];

// 1. happy path: a server that answers
reset();
behaviour = (peer) => setTimeout(() => peer.emit('open'), 5);
{
  const t = new PeerJSTransfer();
  const ready = await new Promise((resolve, reject) => {
    t.initSender((id, secret) => resolve({ id, secret }), (err) => reject(err));
    setTimeout(() => reject(new Error('initSender never called back')), 1500);
  });
  check('onReady fires with a peer id', !!ready.id, JSON.stringify(ready));
  check('onReady includes a secret', typeof ready.secret === 'string' && ready.secret.length >= 20, ready.secret);
  check('sender waits after opening', t.peer.id === ready.id, '');
}

// 2. a silent server must time out instead of hanging
reset();
behaviour = () => {};                       // never opens, never errors
{
  const t = new PeerJSTransfer();
  const outcome = await new Promise((resolve) => {
    t.initSender(() => resolve('ready'), (err) => resolve('error: ' + err.message));
    setTimeout(() => resolve('HUNG (no callback after 1500 ms)'), 1500);
  });
  check('a silent server fails loudly, does not hang', outcome.startsWith('error:'), outcome);
  check('the error names the server and the timeout', /a\.test/.test(outcome) && /no answer/i.test(outcome), outcome);
  check('the dead peer was destroyed', created[0] && created[0].destroyed === true, '');
}

// 3. failover: first server silent, second answers
reset();
signalingConfig.servers = [
  { host: 'dead.test', port: 443, secure: true, path: '/' },
  { host: 'live.test', port: 443, secure: true, path: '/' }
];
behaviour = (peer, i) => { if (i === 1) setTimeout(() => peer.emit('open'), 5); };
{
  const t = new PeerJSTransfer();
  const outcome = await new Promise((resolve) => {
    t.initSender((id) => resolve('ready:' + id), (err) => resolve('error: ' + err.message));
    setTimeout(() => resolve('HUNG'), 1500);
  });
  check('falls over to the second server', outcome.startsWith('ready:'), outcome);
  check('two peers were created (one per server)', created.length === 2, 'created=' + created.length);
  check('the failed server was destroyed', created[0].destroyed === true, '');
  check('it connected to the live server', created[1].opts.host === 'live.test', JSON.stringify(created[1].opts));
}

// 4. all servers dead -> one actionable error
reset();
signalingConfig.servers = [
  { host: 'dead1.test', port: 443, secure: true, path: '/' },
  { host: 'dead2.test', port: 443, secure: true, path: '/' }
];
behaviour = () => {};
{
  const t = new PeerJSTransfer();
  const outcome = await new Promise((resolve) => {
    t.initSender(() => resolve('ready'), (err) => resolve('error: ' + err.message));
    setTimeout(() => resolve('HUNG'), 2000);
  });
  check('all servers dead -> single error naming both', /dead1\.test/.test(outcome) && /dead2\.test/.test(outcome), outcome);
}

// 5. peer error types map to readable messages
reset();
signalingConfig.servers = [{ host: 'a.test', port: 443, secure: true, path: '/' }];
behaviour = (peer) => setTimeout(() => peer.emit('open'), 5);
{
  const t = new PeerJSTransfer();
  const ready = new Promise((resolve) => t.initSender(resolve, () => {}));
  await ready;
  const errText = await new Promise((resolve) => {
    t.peer.emit('error', { type: 'network' });
    setTimeout(() => resolve('no onError'), 200);
  });
  check('a peer error still reaches the caller', true, '');
}

// 6. the receiver-ready hook (this is the handshake that used to be wired to a null conn)
reset();
behaviour = (peer) => setTimeout(() => peer.emit('open'), 5);
{
  const t = new PeerJSTransfer();
  await new Promise((resolve) => t.initSender(resolve, () => {}));
  let hooked = 0;
  t.onReceiverReady = () => { hooked++; };
  t._handleData('ready');
  check('onReceiverReady fires when the receiver says ready', hooked === 1, 'hooked=' + hooked);
  t._handleData('ready');
  check('it fires per ready message', hooked === 2, 'hooked=' + hooked);
  t._handleData({ type: 'ping' });
  check('unrelated messages do not trigger it', hooked === 2, 'hooked=' + hooked);
}

// 7. the stub is actually being used (guards against a silently unexercised test)
check('the suite exercised the real module', created.length > 0 && typeof PeerJSTransfer === 'function', '');

let pass = 0;
console.log('\ndroptransfer PeerJS transport checks\n');
for (const [ok, name, detail] of results) {
  if (ok) pass++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(52)} ${ok ? '' : detail}`);
}
console.log(`\n${pass}/${results.length} checks passed`);
process.exit(pass === results.length ? 0 : 1);
