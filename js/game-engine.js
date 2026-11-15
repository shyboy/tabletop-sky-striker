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
      this.manualPaused = false;
      this.setupPaused = false;

      // Input state (merged from mobile controller, gamepad, keyboard)
      this.remoteInput = { vx: 0, vy: 0, firing: true, railCharge: 0, micLevel: 0 };
      this.keys = new Set();
      this.pointerDrag = { active: false, vx: 0, vy: 0 };
      this.localRailCharge = 0;
      this.prevGpButtons = [];
      this.prevGpL2 = 0;

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
      this.nextBossScore = 2800;
      this.spawnTimer = 1.1;
      this.screenShake = 0;
      this.flashAlpha = 0;
      this.telemetryAccum = 0;
      this.storyBanner = null;
    }

    getCurrentChapter() {
      const idx = clamp(this.wave - 1, 0, STORY_CHAPTERS.length - 1);
      return STORY_CHAPTERS[idx];
    }

    getEffectiveSky() {
      if (this.rig.skyTheme !== 'auto') return this.rig.skyTheme;
      if (this.phase === 'title') return 'day';
      return this.getCurrentChapter().sky;
    }

    // Return to calm Title Screen & Tabletop Helipad
    stopToTitle() {
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
      const ch = STORY_CHAPTERS[clamp(waveNum - 1, 0, STORY_CHAPTERS.length - 1)];
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
        weaponLv: this.player.weaponLv
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
      const side = this._droneSideOffsetX();
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

      for (const dir of [-1, 1]) {
        const dx = px + dir * side - this.player.bank * 10;
        const dy = py + 8;
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

    _stepSpawner(dt, px, py) {
      const topSpawnY = this.rig.mode === 'tabletop'
        ? py - this.height * this.rig.anchorY - 70
        : -60;

      if (!this.boss && this.score >= this.nextBossScore) {
        this._spawnBoss(px, topSpawnY);
        return;
      }

      this.spawnTimer -= dt;
      if (this.spawnTimer > 0) return;

      const difficulty = 1 + (this.wave - 1) * 0.22 + Math.min(1.5, this.time / 120);
      this.spawnTimer = this.boss ? 2.1 : Math.max(0.58, 1.45 - difficulty * 0.16);

      const spanW = Math.min(this.width * 0.84, 760);
      const roll = Math.random();

      if (roll < 0.46) {
        const count = 3 + Math.floor(Math.random() * 3);
        const startX = px + (Math.random() - 0.5) * (spanW * 0.65);
        const dir = Math.random() < 0.5 ? 1 : -1;
        for (let i = 0; i < count; i++) {
          this.enemies.push({
            type: 'scout',
            x: startX + dir * i * 48,
            y: topSpawnY - i * 42,
            vx: -dir * 65,
            vy: 155 * Math.min(1.5, difficulty * 0.75),
            hp: 26 * difficulty,
            maxHp: 26 * difficulty,
            radius: 20,
            fireTimer: 0.9 + i * 0.25,
            phase: Math.random() * Math.PI * 2,
            scoreVal: 110
          });
        }
      } else if (roll < 0.78) {
        const ex = px + (Math.random() - 0.5) * spanW * 0.75;
        this.enemies.push({
          type: 'gunship',
          x: ex,
          y: topSpawnY - 20,
          vx: 0,
          vy: 95,
          hp: 115 * difficulty,
          maxHp: 115 * difficulty,
          radius: 32,
          fireTimer: 0.8,
          phase: 0,
          dropsLoot: true,
          scoreVal: 340
        });
      } else {
        const ex = px + (Math.random() - 0.5) * spanW * 0.85;
        this.enemies.push({
          type: 'lancer',
          x: ex,
          y: topSpawnY - 10,
          vx: 0,
          vy: 60,
          hp: 42 * difficulty,
          maxHp: 42 * difficulty,
          radius: 21,
          chargeWarn: 0.75,
          dashed: false,
          fireTimer: 99,
          scoreVal: 190
        });
      }
    }

    _spawnBoss(px, topSpawnY) {
      const hp = 2000 + (this.wave - 1) * 900;
      const boss = {
        type: 'boss',
        isBoss: true,
        x: px,
        y: topSpawnY - 60,
        vx: 90,
        vy: 80,
        hp,
        maxHp: hp,
        radius: 68,
        fireTimer: 1.2,
        patternIdx: 0,
        phase: 0,
        dropsLoot: true,
        scoreVal: 2500
      };
      this.boss = boss;
      this.enemies.push(boss);
      this.sfx.bossAlarm();
      const ch = this.getCurrentChapter();
      this.storyBanner = {
        title: `第 ${this.wave} 关封锁舰拦路`,
        subtitle: ch.bossWarn,
        timer: 3.8,
        maxTimer: 3.8
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
      e.hp -= dmg;
      e.hitFlash = 0.08;
      if (e.hp > 0) return;

      const idx = indexInArray !== undefined ? indexInArray : this.enemies.indexOf(e);
      if (idx >= 0) this.enemies.splice(idx, 1);

      this.combo++;
      this.comboTimer = 3.2;
      const mult = 1 + Math.min(2.0, this.combo * 0.05);
      const pts = Math.round(e.scoreVal * mult);
      this.score += pts;
      this.killsForNuke++;

      if (this.killsForNuke >= 32) {
        this.killsForNuke = 0;
        if (this.player.nukes < this.player.maxNukes) {
          this.player.nukes++;
          this.floatingTexts.push({ x: e.x, y: e.y - 24, text: '+1 战术核弹充能', color: '#f97316', life: 1.2 });
        }
      }

      if (e.isBoss) {
        this.boss = null;
        this.wave++;
        this.nextBossScore = this.score + 3400 + this.wave * 900;
        this.screenShake = 24;
        this.flashAlpha = 0.55;
        this.sfx.enemyBoom(true);
        this._rumbleGamepad(1.0, 520);
        this._spawnExplosion(e.x, e.y, '#fb923c', 42, 340);
        this.shockwaves.push({ x: e.x, y: e.y, r: 20, maxR: 320, color: '#fb923c', life: 0.65, maxLife: 0.65, width: 10 });
        this._spawnPowerup(e.x - 28, e.y, 'weapon');
        this._spawnPowerup(e.x + 28, e.y, 'heal');
        this._announceChapter(this.wave);
      } else {
        this.sfx.enemyBoom(false);
        this._spawnExplosion(e.x, e.y, e.type === 'gunship' ? '#fb923c' : '#38bdf8', e.type === 'gunship' ? 16 : 9, 180);
        if (e.dropsLoot || Math.random() < 0.14) {
          const kind = Math.random() < 0.62 ? 'weapon' : (Math.random() < 0.7 ? 'heal' : 'nuke');
          this._spawnPowerup(e.x, e.y, kind);
        }
      }
      this.onStateChange(this.getPublicState());
    }

    _spawnPowerup(x, y, kind) {
      this.powerups.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 60,
        vy: -70,
        kind,
        magnet: false,
        life: 11
      });
    }

    _stepEnemies(dt, px, py) {
      const worldStepY = this.rig.mode === 'tabletop' ? -this.player.cruiseSpeed * dt : 0;
      const bottomCullY = py + this.height * (1 - this.rig.anchorY) + 180;
      const hitHalfW = this.rig.mode === 'tabletop' ? this.rig.width * 0.24 : 15;
      const hitHalfL = this.rig.mode === 'tabletop' ? this.rig.length * 0.24 : 18;

      for (let i = this.enemies.length - 1; i >= 0; i--) {
        const e = this.enemies[i];
        if (e.hitFlash > 0) e.hitFlash -= dt;
        e.phase = (e.phase || 0) + dt * 3;

        if (e.isBoss) {
          const desiredY = py - this.height * (this.rig.mode === 'tabletop' ? this.rig.anchorY * 0.66 : 0.52);
          e.y += worldStepY;
          e.y = lerp(e.y, desiredY, 1 - Math.exp(-dt * 3.5));
          e.x = lerp(e.x, px + Math.sin(this.time * 0.95) * Math.min(220, this.width * 0.28), 1 - Math.exp(-dt * 2.4));

          e.fireTimer -= dt;
          if (e.fireTimer <= 0) {
            e.patternIdx = (e.patternIdx + 1) % 3;
            if (e.patternIdx === 0) {
              const n = 12 + Math.min(8, this.wave * 2);
              for (let k = 0; k < n; k++) {
                const ang = (k / n) * Math.PI * 2 + this.time;
                this._spawnEnemyBullet(e.x, e.y + 24, Math.cos(ang) * 230, Math.sin(ang) * 230, '#ef4444', 6);
              }
              e.fireTimer = 1.25;
            } else if (e.patternIdx === 1) {
              for (const side of [-38, 38]) {
                const ang = Math.atan2(py - e.y, px - (e.x + side));
                for (let s = -1; s <= 1; s++) {
                  const a = ang + s * 0.18;
                  this._spawnEnemyBullet(e.x + side, e.y + 30, Math.cos(a) * 310, Math.sin(a) * 310, '#f97316', 5.5);
                }
              }
              e.fireTimer = 1.05;
            } else {
              for (let s = -2; s <= 2; s++) {
                const a = Math.PI * 0.5 + s * 0.24 + Math.sin(this.time * 2) * 0.2;
                this._spawnEnemyBullet(e.x, e.y + 36, Math.cos(a) * 260, Math.sin(a) * 260, '#9333ea', 6.5);
              }
              e.fireTimer = 0.85;
            }
          }
        } else if (e.type === 'lancer') {
          e.y += worldStepY + e.vy * dt;
          if (e.chargeWarn > 0) {
            e.x = lerp(e.x, px, 1 - Math.exp(-dt * 3.2));
            e.chargeWarn -= dt;
            if (e.chargeWarn <= 0) {
              e.dashed = true;
              e.vy = 560;
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
            this._damageEnemy(e, 999, i);
            continue;
          }
        }

        if (!e.isBoss && e.y > bottomCullY) {
          this.enemies.splice(i, 1);
        }
      }
    }

    _spawnEnemyBullet(x, y, vx, vy, color, r = 5.5) {
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

      for (let i = this.powerups.length - 1; i >= 0; i--) {
        const pw = this.powerups[i];
        pw.life -= dt;
        const d = Math.hypot(px - pw.x, py - pw.y);
        if (d < 190) pw.magnet = true;

        if (pw.magnet) {
          const ang = Math.atan2(py - pw.y, px - pw.x);
          pw.x += Math.cos(ang) * 640 * dt;
          pw.y += Math.sin(ang) * 640 * dt;
        } else {
          pw.vy = Math.min(135, pw.vy + 180 * dt);
          pw.x += pw.vx * dt;
          pw.y += (pw.vy + worldVyOffset) * dt;
        }

        if (d < collectR) {
          this.sfx.powerup();
          if (pw.kind === 'weapon') {
            if (this.player.weaponLv < 4) {
              this.player.weaponLv++;
              this.floatingTexts.push({ x: px, y: py - 45, text: `火力升级 Lv.${this.player.weaponLv}！`, color: '#fef08a', life: 1.2 });
            } else {
              this.score += 300;
              this.floatingTexts.push({ x: px, y: py - 45, text: '满级火力 +300', color: '#fef08a', life: 1.0 });
            }
          } else if (pw.kind === 'heal') {
            this.player.hp = Math.min(this.player.maxHp, this.player.hp + 30);
            this.floatingTexts.push({ x: px, y: py - 45, text: '护盾修复 +30%', color: '#86efac', life: 1.1 });
          } else if (pw.kind === 'nuke') {
            this.player.nukes = Math.min(this.player.maxNukes, this.player.nukes + 1);
            this.floatingTexts.push({ x: px, y: py - 45, text: '核弹补给 +1', color: '#fed7aa', life: 1.1 });
          }
          this.powerups.splice(i, 1);
          this.onStateChange(this.getPublicState());
          continue;
        }

        if (pw.life <= 0) this.powerups.splice(i, 1);
      }
    }

    _hurtPlayer(amount) {
      const p = this.player;
      if (p.invulnTimer > 0 || this.phase !== 'playing') return;

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
        this._spawnExplosion(px, py, '#fb923c', 36, 300);
      }
      this.onStateChange(this.getPublicState());
    }

    _spawnExplosion(x, y, color, count = 10, maxSpd = 180) {
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
      }

      this._renderParallaxWorld(ctx, px, py, W, H, skyMode);
      if (this.phase !== 'title') {
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

      // 5. Screen Flash
      if (this.flashAlpha > 0.01) {
        ctx.fillStyle = `rgba(255, 250, 235, ${this.flashAlpha.toFixed(3)})`;
        ctx.fillRect(0, 0, W, H);
      }

      // 6. HUD & Cinematic Story Chapter Banner (only when playing & not pureCamera)
      if (!this.rig.pureCamera && this.phase !== 'title') {
        this._renderMinimalHUD(ctx, W, H);
        this._renderStoryBanner(ctx, W);
      }

      ctx.restore();
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
      const sideX = this._droneSideOffsetX();
      for (const dir of [-1, 1]) {
        const dx = dir * sideX - p.bank * 10;
        const dy = 8 + Math.sin(this.time * 5 + dir) * 4 + dir * p.bank * 8;
        this._drawBitDrone(ctx, dx, dy);
      }

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

      for (const dir of [-1, 1]) {
        this._drawBitDrone(ctx, dir * 44 - p.bank * 8, 8 + Math.sin(this.time * 5 + dir) * 4);
      }

      const charge = Math.max(this.remoteInput.railCharge, this.localRailCharge);
      if (this.phase === 'playing' && charge > 0.05) {
        ctx.fillStyle = '#67e8f9';
        ctx.beginPath();
        ctx.arc(0, -34, 6 + charge * 14, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
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
      for (const e of this.enemies) {
        ctx.save();
        ctx.translate(e.x, e.y);

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

        const flash = e.hitFlash > 0;
        if (e.isBoss) {
          ctx.fillStyle = flash ? '#ffffff' : '#1e293b';
          ctx.strokeStyle = '#fb923c';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(0, 52);
          ctx.lineTo(74, 12);
          ctx.lineTo(58, -42);
          ctx.lineTo(-58, -42);
          ctx.lineTo(-74, 12);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = '#ef4444';
          ctx.beginPath();
          ctx.arc(0, 4, 18 + Math.sin(this.time * 8) * 2, 0, Math.PI * 2);
          ctx.fill();

          const bw = 126;
          ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
          ctx.fillRect(-bw * 0.5, -62, bw, 8);
          ctx.fillStyle = '#ef4444';
          ctx.fillRect(-bw * 0.5, -62, bw * clamp(e.hp / e.maxHp, 0, 1), 8);
        } else if (e.type === 'gunship') {
          ctx.fillStyle = flash ? '#ffffff' : '#334155';
          ctx.strokeStyle = '#fb923c';
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.moveTo(0, 28);
          ctx.lineTo(30, -6);
          ctx.lineTo(16, -24);
          ctx.lineTo(-16, -24);
          ctx.lineTo(-30, -6);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        } else if (e.type === 'lancer') {
          ctx.fillStyle = flash ? '#ffffff' : '#991b1b';
          ctx.strokeStyle = '#fecaca';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(0, 24);
          ctx.lineTo(16, -18);
          ctx.lineTo(0, -10);
          ctx.lineTo(-16, -18);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        } else {
          ctx.fillStyle = flash ? '#ffffff' : '#0f172a';
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(0, 18);
          ctx.lineTo(18, -10);
          ctx.lineTo(0, -4);
          ctx.lineTo(-18, -10);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    _renderBullets(ctx) {
      for (const b of this.bullets) {
        ctx.fillStyle = b.color;
        ctx.fillRect(b.x - b.w * 0.5, b.y - b.h * 0.5, b.w, b.h);
      }

      for (const eb of this.enemyBullets) {
        ctx.fillStyle = eb.color;
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
      for (const pw of this.powerups) {
        const color = pw.kind === 'weapon' ? '#38bdf8' : (pw.kind === 'heal' ? '#4ade80' : '#fb923c');
        const label = pw.kind === 'weapon' ? 'W' : (pw.kind === 'heal' ? '+' : 'N');
        ctx.save();
        ctx.translate(pw.x, pw.y);
        ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.arc(0, 0, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.font = '700 13px system-ui, sans-serif';
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
        ctx.globalAlpha = a;
        ctx.fillStyle = pt.color;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, pt.r * a, 0, Math.PI * 2);
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
        for (const ft of this.floatingTexts) {
          ctx.globalAlpha = clamp(ft.life, 0, 1);
          ctx.fillStyle = '#0f172a';
          ctx.font = '800 15px system-ui, -apple-system, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(ft.text, ft.x + 1, ft.y + 1);
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

    _renderStoryBanner(ctx, W) {
      if (!this.storyBanner) return;
      const sb = this.storyBanner;
      const elapsed = sb.maxTimer - sb.timer;
      const fadeIn = clamp(elapsed / 0.4, 0, 1);
      const fadeOut = clamp(sb.timer / 0.6, 0, 1);
      const alpha = Math.min(fadeIn, fadeOut);

      ctx.save();
      ctx.globalAlpha = alpha;
      const boxW = Math.min(480, W - 40);
      const boxX = (W - boxW) * 0.5;
      const boxY = 74;

      ctx.fillStyle = 'rgba(7, 20, 38, 0.74)';
      if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(boxX, boxY, boxW, 58, 12);
        ctx.fill();
      } else {
        ctx.fillRect(boxX, boxY, boxW, 58);
      }

      ctx.fillStyle = '#fde047';
      ctx.font = '700 15px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(sb.title, W * 0.5, boxY + 24);

      ctx.fillStyle = '#f1f5f9';
      ctx.font = '500 12.5px system-ui, -apple-system, sans-serif';
      ctx.fillText(sb.subtitle, W * 0.5, boxY + 45);
      ctx.restore();
    }

    _renderMinimalHUD(ctx, W, H) {
      const p = this.player;
      const ch = this.getCurrentChapter();
      ctx.save();
      ctx.fillStyle = 'rgba(7, 20, 38, 0.58)';
      if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(12, 12, 308, 62, 10);
        ctx.fill();
      } else {
        ctx.fillRect(12, 12, 308, 62);
      }

      ctx.font = '700 14px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.fillStyle = '#f8fafc';
      ctx.textAlign = 'left';
      ctx.fillText(`SCORE ${String(Math.floor(this.score)).padStart(7, '0')} · ${this.distanceKm.toFixed(1)} km`, 22, 31);

      const barW = 160;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
      ctx.fillRect(22, 40, barW, 6);
      ctx.fillStyle = p.hp > 35 ? '#38bdf8' : '#ef4444';
      ctx.fillRect(22, 40, barW * clamp(p.hp / p.maxHp, 0, 1), 6);

      ctx.font = '600 12px system-ui, -apple-system, sans-serif';
      ctx.fillStyle = '#e2e8f0';
      ctx.fillText(`${ch.title} · 核弹×${p.nukes}${this.rig.godMode ? ' · 亲子护航' : ''}`, 22, 63);
      ctx.restore();
    }
  }

  global.SkyStrikerEngine = SkyStrikerEngine;
  global.STORY_CHAPTERS = STORY_CHAPTERS;
})(typeof window !== 'undefined' ? window : globalThis);
