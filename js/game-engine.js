/**
 * Tabletop Sky Striker -《借风计划》Dual-Mode 2.5D Canvas Game Engine
 * Lifecycle phases:
 *  - 'title'    : Calm drifting sky + glowing golden tabletop helipad waiting for real toy placement
 *  - 'playing'  : Active 3-chapter story voyage with manual pause & automatic setup-dialog pause
 *  - 'gameover' : Voyage summary screen with instant relaunch or return-to-title
 */
(function (global) {
  'use strict';

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  const STORY_CHAPTERS = [
    {
      id: 1,
      title: '第一航段 · 晴空借风',
      subtitle: '它自己没有引擎，那就让整片云海替它往后跑。',
      bossWarn: '⚠ 灰雾封锁舰接近 —— 别让它遮住桌面的天窗！',
      sky: 'day'
    },
    {
      id: 2,
      title: '第二航段 · 暮色穿云',
      subtitle: '拉下磁轨栓，或吹一口真气——你的呼吸就是它的八级顺风。',
      bossWarn: '⚠ 风暴铁幕舰拦路 —— 冲破这层晚霞封锁线！',
      sky: 'sunset'
    },
    {
      id: 3,
      title: '第三航段 · 星海灯塔',
      subtitle: '只要你还握着操纵杆，桌上这件小小旧物就是今晚的王牌机长。',
      bossWarn: '⚠ 深空母舰降临 —— 守住最后一扇云端天窗！',
      sky: 'night'
    }
  ];

  // Per-chapter boss identity (distinct silhouettes, palettes and bullet choreography)
  const BOSS_DEFS = {
    fog: { name: '灰雾封锁舰', hull: '#334155', trim: '#cbd5e1', core: '#94a3b8', bullet: '#64748b', accent: '#e2e8f0' },
    storm: { name: '风暴铁幕舰', hull: '#3b0764', trim: '#fb923c', core: '#facc15', bullet: '#f97316', accent: '#fde68a' },
    mother: { name: '深空母舰', hull: '#0f172a', trim: '#a78bfa', core: '#22d3ee', bullet: '#c084fc', accent: '#67e8f9' }
  };
  const BOSS_ORDER = ['fog', 'storm', 'mother'];

  // Spawn weight tables per chapter (endless loops reuse them with harder stats)
  const SPAWN_TABLES = [
    [['scout', 46], ['gunship', 26], ['lancer', 18], ['mine', 10]],
    [['scout', 30], ['gunship', 18], ['lancer', 14], ['weaver', 20], ['bomber', 10], ['mine', 8]],
    [['scout', 24], ['gunship', 14], ['lancer', 14], ['weaver', 18], ['bomber', 12], ['sentinel', 12], ['mine', 6]]
  ];

  const BEST_KEY = 'skyStriker.best.v1';
  function loadBest() {
    try {
      const raw = global.localStorage && global.localStorage.getItem(BEST_KEY);
      const v = raw ? JSON.parse(raw) : null;
      return { score: Number(v && v.score) || 0, distanceKm: Number(v && v.distanceKm) || 0, cleared: Boolean(v && v.cleared) };
    } catch (e) {
      return { score: 0, distanceKm: 0, cleared: false };
    }
  }
  function saveBest(best) {
    try {
      if (global.localStorage) global.localStorage.setItem(BEST_KEY, JSON.stringify(best));
    } catch (e) { /* storage blocked: records live for this session only */ }
  }

  // Deterministic hash for infinite procedural islands/clouds in world coordinates
  function hash2D(ix, iy) {
    let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263);
    n = (n ^ (n >>> 13)) >>> 0;
    n = Math.imul(n, 1274126177) >>> 0;
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }

  class SkyStrikerEngine {
    constructor(canvas, sfx, callbacks = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: false });
      this.sfx = sfx;
      this.onTelemetry = callbacks.onTelemetry || (() => {});
      this.onStateChange = callbacks.onStateChange || (() => {});

      this.width = 1280;
      this.height = 800;
      this.dpr = 1;

      // Mode & Physical Rig Calibration
      this.rig = {
        mode: 'tabletop',   // 'tabletop' (control background) | 'arcade' (control virtual plane)
        skyTheme: 'auto',   // 'auto' (follows story chapters!) | 'day' | 'sunset' | 'night'
        shape: 'jet',       // 'jet' | 'car' | 'orb'
        width: 86,          // Physical toy width in CSS px
        length: 118,        // Physical toy length in CSS px
        anchorY: 0.75,      // Screen vertical anchor ratio (0.52..0.86)
        pureCamera: false,  // Hide all HUD for clean video shooting
        godMode: false      // Kid-friendly invincible escort mode
      };

      this.calibHighlightTimer = 0;
      this.calibDrawerOpen = false;
      this.hudTop = 12; // set by the host page to sit below its floating toolbar
      this.manualPaused = false;
      this.setupPaused = false;

      // Input state (merged from mobile controller, gamepad, keyboard)
      this.remoteInput = { vx: 0, vy: 0, firing: true, railCharge: 0, micLevel: 0 };
      this.keys = new Set();
      this.pointerDrag = { active: false, vx: 0, vy: 0 };
      this.localRailCharge = 0;
      this.prevGpButtons = [];
      this.prevGpL2 = 0;

      this.best = loadBest();
      this._musicKey = null;
      this._musicIntensity = -1;
      this._musicPaused = null;
      this.lastRun = null;

      this._initWorldContainers();
      this.stopToTitle();
      this.resize();
    }

    get isPaused() {
      return this.phase === 'playing' && (this.manualPaused || this.setupPaused);
    }

    _initWorldContainers() {
      this.time = 0;
      this.score = 0;
      this.distanceKm = 0;
      this.gustUsedCount = 0;
      this.combo = 0;
      this.comboTimer = 0;
      this.wave = 1;
      this.killsForNuke = 0;
      this.kills = 0;
      this.bossKills = 0;
      this.maxCombo = 0;
      this.medalsCollected = 0;
      this.medalValue = 100;
      this.storyCleared = false;
      this.slowMo = 0;
      this.lowHpTimer = 0;
      this.ambientTimer = 6 + Math.random() * 6;
      this.lightningFlash = 0;
      this.pendingFx = [];
      this.hazards = [];
      this.bossIntro = 0;
      this.bossCooldown = 35; // minimum flight time before the first blockade

      this.player = {
        worldX: 0,
        worldY: 0,
        screenX: this.width * 0.5,
        screenY: this.height * this.rig.anchorY,
        vx: 0,
        vy: 0,
        cruiseSpeed: 220,
        bank: 0,
        cameraRoll: 0,
        hp: 100,
        maxHp: 100,
        weaponLv: 1,
        droneCount: 2,
        shield: 0,
        nukes: 2,
        maxNukes: 3,
        fireCooldown: 0,
        droneFireCooldown: 0,
        invulnTimer: 1.5,
        rollTimer: 0,
        rollCooldown: 0,
        gustTimer: 0,
        gustCooldown: 0,
        gustMaxCooldown: 6.0,
        railBeamTimer: 0,
        railBeamPower: 1,
        railCooldown: 0
      };

      this.bullets = [];
      this.enemyBullets = [];
      this.enemies = [];
      this.powerups = [];
      this.particles = [];
      this.shockwaves = [];
      this.floatingTexts = [];
      this.windStreaks = [];

      this.boss = null;
      this.nextBossScore = 5000;
      this.spawnTimer = 1.1;
      this.screenShake = 0;
      this.flashAlpha = 0;
      this.telemetryAccum = 0;
      this.storyBanner = null;
    }

    getCurrentChapter() {
      return this._chapterForWave(this.wave);
    }

    // Waves 1-3 are the story; wave 4+ loops the three skies as the endless "无尽星海" route.
    _chapterForWave(waveNum) {
      const w = Math.max(1, waveNum);
      const idx = (w - 1) % STORY_CHAPTERS.length;
      const loop = Math.floor((w - 1) / STORY_CHAPTERS.length);
      const base = STORY_CHAPTERS[idx];
      if (loop === 0) return { ...base, idx, loop };
      return {
        ...base,
        idx,
        loop,
        title: `无尽航线 · 第 ${loop + 1} 圈 · ${base.title.split('·').pop().trim()}`,
        subtitle: '天窗已守住，但云海还在奔跑——敌阵更密，奖励更高。'
      };
    }

    get loopIndex() {
      return Math.floor((Math.max(1, this.wave) - 1) / STORY_CHAPTERS.length);
    }

    getEffectiveSky() {
      if (this.rig.skyTheme !== 'auto') return this.rig.skyTheme;
      if (this.phase === 'title') return 'day';
      return this.getCurrentChapter().sky;
    }

    // Return to calm Title Screen & Tabletop Helipad
    stopToTitle() {
      if (this.phase === 'playing' && this.score > 0) this._endRun();
      this._initWorldContainers();
      this.phase = 'title';
      this.gameOver = false;
      this.manualPaused = false;
      this.calibHighlightTimer = 9999; // Keep golden helipad visible on title screen!
      this.onStateChange(this.getPublicState());
    }

    // Launch or Restart Mission from Wave 1
    startMission() {
      this._initWorldContainers();
      this.lastRun = null;
      this.phase = 'playing';
      this.gameOver = false;
      this.manualPaused = false;
      this.calibHighlightTimer = 3.2;
      this._announceChapter(1);
      this.sfx.powerup();
      this.onStateChange(this.getPublicState());
    }

    resetGame() {
      this.startMission();
    }

    setManualPause(flag) {
      if (this.phase !== 'playing') return;
      this.manualPaused = Boolean(flag);
      this.keys.clear();
      this.pointerDrag.active = false;
      this.onStateChange(this.getPublicState());
    }

    toggleManualPause() {
      if (this.phase !== 'playing') return false;
      this.setManualPause(!this.manualPaused);
      return this.manualPaused;
    }

    setSetupPause(openFlag) {
      this.calibDrawerOpen = Boolean(openFlag);
      this.setupPaused = Boolean(openFlag);
      if (openFlag) {
        this.keys.clear();
        this.pointerDrag.active = false;
      }
      this.onStateChange(this.getPublicState());
    }

    _announceChapter(waveNum) {
      const ch = this._chapterForWave(waveNum);
      this.storyBanner = {
        title: ch.title,
        subtitle: ch.subtitle,
        timer: 4.2,
        maxTimer: 4.2
      };
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      this.dpr = Math.min(global.devicePixelRatio || 1, 2);
      this.width = Math.max(320, rect.width || global.innerWidth);
      this.height = Math.max(320, rect.height || global.innerHeight);
      this.canvas.width = Math.round(this.width * this.dpr);
      this.canvas.height = Math.round(this.height * this.dpr);
      if (this.player) {
        if (this.rig.mode === 'tabletop') {
          this.player.screenX = this.width * 0.5;
          this.player.screenY = this.height * this.rig.anchorY;
        } else {
          this.player.screenX = clamp(this.player.screenX, 40, this.width - 40);
          this.player.screenY = clamp(this.player.screenY, 60, this.height - 50);
        }
      }
    }

    updateRig(patch = {}, highlight = true) {
      const prevMode = this.rig.mode;
      if (patch.mode === 'tabletop' || patch.mode === 'arcade') this.rig.mode = patch.mode;
      if (patch.skyTheme && ['auto', 'day', 'sunset', 'night'].includes(patch.skyTheme)) {
        this.rig.skyTheme = patch.skyTheme;
      }
      if (patch.shape && ['jet', 'car', 'orb'].includes(patch.shape)) this.rig.shape = patch.shape;
      if (typeof patch.width === 'number') this.rig.width = clamp(patch.width, 36, 240);
      if (typeof patch.length === 'number') this.rig.length = clamp(patch.length, 44, 280);
      if (typeof patch.anchorY === 'number') {
        this.rig.anchorY = clamp(patch.anchorY, 0.52, 0.86);
        if (this.rig.mode === 'tabletop') {
          this.player.screenY = this.height * this.rig.anchorY;
        }
      }
      if (typeof patch.pureCamera === 'boolean') this.rig.pureCamera = patch.pureCamera;
      if (typeof patch.godMode === 'boolean') this.rig.godMode = patch.godMode;

      if (prevMode !== this.rig.mode) {
        if (this.rig.mode === 'arcade') {
          this.player.screenX = this.width * 0.5;
          this.player.screenY = this.height * this.rig.anchorY;
          const dx = this.player.screenX - this.player.worldX;
          const dy = this.player.screenY - this.player.worldY;
          this._shiftAllWorldEntities(dx, dy);
          this.player.worldX = this.player.screenX;
          this.player.worldY = this.player.screenY;
          this.player.cameraRoll = 0;
        } else {
          const dx = this.player.worldX - this.player.screenX;
          const dy = this.player.worldY - this.player.screenY;
          this._shiftAllWorldEntities(dx, dy);
          this.player.screenX = this.width * 0.5;
          this.player.screenY = this.height * this.rig.anchorY;
        }
      }

      if (highlight && this.phase === 'playing' && (patch.width !== undefined || patch.length !== undefined || patch.shape !== undefined || patch.anchorY !== undefined)) {
        this.calibHighlightTimer = 4.0;
      }
      this.onStateChange(this.getPublicState());
    }

    _shiftAllWorldEntities(dx, dy) {
      for (const b of this.bullets) { b.x += dx; b.y += dy; }
      for (const b of this.enemyBullets) { b.x += dx; b.y += dy; }
      for (const e of this.enemies) { e.x += dx; e.y += dy; }
      for (const p of this.powerups) { p.x += dx; p.y += dy; }
      for (const pt of this.particles) { pt.x += dx; pt.y += dy; }
      for (const sw of this.shockwaves) { sw.x += dx; sw.y += dy; }
      for (const ft of this.floatingTexts) { ft.x += dx; ft.y += dy; }
    }

    getPublicState() {
      const ch = this.getCurrentChapter();
      return {
        ...this.rig,
        phase: this.phase,
        paused: this.isPaused,
        manualPaused: this.manualPaused,
        setupPaused: this.setupPaused,
        gameOver: this.phase === 'gameover',
        score: Math.floor(this.score),
        distanceKm: Number(this.distanceKm.toFixed(1)),
        gustUsedCount: this.gustUsedCount,
        wave: this.wave,
        chapterTitle: ch.title,
        chapterSubtitle: ch.subtitle,
        hp: Math.ceil(this.player.hp),
        nukes: this.player.nukes,
        weaponLv: this.player.weaponLv,
        shield: this.player.shield,
        droneCount: this.player.droneCount,
        loop: this.loopIndex,
        storyCleared: this.storyCleared,
        kills: this.kills,
        bossKills: this.bossKills,
        maxCombo: this.maxCombo,
        medals: this.medalsCollected,
        best: { ...this.best },
        lastRun: this.lastRun
      };
    }

    _rankForRun(score, bossKills, cleared) {
      if (cleared && score >= 60000) return 'S';
      if (cleared || bossKills >= 2) return 'A';
      if (bossKills >= 1 || score >= 8000) return 'B';
      return 'C';
    }

    _endRun() {
      const score = Math.floor(this.score);
      const prev = this.best;
      const newRecord = score > prev.score;
      this.best = {
        score: Math.max(prev.score, score),
        distanceKm: Math.max(prev.distanceKm, Number(this.distanceKm.toFixed(1))),
        cleared: prev.cleared || this.storyCleared
      };
      saveBest(this.best);
      this.lastRun = {
        newRecord,
        prevBest: prev.score,
        rank: this._rankForRun(score, this.bossKills, this.storyCleared)
      };
    }

    setRemoteInput(data) {
      if (!data) return;
      if (typeof data.vx === 'number') this.remoteInput.vx = clamp(data.vx, -1, 1);
      if (typeof data.vy === 'number') this.remoteInput.vy = clamp(data.vy, -1, 1);
      if (typeof data.firing === 'boolean') this.remoteInput.firing = data.firing;
      if (typeof data.micLevel === 'number') this.remoteInput.micLevel = clamp(data.micLevel, 0, 1);
      if (typeof data.railCharge === 'number') {
        const prev = this.remoteInput.railCharge;
        const next = clamp(data.railCharge, 0, 1);
        this.remoteInput.railCharge = next;
        if (this.phase === 'playing' && !this.isPaused && next > 0.15) {
          this.sfx.chargeTick(next);
        }
        if (prev >= 0.38 && next === 0 && data.autoRelease) {
          this.triggerRailgun(prev);
        }
      }
    }

    triggerRailgun(power = 1) {
      const p = this.player;
      if (this.phase !== 'playing' || this.isPaused || p.railCooldown > 0 || p.railBeamTimer > 0) return false;
      const clampedPower = clamp(power, 0.35, 1);
      p.railBeamPower = clampedPower;
      p.railBeamTimer = 0.45 + clampedPower * 0.35;
      p.railCooldown = 1.6;
      this.remoteInput.railCharge = 0;
      this.localRailCharge = 0;
      this.screenShake = Math.max(this.screenShake, 12 * clampedPower);
      this.flashAlpha = Math.max(this.flashAlpha, 0.28 * clampedPower);
      this.sfx.railgunFire();
      this._rumbleGamepad(0.75, 260);
      return true;
    }

    triggerNuke() {
      if (this.phase === 'title' || this.phase === 'gameover') {
        this.startMission();
        return true;
      }
      if (this.isPaused) {
        if (this.manualPaused && !this.setupPaused) this.setManualPause(false);
        return true;
      }
      const p = this.player;
      if (p.nukes <= 0) return false;
      p.nukes--;
      p.invulnTimer = Math.max(p.invulnTimer, 1.4);
      this.screenShake = 22;
      this.flashAlpha = 0.65;
      this.sfx.nukeExplosion();
      this._rumbleGamepad(1.0, 480);

      const cx = this._playerWorldX();
      const cy = this._playerWorldY();
      this.shockwaves.push({ x: cx, y: cy, r: 20, maxR: Math.hypot(this.width, this.height) * 0.95, color: '#38bdf8', life: 0.7, maxLife: 0.7, width: 14 });
      this.shockwaves.push({ x: cx, y: cy, r: 10, maxR: Math.hypot(this.width, this.height) * 0.75, color: '#fbbf24', life: 0.55, maxLife: 0.55, width: 8 });

      for (const eb of this.enemyBullets) {
        this.score += 15;
        this._spawnExplosion(eb.x, eb.y, '#fbbf24', 3, 90);
      }
      this.enemyBullets.length = 0;

      for (let i = this.enemies.length - 1; i >= 0; i--) {
        const e = this.enemies[i];
        this._damageEnemy(e, e.isBoss ? 260 : 9999, i);
      }
      this.floatingTexts.push({ x: cx, y: cy - 70, text: 'EMP 天窗脉冲清扫！', color: '#fbbf24', life: 1.1 });
      this.onStateChange(this.getPublicState());
      return true;
    }

    triggerWindGust() {
      const p = this.player;
      if (this.phase !== 'playing' || this.isPaused || p.gustCooldown > 0) return false;
      this.gustUsedCount++;
      p.gustTimer = 1.25;
      p.gustCooldown = p.gustMaxCooldown;
      p.invulnTimer = Math.max(p.invulnTimer, 0.9);
      this.screenShake = Math.max(this.screenShake, 9);
      this.sfx.windGust();
      this._rumbleGamepad(0.5, 320);

      const cx = this._playerWorldX();
      const cy = this._playerWorldY();
      this.floatingTexts.push({ x: cx, y: cy - 64, text: '呼——！借来八级顺风！', color: '#ffffff', life: 1.15 });

      for (let i = 0; i < 42; i++) {
        this.windStreaks.push({
          ox: (Math.random() - 0.5) * this.width * 1.3,
          oy: this.height * 0.55 - Math.random() * this.height * 0.3,
          len: 90 + Math.random() * 160,
          speed: 1100 + Math.random() * 700,
          life: 0.7 + Math.random() * 0.55
        });
      }

      for (const eb of this.enemyBullets) {
        eb.vy = -880 - Math.random() * 320;
        eb.vx = (eb.x - cx) * 1.8 + (Math.random() - 0.5) * 220;
        eb.reflected = true;
        eb.color = '#67e8f9';
      }

      for (let i = this.enemies.length - 1; i >= 0; i--) {
        const e = this.enemies[i];
        if (!e.isBoss) {
          e.y -= 130;
          e.vy = -340;
          this._damageEnemy(e, 28, i);
        } else {
          this._damageEnemy(e, 65, i);
        }
      }

      for (const pw of this.powerups) {
        pw.magnet = true;
      }
      return true;
    }

    triggerBarrelRoll() {
      const p = this.player;
      if (this.phase !== 'playing' || this.isPaused || p.rollCooldown > 0) return false;
      p.rollTimer = 0.62;
      p.rollCooldown = 2.2;
      p.invulnTimer = Math.max(p.invulnTimer, 0.68);
      this.sfx.barrelRoll();
      this._rumbleGamepad(0.35, 140);

      const cx = this._playerWorldX();
      const cy = this._playerWorldY();
      this.shockwaves.push({ x: cx, y: cy, r: 16, maxR: 155, color: '#a5f3fc', life: 0.38, maxLife: 0.38, width: 6 });

      for (const eb of this.enemyBullets) {
        const dx = eb.x - cx;
        const dy = eb.y - cy;
        const d = Math.hypot(dx, dy);
        if (d < 155 && d > 0.01) {
          eb.vx = (dx / d) * 620;
          eb.vy = (dy / d) * 620;
          eb.reflected = true;
          eb.color = '#a5f3fc';
        }
      }
      return true;
    }

    // Optional sound hooks: older SoundFX builds (or the phone cockpit) may not implement every cue.
    _sfx(name, ...args) {
      const fn = this.sfx && this.sfx[name];
      if (typeof fn === 'function') {
        try { fn.apply(this.sfx, args); } catch (e) { /* audio must never break gameplay */ }
      }
    }

    _syncMusic() {
      let key = 'title';
      if (this.phase === 'playing') key = this.getEffectiveSky();
      else if (this.phase === 'gameover') key = 'title';
      if (key !== this._musicKey) {
        this._musicKey = key;
        this._sfx('startMusic', key);
      }
      const intensity = this.phase === 'playing' && this.boss ? 1 : 0;
      if (intensity !== this._musicIntensity) {
        this._musicIntensity = intensity;
        this._sfx('setMusicIntensity', intensity);
      }
      const paused = this.isPaused;
      if (paused !== this._musicPaused) {
        this._musicPaused = paused;
        this._sfx('setMusicPaused', paused);
      }
    }

    // World-stationary objects (mines, wrecks) must drift down the screen in arcade mode, where the camera does not move.
    _scrollDy(dt) {
      return this.rig.mode === 'arcade' ? this.player.cruiseSpeed * dt : 0;
    }

    _playerWorldX() {
      return this.rig.mode === 'tabletop' ? this.player.worldX : this.player.screenX;
    }

    _playerWorldY() {
      return this.rig.mode === 'tabletop' ? this.player.worldY : this.player.screenY;
    }

    _pollGamepad(dt) {
      if (!navigator.getGamepads) return { vx: 0, vy: 0, active: false, firing: false };
      const pads = navigator.getGamepads();
      for (const gp of pads) {
        if (!gp || !gp.connected) continue;
        const deadzone = (v) => (Math.abs(v) < 0.14 ? 0 : (v - Math.sign(v) * 0.14) / 0.86);
        const gx = deadzone(gp.axes[0] || 0);
        const gy = deadzone(gp.axes[1] || 0);

        const pressed = (idx) => Boolean(gp.buttons[idx] && gp.buttons[idx].pressed);
        const justPressed = (idx) => pressed(idx) && !this.prevGpButtons[idx];

        // Start/Options button (9) toggles Pause or Starts Mission!
        if (justPressed(9)) {
          if (this.phase === 'title' || this.phase === 'gameover') this.startMission();
          else if (!this.setupPaused) this.toggleManualPause();
        }

        if (this.phase === 'playing' && !this.isPaused) {
          const l2Val = gp.buttons[6] ? gp.buttons[6].value : 0;
          if (l2Val > 0.15) {
            this.localRailCharge = clamp(this.localRailCharge + dt * 1.15, 0, 1);
            this.sfx.chargeTick(this.localRailCharge);
          } else if (this.prevGpL2 > 0.35 && l2Val <= 0.15) {
            this.triggerRailgun(this.localRailCharge);
          }
          this.prevGpL2 = l2Val;

          if (justPressed(1)) this.triggerNuke();
          if (justPressed(2)) this.triggerWindGust();
          if (justPressed(4) || justPressed(5)) this.triggerBarrelRoll();
          if (justPressed(3)) {
            this.updateRig({ mode: this.rig.mode === 'tabletop' ? 'arcade' : 'tabletop' });
          }
        } else if (justPressed(0) || justPressed(1)) {
          if (this.phase === 'title' || this.phase === 'gameover') this.startMission();
        }

        this.prevGpButtons = gp.buttons.map((b) => Boolean(b && b.pressed));
        const active = Math.abs(gx) > 0.01 || Math.abs(gy) > 0.01 || pressed(0) || pressed(7);
        return { vx: gx, vy: gy, active, firing: pressed(0) || pressed(7) };
      }
      return { vx: 0, vy: 0, active: false, firing: false };
    }

    _rumbleGamepad(intensity = 0.5, duration = 180) {
      if (!navigator.getGamepads) return;
      for (const gp of navigator.getGamepads()) {
        if (gp && gp.vibrationActuator && gp.vibrationActuator.playEffect) {
          gp.vibrationActuator.playEffect('dual-rumble', {
            startDelay: 0,
            duration,
            weakMagnitude: clamp(intensity * 0.7, 0, 1),
            strongMagnitude: clamp(intensity, 0, 1)
          }).catch(() => {});
        }
      }
    }

    _gatherInput(dt) {
      let kx = 0, ky = 0;
      if (this.keys.has('ArrowLeft') || this.keys.has('KeyA')) kx -= 1;
      if (this.keys.has('ArrowRight') || this.keys.has('KeyD')) kx += 1;
      if (this.keys.has('ArrowUp') || this.keys.has('KeyW')) ky -= 1;
      if (this.keys.has('ArrowDown') || this.keys.has('KeyS')) ky += 1;
      if (kx !== 0 && ky !== 0) {
        kx *= Math.SQRT1_2;
        ky *= Math.SQRT1_2;
      }

      if (this.keys.has('KeyJ') || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) {
        this.localRailCharge = clamp(this.localRailCharge + dt * 1.1, 0, 1);
        this.sfx.chargeTick(this.localRailCharge);
      } else if (this._wasChargingKey) {
        if (this.localRailCharge >= 0.35) this.triggerRailgun(this.localRailCharge);
        this.localRailCharge = 0;
      }
      this._wasChargingKey = this.keys.has('KeyJ') || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');

      const gp = this._pollGamepad(dt);

      let vx = this.remoteInput.vx + kx + gp.vx + (this.pointerDrag.active ? this.pointerDrag.vx : 0);
      let vy = this.remoteInput.vy + ky + gp.vy + (this.pointerDrag.active ? this.pointerDrag.vy : 0);
      const mag = Math.hypot(vx, vy);
      if (mag > 1) {
        vx /= mag;
        vy /= mag;
      }

      const railCharge = Math.max(this.remoteInput.railCharge, this.localRailCharge);
      return {
        vx,
        vy,
        firing: this.remoteInput.firing || gp.firing || kx !== 0 || ky !== 0 || this.pointerDrag.active,
        railCharge
      };
    }

    step(dt) {
      dt = Math.min(dt, 0.05);
      this._syncMusic();
      if (this.slowMo > 0 && this.phase === 'playing' && !this.isPaused) {
        this.slowMo = Math.max(0, this.slowMo - dt);
        dt *= 0.32;
      }

      // Always broadcast telemetry at ~15-20Hz so mobile cockpit stays synced in Title & Pause states too!
      this.telemetryAccum += dt;
      if (this.telemetryAccum >= 0.06) {
        this.telemetryAccum = 0;
        this._emitRadarTelemetry(this._playerWorldX(), this._playerWorldY());
      }

      // Title screen: gentle serene cloud drift & idle helipad breathing, zero enemies
      if (this.phase === 'title') {
        this.time += dt;
        this._pollGamepad(dt);
        const gentleX = this.remoteInput.vx * 180;
        this.player.bank = lerp(this.player.bank, this.remoteInput.vx * 0.65, 1 - Math.exp(-dt * 8));
        this.player.worldX += gentleX * dt;
        this.player.worldY -= 145 * dt;
        this.player.cameraRoll = lerp(this.player.cameraRoll, -this.player.bank * 0.09, 1 - Math.exp(-dt * 8));
        this.player.screenX = this.width * 0.5;
        this.player.screenY = this.height * this.rig.anchorY;
        return;
      }

      // Paused (manual or automatic when Setup/Calibration dialog is open): freeze combat completely!
      if (this.isPaused) {
        this._pollGamepad(dt);
        return;
      }

      this.time += dt;
      if (this.calibHighlightTimer > 0) {
        this.calibHighlightTimer = Math.max(0, this.calibHighlightTimer - dt);
      }
      if (this.storyBanner) {
        this.storyBanner.timer -= dt;
        if (this.storyBanner.timer <= 0) this.storyBanner = null;
      }
      if (this.screenShake > 0) this.screenShake = Math.max(0, this.screenShake - dt * 38);
      if (this.flashAlpha > 0) this.flashAlpha = Math.max(0, this.flashAlpha - dt * 1.8);
      if (this.lightningFlash > 0) this.lightningFlash = Math.max(0, this.lightningFlash - dt * 2.6);
      if (this.bossIntro > 0) this.bossIntro = Math.max(0, this.bossIntro - dt);
      this._stepPendingFx(dt);

      if (this.phase === 'gameover') {
        this._pollGamepad(dt);
        this._stepParticles(dt);
        return;
      }

      const p = this.player;
      const inp = this._gatherInput(dt);

      // Cooldowns
      if (p.invulnTimer > 0) p.invulnTimer = Math.max(0, p.invulnTimer - dt);
      if (p.rollTimer > 0) p.rollTimer = Math.max(0, p.rollTimer - dt);
      if (p.rollCooldown > 0) p.rollCooldown = Math.max(0, p.rollCooldown - dt);
      if (p.gustTimer > 0) p.gustTimer = Math.max(0, p.gustTimer - dt);
      if (p.gustCooldown > 0) p.gustCooldown = Math.max(0, p.gustCooldown - dt);
      if (p.railBeamTimer > 0) p.railBeamTimer = Math.max(0, p.railBeamTimer - dt);
      if (p.railCooldown > 0) p.railCooldown = Math.max(0, p.railCooldown - dt);
      if (this.comboTimer > 0) {
        this.comboTimer -= dt;
        if (this.comboTimer <= 0) this.combo = 0;
      }

      // Cockpit low-HP warning + chapter ambience (storm thunder & lightning on the sunset leg)
      if (p.hp <= 30 && !this.rig.godMode) {
        this.lowHpTimer -= dt;
        if (this.lowHpTimer <= 0) {
          this.lowHpTimer = 1.4;
          this._sfx('lowHpWarn');
        }
      }
      this.ambientTimer -= dt;
      if (this.ambientTimer <= 0) {
        this.ambientTimer = 7 + Math.random() * 9;
        if (this.getEffectiveSky() === 'sunset') {
          this.lightningFlash = 0.55 + Math.random() * 0.3;
          this._sfx('thunder');
        }
      }

      // Movement & Camera Illusion Physics
      const maxLatSpeed = 490;
      p.bank = lerp(p.bank, inp.vx, 1 - Math.exp(-dt * 11));

      if (this.rig.mode === 'tabletop') {
        p.screenX = this.width * 0.5;
        p.screenY = this.height * this.rig.anchorY;

        p.vx = lerp(p.vx, inp.vx * maxLatSpeed, 1 - Math.exp(-dt * 12));
        const targetCruise = inp.vy < 0
          ? lerp(310, 610, -inp.vy)
          : lerp(310, 155, inp.vy);
        p.cruiseSpeed = lerp(p.cruiseSpeed, targetCruise, 1 - Math.exp(-dt * 8));
        p.vy = -p.cruiseSpeed;

        p.worldX += p.vx * dt;
        p.worldY += p.vy * dt;

        const targetRoll = -p.bank * 0.132 + (p.rollTimer > 0 ? Math.sin((p.rollTimer / 0.62) * Math.PI * 2) * 0.24 : 0);
        p.cameraRoll = lerp(p.cameraRoll, targetRoll, 1 - Math.exp(-dt * 10));
      } else {
        p.cameraRoll = 0;
        p.cruiseSpeed = 280;
        p.vx = lerp(p.vx, inp.vx * 520, 1 - Math.exp(-dt * 14));
        p.vy = lerp(p.vy, inp.vy * 480, 1 - Math.exp(-dt * 14));
        const halfW = 34;
        p.screenX = clamp(p.screenX + p.vx * dt, halfW, this.width - halfW);
        p.screenY = clamp(p.screenY + p.vy * dt, 56, this.height - 48);
        p.worldX = p.screenX;
        p.worldY -= p.cruiseSpeed * dt;
      }

      this.distanceKm += (p.cruiseSpeed / 420) * dt;

      const px = this._playerWorldX();
      const py = this._playerWorldY();

      // Auto Weapon Fire
      p.fireCooldown -= dt;
      if (inp.firing && inp.railCharge < 0.2 && p.railBeamTimer <= 0 && p.fireCooldown <= 0) {
        this._fireMainGuns(px, py);
        p.fireCooldown = p.weaponLv >= 4 ? 0.095 : 0.115;
      }

      // Flanking Bit-Drones Auto Fire
      p.droneFireCooldown -= dt;
      if (inp.firing && p.droneCount > 0 && p.droneFireCooldown <= 0) {
        this._fireDroneGuns(px, py);
        p.droneFireCooldown = 0.26;
      }

      // Active Railgun Continuous Sweep Damage
      if (p.railBeamTimer > 0) {
        const beamHalfW = 16 + p.railBeamPower * 28;
        const muzzleY = py - (this.rig.mode === 'tabletop' ? this.rig.length * 0.5 : 28);
        const topReachY = py - this.height * 1.15;

        for (let i = this.enemyBullets.length - 1; i >= 0; i--) {
          const eb = this.enemyBullets[i];
          if (Math.abs(eb.x - px) <= beamHalfW + 10 && eb.y <= muzzleY && eb.y >= topReachY) {
            this.enemyBullets.splice(i, 1);
            this.score += 5;
          }
        }
        for (let i = this.enemies.length - 1; i >= 0; i--) {
          const e = this.enemies[i];
          if (Math.abs(e.x - px) <= beamHalfW + e.radius && e.y <= muzzleY + 20 && e.y >= topReachY) {
            this._damageEnemy(e, (260 + 220 * p.railBeamPower) * dt, i);
          }
        }
      }

      this._stepSpawner(dt, px, py);
      this._stepHazards(dt, px, py);
      this._stepPlayerBullets(dt, px, py);
      this._stepEnemies(dt, px, py);
      this._stepEnemyBullets(dt, px, py);
      this._stepPowerups(dt, px, py);
      this._stepParticles(dt);
    }

    _muzzleOffsetY() {
      return this.rig.mode === 'tabletop' ? -(this.rig.length * 0.5 + 10) : -28;
    }

    _droneSideOffsetX() {
      return this.rig.mode === 'tabletop' ? (this.rig.width * 0.5 + 30) : 44;
    }

    // Formation slots for 2..4 flanking bit-drones (relative to the craft centre)
    _droneSlots() {
      const side = this._droneSideOffsetX();
      const back = this.rig.mode === 'tabletop' ? this.rig.length * 0.32 + 14 : 30;
      const slots = [
        { x: -side, y: 8 },
        { x: side, y: 8 },
        { x: -side * 0.62, y: 8 + back },
        { x: side * 0.62, y: 8 + back }
      ];
      return slots.slice(0, clamp(this.player.droneCount, 0, 4));
    }

    _fireMainGuns(px, py) {
      const my = py + this._muzzleOffsetY();
      const baseVy = (this.rig.mode === 'tabletop' ? -this.player.cruiseSpeed : 0) - 920;
      const lv = this.player.weaponLv;

      this.sfx.laser(lv);

      const addShot = (ox, vx, dmg, color = '#0284c7', w = 4.5, h = 19) => {
        const brightColor = this.getEffectiveSky() === 'day' ? color : '#38bdf8';
        this.bullets.push({ x: px + ox, y: my, vx, vy: baseVy, dmg, color: brightColor, w, h, life: 1.35 });
      };

      const spreadBase = this.rig.mode === 'tabletop' ? Math.min(26, this.rig.width * 0.24) : 11;
      if (lv === 1) {
        addShot(-spreadBase, 0, 14, '#0369a1');
        addShot(spreadBase, 0, 14, '#0369a1');
      } else if (lv === 2) {
        addShot(0, 0, 16, '#ea580c', 5, 22);
        addShot(-spreadBase * 1.25, -75, 12, '#0369a1');
        addShot(spreadBase * 1.25, 75, 12, '#0369a1');
      } else if (lv === 3) {
        addShot(-spreadBase * 0.65, 0, 15, '#ea580c', 5, 22);
        addShot(spreadBase * 0.65, 0, 15, '#ea580c', 5, 22);
        addShot(-spreadBase * 1.5, -145, 12, '#0369a1');
        addShot(spreadBase * 1.5, 145, 12, '#0369a1');
      } else {
        addShot(0, 0, 20, '#dc2626', 6, 24);
        addShot(-spreadBase, -65, 15, '#ea580c', 5, 20);
        addShot(spreadBase, 65, 15, '#ea580c', 5, 20);
        addShot(-spreadBase * 1.7, -195, 13, '#0369a1');
        addShot(spreadBase * 1.7, 195, 13, '#0369a1');
      }
    }

    _fireDroneGuns(px, py) {
      const baseVy = (this.rig.mode === 'tabletop' ? -this.player.cruiseSpeed : 0) - 780;

      let target = null;
      let bestDist = 680;
      for (const e of this.enemies) {
        const d = Math.hypot(e.x - px, e.y - py);
        if (e.y < py + 40 && d < bestDist) {
          bestDist = d;
          target = e;
        }
      }

      for (const slot of this._droneSlots()) {
        const dir = slot.x < 0 ? -1 : 1;
        const dx = px + slot.x - this.player.bank * 10;
        const dy = py + slot.y;
        let vx = dir * 25;
        let vy = baseVy;
        if (target) {
          const aimX = target.x - dx;
          const aimY = target.y - dy;
          const len = Math.hypot(aimX, aimY) || 1;
          vx = (aimX / len) * 780;
          vy = (this.rig.mode === 'tabletop' ? -this.player.cruiseSpeed : 0) + (aimY / len) * 780;
        }
        this.bullets.push({ x: dx, y: dy - 12, vx, vy, dmg: 10, color: '#10b981', w: 4, h: 14, life: 1.2 });
      }
    }

    _difficulty() {
      return 1 + (this.wave - 1) * 0.22 + Math.min(1.5, this.time / 120);
    }

    _topSpawnY(py) {
      return this.rig.mode === 'tabletop'
        ? py - this.height * this.rig.anchorY - 70
        : -60;
    }

    _stepSpawner(dt, px, py) {
      const topSpawnY = this._topSpawnY(py);

      if (this.bossCooldown > 0) this.bossCooldown -= dt;
      if (!this.boss && this.bossCooldown <= 0 && this.score >= this.nextBossScore) {
        this._spawnBoss(px, topSpawnY);
        return;
      }

      this.spawnTimer -= dt;
      if (this.spawnTimer > 0) return;

      const difficulty = this._difficulty();
      this.spawnTimer = this.boss ? 2.3 : Math.max(0.55, 1.45 - difficulty * 0.16);

      // Bosses only get light escorts; the story table decides the rest
      const table = SPAWN_TABLES[this.getCurrentChapter().idx];
      const pool = this.boss ? table.filter(([t]) => t === 'scout' || t === 'mine') : table;
      const total = pool.reduce((sum, [, w]) => sum + w, 0);
      let roll = Math.random() * total;
      let type = pool[0][0];
      for (const [t, w] of pool) {
        roll -= w;
        if (roll <= 0) { type = t; break; }
      }
      this._spawnGroup(type, px, py, topSpawnY, difficulty);
    }

    _spawnGroup(type, px, py, topSpawnY, difficulty) {
      const spanW = Math.min(this.width * 0.84, 760);
      const base = (extra) => ({ phase: Math.random() * Math.PI * 2, age: 0, hitFlash: 0, ...extra });

      if (type === 'scout') {
        const count = 3 + Math.floor(Math.random() * 3);
        const startX = px + (Math.random() - 0.5) * (spanW * 0.65);
        const dir = Math.random() < 0.5 ? 1 : -1;
        for (let i = 0; i < count; i++) {
          this.enemies.push(base({
            type: 'scout', x: startX + dir * i * 48, y: topSpawnY - i * 42,
            vx: -dir * 65, vy: 155 * Math.min(1.5, difficulty * 0.75),
            hp: 26 * difficulty, maxHp: 26 * difficulty, radius: 20,
            fireTimer: 0.9 + i * 0.25, scoreVal: 110
          }));
        }
      } else if (type === 'gunship') {
        this.enemies.push(base({
          type: 'gunship', x: px + (Math.random() - 0.5) * spanW * 0.75, y: topSpawnY - 20,
          vx: 0, vy: 95, hp: 115 * difficulty, maxHp: 115 * difficulty, radius: 32,
          fireTimer: 0.8, dropsLoot: true, scoreVal: 340
        }));
      } else if (type === 'lancer') {
        const n = this.wave >= 2 && Math.random() < 0.5 ? 2 : 1;
        for (let i = 0; i < n; i++) {
          this.enemies.push(base({
            type: 'lancer', x: px + (Math.random() - 0.5) * spanW * 0.85, y: topSpawnY - 10 - i * 60,
            vx: 0, vy: 60, hp: 42 * difficulty, maxHp: 42 * difficulty, radius: 21,
            chargeWarn: 0.75 + i * 0.35, dashed: false, fireTimer: 99, scoreVal: 190
          }));
        }
      } else if (type === 'weaver') {
        // Sine-weaving formation that sweeps in from one flank
        const fromLeft = Math.random() < 0.5;
        const count = 5;
        const edgeX = px + (fromLeft ? -1 : 1) * (this.width * 0.5 + 50);
        const rowY = topSpawnY + this.height * (0.12 + Math.random() * 0.18);
        for (let i = 0; i < count; i++) {
          this.enemies.push(base({
            type: 'weaver', x: edgeX + (fromLeft ? -1 : 1) * i * 58, y: rowY,
            baseY: rowY, vx: (fromLeft ? 1 : -1) * 230, vy: 0, phase: i * 0.7,
            hp: 30 * difficulty, maxHp: 30 * difficulty, radius: 18,
            fireTimer: 1.2 + i * 0.3, scoreVal: 150, sideCull: true
          }));
        }
      } else if (type === 'bomber') {
        this.enemies.push(base({
          type: 'bomber', x: px + (Math.random() - 0.5) * spanW * 0.6, y: topSpawnY - 30,
          vx: (Math.random() < 0.5 ? -1 : 1) * 45, vy: 62, hp: 210 * difficulty, maxHp: 210 * difficulty,
          radius: 40, fireTimer: 1.4, mineTimer: 1.1, dropsLoot: true, scoreVal: 520
        }));
      } else if (type === 'sentinel') {
        // Parks in the upper sky and spins a flower of bullets until destroyed
        this.enemies.push(base({
          type: 'sentinel', x: px + (Math.random() - 0.5) * spanW * 0.6, y: topSpawnY - 20,
          vx: 0, vy: 140, parkY: 0.24 + Math.random() * 0.14, hp: 260 * difficulty, maxHp: 260 * difficulty,
          radius: 34, fireTimer: 1.0, spin: 0, stay: 7.5, dropsLoot: true, scoreVal: 640
        }));
      } else if (type === 'mine') {
        const n = 2 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n; i++) {
          this._spawnMine(px + (Math.random() - 0.5) * spanW * 0.9, topSpawnY - Math.random() * 160, difficulty);
        }
      }
    }

    _spawnMine(x, y, difficulty = this._difficulty()) {
      this.enemies.push({
        type: 'mine', x, y, vx: 0, vy: 0, phase: Math.random() * 6, age: 0, hitFlash: 0,
        hp: 18 * difficulty, maxHp: 18 * difficulty, radius: 15, fireTimer: 99,
        armTimer: -1, scoreVal: 80, worldStatic: true
      });
    }

    _spawnBoss(px, topSpawnY) {
      const kind = BOSS_ORDER[this.getCurrentChapter().idx];
      const def = BOSS_DEFS[kind];
      const hp = Math.round((4200 + (this.wave - 1) * 1500) * (1 + this.loopIndex * 0.35));
      const boss = {
        type: 'boss',
        bossKind: kind,
        name: def.name,
        isBoss: true,
        x: px,
        y: topSpawnY - 60,
        vx: 90,
        vy: 80,
        hp,
        maxHp: hp,
        radius: 68,
        fireTimer: 2.0,
        patternIdx: 0,
        phase: 0,
        age: 0,
        enraged: false,
        spin: 0,
        dropsLoot: true,
        scoreVal: 2500 + this.loopIndex * 1500
      };
      this.boss = boss;
      this.enemies.push(boss);
      this.bossIntro = 2.6;
      this.sfx.bossAlarm();
      const ch = this.getCurrentChapter();
      this.storyBanner = {
        title: `⚠ ${def.name} · 第 ${this.wave} 关封锁线`,
        subtitle: ch.bossWarn,
        timer: 3.8,
        maxTimer: 3.8,
        alert: true
      };
    }

    _stepPlayerBullets(dt) {
      for (let i = this.bullets.length - 1; i >= 0; i--) {
        const b = this.bullets[i];
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.life -= dt;
        if (b.life <= 0) {
          this.bullets.splice(i, 1);
          continue;
        }

        let hit = false;
        for (let j = this.enemies.length - 1; j >= 0; j--) {
          const e = this.enemies[j];
          if (Math.abs(b.x - e.x) < e.radius + b.w && Math.abs(b.y - e.y) < e.radius + b.h * 0.5) {
            this._spawnExplosion(b.x, b.y, b.color, 3, 85);
            this.sfx.enemyHit();
            this._damageEnemy(e, b.dmg, j);
            hit = true;
            break;
          }
        }
        if (hit) this.bullets.splice(i, 1);
      }
    }

    _damageEnemy(e, dmg, indexInArray) {
      if (e.dead) return;
      e.hp -= dmg;
      e.hitFlash = 0.08;

      // Boss enrage at half HP: new choreography + visual overdrive
      if (e.isBoss && !e.enraged && e.hp > 0 && e.hp <= e.maxHp * 0.5) {
        e.enraged = true;
        e.fireTimer = 1.1;
        this.screenShake = Math.max(this.screenShake, 14);
        this.flashAlpha = Math.max(this.flashAlpha, 0.22);
        this._sfx('bossPhase');
        this._rumbleGamepad(0.7, 300);
        this.shockwaves.push({ x: e.x, y: e.y, r: 40, maxR: 260, color: BOSS_DEFS[e.bossKind].trim, life: 0.6, maxLife: 0.6, width: 9 });
        this.floatingTexts.push({ x: e.x, y: e.y + 96, text: `${e.name} 进入狂暴！`, color: '#fca5a5', life: 1.5, big: true });
      }
      if (e.hp > 0) return;

      e.dead = true;
      const idx = indexInArray !== undefined && this.enemies[indexInArray] === e ? indexInArray : this.enemies.indexOf(e);
      if (idx >= 0) this.enemies.splice(idx, 1);

      this.combo++;
      this.comboTimer = 3.2;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      if (this.combo > 0 && this.combo % 25 === 0) {
        this._sfx('comboMilestone', this.combo);
        this.floatingTexts.push({ x: this._playerWorldX(), y: this._playerWorldY() - 92, text: `${this.combo} 连击！`, color: '#fde047', life: 1.2, big: true });
      }
      const mult = 1 + Math.min(2.0, this.combo * 0.05);
      const pts = Math.round(e.scoreVal * mult * (1 + this.loopIndex * 0.5));
      this.score += pts;
      this.kills++;
      this.killsForNuke++;

      if (this.killsForNuke >= 32) {
        this.killsForNuke = 0;
        if (this.player.nukes < this.player.maxNukes) {
          this.player.nukes++;
          this.floatingTexts.push({ x: e.x, y: e.y - 24, text: '+1 战术核弹充能', color: '#f97316', life: 1.2 });
        }
      }

      if (e.isBoss) {
        this._onBossDefeated(e);
      } else if (e.type === 'mine') {
        // Shot mines pop harmlessly (only proximity detonation throws shrapnel)
        this.sfx.enemyBoom(false);
        this._spawnExplosion(e.x, e.y, '#fca5a5', 10, 160);
        this.shockwaves.push({ x: e.x, y: e.y, r: 6, maxR: 70, color: '#fda4af', life: 0.3, maxLife: 0.3, width: 4 });
      } else {
        const big = e.type === 'gunship' || e.type === 'bomber' || e.type === 'sentinel';
        this.sfx.enemyBoom(false);
        const color = e.type === 'scout' || e.type === 'weaver' ? '#38bdf8' : '#fb923c';
        this._spawnExplosion(e.x, e.y, color, big ? 16 : 9, big ? 220 : 180);
        if (big) {
          this._spawnFireball(e.x, e.y, e.radius * 1.6);
          this._spawnDebris(e.x, e.y, 7, '#475569');
        } else {
          this._spawnFireball(e.x, e.y, e.radius * 1.1);
        }
        if (e.dropsLoot) {
          const r = Math.random();
          let kind = 'weapon';
          if (e.type === 'sentinel' || e.type === 'bomber') kind = r < 0.4 ? 'shield' : (r < 0.7 ? 'drone' : 'weapon');
          else kind = r < 0.55 ? 'weapon' : (r < 0.72 ? 'heal' : (r < 0.86 ? 'shield' : (r < 0.94 ? 'drone' : 'nuke')));
          this._spawnPowerup(e.x, e.y, kind);
        } else if (Math.random() < 0.08) {
          this._spawnPowerup(e.x, e.y, Math.random() < 0.6 ? 'weapon' : 'heal');
        }
        // Gold medals: chain-collect them for ever-rising bonus points
        if (Math.random() < (big ? 1 : 0.32)) {
          this._spawnPowerup(e.x + (Math.random() - 0.5) * 20, e.y, 'medal');
        }
      }
      this.onStateChange(this.getPublicState());
    }

    _onBossDefeated(e) {
      this.boss = null;
      this.bossKills++;
      const clearedWave = this.wave;
      this.wave++;
      this.nextBossScore = this.score + 6000 + this.wave * 1500;
      // Breathing room: the next blockade never arrives before the new chapter has had time to play out
      this.bossCooldown = clearedWave === STORY_CHAPTERS.length ? 45 : 38;
      this.enemyBullets.length = 0;
      this.hazards.length = 0;
      this.slowMo = 1.3;
      this.screenShake = 24;
      this.flashAlpha = 0.55;
      this.sfx.enemyBoom(true);
      this._rumbleGamepad(1.0, 520);

      // Chain of hull explosions rippling across the wreck, relative to the player so the camera can keep moving
      const px = this._playerWorldX();
      const py = this._playerWorldY();
      const def = BOSS_DEFS[e.bossKind] || BOSS_DEFS.fog;
      for (let k = 0; k < 9; k++) {
        this.pendingFx.push({
          t: k * 0.11,
          dx: e.x - px + (Math.random() - 0.5) * 140,
          dy: e.y - py + (Math.random() - 0.5) * 80,
          size: 40 + Math.random() * 40,
          color: k % 2 ? def.trim : '#fb923c'
        });
      }
      this.pendingFx.push({ t: 1.05, dx: e.x - px, dy: e.y - py, size: 170, color: '#fde68a', final: true });

      this._spawnExplosion(e.x, e.y, '#fb923c', 42, 340);
      this._spawnDebris(e.x, e.y, 16, def.hull);
      this.shockwaves.push({ x: e.x, y: e.y, r: 20, maxR: 320, color: '#fb923c', life: 0.65, maxLife: 0.65, width: 10 });
      this._spawnPowerup(e.x - 40, e.y, 'weapon');
      this._spawnPowerup(e.x + 40, e.y, 'heal');
      this._spawnPowerup(e.x, e.y + 20, Math.random() < 0.5 ? 'shield' : 'drone');
      for (let k = 0; k < 6; k++) this._spawnPowerup(e.x + (k - 2.5) * 26, e.y - 20, 'medal');
      for (const pw of this.powerups) pw.magnet = true;

      if (clearedWave === STORY_CHAPTERS.length && !this.storyCleared) {
        this.storyCleared = true;
        this._sfx('victory');
        this.storyBanner = {
          title: '🌟 借风计划 · 三幕航段全部完成！',
          subtitle: '天窗守住了——云海还在奔跑，继续无尽航线挑战更高分吧。',
          timer: 6.5,
          maxTimer: 6.5,
          victory: true
        };
        for (let k = 0; k < 14; k++) {
          this.pendingFx.push({
            t: 1.3 + k * 0.22,
            dx: (Math.random() - 0.5) * this.width * 0.8,
            dy: -this.height * (0.2 + Math.random() * 0.35),
            size: 0,
            firework: true,
            color: ['#fde047', '#67e8f9', '#f472b6', '#a78bfa', '#4ade80'][k % 5]
          });
        }
      } else {
        this._announceChapter(this.wave);
      }
    }

    _stepPendingFx(dt) {
      if (this.pendingFx.length === 0) return;
      const px = this._playerWorldX();
      const py = this._playerWorldY();
      for (let i = this.pendingFx.length - 1; i >= 0; i--) {
        const fx = this.pendingFx[i];
        fx.t -= dt;
        if (fx.t > 0) continue;
        this.pendingFx.splice(i, 1);
        const x = px + fx.dx;
        const y = py + fx.dy;
        if (fx.firework) {
          this._spawnFirework(x, y, fx.color);
        } else {
          this._spawnFireball(x, y, fx.size);
          this._spawnExplosion(x, y, fx.color, fx.final ? 40 : 12, fx.final ? 380 : 200);
          this.screenShake = Math.max(this.screenShake, fx.final ? 26 : 9);
          this.sfx.enemyBoom(Boolean(fx.final));
          if (fx.final) {
            this.flashAlpha = Math.max(this.flashAlpha, 0.6);
            this.shockwaves.push({ x, y, r: 30, maxR: Math.hypot(this.width, this.height) * 0.6, color: '#fde68a', life: 0.8, maxLife: 0.8, width: 12 });
          }
        }
      }
    }

    _spawnPowerup(x, y, kind) {
      this.powerups.push({
        x,
        y,
        vx: (Math.random() - 0.5) * (kind === 'medal' ? 140 : 60),
        vy: kind === 'medal' ? -140 - Math.random() * 60 : -70,
        kind,
        magnet: false,
        spin: Math.random() * Math.PI * 2,
        life: kind === 'medal' ? 6.5 : 11
      });
    }

    _stepEnemies(dt, px, py) {
      const worldStepY = this.rig.mode === 'tabletop' ? -this.player.cruiseSpeed * dt : 0;
      const bottomCullY = py + this.height * (1 - this.rig.anchorY) + 180;
      const hitHalfW = this.rig.mode === 'tabletop' ? this.rig.width * 0.24 : 15;
      const hitHalfL = this.rig.mode === 'tabletop' ? this.rig.length * 0.24 : 18;
      const skyTopY = this.rig.mode === 'tabletop' ? py - this.height * this.rig.anchorY : 0;

      for (let i = this.enemies.length - 1; i >= 0; i--) {
        const e = this.enemies[i];
        if (!e) continue;
        if (e.hitFlash > 0) e.hitFlash -= dt;
        e.phase = (e.phase || 0) + dt * 3;
        e.age = (e.age || 0) + dt;

        if (e.isBoss) {
          this._stepBoss(e, dt, px, py, worldStepY);
        } else if (e.type === 'lancer') {
          e.y += worldStepY + e.vy * dt;
          if (e.chargeWarn > 0) {
            e.x = lerp(e.x, px, 1 - Math.exp(-dt * 3.2));
            e.chargeWarn -= dt;
            if (e.chargeWarn <= 0) {
              e.dashed = true;
              e.vy = 560 + this.loopIndex * 60;
            }
          } else if (e.dashed && Math.random() < dt * 30) {
            this.particles.push({ x: e.x + (Math.random() - 0.5) * 8, y: e.y - 20, vx: 0, vy: worldStepY / dt * 0.6 - 60, r: 3, color: '#fca5a5', life: 0.25, maxLife: 0.25 });
          }
        } else if (e.type === 'weaver') {
          e.x += e.vx * dt;
          e.baseY += worldStepY + 22 * dt;
          e.y = e.baseY + Math.sin(e.age * 3.2 + e.phase) * 58;
          e.fireTimer -= dt;
          if (e.fireTimer <= 0 && Math.abs(e.x - px) < this.width * 0.45) {
            const ang = Math.atan2(py - e.y, px - e.x);
            this._spawnEnemyBullet(e.x, e.y + 12, Math.cos(ang) * 230, Math.sin(ang) * 230, '#22d3ee', 5);
            e.fireTimer = 2.3;
          }
        } else if (e.type === 'bomber') {
          e.x += (e.vx + Math.sin(e.phase * 0.5) * 20) * dt;
          e.y += worldStepY + e.vy * dt;
          e.mineTimer -= dt;
          if (e.mineTimer <= 0 && e.y < py - 140) {
            this._spawnMine(e.x + (Math.random() - 0.5) * 30, e.y - 34);
            e.mineTimer = 1.7;
          }
          e.fireTimer -= dt;
          if (e.fireTimer <= 0 && e.y < py - 80) {
            for (let s = -2; s <= 2; s++) {
              const a = Math.PI * 0.5 + s * 0.2;
              this._spawnEnemyBullet(e.x, e.y + 30, Math.cos(a) * 170, Math.sin(a) * 170, '#f59e0b', 6.5);
            }
            e.fireTimer = 2.4;
          }
        } else if (e.type === 'sentinel') {
          const parkWorldY = skyTopY + this.height * e.parkY;
          e.y += worldStepY;
          if (e.stay > 0) {
            e.y = lerp(e.y, parkWorldY, 1 - Math.exp(-dt * 2.2));
            e.x = lerp(e.x, e.x + Math.sin(e.age * 0.8) * 30, dt);
            e.stay -= dt;
            e.fireTimer -= dt;
            if (e.fireTimer <= 0 && e.age > 1.2) {
              const arms = 3 + Math.min(2, this.loopIndex);
              for (let k = 0; k < arms; k++) {
                const a = e.spin + (k / arms) * Math.PI * 2;
                this._spawnEnemyBullet(e.x + Math.cos(a) * 24, e.y + Math.sin(a) * 24, Math.cos(a) * 165, Math.sin(a) * 165, '#c084fc', 5);
              }
              e.spin += 0.32;
              e.fireTimer = 0.17;
            }
            if (e.stay <= 0) e.vx = (e.x < px ? -1 : 1) * 210;
          } else {
            e.x += e.vx * dt;
            e.y -= 60 * dt;
            e.sideCull = true;
          }
        } else if (e.type === 'mine') {
          e.y += this._scrollDy(dt);
          const d = Math.hypot(e.x - px, e.y - py);
          if (e.armTimer < 0 && d < 135) {
            e.armTimer = 0.7;
            this._sfx('mineBeep');
          }
          if (e.armTimer >= 0) {
            e.armTimer -= dt;
            if (e.armTimer <= 0) {
              const n = 10 + Math.min(6, this.loopIndex * 2);
              for (let k = 0; k < n; k++) {
                const a = (k / n) * Math.PI * 2 + e.phase;
                this._spawnEnemyBullet(e.x, e.y, Math.cos(a) * 175, Math.sin(a) * 175, '#fb7185', 5);
              }
              this.sfx.enemyBoom(false);
              this._spawnFireball(e.x, e.y, 34);
              this.enemies.splice(i, 1);
              continue;
            }
          }
        } else {
          e.x += (e.vx + Math.sin(e.phase) * (e.type === 'scout' ? 75 : 30)) * dt;
          e.y += worldStepY + e.vy * dt;
          if (e.vy < 110) e.vy = lerp(e.vy, 125, dt * 3);

          e.fireTimer -= dt;
          if (e.fireTimer <= 0 && e.y < py - 60) {
            if (e.type === 'scout') {
              const ang = Math.atan2(py - e.y, px - e.x);
              this._spawnEnemyBullet(e.x, e.y + 14, Math.cos(ang) * 245, Math.sin(ang) * 245, '#e11d48', 5.5);
              e.fireTimer = 1.9;
            } else if (e.type === 'gunship') {
              const baseAng = Math.atan2(py - e.y, px - e.x);
              for (let s = -1; s <= 1; s++) {
                const a = baseAng + s * 0.22;
                this._spawnEnemyBullet(e.x, e.y + 22, Math.cos(a) * 255, Math.sin(a) * 255, '#ea580c', 6);
              }
              e.fireTimer = 1.55;
            }
          }
        }

        if (Math.abs(e.x - px) < e.radius + hitHalfW && Math.abs(e.y - py) < e.radius + hitHalfL) {
          this._hurtPlayer(22);
          if (!e.isBoss) {
            this._damageEnemy(e, 9999, i);
            continue;
          }
        }

        if (!e.isBoss) {
          const offSide = e.sideCull && e.age > 2.5 && Math.abs(e.x - px) > this.width * 0.8;
          if (e.y > bottomCullY || offSide || e.y < py - this.height * 2.2) {
            const idx = this.enemies.indexOf(e);
            if (idx >= 0) this.enemies.splice(idx, 1);
          }
        }
      }
    }

    _stepBoss(e, dt, px, py, worldStepY) {
      const desiredY = py - this.height * (this.rig.mode === 'tabletop' ? this.rig.anchorY * 0.66 : 0.52);
      e.y += worldStepY;
      e.y = lerp(e.y, desiredY, 1 - Math.exp(-dt * 3.5));
      const sway = Math.min(220, this.width * 0.28) * (e.enraged ? 1.15 : 1);
      e.x = lerp(e.x, px + Math.sin(this.time * (e.enraged ? 1.25 : 0.95)) * sway, 1 - Math.exp(-dt * 2.4));
      const def = BOSS_DEFS[e.bossKind] || BOSS_DEFS.fog;
      const loopBoost = 1 + this.loopIndex * 0.12;
      const rate = (e.enraged ? 0.78 : 1) / loopBoost;

      // Continuous streams (spirals) run alongside the discrete pattern cycle
      if (e.streamLeft > 0) {
        e.streamLeft -= dt;
        e.streamTick = (e.streamTick || 0) - dt;
        if (e.streamTick <= 0) {
          e.streamTick = e.enraged ? 0.07 : 0.09;
          e.spin += e.bossKind === 'mother' ? 0.23 : 0.29;
          const arms = e.bossKind === 'mother' ? (e.enraged ? 5 : 4) : 2;
          for (let k = 0; k < arms; k++) {
            const a = e.spin + (k / arms) * Math.PI * 2;
            this._spawnEnemyBullet(e.x, e.y + 10, Math.cos(a) * 200, Math.sin(a) * 200, def.bullet, 5.5);
            if (e.enraged && e.bossKind === 'mother') {
              const b = -e.spin * 1.1 + (k / arms) * Math.PI * 2;
              this._spawnEnemyBullet(e.x, e.y + 10, Math.cos(b) * 150, Math.sin(b) * 150, def.accent, 5);
            }
          }
        }
      }

      e.fireTimer -= dt;
      if (e.fireTimer > 0 || e.age < 1.6) return;
      e.patternIdx = (e.patternIdx + 1) % (e.enraged ? 4 : 3);
      const pat = e.patternIdx;
      const aimAt = (ox) => Math.atan2(py - e.y, px - (e.x + ox));

      if (e.bossKind === 'fog') {
        if (pat === 0) {
          const n = 12 + Math.min(8, this.wave * 2);
          for (let k = 0; k < n; k++) {
            const ang = (k / n) * Math.PI * 2 + this.time;
            this._spawnEnemyBullet(e.x, e.y + 24, Math.cos(ang) * 230, Math.sin(ang) * 230, '#ef4444', 6);
          }
          e.fireTimer = 1.25 * rate;
        } else if (pat === 1) {
          for (const side of [-38, 38]) {
            const ang = aimAt(side);
            for (let s = -1; s <= 1; s++) {
              const a = ang + s * 0.18;
              this._spawnEnemyBullet(e.x + side, e.y + 30, Math.cos(a) * 310, Math.sin(a) * 310, '#f97316', 5.5);
            }
          }
          e.fireTimer = 1.05 * rate;
        } else if (pat === 2) {
          // Fog curtain: a slow wall of grey shells with a single safe gap
          const gapX = px + (Math.random() - 0.5) * 160;
          const span = Math.min(this.width * 0.9, 900);
          for (let x = -span * 0.5; x <= span * 0.5; x += 34) {
            const wx = px + x;
            if (Math.abs(wx - gapX) < 62) continue;
            this._spawnEnemyBullet(wx, e.y + 40, 0, 120, def.bullet, 7.5);
          }
          e.fireTimer = 1.5 * rate;
        } else {
          e.streamLeft = 2.2;
          e.fireTimer = 2.5 * rate;
        }
      } else if (e.bossKind === 'storm') {
        if (pat === 0) {
          const n = 9;
          for (let s = 0; s < n; s++) {
            const a = Math.PI * 0.5 + (s - (n - 1) / 2) * 0.17 + Math.sin(this.time * 2) * 0.15;
            this._spawnEnemyBullet(e.x, e.y + 36, Math.cos(a) * 270, Math.sin(a) * 270, '#f97316', 6.5);
          }
          e.fireTimer = 0.95 * rate;
        } else if (pat === 1) {
          // Lightning lanes: telegraphed columns that strike after a warning
          const lanes = e.enraged ? 3 : 2;
          const used = [];
          for (let k = 0; k < lanes; k++) {
            let x = k === 0 ? px : px + (Math.random() - 0.5) * this.width * 0.7;
            if (used.some((u) => Math.abs(u - x) < 110)) x += 140;
            used.push(x);
            this.hazards.push({ kind: 'lane', x, halfW: 30, warn: 1.05 + k * 0.18, active: 0.42, seed: Math.random() * 100 });
          }
          e.fireTimer = 1.7 * rate;
        } else if (pat === 2) {
          const ang = aimAt(0);
          for (let s = -2; s <= 2; s++) {
            for (let r = 0; r < 2; r++) {
              const a = ang + s * 0.14;
              const spd = 280 + r * 70;
              this._spawnEnemyBullet(e.x, e.y + 30, Math.cos(a) * spd, Math.sin(a) * spd, '#facc15', 5.5);
            }
          }
          e.fireTimer = 1.2 * rate;
        } else {
          // Enraged: sweeping storm wall from both wings
          for (const side of [-70, 70]) {
            for (let s = 0; s < 6; s++) {
              const a = Math.PI * 0.5 + (side < 0 ? -1 : 1) * (0.15 + s * 0.12);
              this._spawnEnemyBullet(e.x + side, e.y + 10, Math.cos(a) * 240, Math.sin(a) * 240, def.accent, 5.5);
            }
          }
          e.fireTimer = 1.0 * rate;
        }
      } else {
        if (pat === 0) {
          // Hangar launch: mothership deploys escort scouts
          const n = e.enraged ? 4 : 3;
          for (let k = 0; k < n; k++) {
            const side = k % 2 ? 1 : -1;
            this.enemies.push({
              type: 'scout', x: e.x + side * (50 + k * 14), y: e.y + 20, vx: side * 120, vy: 140,
              hp: 22 * this._difficulty(), maxHp: 22 * this._difficulty(), radius: 18,
              fireTimer: 0.8 + k * 0.2, phase: k, age: 0, hitFlash: 0, scoreVal: 90
            });
          }
          this.shockwaves.push({ x: e.x, y: e.y + 20, r: 10, maxR: 90, color: def.accent, life: 0.35, maxLife: 0.35, width: 4 });
          e.fireTimer = 1.4 * rate;
        } else if (pat === 1) {
          e.streamLeft = e.enraged ? 2.8 : 2.2;
          e.fireTimer = 2.6 * rate;
        } else if (pat === 2) {
          const n = 16;
          for (let ring = 0; ring < 2; ring++) {
            for (let k = 0; k < n; k++) {
              const a = (k / n) * Math.PI * 2 + ring * (Math.PI / n);
              const spd = 170 + ring * 60;
              this._spawnEnemyBullet(e.x, e.y + 10, Math.cos(a) * spd, Math.sin(a) * spd, ring ? def.accent : def.bullet, 6);
            }
          }
          e.fireTimer = 1.3 * rate;
        } else {
          const ang = aimAt(0);
          for (let s = -3; s <= 3; s++) {
            const a = ang + s * 0.09;
            this._spawnEnemyBullet(e.x, e.y + 30, Math.cos(a) * 340, Math.sin(a) * 340, '#f0abfc', 5);
          }
          e.fireTimer = 0.9 * rate;
        }
      }
    }

    _stepHazards(dt, px, py) {
      const hitHalfW = this.rig.mode === 'tabletop' ? this.rig.width * 0.24 : 15;
      for (let i = this.hazards.length - 1; i >= 0; i--) {
        const hz = this.hazards[i];
        if (hz.warn > 0) {
          hz.warn -= dt;
          if (hz.warn <= 0) {
            this._sfx('lightningZap');
            this.screenShake = Math.max(this.screenShake, 7);
            this.lightningFlash = Math.max(this.lightningFlash, 0.25);
          }
          continue;
        }
        hz.active -= dt;
        if (Math.abs(px - hz.x) < hz.halfW + hitHalfW) this._hurtPlayer(18);
        // Lightning also scorches any non-boss enemy caught in the lane
        for (let j = this.enemies.length - 1; j >= 0; j--) {
          const e = this.enemies[j];
          if (!e.isBoss && Math.abs(e.x - hz.x) < hz.halfW + e.radius * 0.5 && Math.abs(e.y - py) < this.height) {
            this._damageEnemy(e, 200 * dt, j);
          }
        }
        if (hz.active <= 0) this.hazards.splice(i, 1);
      }
    }

    _spawnEnemyBullet(x, y, vx, vy, color, r = 5.5) {
      if (this.enemyBullets.length > 700) return;
      const worldVyOffset = this.rig.mode === 'tabletop' ? -this.player.cruiseSpeed : 0;
      this.enemyBullets.push({
        x,
        y,
        vx,
        vy: vy + worldVyOffset,
        color,
        r,
        grazed: false,
        reflected: false,
        life: 5.5
      });
    }

    _stepEnemyBullets(dt, px, py) {
      const coreW = this.rig.mode === 'tabletop' ? this.rig.width * 0.21 : 11;
      const coreL = this.rig.mode === 'tabletop' ? this.rig.length * 0.21 : 13;
      const grazeW = this.rig.mode === 'tabletop' ? this.rig.width * 0.54 : 30;
      const grazeL = this.rig.mode === 'tabletop' ? this.rig.length * 0.54 : 34;

      for (let i = this.enemyBullets.length - 1; i >= 0; i--) {
        const b = this.enemyBullets[i];
        if (this.player.gustTimer > 0 && !b.reflected) {
          b.vy -= 1400 * dt;
          b.reflected = true;
          b.color = '#06b6d4';
        }
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.life -= dt;

        if (b.life <= 0 || Math.abs(b.x - px) > this.width * 1.1 || Math.abs(b.y - py) > this.height * 1.2) {
          this.enemyBullets.splice(i, 1);
          continue;
        }

        if (b.reflected) {
          let hitEnemy = false;
          for (let j = this.enemies.length - 1; j >= 0; j--) {
            const e = this.enemies[j];
            if (Math.hypot(b.x - e.x, b.y - e.y) < e.radius + b.r + 4) {
              this._damageEnemy(e, 24, j);
              this._spawnExplosion(b.x, b.y, '#67e8f9', 4, 90);
              hitEnemy = true;
              break;
            }
          }
          if (hitEnemy) this.enemyBullets.splice(i, 1);
          continue;
        }

        const dx = Math.abs(b.x - px);
        const dy = Math.abs(b.y - py);

        if (dx < coreW + b.r * 0.6 && dy < coreL + b.r * 0.6) {
          this.enemyBullets.splice(i, 1);
          this._hurtPlayer(14);
          continue;
        }

        if (!b.grazed && dx < grazeW + b.r && dy < grazeL + b.r) {
          b.grazed = true;
          this.score += 35;
          this._spawnExplosion(b.x, b.y, '#38bdf8', 2, 60);
        }
      }
    }

    _stepPowerups(dt, px, py) {
      const worldVyOffset = this.rig.mode === 'tabletop' ? -this.player.cruiseSpeed : 0;
      const collectR = (this.rig.mode === 'tabletop' ? Math.max(this.rig.width, this.rig.length) * 0.58 : 34) + 16;
      const p = this.player;

      for (let i = this.powerups.length - 1; i >= 0; i--) {
        const pw = this.powerups[i];
        pw.life -= dt;
        pw.spin += dt * 4;
        const d = Math.hypot(px - pw.x, py - pw.y);
        if (d < (pw.kind === 'medal' ? 150 : 190)) pw.magnet = true;

        if (pw.magnet) {
          const ang = Math.atan2(py - pw.y, px - pw.x);
          pw.x += Math.cos(ang) * 640 * dt;
          pw.y += Math.sin(ang) * 640 * dt;
        } else {
          pw.vy = Math.min(135, pw.vy + 180 * dt);
          pw.vx *= Math.exp(-dt * 1.5);
          pw.x += pw.vx * dt;
          pw.y += (pw.vy + worldVyOffset) * dt;
        }

        if (d < collectR) {
          let text = '';
          let color = '#fef08a';
          if (pw.kind === 'medal') {
            this.score += this.medalValue;
            this._sfx('medal', Math.min(10, Math.round(this.medalValue / 100) - 1));
            text = `★ ${this.medalValue}`;
            color = '#fde047';
            this.medalsCollected++;
            this.medalValue = Math.min(1000, this.medalValue + 100);
          } else {
            this.sfx.powerup();
            if (pw.kind === 'weapon') {
              if (p.weaponLv < 4) {
                p.weaponLv++;
                text = `火力升级 Lv.${p.weaponLv}！`;
              } else {
                this.score += 300;
                text = '满级火力 +300';
              }
            } else if (pw.kind === 'heal') {
              p.hp = Math.min(p.maxHp, p.hp + 30);
              text = '机体修复 +30%';
              color = '#86efac';
            } else if (pw.kind === 'nuke') {
              p.nukes = Math.min(p.maxNukes, p.nukes + 1);
              text = '核弹补给 +1';
              color = '#fed7aa';
            } else if (pw.kind === 'shield') {
              if (p.shield < 2) {
                p.shield++;
                text = p.shield === 2 ? '双层能量护盾！' : '能量护盾展开';
              } else {
                this.score += 400;
                text = '护盾满载 +400';
              }
              color = '#67e8f9';
              this._sfx('shieldUp');
            } else if (pw.kind === 'drone') {
              if (p.droneCount < 4) {
                p.droneCount++;
                text = `浮游僚机 ×${p.droneCount}`;
              } else {
                this.score += 400;
                text = '僚机满编 +400';
              }
              color = '#6ee7b7';
            }
          }
          this.floatingTexts.push({ x: px, y: py - 45, text, color, life: pw.kind === 'medal' ? 0.7 : 1.15, small: pw.kind === 'medal' });
          this.powerups.splice(i, 1);
          if (pw.kind !== 'medal') this.onStateChange(this.getPublicState());
          continue;
        }

        if (pw.life <= 0) {
          // Missing a medal breaks the chain value
          if (pw.kind === 'medal') this.medalValue = 100;
          this.powerups.splice(i, 1);
        }
      }
    }

    _hurtPlayer(amount) {
      const p = this.player;
      if (p.invulnTimer > 0 || this.phase !== 'playing') return;

      if (p.shield > 0) {
        p.shield--;
        p.invulnTimer = 1.0;
        const sx = this._playerWorldX();
        const sy = this._playerWorldY();
        this.screenShake = Math.max(this.screenShake, 8);
        this._sfx('shieldBreak');
        this._rumbleGamepad(0.5, 160);
        this.shockwaves.push({ x: sx, y: sy, r: 30, maxR: 190, color: '#67e8f9', life: 0.45, maxLife: 0.45, width: 7 });
        this._spawnExplosion(sx, sy, '#a5f3fc', 18, 260);
        this.floatingTexts.push({ x: sx, y: sy - 52, text: '能量护盾抵消！', color: '#67e8f9', life: 1.0 });
        this.onTelemetry({ hitVibrate: true });
        this.onStateChange(this.getPublicState());
        return;
      }

      p.invulnTimer = 1.05;
      this.combo = 0;
      this.screenShake = 15;
      this.flashAlpha = 0.35;
      this.sfx.enemyBoom(false);
      this._rumbleGamepad(0.85, 240);

      const px = this._playerWorldX();
      const py = this._playerWorldY();
      this._spawnExplosion(px, py, '#f87171', 14, 210);
      this.shockwaves.push({ x: px, y: py, r: 12, maxR: 130, color: '#f87171', life: 0.35, maxLife: 0.35, width: 5 });

      if (this.rig.godMode) {
        this.floatingTexts.push({ x: px, y: py - 48, text: '亲子护航抵消伤害', color: '#fef08a', life: 0.9 });
        this.onTelemetry({ hitVibrate: true });
        return;
      }

      p.hp = Math.max(0, p.hp - amount);
      if (p.weaponLv > 1 && Math.random() < 0.35) p.weaponLv--;
      this.onTelemetry({ hitVibrate: true });

      if (p.hp <= 0) {
        this.phase = 'gameover';
        this.gameOver = true;
        this.hazards.length = 0;
        this._spawnExplosion(px, py, '#fb923c', 36, 300);
        this._spawnFireball(px, py, 90);
        this._endRun();
      }
      this.onStateChange(this.getPublicState());
    }

    _camDrift(f) {
      return this.rig.mode === 'tabletop' ? -this.player.cruiseSpeed * f : 0;
    }

    // Bright core flash that blooms outward, followed by lingering smoke puffs
    _spawnFireball(x, y, size = 40) {
      if (this.particles.length > 1100) return;
      this.particles.push({ kind: 'flash', x, y, vx: 0, vy: this._camDrift(0.9), r: size * 0.35, grow: size * 2.4, color: '#fff7ed', life: 0.32, maxLife: 0.32 });
      const puffs = Math.min(6, 2 + Math.floor(size / 30));
      size = Math.min(size, 70); // keep smoke from swallowing the screen after huge blasts
      for (let i = 0; i < puffs; i++) {
        const ang = Math.random() * Math.PI * 2;
        const spd = 20 + Math.random() * size * 0.9;
        const life = 0.7 + Math.random() * 0.6;
        this.particles.push({
          kind: 'smoke', x: x + Math.cos(ang) * size * 0.2, y: y + Math.sin(ang) * size * 0.2,
          vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd + this._camDrift(0.85),
          r: size * (0.18 + Math.random() * 0.12), grow: size * 0.55, drag: 2.2,
          color: 'rgba(71, 85, 105, 0.55)', life, maxLife: life
        });
      }
    }

    _spawnDebris(x, y, count, color) {
      for (let i = 0; i < count && this.particles.length < 1200; i++) {
        const ang = Math.random() * Math.PI * 2;
        const spd = 90 + Math.random() * 260;
        const life = 0.6 + Math.random() * 0.6;
        this.particles.push({
          kind: 'debris', x, y, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd + this._camDrift(0.6),
          r: 3 + Math.random() * 6, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 18, drag: 1.4,
          color, life, maxLife: life
        });
      }
    }

    _spawnFirework(x, y, color) {
      this._sfx('medal', 6 + Math.floor(Math.random() * 4));
      this.particles.push({ kind: 'flash', x, y, vx: 0, vy: this._camDrift(1), r: 10, grow: 160, color, life: 0.3, maxLife: 0.3 });
      const n = 34;
      for (let i = 0; i < n && this.particles.length < 1200; i++) {
        const ang = (i / n) * Math.PI * 2 + Math.random() * 0.1;
        const spd = 180 + Math.random() * 120;
        const life = 1.0 + Math.random() * 0.5;
        this.particles.push({
          kind: 'spark', x, y, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd + this._camDrift(1),
          r: 2.6, drag: 1.6, gravity: 90, color, life, maxLife: life
        });
      }
    }

    _spawnExplosion(x, y, color, count = 10, maxSpd = 180) {
      if (this.particles.length > 1200) count = Math.min(count, 3);
      for (let i = 0; i < count; i++) {
        const ang = Math.random() * Math.PI * 2;
        const spd = 25 + Math.random() * maxSpd;
        const life = 0.25 + Math.random() * 0.38;
        this.particles.push({
          x,
          y,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd + (this.rig.mode === 'tabletop' ? -this.player.cruiseSpeed * 0.6 : 0),
          r: 2 + Math.random() * 4.5,
          color,
          life,
          maxLife: life
        });
      }
    }

    _stepParticles(dt) {
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const pt = this.particles[i];
        if (pt.drag) {
          // Drag only acts on the particle's own motion, not the camera drift baked into vy
          const drift = pt.kind === 'spark' ? this._camDrift(1) : (pt.kind === 'smoke' ? this._camDrift(0.85) : this._camDrift(0.6));
          const k = Math.exp(-pt.drag * dt);
          pt.vx *= k;
          pt.vy = drift + (pt.vy - drift) * k;
        }
        if (pt.gravity) pt.vy += pt.gravity * dt;
        if (pt.grow) pt.r += pt.grow * dt;
        if (pt.vr) pt.rot += pt.vr * dt;
        pt.x += pt.vx * dt;
        pt.y += pt.vy * dt;
        pt.life -= dt;
        if (pt.life <= 0) this.particles.splice(i, 1);
      }
      for (let i = this.shockwaves.length - 1; i >= 0; i--) {
        const sw = this.shockwaves[i];
        sw.life -= dt;
        const t = 1 - sw.life / sw.maxLife;
        sw.curR = lerp(sw.r, sw.maxR, 1 - Math.pow(1 - t, 3));
        if (sw.life <= 0) this.shockwaves.splice(i, 1);
      }
      for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
        const ft = this.floatingTexts[i];
        ft.y -= (this.rig.mode === 'tabletop' ? this.player.cruiseSpeed + 55 : 55) * dt;
        ft.life -= dt;
        if (ft.life <= 0) this.floatingTexts.splice(i, 1);
      }
      for (let i = this.windStreaks.length - 1; i >= 0; i--) {
        const ws = this.windStreaks[i];
        ws.oy -= ws.speed * dt;
        ws.life -= dt;
        if (ws.life <= 0) this.windStreaks.splice(i, 1);
      }
    }

    _emitRadarTelemetry(px, py) {
      const blips = [];
      const rangeX = this.width * 0.6;
      const rangeY = this.height * 0.85;
      for (let i = 0; i < this.enemies.length && blips.length < 22; i++) {
        const e = this.enemies[i];
        blips.push({
          nx: clamp((e.x - px) / rangeX, -1, 1),
          ny: clamp((e.y - py) / rangeY, -1, 1),
          b: e.isBoss ? 1 : 0
        });
      }
      const p = this.player;
      const ch = this.getCurrentChapter();
      this.onTelemetry({
        phase: this.phase,
        paused: this.isPaused,
        manualPaused: this.manualPaused,
        setupPaused: this.setupPaused,
        score: Math.floor(this.score),
        distanceKm: Number(this.distanceKm.toFixed(1)),
        wave: this.wave,
        chapterTitle: ch.title,
        hp: Math.ceil(p.hp),
        weaponLv: p.weaponLv,
        nukes: p.nukes,
        gustReady: p.gustCooldown <= 0 ? 1 : Number((1 - p.gustCooldown / p.gustMaxCooldown).toFixed(2)),
        railReady: p.railCooldown <= 0 ? 1 : 0,
        bossHp: this.boss ? Number((this.boss.hp / this.boss.maxHp).toFixed(2)) : 0,
        bossName: this.boss ? this.boss.name : '',
        shield: p.shield,
        droneCount: p.droneCount,
        combo: this.combo,
        loop: this.loopIndex,
        storyCleared: this.storyCleared,
        mode: this.rig.mode,
        pureCamera: this.rig.pureCamera,
        godMode: this.rig.godMode,
        gameOver: this.phase === 'gameover',
        blips
      });
    }

    // ===================== RENDERING =====================

    render() {
      const ctx = this.ctx;
      const W = this.width;
      const H = this.height;
      ctx.save();
      ctx.scale(this.dpr, this.dpr);

      if (this.screenShake > 0.2 && !this.isPaused) {
        const sx = (Math.random() - 0.5) * this.screenShake;
        const sy = (Math.random() - 0.5) * this.screenShake;
        ctx.translate(sx, sy);
      }

      // 1. Chapter Sky Palette ('day' cerulean | 'sunset' golden dusk | 'night' aurora deep sky)
      const skyMode = this.getEffectiveSky();
      const skyGrad = ctx.createLinearGradient(0, 0, 0, H);
      if (skyMode === 'day') {
        skyGrad.addColorStop(0, '#1e88e5');
        skyGrad.addColorStop(0.55, '#38bdf8');
        skyGrad.addColorStop(1, '#7dd3fc');
      } else if (skyMode === 'sunset') {
        skyGrad.addColorStop(0, '#312e81');
        skyGrad.addColorStop(0.48, '#c2410c');
        skyGrad.addColorStop(1, '#fb923c');
      } else {
        skyGrad.addColorStop(0, '#071426');
        skyGrad.addColorStop(0.55, '#0d2847');
        skyGrad.addColorStop(1, '#14385c');
      }
      ctx.fillStyle = skyGrad;
      ctx.fillRect(-30, -30, W + 60, H + 60);
      this._renderSkyAtmosphere(ctx, W, H, skyMode);

      const px = this._playerWorldX();
      const py = this._playerWorldY();
      const anchorX = this.rig.mode === 'tabletop' ? W * 0.5 : this.player.screenX;
      const anchorY = this.rig.mode === 'tabletop' ? H * this.rig.anchorY : this.player.screenY;

      // 2. Camera-Rotated World Space
      ctx.save();
      if (this.rig.mode === 'tabletop') {
        ctx.translate(anchorX, anchorY);
        ctx.rotate(this.player.cameraRoll);
        ctx.translate(-px, -py);
        this._renderParallaxWorld(ctx, px, py, W, H, skyMode);
      } else {
        // Arcade: the plane moves on a fixed screen, so scroll the scenery with the voyage distance instead
        const camX = W * 0.5 + (this.player.screenX - W * 0.5) * 0.18;
        const camY = this.player.worldY;
        ctx.save();
        ctx.translate(W * 0.5 - camX, H * 0.5 - camY);
        this._renderParallaxWorld(ctx, camX, camY, W, H, skyMode);
        ctx.restore();
      }
      if (this.phase !== 'title') {
        this._renderHazards(ctx, py, H);
        this._renderPowerups(ctx);
        this._renderEnemies(ctx, py);
        this._renderBullets(ctx);
        this._renderRailBeam(ctx, px, py, H);
        this._renderParticlesAndWaves(ctx);
      }
      ctx.restore();

      // 3. Player Craft / Tabletop Helipad Layer (visible on Title, Playing, or whenever Calibrating!)
      if (this.phase !== 'gameover' || this.calibDrawerOpen) {
        if (this.rig.mode === 'tabletop') {
          this._renderTabletopRig(ctx, W * 0.5, H * this.rig.anchorY);
        } else {
          this._renderVirtualFighter(ctx, this.player.screenX, this.player.screenY);
        }
      }

      // 4. Foreground Wind Streaks
      this._renderForegroundWind(ctx, W, H);

      // 5. Screen Flash, storm lightning & low-HP vignette
      if (this.flashAlpha > 0.01) {
        ctx.fillStyle = `rgba(255, 250, 235, ${this.flashAlpha.toFixed(3)})`;
        ctx.fillRect(0, 0, W, H);
      }
      if (this.lightningFlash > 0.01) {
        const flicker = this.lightningFlash * (0.55 + 0.45 * Math.abs(Math.sin(this.time * 47)));
        ctx.fillStyle = `rgba(224, 231, 255, ${(flicker * 0.45).toFixed(3)})`;
        ctx.fillRect(0, 0, W, H);
      }
      if (this.phase === 'playing' && this.player.hp <= 30 && !this.rig.godMode) {
        const pulse = 0.28 + 0.18 * Math.sin(this.time * 6);
        const vg = ctx.createRadialGradient(W * 0.5, H * 0.5, Math.min(W, H) * 0.35, W * 0.5, H * 0.5, Math.hypot(W, H) * 0.6);
        vg.addColorStop(0, 'rgba(220, 38, 38, 0)');
        vg.addColorStop(1, `rgba(220, 38, 38, ${pulse.toFixed(3)})`);
        ctx.fillStyle = vg;
        ctx.fillRect(0, 0, W, H);
      }

      // 6. HUD & Cinematic Story Chapter Banner (only when playing & not pureCamera)
      if (!this.rig.pureCamera && this.phase !== 'title') {
        this._renderMinimalHUD(ctx, W, H);
        this._renderBossBar(ctx, W);
        this._renderStoryBanner(ctx, W);
      }

      ctx.restore();
    }

    _renderSkyAtmosphere(ctx, W, H, skyMode) {
      const p = this.player;
      const t = this.time;
      if (skyMode === 'day') {
        const sx = W * 0.84;
        const sy = H * 0.06;
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, Math.max(W, H) * 0.42);
        g.addColorStop(0, 'rgba(255, 251, 235, 0.75)');
        g.addColorStop(0.12, 'rgba(254, 240, 138, 0.32)');
        g.addColorStop(1, 'rgba(254, 240, 138, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      } else if (skyMode === 'sunset') {
        const sx = W * 0.5 - p.bank * 30;
        const sy = H * 0.1;
        const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, Math.max(W, H) * 0.55);
        glow.addColorStop(0, 'rgba(255, 237, 213, 0.85)');
        glow.addColorStop(0.08, 'rgba(253, 186, 116, 0.55)');
        glow.addColorStop(0.35, 'rgba(234, 88, 12, 0.18)');
        glow.addColorStop(1, 'rgba(234, 88, 12, 0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = 'rgba(255, 247, 237, 0.9)';
        ctx.beginPath();
        ctx.arc(sx, sy, Math.min(W, H) * 0.06, 0, Math.PI * 2);
        ctx.fill();
        // Horizontal haze bands across the dusk sky
        ctx.fillStyle = 'rgba(124, 45, 18, 0.16)';
        for (let k = 0; k < 4; k++) {
          const y = H * (0.16 + k * 0.07) + Math.sin(t * 0.3 + k) * 4;
          ctx.fillRect(0, y, W, 6 + k * 3);
        }
      } else {
        if (!this._stars) {
          this._stars = [];
          for (let i = 0; i < 160; i++) {
            this._stars.push({ x: hash2D(i, 7), y: hash2D(i, 19), s: 0.6 + hash2D(i, 31) * 1.8, tw: hash2D(i, 43) * 6.28 });
          }
        }
        const offX = p.worldX * 0.02;
        const offY = p.worldY * 0.015;
        ctx.fillStyle = '#f8fafc';
        for (const st of this._stars) {
          const x = (((st.x * W - offX) % W) + W) % W;
          const y = (((st.y * H - offY) % H) + H) % H;
          ctx.globalAlpha = 0.35 + 0.65 * Math.abs(Math.sin(t * 1.3 + st.tw));
          ctx.fillRect(x, y, st.s, st.s);
        }
        ctx.globalAlpha = 1;
        // Aurora ribbons
        const bands = [
          { c: '52, 211, 153', y: 0.12, a: 0.16, f: 0.0016, sp: 0.35 },
          { c: '167, 139, 250', y: 0.2, a: 0.12, f: 0.0022, sp: -0.28 },
          { c: '34, 211, 238', y: 0.28, a: 0.09, f: 0.0013, sp: 0.22 }
        ];
        for (const b of bands) {
          const baseY = H * b.y;
          const grad = ctx.createLinearGradient(0, baseY - 70, 0, baseY + 70);
          grad.addColorStop(0, `rgba(${b.c}, 0)`);
          grad.addColorStop(0.5, `rgba(${b.c}, ${b.a})`);
          grad.addColorStop(1, `rgba(${b.c}, 0)`);
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.moveTo(0, baseY + 70);
          for (let x = 0; x <= W + 40; x += 40) {
            ctx.lineTo(x, baseY - 40 + Math.sin(x * b.f * 3 + t * b.sp) * 30 + Math.sin(x * b.f + t * b.sp * 1.7) * 18);
          }
          ctx.lineTo(W, baseY + 70);
          ctx.closePath();
          ctx.fill();
        }
      }
    }

    _renderHazards(ctx, py, H) {
      for (const hz of this.hazards) {
        const top = py - H * 1.3;
        const bottom = py + H * 0.6;
        if (hz.warn > 0) {
          const blink = 0.35 + 0.35 * Math.abs(Math.sin(this.time * 18));
          ctx.fillStyle = `rgba(250, 204, 21, ${(blink * 0.22).toFixed(3)})`;
          ctx.fillRect(hz.x - hz.halfW, top, hz.halfW * 2, bottom - top);
          ctx.strokeStyle = `rgba(250, 204, 21, ${(0.4 + blink * 0.5).toFixed(3)})`;
          ctx.lineWidth = 2;
          ctx.setLineDash([12, 10]);
          ctx.beginPath();
          ctx.moveTo(hz.x - hz.halfW, top); ctx.lineTo(hz.x - hz.halfW, bottom);
          ctx.moveTo(hz.x + hz.halfW, top); ctx.lineTo(hz.x + hz.halfW, bottom);
          ctx.stroke();
          ctx.setLineDash([]);
        } else {
          const a = clamp(hz.active / 0.42, 0, 1);
          const glow = ctx.createLinearGradient(hz.x - hz.halfW * 1.6, 0, hz.x + hz.halfW * 1.6, 0);
          glow.addColorStop(0, 'rgba(250, 204, 21, 0)');
          glow.addColorStop(0.5, `rgba(254, 249, 195, ${(0.75 * a).toFixed(3)})`);
          glow.addColorStop(1, 'rgba(250, 204, 21, 0)');
          ctx.fillStyle = glow;
          ctx.fillRect(hz.x - hz.halfW * 1.6, top, hz.halfW * 3.2, bottom - top);
          // Jagged bolt core
          ctx.strokeStyle = `rgba(255, 255, 255, ${a.toFixed(3)})`;
          ctx.lineWidth = 3.5;
          ctx.beginPath();
          let y = top;
          ctx.moveTo(hz.x, y);
          let k = 0;
          while (y < bottom) {
            y += 36;
            k++;
            ctx.lineTo(hz.x + (hash2D(k, Math.floor(this.time * 30 + hz.seed)) - 0.5) * hz.halfW * 1.4, y);
          }
          ctx.stroke();
        }
      }
    }

    _renderParallaxWorld(ctx, camX, camY, W, H, skyMode) {
      const pad = Math.hypot(W, H) * 0.72;
      const p0 = 0.38;
      const cell = 220;
      const effX0 = camX * (1 - p0);
      const effY0 = camY * (1 - p0);

      const startGX = Math.floor((camX - pad - effX0) / cell);
      const endGX = Math.ceil((camX + pad - effX0) / cell);
      const startGY = Math.floor((camY - pad - effY0) / cell);
      const endGY = Math.ceil((camY + pad - effY0) / cell);

      ctx.strokeStyle = skyMode === 'day'
        ? 'rgba(255, 255, 255, 0.16)'
        : (skyMode === 'sunset' ? 'rgba(254, 215, 170, 0.14)' : 'rgba(56, 189, 248, 0.08)');
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let gx = startGX; gx <= endGX; gx++) {
        const wx = gx * cell + effX0;
        ctx.moveTo(wx, camY - pad);
        ctx.lineTo(wx, camY + pad);
      }
      for (let gy = startGY; gy <= endGY; gy++) {
        const wy = gy * cell + effY0;
        ctx.moveTo(camX - pad, wy);
        ctx.lineTo(camX + pad, wy);
      }
      ctx.stroke();

      // Procedural islands
      for (let gx = startGX; gx <= endGX; gx++) {
        for (let gy = startGY; gy <= endGY; gy++) {
          const h = hash2D(gx, gy);
          if (h > 0.68) {
            const wx = (gx + 0.25 + (h * 13 % 0.5)) * cell + effX0;
            const wy = (gy + 0.25 + (h * 29 % 0.5)) * cell + effY0;
            const r = 24 + (h - 0.68) * 150;
            ctx.fillStyle = skyMode === 'day'
              ? 'rgba(254, 243, 199, 0.45)'
              : (skyMode === 'sunset' ? 'rgba(124, 45, 18, 0.42)' : 'rgba(20, 83, 116, 0.36)');
            ctx.beginPath();
            ctx.ellipse(wx, wy, r * 1.15, r * 0.78, h * Math.PI, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = skyMode === 'day'
              ? 'rgba(16, 185, 129, 0.48)'
              : (skyMode === 'sunset' ? 'rgba(180, 83, 9, 0.38)' : 'rgba(45, 118, 125, 0.28)');
            ctx.beginPath();
            ctx.ellipse(wx - r * 0.12, wy - r * 0.08, r * 0.72, r * 0.48, h * Math.PI, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      const c1 = skyMode === 'day'
        ? 'rgba(255, 255, 255, 0.42)'
        : (skyMode === 'sunset' ? 'rgba(254, 215, 170, 0.26)' : 'rgba(186, 230, 253, 0.11)');
      const c2 = skyMode === 'day'
        ? 'rgba(255, 255, 255, 0.62)'
        : (skyMode === 'sunset' ? 'rgba(255, 237, 213, 0.38)' : 'rgba(224, 242, 254, 0.15)');

      this._renderCloudLayer(ctx, camX, camY, pad, 0.78, 300, c1, 71);
      this._renderCloudLayer(ctx, camX, camY, pad, 1.28, 260, c2, 193);

      // Airflow speed lines
      const boostRatio = clamp((this.player.cruiseSpeed - 280) / 300, 0, 1);
      const streakCell = 170;
      const effXs = camX * (1 - 1.45);
      const effYs = camY * (1 - 1.45);
      const sX0 = Math.floor((camX - pad - effXs) / streakCell);
      const sX1 = Math.ceil((camX + pad - effXs) / streakCell);
      const sY0 = Math.floor((camY - pad - effYs) / streakCell);
      const sY1 = Math.ceil((camY + pad - effYs) / streakCell);

      ctx.strokeStyle = skyMode === 'day'
        ? `rgba(255, 255, 255, ${(0.25 + boostRatio * 0.42).toFixed(3)})`
        : `rgba(254, 243, 199, ${(0.12 + boostRatio * 0.24).toFixed(3)})`;
      ctx.lineWidth = 1.4 + boostRatio;
      ctx.beginPath();
      for (let gx = sX0; gx <= sX1; gx++) {
        for (let gy = sY0; gy <= sY1; gy++) {
          const h = hash2D(gx + 503, gy - 811);
          if (h > 0.55) {
            const wx = (gx + (h * 17 % 1)) * streakCell + effXs;
            const wy = (gy + (h * 31 % 1)) * streakCell + effYs;
            const len = 24 + boostRatio * 68;
            ctx.moveTo(wx, wy);
            ctx.lineTo(wx, wy + len);
          }
        }
      }
      ctx.stroke();
    }

    _renderCloudLayer(ctx, camX, camY, pad, factor, cell, fillStyle, seedOffset) {
      const effX = camX * (1 - factor);
      const effY = camY * (1 - factor);
      const x0 = Math.floor((camX - pad - effX) / cell);
      const x1 = Math.ceil((camX + pad - effX) / cell);
      const y0 = Math.floor((camY - pad - effY) / cell);
      const y1 = Math.ceil((camY + pad - effY) / cell);

      ctx.fillStyle = fillStyle;
      for (let gx = x0; gx <= x1; gx++) {
        for (let gy = y0; gy <= y1; gy++) {
          const h = hash2D(gx + seedOffset, gy - seedOffset);
          if (h > 0.6) {
            const wx = (gx + (h * 19 % 0.8)) * cell + effX;
            const wy = (gy + (h * 43 % 0.8)) * cell + effY;
            const r = 34 + (h - 0.6) * 145;
            ctx.beginPath();
            ctx.arc(wx, wy, r, 0, Math.PI * 2);
            ctx.arc(wx + r * 0.68, wy + r * 0.16, r * 0.76, 0, Math.PI * 2);
            ctx.arc(wx - r * 0.62, wy + r * 0.22, r * 0.68, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }

    _traceRigShapePath(ctx, w, l, shape) {
      const hw = w * 0.5;
      const hl = l * 0.5;
      ctx.beginPath();
      if (shape === 'car') {
        const r = Math.min(hw * 0.45, 18);
        if (ctx.roundRect) ctx.roundRect(-hw, -hl, w, l, r);
        else ctx.rect(-hw, -hl, w, l);
      } else if (shape === 'orb') {
        ctx.ellipse(0, 0, hw, hl, 0, 0, Math.PI * 2);
      } else {
        ctx.moveTo(0, -hl);
        ctx.lineTo(hw * 0.34, -hl * 0.25);
        ctx.lineTo(hw, hl * 0.35);
        ctx.lineTo(hw * 0.42, hl * 0.68);
        ctx.lineTo(hw * 0.28, hl);
        ctx.lineTo(-hw * 0.28, hl);
        ctx.lineTo(-hw * 0.42, hl * 0.68);
        ctx.lineTo(-hw, hl * 0.35);
        ctx.lineTo(-hw * 0.34, -hl * 0.25);
        ctx.closePath();
      }
    }

    _renderTabletopRig(ctx, cx, cy) {
      const p = this.player;
      const rw = this.rig.width;
      const rl = this.rig.length;
      const charge = Math.max(this.remoteInput.railCharge, this.localRailCharge);
      const boost = clamp((p.cruiseSpeed - 260) / 320, 0, 1);
      const onTitle = this.phase === 'title';

      ctx.save();
      ctx.translate(cx, cy);

      // 1. Dynamic Offset Cast Shadow
      const shOffX = -p.bank * 24 + 8;
      const shOffY = (onTitle ? 10 : 16) + boost * 10;
      ctx.save();
      ctx.translate(shOffX, shOffY);
      ctx.scale(1.04 - Math.abs(p.bank) * 0.08, 1.04);
      this._traceRigShapePath(ctx, rw, rl, this.rig.shape);
      ctx.fillStyle = 'rgba(2, 10, 24, 0.46)';
      ctx.shadowColor = 'rgba(2, 10, 24, 0.65)';
      ctx.shadowBlur = 22;
      ctx.fill();
      ctx.restore();

      // 2. Twin Mach Afterburner Plumes (gentle idle flame on Title, roaring plume in flight!)
      const tailY = rl * 0.5 + 2;
      const swayX = -p.bank * 18;
      const baseFlame = onTitle ? 20 : (36 + boost * 56);
      const flameLen = baseFlame * (0.88 + Math.sin(this.time * 42) * 0.12);
      const engineOffsets = this.rig.shape === 'jet' && rw < 56 ? [0] : [-rw * 0.24, rw * 0.24];

      for (const ex of engineOffsets) {
        const grad = ctx.createLinearGradient(ex, tailY, ex + swayX, tailY + flameLen);
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(0.28, '#fde047');
        grad.addColorStop(0.68, 'rgba(234, 88, 12, 0.85)');
        grad.addColorStop(1, 'rgba(234, 88, 12, 0)');

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(ex - 7, tailY);
        ctx.quadraticCurveTo(ex + swayX * 0.45, tailY + flameLen * 0.55, ex + swayX, tailY + flameLen);
        ctx.quadraticCurveTo(ex + swayX * 0.45, tailY + flameLen * 0.55, ex + 7, tailY);
        ctx.fill();
      }

      // 3. Muzzle Flash & Railgun Charge Sphere
      const noseY = -rl * 0.5 - 8;
      if (!onTitle && charge > 0.05) {
        const r = 8 + charge * 22;
        ctx.strokeStyle = `rgba(239, 68, 68, ${(0.3 + charge * 0.55).toFixed(2)})`;
        ctx.setLineDash([8, 8]);
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(0, noseY);
        ctx.lineTo(0, -this.height);
        ctx.stroke();
        ctx.setLineDash([]);

        const cg = ctx.createRadialGradient(0, noseY - 6, 2, 0, noseY - 6, r * 1.5);
        cg.addColorStop(0, '#ffffff');
        cg.addColorStop(0.45, '#67e8f9');
        cg.addColorStop(1, 'rgba(56, 189, 248, 0)');
        ctx.fillStyle = cg;
        ctx.beginPath();
        ctx.arc(0, noseY - 6, r * 1.5, 0, Math.PI * 2);
        ctx.fill();
      } else if (!onTitle && p.fireCooldown > 0.065) {
        ctx.fillStyle = 'rgba(254, 240, 138, 0.92)';
        ctx.beginPath();
        ctx.arc(-rw * 0.2, noseY, 5.5, 0, Math.PI * 2);
        ctx.arc(rw * 0.2, noseY, 5.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // 4. Perimeter Shield & Golden Tabletop Helipad Caliper
      const showCaliper = (onTitle || this.calibHighlightTimer > 0 || this.calibDrawerOpen) && !this.rig.pureCamera;
      const shieldAlpha = p.invulnTimer > 0
        ? 0.5 + Math.sin(this.time * 28) * 0.25
        : (showCaliper ? 0.85 : 0.28);

      this._traceRigShapePath(ctx, rw + 8, rl + 8, this.rig.shape);
      ctx.strokeStyle = p.rollTimer > 0
        ? 'rgba(255, 255, 255, 0.95)'
        : `rgba(255, 255, 255, ${shieldAlpha.toFixed(2)})`;
      ctx.lineWidth = p.rollTimer > 0 ? 4 : 2;
      ctx.stroke();

      if (showCaliper) {
        const pulse = 0.82 + Math.sin(this.time * 4) * 0.15;
        const a = (onTitle || this.calibDrawerOpen) ? pulse : clamp(this.calibHighlightTimer / 1.5, 0, 0.95);
        const hw = rw * 0.5 + 12;
        const hl = rl * 0.5 + 12;
        const corner = 14;

        // Live CAD Ruler & Ghost Toy Silhouette when actively calibrating!
        if (this.calibDrawerOpen) {
          ctx.save();
          // 4a. Anchor Y horizontal reference line across battlefield
          ctx.strokeStyle = 'rgba(251, 191, 36, 0.45)';
          ctx.lineWidth = 1.4;
          ctx.setLineDash([6, 6]);
          ctx.beginPath();
          ctx.moveTo(-this.width * 0.46, 0);
          ctx.lineTo(this.width * 0.46, 0);
          ctx.stroke();
          ctx.setLineDash([]);

          // 4b. Translucent ghost toy silhouette + forward nose arrow inside exact rw x rl box
          this._traceRigShapePath(ctx, rw, rl, this.rig.shape);
          ctx.fillStyle = 'rgba(14, 165, 233, 0.24)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(253, 224, 71, 0.95)';
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 4]);
          ctx.stroke();
          ctx.setLineDash([]);

          // Nose direction indicator inside ghost silhouette
          ctx.fillStyle = 'rgba(254, 240, 138, 0.9)';
          ctx.beginPath();
          ctx.moveTo(0, -rl * 0.34);
          ctx.lineTo(8, -rl * 0.14);
          ctx.lineTo(-8, -rl * 0.14);
          ctx.closePath();
          ctx.fill();

          // 4c. Exact Width Dimension Line (Top)
          const dimTopY = -hl - 14;
          ctx.strokeStyle = '#fde047';
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          ctx.moveTo(-rw * 0.5, dimTopY - 6); ctx.lineTo(-rw * 0.5, dimTopY + 6);
          ctx.moveTo(rw * 0.5, dimTopY - 6); ctx.lineTo(rw * 0.5, dimTopY + 6);
          ctx.moveTo(-rw * 0.5, dimTopY); ctx.lineTo(rw * 0.5, dimTopY);
          ctx.stroke();

          // 4d. Exact Length Dimension Line (Right)
          const dimRightX = hw + 44;
          ctx.beginPath();
          ctx.moveTo(dimRightX - 6, -rl * 0.5); ctx.lineTo(dimRightX + 6, -rl * 0.5);
          ctx.moveTo(dimRightX - 6, rl * 0.5); ctx.lineTo(dimRightX + 6, rl * 0.5);
          ctx.moveTo(dimRightX, -rl * 0.5); ctx.lineTo(dimRightX, rl * 0.5);
          ctx.stroke();

          // Helper for crisp dark badge pills
          const drawDimPill = (px, py, label) => {
            ctx.font = '700 12px ui-monospace, SFMono-Regular, Menlo, system-ui, sans-serif';
            const w = ctx.measureText(label).width + 14;
            ctx.fillStyle = 'rgba(7, 20, 38, 0.88)';
            if (ctx.roundRect) {
              ctx.beginPath();
              ctx.roundRect(px - w * 0.5, py - 11, w, 22, 6);
              ctx.fill();
            } else {
              ctx.fillRect(px - w * 0.5, py - 11, w, 22);
            }
            ctx.strokeStyle = 'rgba(251, 191, 36, 0.65)';
            ctx.lineWidth = 1;
            ctx.strokeRect(px - w * 0.5, py - 11, w, 22);
            ctx.fillStyle = '#fde047';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, px, py);
          };

          drawDimPill(0, dimTopY - 18, `宽 ${Math.round(rw)} px`);
          drawDimPill(dimRightX + 46, 0, `长 ${Math.round(rl)} px`);
          drawDimPill(dimRightX + 52, 28, `锚点 ${Math.round(this.rig.anchorY * 100)}%`);
          ctx.restore();
        }

        ctx.strokeStyle = `rgba(251, 191, 36, ${a.toFixed(2)})`;
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.moveTo(-hw, -hl + corner); ctx.lineTo(-hw, -hl); ctx.lineTo(-hw + corner, -hl);
        ctx.moveTo(hw - corner, -hl); ctx.lineTo(hw, -hl); ctx.lineTo(hw, -hl + corner);
        ctx.moveTo(-hw, hl - corner); ctx.lineTo(-hw, hl); ctx.lineTo(-hw + corner, hl);
        ctx.moveTo(hw - corner, hl); ctx.lineTo(hw, hl); ctx.lineTo(hw, hl - corner);
        ctx.stroke();

        // Subtle label pill when not covered by CAD top ruler
        if (!this.calibDrawerOpen) {
          const tip = onTitle ? '▲ 桌面停机坪 · 把小车/纸飞机/橡皮放进框内' : '▲ 机头朝前 · 实物校准框';
          ctx.font = '700 12px system-ui, -apple-system, sans-serif';
          const tw = ctx.measureText(tip).width + 18;
          ctx.fillStyle = `rgba(7, 20, 38, ${(a * 0.68).toFixed(2)})`;
          if (ctx.roundRect) {
            ctx.beginPath();
            ctx.roundRect(-tw * 0.5, -hl - 30, tw, 22, 999);
            ctx.fill();
          } else {
            ctx.fillRect(-tw * 0.5, -hl - 30, tw, 22);
          }
          ctx.fillStyle = `rgba(253, 224, 71, ${a.toFixed(2)})`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'alphabetic';
          ctx.fillText(tip, 0, -hl - 15);
        }
      }

      // 5. Flanking Autonomous Bit-Drones
      this._drawDroneFormation(ctx);
      this._drawShieldBubble(ctx, Math.max(rw, rl) * 0.5 + 26);

      ctx.restore();
    }

    _renderVirtualFighter(ctx, sx, sy) {
      const p = this.player;
      const bankScale = 1 - Math.abs(p.bank) * 0.28;
      ctx.save();
      ctx.translate(sx, sy);

      // Shadow beneath virtual fighter too
      ctx.fillStyle = 'rgba(2, 10, 24, 0.3)';
      ctx.beginPath();
      ctx.ellipse(-p.bank * 14 + 6, 18, 24 * bankScale, 16, 0, 0, Math.PI * 2);
      ctx.fill();

      if (p.invulnTimer > 0 && this.phase === 'playing') {
        ctx.strokeStyle = `rgba(255, 255, 255, ${(0.45 + Math.sin(this.time * 25) * 0.25).toFixed(2)})`;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(0, 0, 34, 0, Math.PI * 2);
        ctx.stroke();
      }

      const fLen = 24 + Math.sin(this.time * 45) * 5;
      for (const ex of [-9, 9]) {
        const g = ctx.createLinearGradient(ex, 20, ex, 20 + fLen);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.4, '#fde047');
        g.addColorStop(1, 'rgba(234, 88, 12, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(ex - 4, 18);
        ctx.lineTo(ex, 20 + fLen);
        ctx.lineTo(ex + 4, 18);
        ctx.fill();
      }

      ctx.save();
      ctx.scale(bankScale, 1);
      ctx.rotate(p.bank * 0.14);

      ctx.fillStyle = '#f8fafc';
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, -30);
      ctx.lineTo(32, 12);
      ctx.lineTo(26, 20);
      ctx.lineTo(10, 14);
      ctx.lineTo(8, 24);
      ctx.lineTo(-8, 24);
      ctx.lineTo(-10, 14);
      ctx.lineTo(-26, 20);
      ctx.lineTo(-32, 12);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#ea580c';
      ctx.beginPath();
      ctx.moveTo(-24, 12); ctx.lineTo(-11, -3); ctx.lineTo(-11, 6); ctx.lineTo(-21, 16); ctx.closePath();
      ctx.moveTo(24, 12); ctx.lineTo(11, -3); ctx.lineTo(11, 6); ctx.lineTo(21, 16); ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#0284c7';
      ctx.beginPath();
      ctx.ellipse(0, -6, 4.5, 11, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      this._drawDroneFormation(ctx);
      this._drawShieldBubble(ctx, 46);

      const charge = Math.max(this.remoteInput.railCharge, this.localRailCharge);
      if (this.phase === 'playing' && charge > 0.05) {
        ctx.fillStyle = '#67e8f9';
        ctx.beginPath();
        ctx.arc(0, -34, 6 + charge * 14, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }

    _drawDroneFormation(ctx) {
      const p = this.player;
      this._droneSlots().forEach((slot, k) => {
        const dir = slot.x < 0 ? -1 : 1;
        const dx = slot.x - p.bank * 10;
        const dy = slot.y + Math.sin(this.time * 5 + k) * 4 + dir * p.bank * 8;
        this._drawBitDrone(ctx, dx, dy);
      });
    }

    _drawShieldBubble(ctx, r) {
      const p = this.player;
      if (p.shield <= 0 || this.phase === 'title') return;
      const wob = Math.sin(this.time * 3) * 2;
      const g = ctx.createRadialGradient(0, 0, r * 0.6, 0, 0, r + wob);
      g.addColorStop(0, 'rgba(103, 232, 249, 0)');
      g.addColorStop(0.85, `rgba(103, 232, 249, ${p.shield > 1 ? 0.22 : 0.14})`);
      g.addColorStop(1, 'rgba(165, 243, 252, 0.5)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, r + wob, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(165, 243, 252, 0.75)';
      ctx.lineWidth = p.shield > 1 ? 2.6 : 1.6;
      ctx.setLineDash([18, 10]);
      ctx.lineDashOffset = -this.time * 40;
      ctx.beginPath();
      ctx.arc(0, 0, r + wob, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
    }

    _drawBitDrone(ctx, x, y) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(this.time * 2.6);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
      ctx.strokeStyle = '#34d399';
      ctx.lineWidth = 2;
      ctx.fillRect(-7, -7, 14, 14);
      ctx.strokeRect(-7, -7, 14, 14);
      ctx.fillStyle = '#ecfdf5';
      ctx.beginPath();
      ctx.arc(0, 0, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    _renderEnemies(ctx, py) {
      const poly = (pts) => {
        ctx.beginPath();
        ctx.moveTo(pts[0], pts[1]);
        for (let k = 2; k < pts.length; k += 2) ctx.lineTo(pts[k], pts[k + 1]);
        ctx.closePath();
      };
      const engineGlow = (x, y, r, color) => {
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.35, color);
        g.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      };

      for (const e of this.enemies) {
        ctx.save();
        ctx.translate(e.x, e.y);
        const flash = e.hitFlash > 0;
        const flick = 0.8 + Math.sin(this.time * 40 + e.phase) * 0.2;

        if (e.type === 'lancer' && e.chargeWarn > 0) {
          ctx.strokeStyle = `rgba(220, 38, 38, ${(0.45 + Math.sin(this.time * 35) * 0.25).toFixed(2)})`;
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 6]);
          ctx.beginPath();
          ctx.moveTo(0, 18);
          ctx.lineTo(0, py - e.y + 120);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        if (e.isBoss) {
          this._renderBoss(ctx, e, flash, engineGlow, poly);
        } else if (e.type === 'gunship') {
          engineGlow(-14, -26, 12 * flick, '#fb923c');
          engineGlow(14, -26, 12 * flick, '#fb923c');
          ctx.fillStyle = flash ? '#ffffff' : '#334155';
          ctx.strokeStyle = '#fb923c';
          ctx.lineWidth = 2.2;
          poly([0, 30, 30, -4, 36, -18, 16, -26, -16, -26, -36, -18, -30, -4]);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = flash ? '#ffffff' : '#1e293b';
          poly([0, 18, 12, -8, -12, -8]);
          ctx.fill();
          ctx.fillStyle = '#fdba74';
          ctx.beginPath();
          ctx.arc(0, 2, 5 + Math.sin(this.time * 6) * 1.2, 0, Math.PI * 2);
          ctx.fill();
        } else if (e.type === 'lancer') {
          if (e.dashed) engineGlow(0, -16, 18 * flick, '#f87171');
          ctx.fillStyle = flash ? '#ffffff' : '#991b1b';
          ctx.strokeStyle = '#fecaca';
          ctx.lineWidth = 2;
          poly([0, 26, 16, -18, 0, -10, -16, -18]);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#fecaca';
          poly([0, 18, 4, 0, -4, 0]);
          ctx.fill();
        } else if (e.type === 'weaver') {
          ctx.rotate(Math.sin(e.age * 3.2 + e.phase) * 0.35);
          ctx.fillStyle = flash ? '#ffffff' : '#0e7490';
          ctx.strokeStyle = '#a5f3fc';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.ellipse(0, 0, 20, 11, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.strokeStyle = `rgba(165, 243, 252, ${(0.5 + Math.sin(this.time * 9 + e.phase) * 0.3).toFixed(2)})`;
          ctx.beginPath();
          ctx.ellipse(0, 0, 27, 7, 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = '#ecfeff';
          ctx.beginPath();
          ctx.arc(0, -2, 5, 0, Math.PI * 2);
          ctx.fill();
        } else if (e.type === 'bomber') {
          for (const ex of [-26, -10, 10, 26]) engineGlow(ex, -22, 10 * flick, '#f59e0b');
          ctx.fillStyle = flash ? '#ffffff' : '#44403c';
          ctx.strokeStyle = '#fbbf24';
          ctx.lineWidth = 2.4;
          poly([0, 34, 20, 12, 52, 2, 46, -14, 16, -20, -16, -20, -46, -14, -52, 2, -20, 12]);
          ctx.fill();
          ctx.stroke();
          ctx.strokeStyle = 'rgba(251, 191, 36, 0.7)';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(-38, -6); ctx.lineTo(-18, -6);
          ctx.moveTo(18, -6); ctx.lineTo(38, -6);
          ctx.stroke();
          ctx.fillStyle = '#fde68a';
          ctx.beginPath();
          ctx.arc(0, 8, 6, 0, Math.PI * 2);
          ctx.fill();
        } else if (e.type === 'sentinel') {
          ctx.save();
          ctx.rotate(e.spin || 0);
          ctx.fillStyle = flash ? '#ffffff' : '#2e1065';
          ctx.strokeStyle = '#c4b5fd';
          ctx.lineWidth = 2.4;
          ctx.beginPath();
          for (let k = 0; k < 6; k++) {
            const a = (k / 6) * Math.PI * 2;
            const r = k % 2 ? 26 : 36;
            if (k === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
            else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
          }
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.restore();
          engineGlow(0, 0, 18 * flick, '#c084fc');
        } else if (e.type === 'mine') {
          const armed = e.armTimer >= 0;
          const bob = Math.sin(e.phase * 0.9) * 3;
          ctx.translate(0, bob);
          if (armed) {
            ctx.strokeStyle = `rgba(251, 113, 133, ${(0.35 + Math.abs(Math.sin(this.time * 24)) * 0.5).toFixed(2)})`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(0, 0, 22 + (0.7 - e.armTimer) * 30, 0, Math.PI * 2);
            ctx.stroke();
          }
          ctx.strokeStyle = '#94a3b8';
          ctx.lineWidth = 3;
          ctx.beginPath();
          for (let k = 0; k < 8; k++) {
            const a = (k / 8) * Math.PI * 2 + e.phase * 0.2;
            ctx.moveTo(Math.cos(a) * 10, Math.sin(a) * 10);
            ctx.lineTo(Math.cos(a) * 18, Math.sin(a) * 18);
          }
          ctx.stroke();
          ctx.fillStyle = flash ? '#ffffff' : '#1f2937';
          ctx.beginPath();
          ctx.arc(0, 0, 12, 0, Math.PI * 2);
          ctx.fill();
          const blinkOn = armed ? Math.sin(this.time * 30) > 0 : Math.sin(this.time * 5 + e.phase) > 0.3;
          ctx.fillStyle = blinkOn ? '#f43f5e' : '#7f1d1d';
          ctx.beginPath();
          ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
          ctx.fill();
        } else {
          engineGlow(0, -8, 9 * flick, '#38bdf8');
          ctx.fillStyle = flash ? '#ffffff' : '#0f172a';
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 2;
          poly([0, 18, 18, -10, 0, -4, -18, -10]);
          ctx.fill();
          ctx.stroke();
        }

        // Compact HP bar for armoured targets once damaged
        if (!e.isBoss && e.maxHp > 90 && e.hp < e.maxHp) {
          const bw = e.radius * 1.6;
          ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
          ctx.fillRect(-bw * 0.5, -e.radius - 14, bw, 4);
          ctx.fillStyle = '#f87171';
          ctx.fillRect(-bw * 0.5, -e.radius - 14, bw * clamp(e.hp / e.maxHp, 0, 1), 4);
        }
        ctx.restore();
      }
    }

    _renderBoss(ctx, e, flash, engineGlow, poly) {
      const def = BOSS_DEFS[e.bossKind] || BOSS_DEFS.fog;
      const t = this.time;
      const hull = def.hull;
      const hitTint = () => {
        if (!flash) return;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.38)';
        ctx.fill();
      };
      const pulse = 0.8 + Math.sin(t * 8) * 0.2;

      if (e.enraged) {
        const rg = ctx.createRadialGradient(0, 0, 40, 0, 0, 130);
        rg.addColorStop(0, `rgba(239, 68, 68, ${(0.28 * pulse).toFixed(3)})`);
        rg.addColorStop(1, 'rgba(239, 68, 68, 0)');
        ctx.fillStyle = rg;
        ctx.beginPath();
        ctx.arc(0, 0, 130, 0, Math.PI * 2);
        ctx.fill();
      }

      if (e.bossKind === 'fog') {
        // Fog vents trailing grey vapour around a hexagonal fortress
        ctx.fillStyle = 'rgba(203, 213, 225, 0.22)';
        for (let k = 0; k < 6; k++) {
          const a = t * 0.6 + k;
          ctx.beginPath();
          ctx.arc(Math.cos(a) * 70, Math.sin(a) * 26 - 10, 24 + Math.sin(t * 2 + k) * 6, 0, Math.PI * 2);
          ctx.fill();
        }
        for (const ex of [-40, 40]) engineGlow(ex, -46, 20 * pulse, '#cbd5e1');
        ctx.fillStyle = hull;
        ctx.strokeStyle = def.trim;
        ctx.lineWidth = 3;
        poly([0, 56, 52, 36, 80, 4, 66, -40, 24, -52, -24, -52, -66, -40, -80, 4, -52, 36]);
        ctx.fill();
        hitTint();
        ctx.stroke();
        ctx.fillStyle = '#475569';
        for (const tx of [-48, 48]) {
          ctx.beginPath();
          ctx.arc(tx, 6, 12, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = def.accent;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      } else if (e.bossKind === 'storm') {
        for (const ex of [-56, -20, 20, 56]) engineGlow(ex, -44, 16 * pulse, '#fb923c');
        ctx.fillStyle = hull;
        ctx.strokeStyle = def.trim;
        ctx.lineWidth = 3;
        poly([0, 62, 30, 24, 96, 10, 84, -16, 40, -24, 30, -48, -30, -48, -40, -24, -84, -16, -96, 10, -30, 24]);
        ctx.fill();
        hitTint();
        ctx.stroke();
        // Crackling arcs between the wingtips
        ctx.strokeStyle = `rgba(253, 230, 138, ${(0.45 + Math.random() * 0.5).toFixed(2)})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-92, 8);
        for (let k = 1; k <= 8; k++) ctx.lineTo(-92 + k * 23, 8 + (Math.random() - 0.5) * 22);
        ctx.stroke();
      } else {
        // Mothership: wide crescent disc with a rotating ring of hangar lights
        for (const ex of [-60, 0, 60]) engineGlow(ex, -40, 18 * pulse, '#a78bfa');
        ctx.fillStyle = hull;
        ctx.strokeStyle = def.trim;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(0, 0, 100, 48, 0, 0, Math.PI * 2);
        ctx.fill();
        hitTint();
        ctx.stroke();
        ctx.fillStyle = '#1e1b4b';
        ctx.beginPath();
        ctx.ellipse(0, 6, 64, 28, 0, 0, Math.PI * 2);
        ctx.fill();
        for (let k = 0; k < 12; k++) {
          const a = t * 0.9 + (k / 12) * Math.PI * 2;
          ctx.fillStyle = k % 3 === 0 ? def.accent : 'rgba(196, 181, 253, 0.8)';
          ctx.beginPath();
          ctx.arc(Math.cos(a) * 84, Math.sin(a) * 38, 3.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Reactor core
      const coreR = 18 + Math.sin(t * 8) * 2;
      engineGlow(0, 4, coreR * 2, e.enraged ? '#ef4444' : def.core);
      ctx.fillStyle = e.enraged ? '#fecaca' : '#ffffff';
      ctx.beginPath();
      ctx.arc(0, 4, coreR * 0.45, 0, Math.PI * 2);
      ctx.fill();
    }

    _renderBullets(ctx) {
      for (const b of this.bullets) {
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = b.color;
        ctx.fillRect(b.x - b.w * 1.2, b.y - b.h * 0.6, b.w * 2.4, b.h * 1.2);
        ctx.globalAlpha = 1;
        ctx.fillRect(b.x - b.w * 0.5, b.y - b.h * 0.5, b.w, b.h);
        ctx.fillStyle = '#f0f9ff';
        ctx.fillRect(b.x - b.w * 0.18, b.y - b.h * 0.42, b.w * 0.36, b.h * 0.7);
      }

      for (const eb of this.enemyBullets) {
        ctx.globalAlpha = 0.28;
        ctx.fillStyle = eb.color;
        ctx.beginPath();
        ctx.arc(eb.x, eb.y, eb.r * 1.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(eb.x, eb.y, eb.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(eb.x, eb.y, eb.r * 0.45, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    _renderPowerups(ctx) {
      const STYLE = {
        weapon: ['#38bdf8', 'P'],
        heal: ['#4ade80', '+'],
        nuke: ['#fb923c', 'N'],
        shield: ['#67e8f9', 'S'],
        drone: ['#6ee7b7', 'D']
      };
      for (const pw of this.powerups) {
        ctx.save();
        ctx.translate(pw.x, pw.y);
        const blinkOut = pw.life < 2 && Math.sin(this.time * 22) > 0;
        if (blinkOut) ctx.globalAlpha = 0.4;

        if (pw.kind === 'medal') {
          ctx.scale(Math.max(0.2, Math.abs(Math.cos(pw.spin))), 1);
          ctx.fillStyle = '#facc15';
          ctx.strokeStyle = '#a16207';
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          for (let k = 0; k < 10; k++) {
            const a = -Math.PI / 2 + (k / 10) * Math.PI * 2;
            const r = k % 2 ? 5 : 11;
            if (k === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
            else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
          }
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.restore();
          continue;
        }

        const [color, label] = STYLE[pw.kind] || STYLE.weapon;
        const ring = 18 + Math.sin(this.time * 6 + pw.spin) * 3;
        ctx.strokeStyle = color;
        ctx.globalAlpha *= 0.45;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, ring, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = blinkOut ? 0.4 : 1;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
          if (k === 0) ctx.moveTo(Math.cos(a) * 15, Math.sin(a) * 15);
          else ctx.lineTo(Math.cos(a) * 15, Math.sin(a) * 15);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.font = '800 13px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, 0, 1);
        ctx.restore();
      }
    }

    _renderRailBeam(ctx, px, py, H) {
      const p = this.player;
      if (p.railBeamTimer <= 0) return;

      const muzzleY = py + this._muzzleOffsetY();
      const topY = py - H * 1.2;
      const halfW = (16 + p.railBeamPower * 28) * Math.min(1, p.railBeamTimer * 5);

      const grad = ctx.createLinearGradient(px - halfW, 0, px + halfW, 0);
      grad.addColorStop(0, 'rgba(56, 189, 248, 0)');
      grad.addColorStop(0.25, 'rgba(14, 165, 233, 0.9)');
      grad.addColorStop(0.5, '#ffffff');
      grad.addColorStop(0.75, 'rgba(14, 165, 233, 0.9)');
      grad.addColorStop(1, 'rgba(56, 189, 248, 0)');

      ctx.fillStyle = grad;
      ctx.fillRect(px - halfW, topY, halfW * 2, muzzleY - topY);
    }

    _renderParticlesAndWaves(ctx) {
      for (const pt of this.particles) {
        const a = clamp(pt.life / pt.maxLife, 0, 1);
        if (pt.kind === 'flash') {
          const g = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, pt.r);
          g.addColorStop(0, `rgba(255, 255, 255, ${(0.95 * a).toFixed(3)})`);
          g.addColorStop(0.35, `rgba(253, 186, 116, ${(0.7 * a).toFixed(3)})`);
          g.addColorStop(1, 'rgba(234, 88, 12, 0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, pt.r, 0, Math.PI * 2);
          ctx.fill();
          continue;
        }
        if (pt.kind === 'smoke') {
          ctx.globalAlpha = a * 0.8;
          ctx.fillStyle = pt.color;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, pt.r, 0, Math.PI * 2);
          ctx.fill();
          continue;
        }
        if (pt.kind === 'debris') {
          ctx.globalAlpha = a;
          ctx.save();
          ctx.translate(pt.x, pt.y);
          ctx.rotate(pt.rot);
          ctx.fillStyle = pt.color;
          ctx.fillRect(-pt.r, -pt.r * 0.4, pt.r * 2, pt.r * 0.8);
          ctx.restore();
          continue;
        }
        ctx.globalAlpha = a;
        ctx.fillStyle = pt.color;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, pt.kind === 'spark' ? pt.r : pt.r * a, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      for (const sw of this.shockwaves) {
        const a = clamp(sw.life / sw.maxLife, 0, 1);
        ctx.strokeStyle = sw.color;
        ctx.globalAlpha = a;
        ctx.lineWidth = sw.width * a;
        ctx.beginPath();
        ctx.arc(sw.x, sw.y, sw.curR || sw.r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      if (!this.rig.pureCamera) {
        ctx.textAlign = 'center';
        for (const ft of this.floatingTexts) {
          const age = (ft.maxLife || (ft.maxLife = ft.life)) - ft.life;
          const pop = ft.big ? 1 + Math.max(0, 0.35 - age) * 1.6 : 1;
          const size = ft.big ? 22 : (ft.small ? 12 : 15);
          ctx.globalAlpha = clamp(ft.life * 1.5, 0, 1);
          ctx.font = `800 ${Math.round(size * pop)}px system-ui, -apple-system, sans-serif`;
          ctx.fillStyle = '#0f172a';
          ctx.fillText(ft.text, ft.x + 1, ft.y + 1.5);
          ctx.fillStyle = ft.color;
          ctx.fillText(ft.text, ft.x, ft.y);
        }
        ctx.globalAlpha = 1;
      }
    }

    _renderForegroundWind(ctx, W, H) {
      if (this.windStreaks.length === 0) return;
      ctx.save();
      ctx.translate(W * 0.5, H * 0.5);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.78)';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      for (const ws of this.windStreaks) {
        ctx.moveTo(ws.ox, ws.oy);
        ctx.lineTo(ws.ox, ws.oy + ws.len);
      }
      ctx.stroke();
      ctx.restore();
    }

    _roundRectPath(ctx, x, y, w, h, r) {
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
      else ctx.rect(x, y, w, h);
    }

    _renderStoryBanner(ctx, W) {
      if (!this.storyBanner) return;
      const sb = this.storyBanner;
      const elapsed = sb.maxTimer - sb.timer;
      const fadeIn = clamp(elapsed / 0.4, 0, 1);
      const fadeOut = clamp(sb.timer / 0.6, 0, 1);
      const alpha = Math.min(fadeIn, fadeOut);
      const slide = (1 - fadeIn) * -16;

      ctx.save();
      ctx.globalAlpha = alpha;
      const boxW = Math.min(sb.victory ? 560 : 500, W - 32);
      const boxH = sb.victory ? 72 : 62;
      const boxX = (W - boxW) * 0.5;
      const boxY = (this.boss ? this._bossBarY(W) + 36 : this._bannerBaseY(W)) + slide;
      const accent = sb.alert ? '#f87171' : (sb.victory ? '#fde047' : '#38bdf8');

      ctx.fillStyle = 'rgba(7, 20, 38, 0.8)';
      this._roundRectPath(ctx, boxX, boxY, boxW, boxH, 14);
      ctx.fill();
      ctx.strokeStyle = accent;
      ctx.globalAlpha = alpha * (sb.alert ? 0.55 + 0.45 * Math.abs(Math.sin(this.time * 8)) : 0.7);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = accent;
      ctx.fillRect(boxX + 18, boxY + boxH - 3, (boxW - 36) * clamp(sb.timer / sb.maxTimer, 0, 1), 2);

      ctx.fillStyle = sb.alert ? '#fecaca' : '#fde047';
      ctx.font = `800 ${sb.victory ? 19 : 16}px system-ui, -apple-system, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(sb.title, W * 0.5, boxY + (sb.victory ? 30 : 26));

      ctx.fillStyle = '#f1f5f9';
      ctx.font = '500 12.5px system-ui, -apple-system, sans-serif';
      ctx.fillText(sb.subtitle, W * 0.5, boxY + (sb.victory ? 54 : 47), boxW - 24);
      ctx.restore();
    }

    _hudPanelW(W) {
      return W < 560 ? Math.min(W - 24, 300) : 330;
    }

    // Boss bar and banners sit beside the score panel on wide screens, beneath it on narrow ones
    _bossBarY(W) {
      const barW = Math.min(520, W - 40);
      const clearsPanel = (W - barW) * 0.5 - 10 > 12 + this._hudPanelW(W) + 8;
      return this.hudTop + (clearsPanel ? 18 : 122);
    }

    _bannerBaseY(W) {
      const boxW = Math.min(560, W - 32);
      const clearsPanel = (W - boxW) * 0.5 > 12 + this._hudPanelW(W) + 8;
      return this.hudTop + (clearsPanel ? 4 : 112);
    }

    _renderBossBar(ctx, W) {
      const b = this.boss;
      if (!b || this.phase !== 'playing') return;
      const def = BOSS_DEFS[b.bossKind] || BOSS_DEFS.fog;
      const intro = clamp(1 - this.bossIntro / 2.6 + 0.25, 0, 1);
      const barW = Math.min(520, W - 40);
      const x = (W - barW) * 0.5;
      const y = this._bossBarY(W);
      ctx.save();
      ctx.fillStyle = 'rgba(7, 20, 38, 0.72)';
      this._roundRectPath(ctx, x - 10, y - 18, barW + 20, 36, 10);
      ctx.fill();
      ctx.font = '800 12px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillStyle = b.enraged ? '#fca5a5' : def.accent;
      ctx.fillText(`${b.name}${b.enraged ? ' · 狂暴' : ''}`, x, y - 4);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#e2e8f0';
      ctx.fillText(`${Math.max(0, Math.ceil((b.hp / b.maxHp) * 100))}%`, x + barW, y - 4);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
      ctx.fillRect(x, y + 3, barW, 8);
      const frac = clamp(b.hp / b.maxHp, 0, 1) * intro;
      const g = ctx.createLinearGradient(x, 0, x + barW, 0);
      g.addColorStop(0, b.enraged ? '#ef4444' : def.trim);
      g.addColorStop(1, b.enraged ? '#f97316' : def.core);
      ctx.fillStyle = g;
      ctx.fillRect(x, y + 3, barW * frac, 8);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.fillRect(x + barW * 0.5 - 1, y + 1, 2, 12);
      ctx.restore();
    }

    _renderMinimalHUD(ctx, W, H) {
      const p = this.player;
      const ch = this.getCurrentChapter();
      const narrow = W < 560;
      const panelW = this._hudPanelW(W);
      ctx.save();
      ctx.translate(0, this.hudTop - 12);
      ctx.fillStyle = 'rgba(7, 20, 38, 0.6)';
      this._roundRectPath(ctx, 12, 12, panelW, 80, 12);
      ctx.fill();

      ctx.textAlign = 'left';
      ctx.font = '800 15px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.fillStyle = '#f8fafc';
      ctx.fillText(String(Math.floor(this.score)).padStart(7, '0'), 22, 32);
      ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.fillStyle = '#94a3b8';
      const hi = Math.max(this.best.score, Math.floor(this.score));
      ctx.fillText(`HI ${String(hi).padStart(7, '0')} · ${this.distanceKm.toFixed(1)} km`, 100, 31);

      // Segmented hull bar
      const barW = panelW - 120;
      const segs = 10;
      const frac = clamp(p.hp / p.maxHp, 0, 1);
      for (let k = 0; k < segs; k++) {
        const sx = 22 + k * (barW / segs);
        const filled = frac * segs - k;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
        ctx.fillRect(sx, 41, barW / segs - 2, 7);
        if (filled > 0) {
          ctx.fillStyle = p.hp > 60 ? '#38bdf8' : (p.hp > 30 ? '#facc15' : '#ef4444');
          ctx.fillRect(sx, 41, (barW / segs - 2) * clamp(filled, 0, 1), 7);
        }
      }
      // Shield pips
      for (let k = 0; k < 2; k++) {
        ctx.strokeStyle = '#67e8f9';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(22 + barW + 12 + k * 16, 44.5, 5, 0, Math.PI * 2);
        if (k < p.shield) {
          ctx.fillStyle = '#67e8f9';
          ctx.fill();
        }
        ctx.stroke();
      }
      // Weapon level pips + drones + nukes
      ctx.font = '700 11px system-ui, -apple-system, sans-serif';
      ctx.fillStyle = '#e2e8f0';
      ctx.fillText('火力', 22, 66);
      for (let k = 0; k < 4; k++) {
        ctx.fillStyle = k < p.weaponLv ? '#fde047' : 'rgba(148, 163, 184, 0.35)';
        ctx.fillRect(48 + k * 9, 58, 6, 9);
      }
      ctx.fillStyle = '#e2e8f0';
      ctx.fillText(`僚机×${p.droneCount}  核弹×${p.nukes}`, 92, 66);
      const gustPct = p.gustCooldown <= 0 ? 1 : 1 - p.gustCooldown / p.gustMaxCooldown;
      ctx.fillStyle = gustPct >= 1 ? '#a5f3fc' : '#64748b';
      ctx.fillText(gustPct >= 1 ? '顺风✓' : `顺风${Math.floor(gustPct * 100)}%`, 196, 66);

      ctx.font = '600 11.5px system-ui, -apple-system, sans-serif';
      ctx.fillStyle = '#cbd5e1';
      ctx.fillText(`${ch.title}${this.rig.godMode ? ' · 亲子护航' : ''}`, 22, 84, panelW - 20);

      // Combo meter (decays with the combo timer)
      if (this.combo >= 3) {
        const cx = W - 12 - 104;
        const show = !narrow;
        if (show) {
          const mult = 1 + Math.min(2.0, this.combo * 0.05);
          ctx.fillStyle = 'rgba(7, 20, 38, 0.6)';
          this._roundRectPath(ctx, cx, 12, 104, 52, 12);
          ctx.fill();
          ctx.textAlign = 'center';
          ctx.font = '900 20px system-ui, -apple-system, sans-serif';
          ctx.fillStyle = this.combo >= 50 ? '#f472b6' : '#fde047';
          ctx.fillText(`${this.combo}`, cx + 52, 36);
          ctx.font = '700 10px system-ui, -apple-system, sans-serif';
          ctx.fillStyle = '#e2e8f0';
          ctx.fillText(`连击 ×${mult.toFixed(2)}`, cx + 52, 50);
          ctx.fillStyle = '#fde047';
          ctx.fillRect(cx + 10, 56, 84 * clamp(this.comboTimer / 3.2, 0, 1), 3);
        }
      }
      if (this.medalValue > 100) {
        ctx.textAlign = 'left';
        ctx.font = '700 11px system-ui, -apple-system, sans-serif';
        ctx.fillStyle = '#facc15';
        ctx.fillText(`★ 金星连锁 ${this.medalValue}`, 22, 108);
      }
      ctx.restore();
    }
  }

  global.SkyStrikerEngine = SkyStrikerEngine;
  global.STORY_CHAPTERS = STORY_CHAPTERS;
})(typeof window !== 'undefined' ? window : globalThis);
