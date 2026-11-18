const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const hostScript = new vm.Script(html.match(/<script>\s*([\s\S]*?)<\/script>/)[1], { filename: 'index.html' });
const engineScript = new vm.Script(fs.readFileSync(path.join(__dirname, '..', 'js', 'game-engine.js'), 'utf8'));
const knownIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
const noop = () => {};

class Element {
  constructor() {
    this.events = new Map();
    this.children = [];
    this.classList = { add: noop, remove: noop, toggle: noop, contains: () => false };
    this.style = { setProperty: noop };
    this.dataset = {};
    this.firstElementChild = {};
    this.hidden = false;
  }

  addEventListener(type, handler) { this.events.set(type, handler); }
  dispatch(type, event) { this.events.get(type)(event); }
  setPointerCapture(id) { this.capturedPointer = id; }
  hasPointerCapture(id) { return this.capturedPointer === id; }
  releasePointerCapture() { this.capturedPointer = null; }
  setAttribute() {}
  getContext() { return {}; }
  getBoundingClientRect() { return { width: 1280, height: 800, top: 0, bottom: 60 }; }
  replaceChildren() { this.children = []; }
  appendChild(element) { this.children.push(element); }
}

async function openHost(href, endpoints) {
  const elements = new Map();
  const get = (id) => {
    if (!knownIds.has(id)) return null;
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  const document = {
    getElementById: get, querySelector: () => new Element(), querySelectorAll: () => [],
    createElement: () => new Element(), addEventListener: noop, body: new Element()
  };
  const profile = new Map();
  const windowEvents = new Element();
  const context = vm.createContext({
    document, URL, URLSearchParams, location: new URL(href), history: { replaceState: noop },
    navigator: {}, HTMLDialogElement: Element, performance: { now: () => 50 },
    localStorage: { getItem: (key) => profile.get(key), setItem: (key, value) => profile.set(key, value) },
    requestAnimationFrame: noop, addEventListener: windowEvents.addEventListener.bind(windowEvents), randomRoomCode: () => 'TEST',
    matchMedia: () => ({ matches: true }),
    fetch: async () => ({ ok: true, json: async () => ({ endpoints }) }),
    MiniQR: { renderQRSVG: (url) => url },
    SoundFX: class { constructor() { return new Proxy({}, { get: () => noop }); } },
    LinkBridge: class { constructor(options) { this.options = options; } start() {} send() {} }
  });
  context.window = context;
  engineScript.runInContext(context);
  hostScript.runInContext(context);
  await new Promise((resolve) => setImmediate(resolve));
  return { get, callbacks: context.__skyHost.bridge.options, engine: context.__skyHost.engine, profile, windowEvents };
}

const endpoints = ['http://192.168.1.8:8780', 'https://192.168.1.8:8781', 'https://10.0.0.9:8781']
  .map((origin) => ({ label: origin, origin }));

test('holding P or Escape toggles the pause menu just once per press', async () => {
  const { engine, windowEvents, get } = await openHost('http://localhost:8780/?room=TEST', endpoints);
  engine.startMission({ tutorial: false });
  get('help-overlay').hidden = true;
  for (const code of ['KeyP', 'Escape']) {
    windowEvents.dispatch('keydown', { code, repeat: false, preventDefault: noop });
    windowEvents.dispatch('keydown', { code, repeat: true, preventDefault: noop });
    assert.equal(engine.isPaused, true);
    windowEvents.dispatch('keyup', { code });
    windowEvents.dispatch('keydown', { code, repeat: false, preventDefault: noop });
    assert.equal(engine.isPaused, false);
    windowEvents.dispatch('keyup', { code });
  }
});

test('pairing prefers the current LAN origin and keeps both QR codes on it', async () => {
  const { get } = await openHost('https://10.0.0.9:8781/?room=ABCD', endpoints);
  assert.equal(get('host-select').value, 'https://10.0.0.9:8781');
  assert.equal(get('controller-url-input').value, 'https://10.0.0.9:8781/controller.html?room=ABCD');
  assert.equal(get('crew-url-input').value, 'https://10.0.0.9:8781/crew.html?room=ABCD');
});

test('localhost defaults to a LAN address when available and hides unscannable QR codes otherwise', async () => {
  const linked = await openHost('https://localhost:8781/?room=ABCD', endpoints);
  assert.equal(linked.get('host-select').value, 'https://192.168.1.8:8781');
  assert.equal(linked.get('qr-box').hidden, false);

  const offline = await openHost('http://localhost:8780/?room=ABCD', [{ origin: 'http://localhost:8780', label: '本机预览' }]);
  assert.equal(offline.get('qr-box').hidden, true);
  assert.equal(offline.get('crew-qr-box').hidden, true);
  assert.match(offline.get('qr-address-help').textContent, /同机副屏/);
});

test('crew alone never marks the cockpit ready and a lost cockpit is announced', async () => {
  const { get, callbacks } = await openHost('http://localhost:8780/?room=ABCD', endpoints);
  callbacks.onStatus({ connected: true, crewConnected: true, controllerConnected: false });
  assert.match(get('title-conn-pill').textContent, /地勤已连接 · 等待驾驶手机/);
  assert.match(get('link-live-status').textContent, /等待驾驶座舱连接/);
  callbacks.onStatus({ connected: true, crewConnected: true, controllerConnected: true, transport: '局域网高速' });
  assert.match(get('title-conn-pill').textContent, /座舱已就绪 · 地勤在线/);
  callbacks.onStatus({ connected: true, crewConnected: true, controllerConnected: false });
  assert.match(get('link-live-status').textContent, /座舱已断开/);
});

test('the main page saves a calibration received from the cockpit', async () => {
  const { get, callbacks, engine, profile } = await openHost('http://localhost:8780/?room=ABCD', endpoints);
  callbacks.onMessage('updateRig', { width: 142, length: 178, anchorY: 0.82 }, { from: 'controller' });
  assert.equal(engine.rig.anchorY, 0.82);
  assert.equal(get('val-anchor').textContent, '82%');
  assert.equal(JSON.parse(profile.get('skyStriker.toy')).anchorY, 0.82);
});

test('tablet pointer cancellation and lost capture clear charge while a deliberate release fires', async () => {
  const { get, engine } = await openHost('http://localhost:8780/?room=ABCD', endpoints);
  engine.startMission({ tutorial: false });
  const button = get('dock-rail');
  const press = { pointerId: 1, button: 0, preventDefault: noop };
  button.dispatch('pointerdown', press);
  engine._gatherInput(1);
  button.dispatch('pointercancel', press);
  button.dispatch('lostpointercapture', press);
  assert.equal(engine.player.railBeamTimer, 0);
  assert.equal(engine.touchRailCharge, 0);

  button.dispatch('pointerdown', press);
  engine._gatherInput(1);
  button.dispatch('pointerup', press);
  assert.ok(engine.player.railBeamTimer > 0);
});
