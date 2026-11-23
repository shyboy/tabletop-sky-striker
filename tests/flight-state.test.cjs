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

test('tabletop forward flight rushes into ahead powerups, medals, XP gems, and star lines like arcade mode', () => {
  const framesToCollectPowerup = (mode, vyInput) => {
    const { engine } = createFlight();
    engine.updateRig({ mode }, false);
    engine.startMission({ tutorial: false });
    engine.spawnTimer = 100;
    engine._spawnPowerup(engine._playerWorldX(), engine._playerWorldY() - 360, 'weapon');
    engine.powerups[0].vx = 0;
    let frames = 0;
    while (engine.player.weaponLv === 1 && frames < 300) {
      engine.setRemoteInput({ vy: vyInput, firing: false });
      engine.step(1 / 60);
      frames++;
    }
    return frames;
  };

  const tabletopCruiseFrames = framesToCollectPowerup('tabletop', 0);
  const tabletopForwardFrames = framesToCollectPowerup('tabletop', -1);
  const arcadeForwardFrames = framesToCollectPowerup('arcade', -1);
  assert.ok(tabletopCruiseFrames > 100);
  assert.ok(tabletopForwardFrames <= 26, `expected <= 26 frames, got ${tabletopForwardFrames}`);
  assert.ok(tabletopForwardFrames <= arcadeForwardFrames, `tabletop (${tabletopForwardFrames}) should match or beat arcade (${arcadeForwardFrames})`);

  // Freshly popped medals (initial upward vy < 0) immediately close screen distance under full forward throttle
  const { engine: medalEngine } = createFlight();
  medalEngine.startMission({ tutorial: false });
  medalEngine.spawnTimer = 100;
  medalEngine.keys.add('KeyW');
  advance(medalEngine, 15);
  medalEngine._spawnPowerup(medalEngine.player.worldX, medalEngine.player.worldY - 320, 'medal');
  medalEngine.powerups[0].vx = 0;
  const gapBefore = medalEngine.player.worldY - medalEngine.powerups[0].y;
  medalEngine.step(1 / 60);
  const gapAfter = medalEngine.player.worldY - medalEngine.powerups[0].y;
  assert.ok(gapAfter < gapBefore - 5, 'forward thrust must close distance even while medal pops upward');

  // XP gems ahead are also swept in rapidly when pushing forward, and never drift backward when pulling back
  const framesToCollectGem = (vyInput) => {
    const { engine } = createFlight();
    engine.startMission({ tutorial: false });
    engine.spawnTimer = 100;
    engine.roguelite.spawnXp(engine.player.worldX, engine.player.worldY - 360, 10, 1);
    engine.roguelite.gems[0].vx = 0;
    engine.roguelite.gems[0].vy = 76;
    let frames = 0;
    while (engine.roguelite.gems.length > 0 && frames < 400) {
      engine.setRemoteInput({ vy: vyInput, firing: false });
      engine.step(1 / 60);
      frames++;
    }
    return frames;
  };
  const gemCruiseFrames = framesToCollectGem(0);
  const gemForwardFrames = framesToCollectGem(-1);
  const gemSlowFrames = framesToCollectGem(1);
  assert.ok(gemCruiseFrames > 160);
  assert.ok(gemForwardFrames <= 28, `expected <= 28 frames for XP gem, got ${gemForwardFrames}`);
  assert.ok(gemSlowFrames < 260, 'pulling back to slow flight must still let XP gems descend cleanly');

  // Guide star line closes much faster when pushing forward in tabletop mode
  const framesToFirstStar = (vyInput) => {
    const { engine } = createFlight();
    engine.startMission({ tutorial: false });
    engine.chapterTime = engine._chapterLength() * 0.10;
    engine.spawnTimer = 100;
    engine.step(1 / 60);
    let frames = 0;
    while (engine.starRoute && engine.starRoute.collected === 0 && frames < 200) {
      engine.setRemoteInput({ vy: vyInput, firing: false });
      engine.step(1 / 60);
      frames++;
    }
    return frames;
  };
  assert.ok(framesToFirstStar(-1) * 3 < framesToFirstStar(0));
});

const REMOTE_CONTROLS = { vx: 0.8, vy: -0.6, firing: true, railCharge: 1, micLevel: 0.5 };

test('steering along all six guide stars awards one bonus and attracts distant loot in either mode', () => {
  for (const mode of ['arcade', 'tabletop']) {
    const { engine } = createFlight();
    engine.updateRig({ mode }, false);
    engine.startMission({ tutorial: false });
    engine.chapterTime = engine._chapterLength() * 0.10;
    engine.spawnTimer = 100;
    engine.step(1 / 60);
    assert.equal(engine.starRoute.stars.length, 6);
    const startScore = engine.score;
    const firstY = engine.starRoute.stars[0].y;
    engine.setManualPause(true);
    advance(engine, 20);
    assert.equal(engine.starRoute.stars[0].y, firstY);
    engine.setManualPause(false);
    for (let frame = 0; frame < 420 && engine.starRoute; frame++) {
      const target = engine.starRoute.stars.find(s => !s.collected);
      const dx = target.x - engine._playerWorldX();
      engine.setRemoteInput({ vx: Math.max(-1, Math.min(1, dx / 45)), vy: 0, firing: false });
      engine.step(1 / 60);
    }
    assert.equal(engine.perfectRoutes, 1, mode);
    assert.equal(engine.score - startScore, 1100);
    assert.equal(engine.starMagnet, 4);
    engine._spawnPowerup(engine._playerWorldX() + 380, engine._playerWorldY(), 'heal');
    advance(engine, 1);
    assert.equal(engine.powerups[0].magnet, true);
    advance(engine, 240);
    assert.equal(engine.starMagnet, 0);
    assert.equal(engine.perfectRoutes, 1);
    engine.startMission({ tutorial: false });
    assert.equal(engine.perfectRoutes, 0);
    assert.equal(engine.starRouteIndex, 0);
  }
});

test('flying past a star line pays only for touched stars and preserves the gold medal chain', () => {
  const { engine } = createFlight();
  engine.startMission({ tutorial: false });
  engine.chapterTime = engine._chapterLength() * 0.10;
  engine.spawnTimer = 100;
  engine.medalValue = 300;
  advance(engine, 540);
  assert.equal(engine.starRoute, null);
  assert.equal(engine.perfectRoutes, 0);
  assert.equal(engine.starMagnet, 0);
  assert.ok(engine.score > 0 && engine.score <= 250);
  assert.equal(engine.medalValue, 300);
});

test('narrow-screen HUD switches from tutorial to star count and clears the line at the blockade', () => {
  const { engine } = createFlight();
  engine.width = 360;
  engine.height = 740;
  engine.startMission({ tutorial: true });
  const labels = [];
  const ctx = new Proxy({ fillText: str => labels.push(str) }, { get: (obj, key) => obj[key] || (() => {}) });
  const hud = () => {
    labels.length = 0;
    engine._renderMinimalHUD(ctx, engine.width, engine.height);
    return labels.join(' ');
  };
  advance(engine, 3);
  assert.match(hud(), /新手引导中/);
  assert.equal(engine.starRoute, null);
  engine.skipTutorial();
  engine.chapterTime = engine._chapterLength() * 0.85;
  engine.starRouteIndex = 3;
  engine.supplyDropped = true;
  engine.spawnTimer = 100;
  advance(engine, 1);
  assert.match(hud(), /星线 0\/6/);
  engine.chapterTime = engine._chapterLength() + 6;
  engine.starMagnet = 0.25;
  advance(engine, 1);
  assert.ok(engine.boss);
  assert.equal(engine.starRoute, null);
  assert.match(hud(), /封锁线交战中/);
  assert.doesNotMatch(hud(), /星线/);
  advance(engine, 20);
  assert.equal(engine.starMagnet, 0);
  assert.doesNotMatch(hud(), /吸附/);
});
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

test('boss damage pays each hull milestone once, including those crossed by a finishing shot', () => {
  const { engine } = createFlight();
  engine.startMission({ tutorial: false });
  engine._spawnBoss(100, 0);
  const boss = engine.boss;
  boss.unveiled = 6;
  const totalXp = () => engine.roguelite.gems.reduce((sum, gem) => sum + gem.amount, 0);
  engine._damageEnemy(boss, 1);
  assert.equal(totalXp(), 0);
  engine._damageEnemy(boss, boss.maxHp / 5 - 1);
  assert.equal(totalXp(), 34);
  engine._damageEnemy(boss, 1);
  assert.equal(totalXp(), 34);
  engine._damageEnemy(boss, boss.hp);
  assert.equal(totalXp(), 4 * 34 + 90);
});

test('XP from mixed kills grants a first draft at exactly 36 even when drops divide unevenly', () => {
  const { engine } = createFlight();
  engine.startMission({ tutorial: false });
  const skills = engine.roguelite;
  skills.spawnXpFromKill(0, 0, 'bomber');
  skills.spawnXpFromKill(0, 0, 'gunship');
  const last = skills.gems.pop();
  for (const gem of skills.gems) skills.addRawXp(gem.amount);
  assert.equal(skills.level, 1);
  skills.addRawXp(last.amount);
  assert.equal(skills.xp, 0);
  assert.equal(skills.level, 2);
  assert.equal(skills.pendingLevelUps, 1);
});

test('wingtip contrails record trails in both modes, reset on mode switch, and HUD reports heading & filter', () => {
  const { engine } = createFlight();
  engine.startMission({ tutorial: false });
  engine.keys.add('KeyD');
  advance(engine, 12);
  assert.ok(engine.contrails.left.length > 0 && engine.contrails.right.length > 0);
  assert.equal(engine.rig.visualFilter, 'normal');

  engine.updateRig({ visualFilter: 'pixel' }, false);
  assert.equal(engine.rig.visualFilter, 'pixel');
  engine.updateRig({ visualFilter: 'invalid_filter' }, false);
  assert.equal(engine.rig.visualFilter, 'pixel');

  const labels = [];
  const ctx = new Proxy({ fillText: str => labels.push(str) }, { get: (obj, key) => obj[key] || (() => {}) });
  engine._renderMinimalHUD(ctx, 1280, 800);
  const hudText = labels.join(' ');
  assert.match(hudText, /HDG \d{3}°/);
  assert.match(hudText, /KM/);

  engine.updateRig({ mode: 'arcade' }, false);
  assert.equal(engine.contrails.left.length, 0);
  advance(engine, 10);
  assert.ok(engine.contrails.left.length > 0 && engine.contrails.right.length > 0);
});

test('first draft offers three distinct factions, avoids passive-only utility traps, and sorts summary by prestige', () => {
  for (let trial = 0; trial < 20; trial++) {
    const { engine } = createFlight();
    engine.startMission({ tutorial: false });
    engine.roguelite.addRawXp(36);
    engine.step(1 / 60);
    const draft = engine.getPublicState().skillDraft;
    assert.equal(draft.level, 2);
    assert.equal(draft.choices.length, 3);
    const categories = new Set(draft.choices.map((c) => c.category));
    assert.equal(categories.size, 3, 'Lv.2 starter draft must span 3 distinct factions');
    for (const c of draft.choices) {
      assert.equal(['wind_magnet', 'iron_lungs', 'graze_dynamo', 'nano_hull'].includes(c.id), false);
      assert.ok(c.synergyHint.length > 0);
    }
  }

  const { engine } = createFlight();
  engine.startMission({ tutorial: false });
  engine.roguelite.pickOrder.push('wind_magnet', 'wind_blades', 'awakening_tempest');
  engine.roguelite.skills.wind_magnet = 1;
  engine.roguelite.skills.wind_blades = 3;
  engine.roguelite.skills.awakening_tempest = 1;
  const topIds = [...engine.getPublicState().pickedSkills.map((s) => s.id)];
  assert.deepEqual(topIds, ['awakening_tempest', 'wind_blades', 'wind_magnet']);
});

test('all five factions unlock their epic awakenings on tiered level gates (Lv.5 / Lv.8 / Lv.11)', () => {
  const cases = [
    ['split_prism', 'awakening_barrage', 'wind_magnet'],
    ['wind_blades', 'awakening_tempest', 'split_prism'],
    ['orbit_orbs', 'awakening_hive', 'split_prism'],
    ['rail_capacitor', 'awakening_rail', 'split_prism'],
    ['nano_hull', 'awakening_aegis', 'split_prism']
  ];
  for (const [prereq, epicId, filler] of cases) {
    const { engine } = createFlight();
    engine.startMission({ tutorial: false });
    const rg = engine.roguelite;
    rg.skills[prereq] = 2;
    rg.level = 4;
    const atLv4 = rg._rollChoices(new Set(), 4);
    assert.equal(atLv4.some((c) => c.id === epicId), false, `${epicId} locked before Lv.5`);

    // Keep 3 eligible unexcluded cards (prereq, epicId, and 1 filler) so _rollChoices returns all 3 deterministically
    const keep = new Set([prereq, epicId, filler]);
    const excludeOthers = new Set(
      rg.constructor.SKILL_POOL.filter((sk) => !keep.has(sk.id)).map((sk) => sk.id)
    );
    const atLv5 = rg._rollChoices(excludeOthers, 5);
    assert.equal(atLv5.some((c) => c.id === epicId), true, `${epicId} unlocks at Lv.5 from ${prereq} 2★`);
  }

  // Verify 2nd awakening requires Lv.8 and 3rd requires Lv.11
  const { engine } = createFlight();
  engine.startMission({ tutorial: false });
  const rg = engine.roguelite;
  for (const sk of rg.constructor.SKILL_POOL) {
    if (sk.rarity !== 'epic') rg.skills[sk.id] = sk.maxStars;
  }
  rg.skills.awakening_barrage = 1;
  assert.equal(rg._rollChoices(new Set(), 7).length, 0, '2nd awakening waits until Lv.8');
  assert.ok(rg._rollChoices(new Set(), 8).some((c) => c.rarity === 'epic'), '2nd awakening opens at Lv.8');
  rg.skills.awakening_tempest = 1;
  assert.equal(rg._rollChoices(new Set(), 10).length, 0, '3rd awakening waits until Lv.11');
  assert.ok(rg._rollChoices(new Set(), 11).some((c) => c.rarity === 'epic'), '3rd awakening opens at Lv.11');
  rg.skills.awakening_hive = 1;
  assert.equal(rg._rollChoices(new Set(), 15).length, 0, 'capped at 3 awakenings max');
});

test('XP gems pulled from behind still reach the craft at full tabletop throttle without velocity contamination', () => {
  const { engine } = createFlight();
  engine.startMission({ tutorial: false });
  engine.setRemoteInput({ vy: -1, firing: false });
  advance(engine, 35);
  engine.roguelite.spawnXp(engine.player.worldX, engine.player.worldY + 110, 36, 1);
  advance(engine, 30);
  assert.equal(engine.roguelite.level, 2);
});

test('awakening_tempest strictly upgrades 3-star wind_blades, tesla_chain fires 5th-shot fallback, and aegis unlocks 3 shields', () => {
  const { engine } = createFlight();
  engine.startMission({ tutorial: false });
  const rg = engine.roguelite;

  // 1. 3★ wind_blades -> awakening_tempest never downgrades per-blade damage
  rg.skills.wind_blades = 3;
  rg.notifyGust(0, 0, 1, 0);
  const dmgBefore = rg.windBlades.at(-1).dmg;
  rg.windBlades.length = 0;
  rg.skills.awakening_tempest = 1;
  rg.notifyGust(0, 0, 1, 0);
  const dmgAfter = rg.windBlades.at(-1).dmg;
  assert.ok(dmgAfter > dmgBefore, `expected ${dmgAfter} > ${dmgBefore}`);

  // 2. Fractional hull regen is preserved when picking unrelated skills, and aegis grants 3-shield cap + break nova
  engine.player.invulnTimer = 0;
  engine.player.hp = 50.4;
  engine._applyToyTraits(false);
  assert.ok(Math.abs(engine.player.hp - 50.4) < 1e-6);

  rg.skills.awakening_aegis = 1;
  engine.roguelite.cb.onApplyInstant({ id: 'awakening_aegis', name: '不灭星神装甲', rarity: 'epic' });
  assert.equal(engine._mods().maxShields, 3);
  assert.equal(engine.player.shield, 2);
  engine.crewAction('shield');
  assert.equal(engine.player.shield, 3);

  const px = engine._playerWorldX();
  const py = engine._playerWorldY();
  engine._spawnEnemyBullet(px + 80, py, 0, 100, '#ef4444', 5);
  engine._hurtPlayer(14);
  assert.equal(engine.player.shield, 2);
  assert.equal(engine.enemyBullets.length, 0, 'aegis shield break clears nearby enemy shots');

  // 3. Tesla chain triggers on 5th main volley even with 0 drones and 0% crit, and focuses unused jumps onto solo boss
  rg.skills.tesla_chain = 2;
  rg.lightningIcdTimer = 0;
  engine._spawnBoss(px, py - 220);
  engine.boss.unveiled = 6;
  const hpStart = engine.boss.hp;
  for (let i = 0; i < 5; i++) {
    rg.notifyMainShot(px, py - 28, 25, 0, engine.enemies);
  }
  assert.ok(engine.boss.hp < hpStart, '5th main shot discharges lightning + single-target focus onto solo boss');
});

test('player bullet silhouettes evolve with craft and skills in auto mode, and honor manual bulletStyle overrides', () => {
  const { engine } = createFlight();
  engine.startMission({ tutorial: false });
  assert.equal(engine.rig.bulletStyle, 'auto');

  const fireShapes = () => {
    engine.bullets = [];
    engine._fireMainGuns(0, 0);
    return [...engine.bullets.map((b) => b.shape)];
  };

  // Craft baseline identities
  assert.deepEqual(fireShapes(), ['laser', 'laser']);
  engine.updateRig({ shape: 'car' }, false);
  assert.deepEqual(fireShapes(), ['slug', 'slug']);
  engine.updateRig({ shape: 'orb' }, false);
  assert.deepEqual(fireShapes(), ['blade', 'blade']);

  // Skill evolution: split_prism adds prism shards; plasma_pierce evolves shots into piercing lances; barrage into swords
  engine.updateRig({ shape: 'jet' }, false);
  engine.roguelite.skills.split_prism = 1;
  assert.deepEqual(fireShapes(), ['laser', 'laser', 'prism', 'prism']);

  engine.roguelite.skills.plasma_pierce = 1;
  assert.deepEqual(fireShapes(), ['lance', 'lance', 'prism', 'prism']);

  engine.roguelite.skills.awakening_barrage = 1;
  assert.deepEqual(fireShapes(), ['sword', 'sword', 'sword', 'sword']);

  // Manual style override & invalid style guard
  engine.updateRig({ bulletStyle: 'prism' }, false);
  assert.deepEqual(fireShapes(), ['prism', 'prism', 'prism', 'prism']);
  engine.updateRig({ bulletStyle: 'nonexistent_style' }, false);
  assert.equal(engine.rig.bulletStyle, 'prism');
});
