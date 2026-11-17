const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const sources = ['roguelite-skills.js', 'game-engine.js'].map((file) => new vm.Script(
  fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8'), { filename: file }
));

function createFlight() {
  let now = 0;
  let railShots = 0;
  const browser = vm.createContext({ performance: { now: () => now }, navigator: {} });
  sources.forEach((script) => script.runInContext(browser));
  const canvas = { getContext: () => ({}), getBoundingClientRect: () => ({ width: 1280, height: 800 }) };
  const sfx = new Proxy({ railgunFire: () => railShots++ }, { get: (target, key) => target[key] || (() => {}) });
  const engine = new browser.SkyStrikerEngine(canvas, sfx);

  return { engine, setTime: (time) => { now = time; }, railShots: () => railShots };
}

const REMOTE_CONTROLS = { vx: 0.8, vy: -0.6, firing: true, railCharge: 1, micLevel: 0.5 };
const NEUTRAL_CONTROLS = { vx: 0, vy: 0, firing: false, railCharge: 0, micLevel: 0 };

test('all remote controls expire during flight, even when the first packet arrives at time zero', () => {
  const { engine, setTime, railShots } = createFlight();
  engine.startMission({ tutorial: false });
  assert.equal(engine._gatherInput(0).firing, true, 'local-only missions still have automatic fire');
  engine.setRemoteInput(REMOTE_CONTROLS);
  engine._gatherInput(0);
  assert.equal(engine.fullChargeAt, 0);

  setTime(349);
  engine.step(0.016);
  assert.deepEqual({ ...engine.remoteInput }, REMOTE_CONTROLS);
  setTime(350);
  engine.step(0.016);
  assert.deepEqual({ ...engine.remoteInput }, NEUTRAL_CONTROLS);
  assert.equal(engine.fullChargeAt, null);
  assert.equal(engine._gatherInput(0).firing, false);
  assert.equal(railShots(), 0);

  engine.keys.add('KeyD');
  assert.equal(engine._gatherInput(0).vx, 1);
  assert.equal(engine._gatherInput(0).firing, true);
  engine.setRemoteInput(REMOTE_CONTROLS);
  assert.deepEqual({ ...engine.remoteInput }, REMOTE_CONTROLS);
});

test('the title preview and paused battle also clear old remote input', () => {
  const { engine, setTime } = createFlight();
  engine.setRemoteInput(REMOTE_CONTROLS);
  setTime(350);
  engine.step(0.016);
  assert.equal(engine.player.worldX, 0);

  engine.startMission({ tutorial: false });
  engine.setRemoteInput(REMOTE_CONTROLS);
  engine.setManualPause(true);
  setTime(700);
  engine.step(0.016);
  assert.deepEqual({ ...engine.remoteInput }, NEUTRAL_CONTROLS);
  assert.equal(engine.isPaused, true);
});

test('an invalid packet cannot extend the timeout or trigger an expired rail release', () => {
  const { engine, setTime, railShots } = createFlight();
  engine.startMission({ tutorial: false });
  engine.setRemoteInput(REMOTE_CONTROLS);
  setTime(349);
  engine.setRemoteInput({ vx: NaN, railCharge: Infinity, firing: 'true' });
  setTime(350);
  engine.setRemoteInput({ railCharge: 0, autoRelease: true });
  assert.deepEqual({ ...engine.remoteInput }, NEUTRAL_CONTROLS);
  assert.equal(railShots(), 0);
});

test('each calibration panel owns its pause and repeated messages cannot resume play', () => {
  const { engine } = createFlight();
  engine.startMission({ tutorial: false });

  for (const firstToClose of ['host', 'controller']) {
    const other = firstToClose === 'host' ? 'controller' : 'host';
    engine.setSetupPause(true, firstToClose);
    engine.setSetupPause(true, other);
    engine.setSetupPause(false, firstToClose);
    engine.setSetupPause(false, firstToClose);
    assert.equal(engine.getPublicState().setupPaused, true);
    assert.equal(engine.isPaused, true);
    engine.setSetupPause(false, other);
    assert.equal(engine.isPaused, false);
  }
});

test('calibration close and skill selection leave manual pause in effect', () => {
  const { engine } = createFlight();
  engine.startMission({ tutorial: false });
  engine.roguelite.addRawXp(engine.roguelite.xpNext);
  engine.step(0.016);
  assert.equal(engine.isSkillDraftOpen(), true);

  engine.setManualPause(true);
  engine.setSetupPause(true, 'controller');
  engine.setSetupPause(false, 'controller');
  assert.equal(engine.isSkillDraftOpen(), true);
  assert.equal(engine.pickSkill(0), true);
  assert.equal(engine.isSkillDraftOpen(), false);
  assert.equal(engine.isPaused, true);
  engine.setManualPause(false);
  assert.equal(engine.isPaused, false);
});

test('a reroll rejects stale picks and duplicate rerolls; the host applies only the advertised card', () => {
  const { engine } = createFlight();
  engine.startMission({ tutorial: false });
  engine.roguelite.addRawXp(engine.roguelite.xpNext);
  engine.step(0.016);
  const before = engine.getPublicState().skillDraft;
  assert.equal(engine.rerollSkills(before.version), true);
  const after = engine.getPublicState().skillDraft;

  assert.notEqual(before.version, after.version);
  assert.equal(engine.rerollSkills(before.version), false);
  assert.equal(engine.getPublicState().skillDraft.rerollsLeft, after.rerollsLeft);
  assert.equal(engine.pickOfferedSkill(before.version, before.choices[0].id), false);
  assert.equal(engine.pickOfferedSkill(undefined, after.choices[0].id), false);
  assert.equal(engine.pickOfferedSkill(after.version, 'unknown'), false);
  assert.equal(engine.pickOfferedSkill(after.version, after.choices[1].id), true);
  assert.equal(engine.pickOfferedSkill(after.version, after.choices[1].id), false);
  assert.deepEqual([...engine.roguelite.pickOrder], [after.choices[1].id]);
});

test('a queued level-up and a new mission get distinct versions', () => {
  const { engine } = createFlight();
  engine.startMission({ tutorial: false });
  engine.roguelite.addRawXp(160);
  engine.step(0.016);
  const first = engine.getPublicState().skillDraft;
  assert.equal(engine.pickSkill(0), true);
  const next = engine.getPublicState().skillDraft;
  assert.notEqual(first.version, next.version);
  assert.equal(engine.pickOfferedSkill(first.version, first.choices[0].id), false);

  engine.startMission({ tutorial: false });
  engine.roguelite.addRawXp(engine.roguelite.xpNext);
  engine.step(0.016);
  const newMission = engine.getPublicState().skillDraft;
  assert.notEqual(next.version, newMission.version);
  assert.equal(engine.pickOfferedSkill(next.version, next.choices[0].id), false);
});
