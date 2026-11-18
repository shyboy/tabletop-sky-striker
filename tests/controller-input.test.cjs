const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const controllerSource = new vm.Script(
  fs.readFileSync(path.join(__dirname, '..', 'js', 'controller-app.js'), 'utf8'), { filename: 'controller-app.js' }
);
const noop = () => {};

class Element {
  constructor() {
    this.events = new Map();
    this.captures = new Set();
    this.children = [];
    this.classList = { add: noop, remove: noop, toggle: noop };
    this.style = { setProperty: noop };
    this.open = false;
  }

  addEventListener(type, listener) {
    this.events.set(type, [...(this.events.get(type) || []), listener]);
  }

  dispatch(type, event = {}) {
    for (const listener of this.events.get(type) || []) listener(event);
  }

  hasPointerCapture(id) { return this.captures.has(id); }
  setPointerCapture(id) { this.captures.add(id); }
  releasePointerCapture(id) { this.captures.delete(id); }
  setAttribute() {}
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatch('close'); }
  set innerHTML(html) { this.children = []; }
  appendChild(element) { this.children.push(element); }
  getBoundingClientRect() { return { top: 0, left: 0, height: 200, width: 200 }; }
  getContext() { return {}; }
}

function openController() {
  const elements = new Map();
  const packets = [];
  const document = new Element();
  const window = new Element();
  document.hidden = false;
  document.querySelectorAll = () => [];
  document.createElement = () => new Element();
  document.getElementById = (id) => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  window.SoundFX = class {
    unlock() {}
    chargeTick() {}
    railgunFire() {}
    uiClick() {}
  };
  window.LinkBridge = class {
    constructor(callbacks) { this.callbacks = callbacks; }
    send(type, payload) { packets.push({ type, payload: { ...payload } }); }
    start() { this.callbacks.onStatus({ connected: true }); }
  };
  controllerSource.runInNewContext({ window, document, navigator: {}, URLSearchParams, location: { search: '' },
    HTMLDialogElement: Element, requestAnimationFrame: noop, performance: { now: () => 500 } });

  const { state, bridge } = window.__skyController;
  const sendState = (payload) => bridge.callbacks.onMessage('hostState', { phase: 'playing', ...payload });
  sendState({});
  return { state, document, packets, sendState, element: document.getElementById };
}

function pullRail(track) {
  track.dispatch('pointerdown', { button: 0, pointerId: 1, clientY: 0 });
  track.dispatch('pointermove', { pointerId: 1, clientY: 150 });
}

test('cancelling a held rail pointer never fires; a new deliberate release still fires', () => {
  const { element, packets, state } = openController();
  const rail = element('railgun-track');
  pullRail(rail);
  assert.ok(state.railCharge >= 0.38);
  rail.dispatch('pointercancel', { pointerId: 1 });
  rail.dispatch('lostpointercapture', { pointerId: 1 });
  assert.equal(state.railCharge, 0);
  assert.equal(packets.some(({ type }) => type === 'railgunFire'), false);

  pullRail(rail);
  rail.dispatch('pointerup', { pointerId: 1 });
  rail.dispatch('lostpointercapture', { pointerId: 1 });
  assert.equal(packets.filter(({ type }) => type === 'railgunFire').length, 1);
});

test('hiding the cockpit sends neutral controls and cancels an in-progress rail pull', () => {
  const { document, element, packets, state } = openController();
  const rail = element('railgun-track');
  pullRail(rail);
  element('calib-dialog').showModal();
  state.stickVx = 0.8;
  state.micLevel = 0.6;
  document.hidden = true;
  document.dispatch('visibilitychange');
  rail.dispatch('pointerup', { pointerId: 1 });

  assert.deepEqual(packets.at(-1), {
    type: 'input', payload: { vx: 0, vy: 0, firing: false, railCharge: 0, micLevel: 0, calibOpen: false }
  });
  assert.equal(packets.some(({ type }) => type === 'railgunFire'), false);
});

test('new controller buttons send the displayed batch version and card ID', () => {
  const { element, packets, sendState } = openController();
  const card = { id: 'wind_magnet', stars: 1, maxStars: 3 };
  sendState({ skillDraft: { version: 'first', level: 2, choices: [card] } });
  const oldButton = element('c-draft-list').children[0];
  sendState({ skillDraft: { version: 'second', level: 2, choices: [card] } });
  oldButton.dispatch('click');
  assert.equal(packets.some(({ type }) => type === 'pickSkill'), false);

  element('c-draft-list').children[0].dispatch('click');
  assert.deepEqual(packets.at(-1), { type: 'pickSkill', payload: { version: 'second', cardId: card.id } });
});

test('continue while a calibration panel is open requests resume explicitly', () => {
  const { element, packets, sendState } = openController();
  sendState({ paused: true, setupPaused: true });
  element('btn-c-pause').dispatch('click');
  assert.deepEqual(packets.at(-1), { type: 'setPause', payload: { paused: false } });
});
