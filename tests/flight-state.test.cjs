const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const sources = ['roguelite-skills.js', 'game-engine.js'].map((file) => new vm.Script(
  fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8'), { filename: file }
));

function createFlight(localStorage) {
  let now = 0;
  let railShots = 0;
  const browser = vm.createContext({ performance: { now: () => now }, navigator: {}, localStorage });
  sources.forEach((script) => script.runInContext(browser));
  const canvas = { getContext: () => ({}), getBoundingClientRect: () => ({ width: 1280, height: 800 }) };
  const sfx = new Proxy({ railgunFire: () => railShots++ }, { get: (target, key) => target[key] || (() => {}) });
  const engine = new browser.SkyStrikerEngine(canvas, sfx);

  return { engine, setTime: (time) => { now = time; }, railShots: () => railShots };
}

function advance(engine, frames) {
  for (let i = 0; i < frames; i++) engine.step(1 / 60);
}

test('tabletop forward input accelerates the scenery and returns smoothly to cruise', () => {
  const { engine } = createFlight();
  engine.startMission({ tutorial: false });
  let sceneryState;
  engine.scenery = { step: (_dt, state) => { sceneryState = state; } };
  engine.setRemoteInput({ vy: -0.5, firing: false });
  advance(engine, 20);
  assert.ok(engine.player.cruiseSpeed > 620 && engine.player.cruiseSpeed < 650);
  assert.ok(sceneryState.boost > 0.5 && sceneryState.boost < 0.65);

  engine.setRemoteInput({ vy: -1 });
  advance(engine, 20);
  assert.ok(engine.player.cruiseSpeed > 870);
  assert.equal(sceneryState.scrollSpeed, engine.player.cruiseSpeed);
  assert.ok(sceneryState.boost > 0.98);
  assert.equal(engine.player.screenY, engine.height * engine.rig.anchorY);
  engine.setRemoteInput({ vy: 0 });
  advance(engine, 1);
  assert.ok(engine.player.cruiseSpeed > 310 && engine.player.cruiseSpeed < 870);
  advance(engine, 59);
  assert.ok(Math.abs(engine.player.cruiseSpeed - 310) < 1);
  assert.ok(sceneryState.boost < 0.01);
  engine.setRemoteInput({ vy: 1 });
  advance(engine, 60);
  assert.ok(Math.abs(engine.player.cruiseSpeed - 155) < 1);
});

test('arcade forward movement is faster and reverse uses its existing ceiling', () => {
  const { engine } = createFlight();
  engine.updateRig({ mode: 'arcade' }, false);
  engine.startMission({ tutorial: false });
  engine.keys.add('KeyW');
  advance(engine, 20);
  assert.ok(engine.player.vy < -640);
  assert.ok(engine.player.screenY < 430);
  engine.keys.delete('KeyW');
  engine.keys.add('KeyS');
  advance(engine, 40);
  assert.ok(Math.abs(engine.player.vy - 480) < 1);
});

test('forward flight clears a crossing shot and still takes a head-on hit in both modes', () => {
  for (const mode of ['tabletop', 'arcade']) {
    for (const fps of [30, 60]) {
      for (const scenario of ['neutral', 'push at shot', 'already pushing', 'head-on']) {
        const { engine } = createFlight();
        engine.updateRig({ mode }, false);
        engine.startMission({ tutorial: false });
        engine.spawnTimer = 100;
        engine.player.invulnTimer = 0;
        if (scenario === 'already pushing' || scenario === 'head-on') {
          engine.setRemoteInput({ vy: -1 });
        }
        for (let i = 0; i < fps / 3; i++) engine.step(1 / fps);
        const x = engine._playerWorldX();
        const y = engine._playerWorldY();
        if (scenario === 'head-on') {
          engine._spawnEnemyBullet(x, y - 65, 0, 245, '#ef4444', 5);
        } else {
          engine._spawnEnemyBullet(x - 44, y, 245, 0, '#ef4444', 5);
        }
        if (scenario === 'push at shot') engine.keys.add('KeyW');
        for (let i = 0; i < fps / 4; i++) engine.step(1 / fps);
        const expectedHits = scenario === 'neutral' || scenario === 'head-on' ? 1 : 0;
        assert.equal(engine.hitsTaken, expectedHits, `${mode}, ${fps} FPS, ${scenario}`);
      }
    }
  }
});

test('a fast crossing between frames hits only when its path intersects the core', () => {
  for (const directHit of [true, false]) {
    const { engine } = createFlight();
    engine.updateRig({ mode: 'arcade', difficulty: 'ace', hitSize: 'small' }, false);
    engine.startMission({ tutorial: false });
    engine.player.invulnTimer = 0;
    engine.keys.add('KeyW');
    advance(engine, 20);

    const radius = 5;
    const hitDistance = engine.hitCoreR + radius * 0.6;
    const offsetX = directHit ? 0 : hitDistance + 1;
    const x = engine._playerWorldX() + offsetX;
    const y = engine._playerWorldY() - hitDistance - 1;
    engine._spawnEnemyBullet(x, y, 0, 340, '#ef4444', radius);
    engine.step(1 / 50);
    assert.equal(engine.hitsTaken, directHit ? 1 : 0);
  }
});

test('two seconds at full throttle cover the same distance at 15, 30 and 60 FPS', () => {
  const distances = [15, 30, 60].map((fps) => {
    const { engine } = createFlight();
    engine.startMission({ tutorial: false });
    engine.keys.add('KeyW');
    const startY = engine.player.worldY;
    for (let frame = 0; frame < 2 * fps; frame++) engine.step(1 / fps);
    assert.ok(Math.abs(engine.time - 2) < 1e-8);
    return startY - engine.player.worldY;
  });
  assert.ok(distances[0] > 1700);
  assert.ok(Math.max(...distances) - Math.min(...distances) < 1);
});

test('a long frame bounds catch-up and broadcasts only the final radar position', () => {
  const { engine } = createFlight();
  engine.startMission({ tutorial: false });
  const radar = [];
  engine.onTelemetry = (state) => { if (state.blips) radar.push(state); };
  engine.step(5);
  assert.ok(Math.abs(engine.time - 0.1) < 1e-8);
  assert.equal(radar.length, 1);
  assert.equal(radar[0].distanceKm, Number(engine.distanceKm.toFixed(1)));
});

test('pausing during a keyboard charge requires a fresh press and release to fire', () => {
  const { engine, railShots } = createFlight();
  engine.startMission({ tutorial: false });
  for (const pause of [on => engine.setManualPause(on), on => engine.setSetupPause(on)]) {
    engine.keys.add('KeyJ');
    advance(engine, 57);
    assert.equal(engine.localRailCharge, 1);
    pause(true);
    pause(false);
    advance(engine, 1);
    assert.equal(engine.localRailCharge, 0);
    assert.equal(engine.fullChargeAt, null);
    assert.equal(railShots(), 0);
  }
  engine.keys.add('KeyJ');
  advance(engine, 57);
  engine.keys.delete('KeyJ');
  advance(engine, 1);
  assert.equal(railShots(), 1);
  assert.equal(engine.player.railPerfect, true);
});

test('a medal pulled from behind still reaches the toy at maximum forward speed', () => {
  const { engine } = createFlight();
  engine.startMission({ tutorial: false });
  engine.setRemoteInput({ vy: -1, firing: false });
  advance(engine, 35);
  engine._spawnPowerup(engine.player.worldX, engine.player.worldY + 130, 'medal');
  advance(engine, 12);
  assert.equal(engine.medalsCollected, 1);
});

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

test('cancelled touch charging never fires; a subsequent full release still earns a perfect shot', () => {
  const { engine, railShots } = createFlight();
  engine.startMission({ tutorial: false });
  assert.equal(engine.beginTouchRail(), true);
  engine._gatherInput(1);
  assert.equal(engine.touchRailCharge, 1);
  engine.endTouchRail();
  assert.equal(engine._gatherInput(0).railCharge, 0);
  assert.equal(engine.fullChargeAt, null);
  assert.equal(engine.endTouchRail(true), false);
  assert.equal(railShots(), 0);

  assert.equal(engine.beginTouchRail(), true);
  engine._gatherInput(1);
  assert.equal(engine.endTouchRail(true), true);
  assert.equal(engine.player.railPerfect, true);
  assert.equal(railShots(), 1);
});

test('pause cancels touch charging without consuming keyboard input', () => {
  const { engine, railShots } = createFlight();
  engine.startMission({ tutorial: false });
  engine.keys.add('KeyJ');
  engine._gatherInput(0.25);
  engine.beginTouchRail();
  engine._gatherInput(0.5);
  const keyboardCharge = engine.localRailCharge;
  engine.endTouchRail();
  assert.equal(engine.localRailCharge, keyboardCharge);
  assert.equal(engine.keys.has('KeyJ'), true);
  engine.keys.clear();
  engine._wasChargingKey = false;
  engine.localRailCharge = 0;

  engine.beginTouchRail();
  engine._gatherInput(1);
  engine.setSetupPause(true, 'controller');
  engine.setSetupPause(false, 'controller');
  assert.equal(engine.endTouchRail(true), false);
  assert.equal(railShots(), 0);
});

test('old toy presets load and subsequent calibration survives a reload, including the anchor', () => {
  const key = 'skyStriker.toy';
  const values = new Map([[key, JSON.stringify({ shape: 'car', name: '小车', hitSize: 'large', w: 120, l: 150 })]]);
  const storage = { getItem: (name) => values.get(name), setItem: (name, value) => values.set(name, value) };
  const { engine } = createFlight(storage);
  assert.equal(engine.rig.anchorY, 0.75);
  assert.equal(engine.rig.toyName, '小车');
  assert.equal(engine.rig.hitSize, 'large');
  assert.equal(engine.rig.length, 150);
  engine.updateRig({ width: 151, length: 170, anchorY: 0.83 });
  engine.updateRig({ mode: 'arcade', godMode: true });
  assert.deepEqual(JSON.parse(values.get(key)), { shape: 'car', name: '小车', hitSize: 'large', w: 151, l: 170, anchorY: 0.83 });

  const reloaded = createFlight(storage).engine;
  assert.equal(reloaded.rig.width, 151);
  assert.equal(reloaded.rig.anchorY, 0.83);
  assert.equal(reloaded.player.screenY, 800 * 0.83);
  assert.equal(reloaded.rig.mode, 'tabletop');
  assert.equal(reloaded.rig.godMode, false);
});
