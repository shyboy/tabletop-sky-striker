const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const rootDir = path.join(__dirname, '..');
const noop = () => {};

test('wake-lock guard retries on user gesture and re-acquires after returning to foreground', async () => {
  const src = fs.readFileSync(path.join(rootDir, 'js', 'wake-lock.js'), 'utf8');
  const docListeners = new Map();
  const winListeners = new Map();
  let shouldRejectFirst = true;
  let requestCount = 0;
  let activeSentinel = null;

  const document = {
    hidden: false,
    addEventListener(type, fn) {
      docListeners.set(type, [...(docListeners.get(type) || []), fn]);
    },
    dispatch(type) {
      for (const fn of docListeners.get(type) || []) fn();
    }
  };
  const navigator = {
    wakeLock: {
      async request(kind) {
        assert.equal(kind, 'screen');
        requestCount++;
        if (shouldRejectFirst) {
          shouldRejectFirst = false;
          throw new Error('NotAllowedError');
        }
        const releaseHandlers = [];
        const sentinel = {
          released: false,
          addEventListener(evt, fn) {
            if (evt === 'release') releaseHandlers.push(fn);
          },
          async release() {
            this.released = true;
            for (const fn of releaseHandlers) fn();
          }
        };
        activeSentinel = sentinel;
        return sentinel;
      }
    }
  };
  const ctx = vm.createContext({
    document,
    navigator,
    Promise,
    addEventListener(type, fn) {
      winListeners.set(type, [...(winListeners.get(type) || []), fn]);
    }
  });
  ctx.window = ctx;
  new vm.Script(src, { filename: 'wake-lock.js' }).runInContext(ctx);
  await new Promise((r) => setImmediate(r));

  // Initial opportunistic request failed (simulating iOS gesture requirement)
  assert.equal(requestCount, 1);
  assert.equal(ctx.skyWakeLock.isActive(), false);

  // First pointer gesture acquires the screen wake lock
  document.dispatch('pointerdown');
  await new Promise((r) => setImmediate(r));
  assert.equal(requestCount, 2);
  assert.equal(ctx.skyWakeLock.isActive(), true);

  // Hiding the tab releases it; returning to foreground re-acquires automatically
  document.hidden = true;
  document.dispatch('visibilitychange');
  await new Promise((r) => setImmediate(r));
  assert.equal(activeSentinel.released, true);
  assert.equal(ctx.skyWakeLock.isActive(), false);

  document.hidden = false;
  document.dispatch('visibilitychange');
  await new Promise((r) => setImmediate(r));
  assert.equal(requestCount, 3);
  assert.equal(ctx.skyWakeLock.isActive(), true);

  await ctx.skyWakeLock.dispose();
});

test('LinkBridge loads local PeerJS first, enforces SRI on CDN fallback, passes STUN list, and rotates room on ID collision', async () => {
  const src = fs.readFileSync(path.join(rootDir, 'js', 'link-bridge.js'), 'utf8');
  const appendedScripts = [];
  const createdPeers = [];
  let nextTimerId = 1;
  const timers = new Map();
  const runNextTimer = () => {
    const first = timers.entries().next().value;
    assert.ok(first, 'expected a scheduled timer');
    timers.delete(first[0]);
    first[1]();
  };

  class FakePeer {
    constructor(id, opts) {
      this.id = id;
      this.opts = opts;
      this.handlers = new Map();
      this.open = false;
      this.destroyed = false;
      createdPeers.push(this);
    }
    on(evt, fn) { this.handlers.set(evt, fn); }
    emit(evt, arg) { if (this.handlers.has(evt)) this.handlers.get(evt)(arg); }
    destroy() { this.destroyed = true; }
  }

  const document = {
    createElement(tag) {
      assert.equal(tag, 'script');
      return {
        dataset: {},
        remove: noop
      };
    },
    head: {
      appendChild(scriptEl) {
        appendedScripts.push(scriptEl);
        // Simulate local vendor script failing once so CDN fallback with SRI is exercised
        if (appendedScripts.length === 1) {
          scriptEl.onerror();
        } else {
          ctx.Peer = FakePeer;
          scriptEl.onload();
        }
      }
    }
  };

  const ctx = vm.createContext({
    document,
    location: new URL('https://shyboy.github.io/tabletop-sky-striker/?room=COLL'),
    navigator: { userAgent: 'Mozilla/5.0 MicroMessenger/8.0' },
    performance: { now: () => 100 },
    setTimeout: (fn) => { const id = nextTimerId++; timers.set(id, fn); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    setInterval: () => 1,
    clearInterval: noop
  });
  ctx.window = ctx;
  new vm.Script(src, { filename: 'link-bridge.js' }).runInContext(ctx);

  let rotatedTo = null;
  let latestStatus = null;
  const bridge = new ctx.LinkBridge({
    role: 'host',
    roomId: 'COLL',
    onStatus(st) { latestStatus = st; },
    onRoomChange(next) { rotatedTo = next; }
  });
  bridge.start();
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));

  // 1. Local source tried first, then CDN fallback with SHA-384 SRI + anonymous CORS + no-referrer
  assert.equal(appendedScripts[0].src, './js/vendor/peerjs.min.js');
  assert.equal(appendedScripts[1].crossOrigin, 'anonymous');
  assert.equal(appendedScripts[1].referrerPolicy, 'no-referrer');
  assert.match(appendedScripts[1].integrity, /^sha384-/);

  // 2. Multi-STUN ICE config passed and WeChat UA detected
  assert.equal(createdPeers.length, 1);
  assert.equal(createdPeers[0].id, 'yang-sky-striker-v1-COLL');
  assert.ok(createdPeers[0].opts.config.iceServers.length >= 4);
  assert.equal(bridge.isWeChat, true);

  // 3. First unavailable-id retries same room; second collision rotates to a fresh room code
  createdPeers[0].emit('error', { type: 'unavailable-id' });
  runNextTimer();
  await new Promise((r) => setImmediate(r));
  assert.equal(createdPeers.length, 2);
  assert.equal(createdPeers[1].id, 'yang-sky-striker-v1-COLL');

  createdPeers[1].emit('error', { type: 'unavailable-id' });
  assert.ok(rotatedTo && rotatedTo !== 'COLL');
  assert.equal(latestStatus.roomId, rotatedTo);
  runNextTimer();
  await new Promise((r) => setImmediate(r));
  assert.equal(createdPeers.length, 3);
  assert.equal(createdPeers[2].id, 'yang-sky-striker-v1-' + rotatedTo);

  bridge.destroy();
});

test('FlightCard stamps a scannable public play QR code on the keepsake stub', () => {
  const qrSrc = fs.readFileSync(path.join(rootDir, 'js', 'qrcode-mini.js'), 'utf8');
  const cardSrc = fs.readFileSync(path.join(rootDir, 'js', 'flight-card.js'), 'utf8');
  const encodedTexts = [];
  const drawnTexts = [];

  function makeFakeCtx() {
    const grad = { addColorStop: noop };
    return new Proxy({
      font: '',
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      globalAlpha: 1,
      textAlign: 'left',
      textBaseline: 'alphabetic',
      createLinearGradient: () => grad,
      createRadialGradient: () => grad,
      measureText: (t) => ({ width: String(t).length * 14 }),
      fillText: (t) => { drawnTexts.push(String(t)); }
    }, {
      get: (target, prop) => (prop in target ? target[prop] : noop),
      set: (target, prop, val) => { target[prop] = val; return true; }
    });
  }

  const ctx = vm.createContext({
    TextEncoder,
    location: new URL('http://localhost:8780/?room=ABCD'),
    document: {
      createElement(tag) {
        if (tag === 'canvas') {
          return { width: 0, height: 0, getContext: makeFakeCtx };
        }
        return { style: {} };
      }
    }
  });
  ctx.window = ctx;
  new vm.Script(qrSrc, { filename: 'qrcode-mini.js' }).runInContext(ctx);
  const origGen = ctx.MiniQR.generateMatrix;
  ctx.MiniQR.generateMatrix = (text) => {
    encodedTexts.push(text);
    return origGen(text);
  };
  new vm.Script(cardSrc, { filename: 'flight-card.js' }).runInContext(ctx);

  const canvas = ctx.FlightCard.render({
    toyName: '雷霆号',
    score: 58200,
    rank: 'S',
    storyCleared: true,
    wave: 3,
    distanceKm: 42.6
  });

  assert.equal(canvas.width, 1080);
  assert.equal(canvas.height, 1440);
  // On localhost, QR automatically points to the public GitHub Pages URL rather than unscannable localhost
  assert.equal(encodedTexts[0], 'https://shyboy.github.io/tabletop-sky-striker/');
  assert.ok(drawnTexts.includes('扫码借风起飞'));
});

test('SoundFX.unlock resumes iOS interrupted AudioContext and manifest/head assets are wired', () => {
  const sfxSrc = fs.readFileSync(path.join(rootDir, 'js', 'sound-fx.js'), 'utf8');
  let resumeCalls = 0;

  class FakeAudioContext {
    constructor() {
      this.state = 'interrupted';
      this.sampleRate = 22050;
      this.currentTime = 0;
      this.destination = {};
    }
    createGain() { return { gain: { value: 1 }, connect: noop }; }
    createBuffer(_ch, len) { return { getChannelData: () => new Float32Array(len) }; }
    resume() {
      resumeCalls++;
      this.state = 'running';
      return Promise.resolve();
    }
  }

  const ctx = vm.createContext({ AudioContext: FakeAudioContext, setInterval, clearInterval });
  new vm.Script(sfxSrc, { filename: 'sound-fx.js' }).runInContext(ctx);
  const sfx = new ctx.SoundFX();
  assert.equal(sfx.unlock(), true);
  assert.equal(resumeCalls, 1);

  const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.id, './');
  assert.equal(manifest.display, 'standalone');
  assert.ok(fs.existsSync(path.join(rootDir, 'assets', 'icon.svg')));
  assert.ok(fs.existsSync(path.join(rootDir, 'js', 'vendor', 'peerjs.min.js')));

  for (const page of ['index.html', 'controller.html', 'crew.html']) {
    const html = fs.readFileSync(path.join(rootDir, page), 'utf8');
    assert.match(html, /wake-lock\.js/);
    assert.match(html, /assets\/icon\.svg/);
    assert.match(html, /strict-origin-when-cross-origin/);
  }
});

test('server.mjs handles malformed URIs safely, blocks dotfile paths, and serves webmanifest MIME', async () => {
  const { spawn } = require('node:child_process');
  const http = require('node:http');
  const port = 19400 + Math.floor(Math.random() * 400);
  const child = spawn(process.execPath, [path.join(rootDir, 'server.mjs')], {
    env: { ...process.env, PORT: String(port), HTTPS_PORT: String(port + 1) },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('server startup timeout')), 4000);
      child.stdout.on('data', (buf) => {
        if (String(buf).includes(String(port))) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.on('exit', (code) => {
        clearTimeout(timer);
        reject(new Error('server exited early: ' + code));
      });
    });

    const getRaw = (rawPath) => new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: rawPath, method: 'GET' }, (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] || '' }));
      });
      req.on('error', reject);
      req.end();
    });

    const bad = await getRaw('/%E0%A4%A');
    assert.equal(bad.status, 400);

    const dot = await getRaw('/.git/HEAD');
    assert.equal(dot.status, 403);

    const manifestRes = await getRaw('/manifest.webmanifest');
    assert.equal(manifestRes.status, 200);
    assert.match(manifestRes.type, /application\/manifest\+json/);
  } finally {
    child.kill();
  }
});
