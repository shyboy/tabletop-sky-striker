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
  const TABLETOP_CRUISE_SPEED = 310;
  const TABLETOP_FULL_SPEED = 880;
  const ARCADE_FORWARD_SPEED = 760;
  const TABLETOP_PICKUP_SURGE_SCALE = ARCADE_FORWARD_SPEED / (TABLETOP_FULL_SPEED - TABLETOP_CRUISE_SPEED);
  const FORWARD_RESPONSE = 32;
  const MAX_FRAME_SECONDS = 0.1;
  const MAX_STEP_SECONDS = 0.02;
  const REMOTE_INPUT_TIMEOUT_MS = 350;
  const NEUTRAL_REMOTE_INPUT = { vx: 0, vy: 0, firing: false, railCharge: 0, micLevel: 0 };

  const STORY_CHAPTERS = [
    {
      id: 1,
      title: '第一航段 · 晴空借风',
      subtitle: '它自己没有引擎，那就让整片云海替它往后跑。',
      bossWarn: '灰雾护甲会吸收大部分火力 —— 对手机吹一口顺风，把雾吹散再集火！',
      sky: 'day'
    },
    {
      id: 2,
      title: '第二航段 · 暮色穿云',
      subtitle: '拉下磁轨栓，或吹一口真气——你的呼吸就是它的八级顺风。',
      bossWarn: '黄色虚线是闪电预警 —— 躲开，或者吹一口顺风把闪电吹偏！',
      sky: 'sunset'
    },
    {
      id: 3,
      title: '第三航段 · 星海灯塔',
      subtitle: '只要你还握着操纵杆，桌上这件小小旧物就是今晚的王牌机长。',
      bossWarn: '母舰放出护航机时吹气，把它们倒吹回母舰！满蓄力磁轨炮专克狂暴核心。',
      sky: 'night'
    }
  ];

  // Per-chapter boss identity (distinct silhouettes, palettes and bullet choreography)
  const BOSS_DEFS = {
    fog: { name: '灰雾封锁舰', hull: '#334155', trim: '#cbd5e1', core: '#94a3b8', bullet: '#f472b6', bulletAlt: '#fb7185', accent: '#e2e8f0' },
    storm: { name: '风暴铁幕舰', hull: '#3b0764', trim: '#fb923c', core: '#facc15', bullet: '#f97316', bulletAlt: '#fde047', accent: '#fde68a' },
    mother: { name: '深空母舰', hull: '#0f172a', trim: '#a78bfa', core: '#22d3ee', bullet: '#c084fc', bulletAlt: '#f0abfc', accent: '#67e8f9' }
  };
  const BOSS_ORDER = ['fog', 'storm', 'mother'];

  // Spawn weight tables per chapter (endless loops reuse them with harder stats).
  // Third value = chapter progress (0..1) at which the type starts appearing, so new enemies
  // arrive one at a time instead of all at once.
  const SPAWN_TABLES = [
    [['scout', 50, 0], ['gunship', 24, 0.18], ['lancer', 16, 0.42], ['mine', 10, 0.62]],
    [['scout', 30, 0], ['gunship', 18, 0], ['lancer', 14, 0], ['weaver', 20, 0.05], ['mine', 8, 0.2], ['bomber', 10, 0.45]],
    [['scout', 24, 0], ['gunship', 14, 0], ['lancer', 14, 0], ['weaver', 18, 0], ['bomber', 12, 0], ['mine', 6, 0], ['sentinel', 12, 0.3]]
  ];

  // Seconds of normal flight in each chapter before its blockade boss shows up (endless legs use the last+)
  const CHAPTER_LENGTH = [95, 120, 140];
  const ENDLESS_LENGTH = 110;
  const STAR_ROUTE = {
    chapterMarks: [0.10, 0.32, 0.65, 0.85],
    count: 6, points: 50, bonus: 800, magnetSeconds: 4, drift: 165
  };
  // Story boss hull per chapter (endless loops scale the last one up)
  const BOSS_HP = [3200, 5400, 7200];
  const ENEMY_HULL = { scout: 26, gunship: 115, lancer: 42, weaver: 30, bomber: 210, sentinel: 260, mine: 18, escort: 22 };
  const INCOMING_DAMAGE = { bullet: 14, lightning: 18, collision: 22 };
  const BOSS_XP_THRESHOLDS = [0.8, 0.6, 0.4, 0.2];
  // Firepower ceiling grows with the voyage: Lv2 in act I, Lv3 in act II, Lv4 in act III, Lv5 in the endless route
  const MAX_WEAPON_LV = 5;

  // One-time explanations, shown the first time each thing turns up (remembered per browser)
  const FIRST_TIPS = {
    scout: { icon: '🛩', title: '侦察机', text: '成群飞来、会瞄准你开枪。持续开火就能清掉。' },
    gunship: { icon: '🚁', title: '炮艇', text: '一次打三发扇形弹，血更厚。击落必掉道具！' },
    lancer: { icon: '🗡', title: '冲锋枪骑', text: '先对准你，再直线冲下来 —— 看到它停顿就横移躲开。' },
    mine: { icon: '💣', title: '浮空水雷', text: '靠近会爆成一圈子弹。远远地把它打掉最安全。' },
    weaver: { icon: '〰', title: '织云机', text: '从侧面蛇形飞过的编队，排成一行好打连击。' },
    bomber: { icon: '🛫', title: '轰炸机', text: '会沿途丢水雷、撒扇形弹。优先集火，掉落护盾和僚机。' },
    sentinel: { icon: '🌸', title: '哨塔', text: '停在空中旋转喷弹幕。磁轨炮或核弹能快速拆掉它。' },
    weapon: { icon: 'P', color: '#38bdf8', title: '火力升级', text: '子弹更多更强。每一幕能升到更高一级。' },
    heal: { icon: '+', color: '#4ade80', title: '机体修复', text: '恢复 30 点耐久，最多回到机体上限。' },
    shield: { icon: 'S', color: '#67e8f9', title: '能量护盾', text: '抵挡一次伤害，最多叠两层。' },
    drone: { icon: 'D', color: '#6ee7b7', title: '浮游僚机', text: '在两侧自动瞄准开火，基础上限 4 架，蜂群编队最高可扩至 6 架。' },
    nuke: { icon: 'N', color: '#fb923c', title: '战术核弹', text: '清掉全屏子弹和杂兵。键盘 K / 手柄 ○ / 手机大按钮。' },
    medal: { icon: '★', color: '#facc15', title: '金星连锁', text: '连续拾取价值从 100 涨到 1000；漏掉或受伤就重置。' },
    lowHp: { icon: '⚠', color: '#f87171', title: '机体告急', text: '找绿色「+」修复，或用顺风、翻滚先躲一躲。' },
    boss: { icon: '☠', color: '#f87171', title: '封锁舰', text: '顶部是它的血条。血量过半会狂暴，换更凶的弹幕。' },
    supply: { icon: '📦', color: '#fde68a', title: '中途补给', text: '每一幕飞到一半会空投补给，记得去接。' }
  };
  // Guided first flight. Each step waits for the player to actually do the thing (with a timeout so nobody gets stuck).
  // phone / touch / keys = how to do it with the phone cockpit, a touchscreen, or keyboard & gamepad.
  // target = which phone-cockpit control to highlight.
  const TUTORIAL_STEPS = [
    {
      id: 'move', title: '移动', goal: '左右移动一下：玩具不动，云海替它往后跑',
      phone: '推动手机上的摇杆（或切到体感后倾斜手机）', touch: '手指按住屏幕任意处拖动',
      keys: 'WASD / 方向键，或鼠标按住画面拖动；手柄左摇杆', target: 'stick', timeout: 14
    },
    {
      id: 'shoot', title: '自动开火', goal: '飞行时会自动射击 —— 对准侦察机，击落 3 架',
      phone: '移动就会自动开火', touch: '移动就会自动开火', keys: '移动就会自动开火（手柄也可按住 R2）',
      target: 'stick', need: 3, timeout: 30
    },
    {
      id: 'pickup', title: '吃道具', goal: '飞过去碰到蓝色「P」—— 火力升级！其他道具第一次吃到时会有说明',
      phone: '靠近道具会被自动吸过来', touch: '靠近道具会被自动吸过来', keys: '靠近道具会被自动吸过来',
      target: 'stick', timeout: 18
    },
    {
      id: 'dodge', title: '躲子弹', goal: '只有机身中央的红白判定点碰到子弹才算受伤。击落这架炮艇',
      phone: '横移躲开红色子弹（引导中不扣血）', touch: '横移躲开红色子弹（引导中不扣血）', keys: '横移躲开红色子弹（引导中不扣血）',
      target: 'stick', timeout: 24
    },
    {
      id: 'gust', title: '借风 · 顺风', goal: '吹一口顺风，把迎面的子弹倒吹回敌机',
      phone: '对着手机麦克风用力吹一口，或点「💨 顺风」', touch: '点左下角「💨 顺风」', keys: '按 F（按住＝持续轻吹）· 手柄 □/X',
      target: 'wind', timeout: 20
    },
    {
      id: 'rail', title: '磁轨炮', goal: '蓄满力后松手，轰掉这架厚皮轰炸机（拉满立刻松手＝完美蓄力）',
      phone: '按住右侧拉栓往下拉，拉满后松手', touch: '按住右下角「⚡ 磁轨」蓄力，松手发射', keys: '按住 Shift 或 J 蓄力，松开发射 · 手柄按住 L2',
      target: 'rail', timeout: 22
    },
    {
      id: 'done', title: '准备出发！', goal: '危急时：翻滚可短暂无敌，核弹能清空全屏子弹。第一航段开始！',
      phone: '翻滚＝后拉手机或「🌀」键 · 核弹＝大圆按钮', touch: '核弹＝右下角「☢」', keys: '翻滚 Space · 核弹 K · 暂停 P',
      target: 'nuke', timeout: 5.5
    }
  ];

  const TIPS_KEY = 'skyStriker.tips.v1';

  // Combat readability (what Touhou / Cave / Raiden do): in flight the scenery is pushed back -
  // darker, calmer, fewer bright shapes - so the craft and every bullet sit clearly on top of it.
  // veil = dark wash over the scenery, cloud = cloud & island opacity, sun = glare, lines = grid / speed lines / stars.
  const BG_CALM = {
    normal: { label: '标准', veil: 0.3, cloud: 0.26, sun: 0.25, lines: 0.12 },
    dark: { label: '压暗', veil: 0.42, cloud: 0.16, sun: 0.14, lines: 0.08 },
    max: { label: '很暗', veil: 0.56, cloud: 0.08, sun: 0.06, lines: 0.04 }
  };
  const VISUAL_FILTERS = Object.freeze({
    normal: { label: '标准绘本' },
    pixel: { label: '复古像素' },
    film: { label: '暖调胶片' }
  });
  const BULLET_STYLES = Object.freeze({
    auto: { label: '随构筑进化', short: '随进化' },
    laser: { label: '极光脉冲梭', short: '脉冲梭' },
    blade: { label: '新月风刃弹', short: '新月刃' },
    prism: { label: '棱晶星芒针', short: '棱晶针' },
    sword: { label: '苍穹御剑弹', short: '御剑弹' }
  });
  // Main guns fire 1.45x less often with 1.45x damage: same firepower, far fewer bars filling the screen
  const SHOT_THIN = 1.45;
  const BG_CALM_TITLE = { veil: 0, cloud: 1, sun: 1, lines: 1 };
  // Corridor feel (like the avenues / canyons other vertical shooters fly along): soft cloud walls on both
  // sides and a clean, gently winding lane in the middle where the craft and bullets stay readable.
  const LANE_STYLE = {
    day: { wall: '255, 255, 255', wallA: 1 },
    sunset: { wall: '255, 214, 186', wallA: 0.75 },
    night: { wall: '51, 85, 150', wallA: 0.95 }
  };
  const LANE_PF = 0.6; // the corridor scrolls a bit slower than the battle layer: it reads as terrain far below
  const VEIL_RGB = { day: '10, 34, 66', sunset: '34, 12, 36', night: '2, 6, 18' };
  const TUTORIAL_KEY = 'skyStriker.tutorialDone.v1';
  const TOY_KEY = 'skyStriker.toy';
  const TOY_CALIBRATION_FIELDS = ['shape', 'toyName', 'hitSize', 'width', 'length', 'anchorY'];

  // Toy personality: what sits on the tablet changes how it flies
  const TOY_TRAITS = {
    jet: {
      label: '灵巧型', icon: '✈️', maxHp: 90, lateral: 1.15, fireRate: 0.85, dmg: 1, core: 9, rollCd: 1.6, gustCd: 1,
      desc: '速度快、射速高、判定小，但机体较薄；翻滚冷却更短'
    },
    car: {
      label: '坦克型', icon: '🚗', maxHp: 140, lateral: 0.85, fireRate: 1.16, dmg: 1.32, core: 13, rollCd: 2.2, gustCd: 1, bumper: true,
      desc: '机体厚、子弹重；撞上小型敌机会直接把它撞飞'
    },
    orb: {
      label: '守护型', icon: '🧿', maxHp: 105, lateral: 1.02, fireRate: 0.94, dmg: 1.04, core: 11, rollCd: 2.0, gustCd: 0.75, satellite: true,
      desc: '自带环绕护卫球拦截子弹，顺风充能更快'
    }
  };
  const HIT_SIZE = { small: 0.75, normal: 1, large: 1.5 };
  const CREW_COOLDOWNS = { shield: 22, heal: 18, supply: 28, mark: 3, cheer: 1.2 };

  // Difficulty tiers (亲子护航 invincibility is a separate toggle on top of these)
  const DIFFICULTY = {
    easy: { label: '轻松', dmg: 0.35, bulletSpeed: 0.7, spawn: 1.5, regen: 1.2, startShield: 1 },
    normal: { label: '标准', dmg: 1, bulletSpeed: 1, spawn: 1 },
    ace: { label: '王牌', dmg: 1.35, bulletSpeed: 1.15, spawn: 0.82 }
  };

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
  function loadJSON(key, fallback) {
    try {
      const raw = global.localStorage && global.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function saveJSON(key, value) {
    try {
      if (global.localStorage) global.localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* ignore */ }
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
      // Coach card: tutorial steps and one-time tips (host renders them outside the battlefield)
      this.onCoach = callbacks.onCoach || (() => {});
      this.tipsSeen = loadJSON(TIPS_KEY, {}) || {};
      this.tutorialDone = Boolean(loadJSON(TUTORIAL_KEY, false));

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
        godMode: false,     // Kid-friendly invincible escort mode
        difficulty: 'normal', // 'easy' | 'normal' | 'ace'
        hitSize: 'normal',    // bullet hit-core size: 'small' | 'normal' | 'large'
        toyName: '',          // the kid's name for the toy, shown on banners and the keepsake card
        bgDim: 'normal',      // how far the scenery is pushed back in flight: 'normal' | 'dark' | 'max'
        visualFilter: 'normal', // lightweight optional screen filter easter egg: 'normal' | 'pixel' | 'film'
        bulletStyle: 'auto'   // player shot visual style: 'auto' (evolves with craft & skills) | 'laser' | 'blade' | 'prism' | 'sword'
      };

      this._pixelBuffer = null;
      this._ditherPattern = null;
      this._filmPattern = null;
      this._cloudCover = { density: 0, heightFactor: 0.85 };
      this._cloudMistTimer = 0;

      this.calibHighlightTimer = 0;
      this.hudTop = 12; // set by the host page to sit below its floating toolbar
      this.manualPaused = false;
      this.localSetupOpen = false;
      this.remoteSetupOpen = false;
      this.skillDraftOpen = false;
      this._gpStickLatch = false;

      this.scenery = global.SkySceneryRenderer ? new global.SkySceneryRenderer() : null;
      this.roguelite = global.SkyRoguelite ? new global.SkyRoguelite({
        sfx: this.sfx,
        onDraftChange: (draft) => {
          const wasOpen = this.skillDraftOpen;
          this.skillDraftOpen = Boolean(draft);
          if (this.skillDraftOpen) {
            this._cancelLocalControls();
          } else if (wasOpen && this.phase === 'playing') {
            // Post-draft safety grace: 1.5s invulnerability + gentle shockwave clearing nearby shots
            this._applyToyTraits(false);
            this.player.invulnTimer = Math.max(this.player.invulnTimer, 1.5);
            const px = this._playerWorldX();
            const py = this._playerWorldY();
            this.shockwaves.push({ x: px, y: py, r: 16, maxR: 150, color: '#38bdf8', life: 0.4, maxLife: 0.4, width: 6 });
            for (let i = this.enemyBullets.length - 1; i >= 0; i--) {
              const eb = this.enemyBullets[i];
              if (Math.hypot(eb.x - px, eb.y - py) < 145) this.enemyBullets.splice(i, 1);
            }
          }
          this.onStateChange(this.getPublicState());
        },
        onApplyInstant: (choice) => {
          if (!choice || !this.player) return;
          const p = this.player;
          const px = this._playerWorldX();
          const py = this._playerWorldY();
          const mods = this._mods();
          const maxShields = mods.maxShields || 2;
          if (choice.id === '_auto_shield') {
            if (p.shield < maxShields && this.phase === 'playing') {
              p.shield++;
              this._sfx('shieldUp');
              this.floatingTexts.push({ x: px, y: py - 54, text: '🔷 相位护盾充能完成', color: '#67e8f9', life: 1.1 });
              this._stateDirty = true;
            }
            return;
          }
          if (choice.id === '_core_overclock') {
            p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.35);
            if (p.shield < maxShields) p.shield++;
            this._sfx('shieldUp');
            this.floatingTexts.push({ x: px, y: py - 68, text: `⚡ ${choice.name} · 护盾与耐久补给`, color: '#fde047', life: 1.4, big: true });
            this._stateDirty = true;
            return;
          }
          this._applyToyTraits(false);
          if (choice.id === 'nano_hull') {
            p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.3);
          } else if (choice.id === 'phase_aegis') {
            p.shield = Math.min(maxShields, p.shield + 1);
            this._sfx('shieldUp');
          } else if (choice.id === 'awakening_aegis') {
            p.shield = Math.min(maxShields, p.shield + 2);
            this._sfx('shieldUp');
          } else if (choice.id === 'drone_swarm') {
            p.droneCount = Math.min(mods.maxDrones, p.droneCount + 1);
          } else if (choice.id === 'awakening_hive') {
            p.droneCount = Math.min(mods.maxDrones, p.droneCount + 2);
          } else if (choice.id === 'tactical_arsenal') {
            p.nukes = Math.min(p.maxNukes + 1, p.nukes + 1);
          }
          this.floatingTexts.push({
            x: px, y: py - 68,
            text: `${choice.iconEmoji || '⚡'} 习得：${choice.name}`,
            color: choice.rarity === 'epic' ? '#fde047' : '#7dd3fc',
            life: 1.4, big: true
          });
          this._stateDirty = true;
        },
        onDealDamage: (enemy, dmg, meta = {}) => {
          if (!enemy || enemy.dead || enemy.hp <= 0) return;
          this._damageEnemy(enemy, dmg, undefined, meta);
        }
      }) : null;

      // Input state (merged from mobile controller, gamepad, keyboard)
      this.remoteInput = { ...NEUTRAL_REMOTE_INPUT };
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
      this.crewOnline = false; // connection-level, survives between voyages

      this._initWorldContainers();
      this.stopToTitle();
      this.resize();
      const toy = loadJSON(TOY_KEY, null);
      if (toy) {
        this.updateRig({ shape: toy.shape, toyName: toy.name, hitSize: toy.hitSize,
          width: toy.w, length: toy.l, anchorY: toy.anchorY }, false);
      }
    }

    get isPaused() {
      return this.phase === 'playing' && (this.manualPaused || this.setupPaused || this.skillDraftOpen);
    }

    get setupPaused() {
      return this.localSetupOpen || this.remoteSetupOpen;
    }

    get calibDrawerOpen() {
      return this.setupPaused;
    }

    _mods() {
      if (this.roguelite) return this.roguelite.getModifiers();
      return {
        evoTier: 0, globalDmgMult: 1, splitShots: 0, pierceCount: 0, fireRateMult: 1, damageMult: 1,
        critChance: 0, critMult: 1, pickupRadiusMult: 1, xpMult: 1,
        lungCapMult: 1, lungRegenMult: 1, gustCdMult: 1, windReflectMult: 1.8, windReflectHoming: false, breezeReflectChance: 0,
        maxDrones: 4, droneDamageMult: 1, hiveAwakened: false, hasLightning: false,
        railChargeMult: 1, railPerfectWindowMult: 1, railAwakened: false, railPerfectCdRefund: 0, railDamageMult: 1,
        maxHpBonus: 0, hullRegenPerSec: 0, maxShields: 2, aegisAwakened: false, autoShieldInterval: 0,
        grazeRadiusMult: 1, grazeGustReduce: 0, grazeXp: 0, tempestAura: false
      };
    }

    _skillPowerScale() {
      const mods = this._mods();
      const wLv = this.player ? clamp(this.player.weaponLv || 1, 1, MAX_WEAPON_LV) : 1;
      return (1 + (wLv - 1) * 0.12) * this.traits.dmg * (mods.globalDmgMult || 1);
    }

    _xpDropScale() {
      if (this.wave <= 1) return 1;
      return 1 + (this.wave - 1) * 0.25;
    }

    isSkillDraftOpen() {
      return Boolean(this.roguelite && this.roguelite.isDraftOpen());
    }

    pickSkill(index) {
      return this.roguelite ? this.roguelite.pickCard(index) : false;
    }

    pickOfferedSkill(version, cardId) {
      return this.roguelite ? this.roguelite.pickOfferedCard(version, cardId) : false;
    }

    rerollSkills(version) {
      return this.roguelite ? this.roguelite.reroll(version) : false;
    }

    moveSkillFocus(delta) {
      if (this.roguelite) this.roguelite.moveFocus(delta);
    }

    confirmSkillFocus() {
      if (this.roguelite) this.roguelite.confirmFocus();
    }

    _initWorldContainers() {
      this._cancelLocalControls();
      this.hasRemoteFireInput = false;
      this.clearRemoteInput();
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
      this.starRoute = null;
      this.starRouteIndex = 0;
      this.starMagnet = 0;
      this.perfectRoutes = 0;
      this.medalValue = 100;
      this.storyCleared = false;
      this.slowMo = 0;
      this.lowHpTimer = 0;
      this.ambientTimer = 6 + Math.random() * 6;
      this.lightningFlash = 0;
      this.pendingFx = [];
      this.hazards = [];
      this.bossIntro = 0;
      this.chapterTime = 0;     // seconds flown in the current chapter (drives pacing & boss timing)
      this.supplyDropped = false;
      this.tutorial = null;     // first-flight guided steps (see _stepTutorial)
      this.coach = null;        // currently shown coach card
      this.coachQueue = [];
      this.coachCooldown = 0;
      this.breath = 0;        // smoothed sustained-breath level (phone mic / held key)
      this.breathPeak = 0;    // recent peak, scales the strength of a gust
      this.breezeAccum = 0;
      this.breathGate = false;
      this.breathHold = 0;
      this.lungs = 1;          // breath stamina: a long blow runs out, like real lungs
      this.lungsExhausted = false;
      this.hitsTaken = 0;
      this.victoryHold = false;
      this.victoryHoldTimer = 0;
      this.warnThrottle = 0;
      this.crewAssists = 0;
      this.hullBonus = 0;
      this.crewCd = { shield: 0, heal: 0, supply: 0, mark: 0, cheer: 0 };
      this.marks = [];          // radar pings from the ground crew (world coords)

      this.player = {
        worldX: 0,
        worldY: 0,
        screenX: this.width * 0.5,
        screenY: this.height * this.rig.anchorY,
        vx: 0,
        vy: 0,
        cruiseSpeed: this.rig.mode === 'tabletop' ? TABLETOP_CRUISE_SPEED : 280,
        bank: 0,
        cameraRoll: 0,
        hp: 100,
        maxHp: 100,
        weaponLv: 1,
        droneCount: 0,   // earned along the way: supply drops, D pickups and boss rewards
        shield: 0,
        nukes: 1,
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
      this.contrails = { left: [], right: [] };
      this.cloudWisps = [];
      this._contrailAccum = 0;
      this._cloudCover = { density: 0, heightFactor: 0.85 };
      this._cloudMistTimer = 0;

      this.boss = null;
      this.spawnTimer = 1.6;
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
      this.skillDraftOpen = false;
      if (this.roguelite) this.roguelite.reset({});
      this.phase = 'title';
      this.gameOver = false;
      this.manualPaused = false;
      this.calibHighlightTimer = 9999; // Keep golden helipad visible on title screen!
      this._emitCoach();
      this.onStateChange(this.getPublicState());
    }

    // Launch or Restart Mission from Wave 1
    // opts.tutorial: true forces the guided first flight, false skips it; default = only until finished once
    startMission(opts = {}) {
      this._initWorldContainers();
      this.skillDraftOpen = false;
      const wantTutorial = typeof opts.tutorial === 'boolean' ? opts.tutorial : !this.tutorialDone;
      if (this.roguelite) this.roguelite.reset({ tutorial: wantTutorial });
      this.lastRun = null;
      this.phase = 'playing';
      this.gameOver = false;
      this.manualPaused = false;
      this.player.shield = this.tier.startShield || 0;
      this._applyToyTraits(true);
      this.calibHighlightTimer = 3.2;
      if (wantTutorial) {
        this._startTutorial();
      } else {
        this._announceChapter(1);
      }
      this.floatingTexts.push({
        x: this._playerWorldX(), y: this._playerWorldY() - 110,
        text: `${this.traits.icon} ${this.toyLabel}（${this.traits.label}）起飞！`, color: '#fde68a', life: 2.2, big: true
      });
      this.sfx.powerup();
      this._emitCoach();
      this.onStateChange(this.getPublicState());
    }

    resetGame() {
      this.startMission();
    }

    setManualPause(flag) {
      if (this.phase !== 'playing') return;
      // Ignore stray resume inputs (mashed nuke/Enter/phone button) right after the victory card appears
      if (!flag && this.victoryHold && Date.now() - (this.victoryHoldSince || 0) < 1500) return;
      this.manualPaused = Boolean(flag);
      if (!this.manualPaused && this.victoryHold) {
        // Resuming from the victory card = continue on the endless route, with a grace window
        this.victoryHold = false;
        this.player.invulnTimer = Math.max(this.player.invulnTimer, 2.2);
      }
      this._cancelLocalControls();
      this.onStateChange(this.getPublicState());
    }

    toggleManualPause() {
      if (this.phase !== 'playing') return false;
      this.setManualPause(!this.manualPaused);
      return this.manualPaused;
    }

    // End the voyage voluntarily (from the victory card): straight to the flight-log summary
    finishVoyage() {
      if (this.phase !== 'playing') return;
      this.victoryHold = false;
      this.manualPaused = false;
      this.phase = 'gameover';
      this.gameOver = true;
      this.endTouchRail();
      this._endRun();
      this.onStateChange(this.getPublicState());
    }

    setSetupPause(open, source = 'host') {
      const field = source === 'controller' ? 'remoteSetupOpen' : 'localSetupOpen';
      open = Boolean(open);
      if (this[field] === open) return;
      this[field] = open;
      if (open) this._cancelLocalControls();
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
      if (this.scenery) this.scenery.resize(this.width, this.height, this.dpr);
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
      const previous = { ...this.rig };
      if (patch.mode === 'tabletop' || patch.mode === 'arcade') this.rig.mode = patch.mode;
      if (patch.skyTheme && ['auto', 'day', 'sunset', 'night'].includes(patch.skyTheme)) {
        this.rig.skyTheme = patch.skyTheme;
      }
      if (patch.shape && ['jet', 'car', 'orb'].includes(patch.shape)) this.rig.shape = patch.shape;
      if (Number.isFinite(patch.width)) this.rig.width = clamp(patch.width, 36, 240);
      if (Number.isFinite(patch.length)) this.rig.length = clamp(patch.length, 44, 280);
      if (Number.isFinite(patch.anchorY)) {
        this.rig.anchorY = clamp(patch.anchorY, 0.52, 0.86);
        if (this.rig.mode === 'tabletop') {
          this.player.screenY = this.height * this.rig.anchorY;
        }
      }
      if (typeof patch.pureCamera === 'boolean') this.rig.pureCamera = patch.pureCamera;
      if (typeof patch.godMode === 'boolean') this.rig.godMode = patch.godMode;
      if (patch.difficulty && DIFFICULTY[patch.difficulty]) this.rig.difficulty = patch.difficulty;
      if (Object.hasOwn(HIT_SIZE, patch.hitSize)) this.rig.hitSize = patch.hitSize;
      if (typeof patch.toyName === 'string') this.rig.toyName = patch.toyName.trim().slice(0, 8);
      if (patch.bgDim && BG_CALM[patch.bgDim]) this.rig.bgDim = patch.bgDim;
      if (patch.visualFilter && VISUAL_FILTERS[patch.visualFilter]) this.rig.visualFilter = patch.visualFilter;
      if (patch.bulletStyle && BULLET_STYLES[patch.bulletStyle]) this.rig.bulletStyle = patch.bulletStyle;
      // A new toy type before take-off changes the hull right away (mid-flight it keeps the current HP ratio)
      if (patch.shape && this.player) this._applyToyTraits(this.phase !== 'playing');

      if (previous.mode !== this.rig.mode) {
        // Existing shots use the previous mode's reference frame.
        for (const b of this.enemyBullets) b.life = 0;
        if (this.contrails) {
          this.contrails.left.length = 0;
          this.contrails.right.length = 0;
        }
        if (this.cloudWisps) this.cloudWisps.length = 0;
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
      if (TOY_CALIBRATION_FIELDS.some((key) => previous[key] !== this.rig[key])) {
        const { shape, toyName, hitSize, width, length, anchorY } = this.rig;
        saveJSON(TOY_KEY, { shape, name: toyName, hitSize, w: width, l: length, anchorY });
      }
      this.onStateChange(this.getPublicState());
    }

    _shiftAllWorldEntities(dx, dy) {
      for (const b of this.bullets) { b.x += dx; b.y += dy; }
      for (const b of this.enemyBullets) { b.x += dx; b.y += dy; }
      for (const e of this.enemies) {
        e.x += dx;
        e.y += dy;
        if (e.baseY !== undefined) e.baseY += dy;
      }
      for (const hz of this.hazards) hz.x += dx;
      for (const p of this.powerups) { p.x += dx; p.y += dy; }
      if (this.starRoute) {
        for (const star of this.starRoute.stars) { star.x += dx; star.y += dy; }
      }
      for (const pt of this.particles) { pt.x += dx; pt.y += dy; }
      for (const sw of this.shockwaves) { sw.x += dx; sw.y += dy; }
      for (const ft of this.floatingTexts) { ft.x += dx; ft.y += dy; }
      if (this.roguelite) this.roguelite.shiftWorldEntities(dx, dy);
    }

    getPublicState() {
      const ch = this.getCurrentChapter();
      const rg = this.roguelite ? this.roguelite.getSummary() : { level: 1, xpRatio: 0, evoTier: 0, pickedSkills: [] };
      return {
        ...this.rig,
        phase: this.phase,
        paused: this.isPaused,
        manualPaused: this.manualPaused,
        setupPaused: this.setupPaused,
        skillDraftOpen: this.skillDraftOpen,
        skillDraft: this.roguelite ? this.roguelite.getDraftState() : null,
        level: rg.level,
        xpRatio: Number((rg.xpRatio || 0).toFixed(3)),
        evoTier: rg.evoTier,
        pickedSkills: rg.pickedSkills,
        gameOver: this.phase === 'gameover',
        score: Math.floor(this.score),
        distanceKm: Number(this.distanceKm.toFixed(1)),
        gustUsedCount: this.gustUsedCount,
        wave: this.wave,
        chapterTitle: ch.title,
        chapterSubtitle: ch.subtitle,
        hp: Math.ceil((this.player.hp / this.player.maxHp) * 100),
        toyLabel: this.toyLabel,
        toyTrait: this.traits.label,
        crewAssists: this.crewAssists,
        nukes: this.player.nukes,
        weaponLv: this.player.weaponLv,
        weaponCap: this.weaponCap,
        tutorialActive: Boolean(this.tutorial),
        tutorialDone: this.tutorialDone,
        chapterProgress: Number(this.chapterProgress.toFixed(3)),
        shield: this.player.shield,
        droneCount: this.player.droneCount,
        loop: this.loopIndex,
        storyCleared: this.storyCleared,
        victoryHold: this.victoryHold,
        hitsTaken: this.hitsTaken,
        kills: this.kills,
        bossKills: this.bossKills,
        maxCombo: this.maxCombo,
        medals: this.medalsCollected,
        perfectRoutes: this.perfectRoutes,
        best: { ...this.best },
        lastRun: this.lastRun
      };
    }

    // Rank rewards clean flying, not score (medals make score explode)
    _rankForRun(score, bossKills, cleared) {
      if (cleared && this.hitsTaken <= 4 && !this.rig.godMode && this.rig.difficulty !== 'easy') return 'S';
      if (cleared || bossKills >= 2) return 'A';
      if (bossKills >= 1 || score >= 20000) return 'B';
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

    clearRemoteInput() {
      Object.assign(this.remoteInput, NEUTRAL_REMOTE_INPUT);
      this._lastRemoteInputAt = null;
      if (this._railCharge() < 0.97) this.fullChargeAt = null;
    }

    _expireRemoteInput(now) {
      if (this._lastRemoteInputAt !== null && now - this._lastRemoteInputAt >= REMOTE_INPUT_TIMEOUT_MS) {
        this.clearRemoteInput();
      }
    }

    setRemoteInput(data) {
      if (!data) return;
      const now = performance.now();
      this._expireRemoteInput(now);
      const { vx, vy, firing, micLevel, railCharge, autoRelease } = data;
      const hasAxis = Number.isFinite(vx) || Number.isFinite(vy);
      const hasFiring = typeof firing === 'boolean';
      const hasMic = Number.isFinite(micLevel);
      const hasCharge = Number.isFinite(railCharge);
      if (!hasAxis && !hasFiring && !hasMic && !hasCharge) return;

      this._lastRemoteInputAt = now;
      if (Number.isFinite(vx)) this.remoteInput.vx = clamp(vx, -1, 1);
      if (Number.isFinite(vy)) this.remoteInput.vy = clamp(vy, -1, 1);
      if (hasFiring) {
        this.hasRemoteFireInput = true;
        this.remoteInput.firing = firing;
      }
      if (hasMic) this.remoteInput.micLevel = clamp(micLevel, 0, 1);
      if (hasCharge) {
        const prev = this.remoteInput.railCharge;
        const next = clamp(railCharge, 0, 1);
        this.remoteInput.railCharge = next;
        if (this.phase === 'playing' && !this.isPaused && next > 0.15) {
          this.sfx.chargeTick(next);
        }
        if (prev >= 0.38 && next === 0 && autoRelease) {
          this.triggerRailgun(prev);
        }
      }
    }

    // ===== Ground crew (second phone) support actions =====
    crewAction(action, payload = {}) {
      if (action === 'hello') {
        if (!this.crewOnline) {
          this.crewOnline = true;
          this.floatingTexts.push({ x: this._playerWorldX(), y: this._playerWorldY() - 120, text: '🎧 地勤已上线！', color: '#a7f3d0', life: 1.6, big: true });
        }
        return true;
      }
      if (this.phase !== 'playing' || this.isPaused) return false;
      if (!(action in CREW_COOLDOWNS) || this.crewCd[action] > 0) return false;
      const p = this.player;
      const px = this._playerWorldX();
      const py = this._playerWorldY();
      const say = (text, color) => this.floatingTexts.push({ x: px, y: py - 78, text, color, life: 1.4, big: true });

      if (action === 'shield') {
        const maxShields = this._mods().maxShields || 2;
        if (p.shield >= maxShields) return false;
        p.shield++;
        this._sfx('shieldUp');
        say('🛡 地勤投放护盾！', '#67e8f9');
      } else if (action === 'heal') {
        if (p.hp >= p.maxHp) return false;
        p.hp = Math.min(p.maxHp, p.hp + 25);
        this.sfx.powerup();
        say('🔧 远程维修 +25', '#86efac');
      } else if (action === 'supply') {
        const kinds = ['weapon', 'heal', 'shield', 'drone', 'nuke'];
        const ahead = this.rig.mode === 'tabletop' ? this.height * 0.4 : this.height * 0.35;
        this._spawnPowerup(px + (Math.random() - 0.5) * 140, py - ahead, kinds[Math.floor(Math.random() * kinds.length)]);
        this._spawnPowerup(px + (Math.random() - 0.5) * 140, py - ahead - 30, 'medal');
        say('📦 空投补给到达！', '#fde68a');
      } else if (action === 'mark') {
        const nx = clamp(Number(payload.nx) || 0, -1, 1);
        const ny = clamp(Number(payload.ny) || 0, -1, 1);
        const mx = px + nx * this.width * 0.6;
        const my = py + ny * this.height * 0.85;
        let best = null;
        let bestD = 240;
        for (const e of this.enemies) {
          const d = Math.hypot(e.x - mx, e.y - my) - (e.isBoss ? 60 : 0);
          if (d < bestD) { bestD = d; best = e; }
        }
        this.marks.push({ x: best ? best.x : mx, y: best ? best.y : my, life: 0.8 });
        if (!best) {
          this.crewCd.mark = 0.6;
          return false;
        }
        best.marked = 6;
        this._sfx('mineBeep');
      } else if (action === 'cheer') {
        const emojis = ['👍', '❤️', '🔥', '⭐', '💪'];
        const emoji = emojis.includes(payload.emoji) ? payload.emoji : '👍';
        this.floatingTexts.push({ x: px + (Math.random() - 0.5) * 60, y: py - 90, text: `${emoji} 加油！`, color: '#fbcfe8', life: 1.5, big: true });
        this._sfx('medal', 4);
        this.crewCd.cheer = CREW_COOLDOWNS.cheer;
        return true;
      }
      this.crewCd[action] = CREW_COOLDOWNS[action];
      this.crewAssists++;
      this._stateDirty = true;
      return true;
    }

    _cancelLocalControls() {
      this.keys.clear();
      this.pointerDrag.active = false;
      this.localRailCharge = 0;
      this._wasChargingKey = false;
      this.prevGpL2 = 0;
      this.touchRailHeld = false;
      this.touchRailCharge = 0;
      if (this.remoteInput.railCharge < 0.97) this.fullChargeAt = null;
    }

    beginTouchRail() {
      if (this.phase !== 'playing' || this.isPaused || this.touchRailHeld) return false;
      this.touchRailHeld = true;
      return true;
    }

    endTouchRail(fire = false) {
      if (!this.touchRailHeld) return false;
      const power = this.touchRailCharge;
      this.touchRailHeld = false;
      this.touchRailCharge = 0;
      const fired = fire && power >= 0.35 && this.triggerRailgun(power);
      if (this._railCharge() < 0.97) this.fullChargeAt = null;
      return fired;
    }

    _railCharge() {
      return Math.max(this.remoteInput.railCharge, this.localRailCharge, this.touchRailCharge);
    }

    triggerRailgun(power = 1) {
      const p = this.player;
      if (this.phase !== 'playing' || this.isPaused || p.railCooldown > 0 || p.railBeamTimer > 0) return false;
      const mods = this._mods();
      const perfWin = 0.45 * mods.railPerfectWindowMult;
      const sinceFull = this.fullChargeAt !== null && this.fullChargeAt !== undefined ? this.time - this.fullChargeAt : 99;
      const perfect = power >= 0.97 && sinceFull <= perfWin;
      const overheated = power >= 0.97 && !perfect;
      this.fullChargeAt = null;
      if (overheated) power = 0.8;
      const clampedPower = perfect ? 1.25 : clamp(power, 0.35, 1);
      p.railBeamPower = clampedPower;
      p.railPerfect = perfect;
      p.railBeamTimer = 0.45 + Math.min(1, clampedPower) * 0.35 + (perfect ? 0.2 : 0);
      const px = this._playerWorldX();
      const py = this._playerWorldY();
      if (perfect) {
        this.floatingTexts.push({ x: px, y: py - 110, text: mods.railAwakened ? '🌟 阳电子破城完美释放！' : '⚡ 完美蓄力！', color: '#a5f3fc', life: 1.1, big: true });
      }
      if (this.roguelite) {
        this.roguelite.powerScale = this._skillPowerScale();
        const muzzleY = py - (this.rig.mode === 'tabletop' ? this.rig.length * 0.5 : 28);
        const beamW = (16 + clampedPower * 28) * (mods.railAwakened ? 1.35 : 1);
        this.roguelite.notifyRailgun(px, muzzleY, beamW, clampedPower, this.enemies, this.height * 1.15);
      }
      p.railCooldown = 1.6 * (perfect ? (1 - (mods.railPerfectCdRefund || 0)) : 1);
      if (this.tutorial) this.tutorial.railed = true;
      this.remoteInput.railCharge = 0;
      this.localRailCharge = 0;
      this.touchRailCharge = 0;
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

      this._nuking = true;
      for (let i = this.enemies.length - 1; i >= 0; i--) {
        const e = this.enemies[i];
        if (e.isBoss && e.bossKind === 'fog') e.unveiled = Math.max(e.unveiled || 0, 4);
        this._damageEnemy(e, e.isBoss ? 260 : 9999, i);
      }
      this._nuking = false;
      this.floatingTexts.push({ x: cx, y: cy - 70, text: 'EMP 天窗脉冲清扫！', color: '#fbbf24', life: 1.1 });
      this.onStateChange(this.getPublicState());
      return true;
    }

    // power 0..1: a hard puff into the phone mic hits harder than a tap (taps default to a solid 0.75)
    triggerWindGust(power) {
      const p = this.player;
      if (this.phase !== 'playing' || this.isPaused || p.gustCooldown > 0) return false;
      const pw = clamp(typeof power === 'number' ? power : Math.max(0.6, this.breathPeak), 0.4, 1);
      this.gustUsedCount++;
      if (this.tutorial) this.tutorial.gusted = true;
      p.gustStartedAt = this.time;
      p.gustTimer = 0.9 + pw * 0.6;
      p.gustCooldown = p.gustMaxCooldown;
      p.invulnTimer = Math.max(p.invulnTimer, 0.9);
      this.screenShake = Math.max(this.screenShake, 6 + pw * 6);
      this.sfx.windGust();
      this._rumbleGamepad(0.35 + pw * 0.3, 320);

      const cx = this._playerWorldX();
      const cy = this._playerWorldY();
      const label = pw >= 0.92 ? '呼——！！十级狂风！' : (pw >= 0.7 ? '呼——！借来八级顺风！' : '呼～ 一阵小顺风');
      this.floatingTexts.push({ x: cx, y: cy - 64, text: label, color: '#ffffff', life: 1.15, big: pw >= 0.92 });

      const streaks = Math.round(24 + pw * 30);
      for (let i = 0; i < streaks; i++) {
        this.windStreaks.push({
          ox: (Math.random() - 0.5) * this.width * 1.3,
          oy: this.height * 0.55 - Math.random() * this.height * 0.3,
          len: 90 + Math.random() * 160,
          speed: 1100 + Math.random() * 700,
          life: 0.7 + Math.random() * 0.55,
          a: 0.78
        });
      }

      for (const eb of this.enemyBullets) {
        eb.vy = -700 - pw * 400 - Math.random() * 220;
        eb.vx = (eb.x - cx) * 1.8 + (Math.random() - 0.5) * 220;
        eb.reflected = true;
        eb.color = '#67e8f9';
      }

      const boss = this.boss;
      for (let i = this.enemies.length - 1; i >= 0; i--) {
        const e = this.enemies[i];
        if (e.isBoss) {
          this._damageEnemy(e, 40 + 50 * pw, i);
        } else if (e.fromHangar && boss) {
          // Mothership weakness: escorts get blown straight back into their own hangar
          e.blownBack = true;
          e.fireTimer = 99;
        } else {
          e.y -= 90 + 60 * pw;
          e.vy = -340;
          this._damageEnemy(e, 18 + 22 * pw, i);
        }
      }

      if (boss && !boss.dead) {
        if (boss.bossKind === 'fog') {
          boss.unveiled = 4 + pw * 2;
          this.floatingTexts.push({ x: boss.x, y: boss.y + 90, text: '灰雾护甲被吹散！全力开火！', color: '#fde047', life: 1.6, big: true });
          this._spawnExplosion(boss.x, boss.y, '#e2e8f0', 24, 320);
        } else if (boss.bossKind === 'storm' && this.hazards.length) {
          for (const hz of this.hazards) {
            const dir = Math.sign(hz.x - cx) || (Math.random() < 0.5 ? -1 : 1);
            hz.x += dir * (200 + 140 * pw);
            if (hz.warn > 0) hz.warn += 0.25;
          }
          this.floatingTexts.push({ x: cx, y: cy - 96, text: '闪电被顺风吹偏！', color: '#fde68a', life: 1.3, big: true });
        }
      }

      for (const pwp of this.powerups) {
        pwp.magnet = true;
      }
      if (this.roguelite) {
        this.roguelite.powerScale = this._skillPowerScale();
        const worldVyOffset = this.rig.mode === 'tabletop' ? -p.cruiseSpeed : 0;
        this.roguelite.notifyGust(cx, cy, pw, worldVyOffset);
      }
      return true;
    }

    triggerBarrelRoll() {
      const p = this.player;
      if (this.phase !== 'playing' || this.isPaused || p.rollCooldown > 0) return false;
      p.rollTimer = 0.62;
      p.rollCooldown = this.traits.rollCd;
      p.invulnTimer = Math.max(p.invulnTimer, 0.68);
      this.sfx.barrelRoll();
      this._rumbleGamepad(0.35, 140);

      const cx = this._playerWorldX();
      const cy = this._playerWorldY();
      this.shockwaves.push({ x: cx, y: cy, r: 16, maxR: 155, color: '#a5f3fc', life: 0.38, maxLife: 0.38, width: 6 });
      if (this.roguelite) {
        this.roguelite.powerScale = this._skillPowerScale();
        this.roguelite.notifyBarrelRoll(cx, cy, this.enemies, this.enemyBullets);
      }

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
      if (this.phase === 'playing') key = this.getCurrentChapter().sky;
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

        if (this.skillDraftOpen) {
          if (Math.abs(gx) < 0.25) this._gpStickLatch = false;
          if ((gx < -0.55 && !this._gpStickLatch) || justPressed(14)) {
            this._gpStickLatch = true;
            this.moveSkillFocus(-1);
          } else if ((gx > 0.55 && !this._gpStickLatch) || justPressed(15)) {
            this._gpStickLatch = true;
            this.moveSkillFocus(1);
          }
          if (justPressed(0)) this.confirmSkillFocus();
          if (justPressed(2) || justPressed(3)) this.rerollSkills();
          this.prevGpButtons = gp.buttons.map((b) => Boolean(b && b.pressed));
          return { vx: 0, vy: 0, active: false, firing: false };
        }

        // Start/Options button (9) toggles Pause or Starts Mission!
        if (justPressed(9)) {
          if (this.phase === 'title' || this.phase === 'gameover') this.startMission();
          else if (!this.setupPaused && !this.skillDraftOpen) this.toggleManualPause();
        }

        if (this.phase === 'playing' && !this.isPaused) {
          const mods = this._mods();
          const l2Val = gp.buttons[6] ? gp.buttons[6].value : 0;
          if (l2Val > 0.15) {
            this.localRailCharge = clamp(this.localRailCharge + dt * 1.15 * mods.railChargeMult, 0, 1);
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
        return { vx: gx, vy: gy, active, firing: pressed(0) || pressed(7), breeze: pressed(2) };
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

      const mods = this._mods();
      if (this.keys.has('KeyJ') || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) {
        this.localRailCharge = clamp(this.localRailCharge + dt * 1.1 * mods.railChargeMult, 0, 1);
        this.sfx.chargeTick(this.localRailCharge);
      } else if (this._wasChargingKey) {
        if (this.localRailCharge >= 0.35) this.triggerRailgun(this.localRailCharge);
        this.localRailCharge = 0;
      }
      this._wasChargingKey = this.keys.has('KeyJ') || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');

      if (this.touchRailHeld) {
        this.touchRailCharge = clamp(this.touchRailCharge + dt * 1.1 * mods.railChargeMult, 0, 1);
        this.sfx.chargeTick(this.touchRailCharge);
      }

      const gp = this._pollGamepad(dt);

      let vx = this.remoteInput.vx + kx + gp.vx + (this.pointerDrag.active ? this.pointerDrag.vx : 0);
      let vy = this.remoteInput.vy + ky + gp.vy + (this.pointerDrag.active ? this.pointerDrag.vy : 0);
      const mag = Math.hypot(vx, vy);
      if (mag > 1) {
        vx /= mag;
        vy /= mag;
      }

      const railCharge = this._railCharge();
      // Track when the charge first hit full: releasing within 0.45s is a "perfect" shot, holding longer overheats
      if (railCharge >= 0.97) {
        if (this.fullChargeAt === null || this.fullChargeAt === undefined) {
          this.fullChargeAt = this.time;
          this._sfx('comboMilestone', 50);
          this.onTelemetry({ warn: 'perfect' });
        }
      } else if (railCharge < 0.5) {
        this.fullChargeAt = null;
      }
      // Sustained breath: real mic level from the phone, or holding the gust key/button as a gentle breeze
      const heldBreeze = this.keys.has('KeyF') || gp.breeze ? 0.5 : 0;
      return {
        vx,
        vy,
        firing: !this.hasRemoteFireInput || this.remoteInput.firing || gp.firing || kx !== 0 || ky !== 0 || this.pointerDrag.active,
        railCharge,
        micBreath: this.remoteInput.micLevel || 0,
        breath: Math.max(this.remoteInput.micLevel || 0, heldBreeze)
      };
    }

    step(dt) {
      this._expireRemoteInput(performance.now());
      // Bound catch-up after a stall, then divide slow frames into collision-sized steps.
      const elapsed = clamp(dt, 0, MAX_FRAME_SECONDS);
      const steps = Math.max(1, Math.ceil(elapsed / MAX_STEP_SECONDS));
      for (let i = 0; i < steps; i++) this._stepWorld(elapsed / steps);

      // Publish the latest state once per display frame, even when physics needed several steps.
      this.telemetryAccum += elapsed;
      if (this.telemetryAccum >= 0.06) {
        this.telemetryAccum %= 0.06;
        this._emitRadarTelemetry(this._playerWorldX(), this._playerWorldY());
      }
    }

    _stepWorld(dt) {
      this._calmFactors(dt);
      // The corridor lazily re-centres on the craft, so strafing shows motion but the lane never gets lost
      const laneTarget = this.rig.mode === 'tabletop' ? this.player.worldX : this.width * 0.5 + (this.player.screenX - this.width * 0.5) * 0.18;
      this._laneCamX = this._laneCamX === undefined ? laneTarget : lerp(this._laneCamX, laneTarget, 1 - Math.exp(-dt * 0.55));
      if (this._stateDirty) {
        this._stateDirty = false;
        this.onStateChange(this.getPublicState());
      }
      this._syncMusic();
      if (this.slowMo > 0 && this.phase === 'playing' && !this.isPaused) {
        this.slowMo = Math.max(0, this.slowMo - dt);
        dt *= 0.32;
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
        if (this.scenery) {
          this.scenery.step(dt, {
            sky: this.getEffectiveSky(),
            phase: 'title',
            scrollSpeed: 145,
            cameraVx: gentleX,
            time: this.time,
            calm: this._calmFactors()
          });
        }
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
      if (this.warnThrottle > 0) this.warnThrottle -= dt;
      if (this.comboPulse > 0) this.comboPulse = Math.max(0, this.comboPulse - dt);
      for (const k in this.crewCd) if (this.crewCd[k] > 0) this.crewCd[k] = Math.max(0, this.crewCd[k] - dt);
      for (let i = this.marks.length - 1; i >= 0; i--) {
        this.marks[i].life -= dt;
        if (this.marks[i].life <= 0) this.marks.splice(i, 1);
      }
      // Easy tier + Roguelite Nano-Hull: the hull slowly self-repairs while not being hit
      const mods = this._mods();
      const totalRegen = (this.tier.regen || 0) + (mods.hullRegenPerSec || 0);
      if (totalRegen > 0 && p.invulnTimer <= 0 && p.hp > 0 && p.hp < p.maxHp) {
        p.hp = Math.min(p.maxHp, p.hp + totalRegen * dt);
      }
      if (this.victoryHoldTimer > 0) {
        this.victoryHoldTimer -= dt;
        if (this.victoryHoldTimer <= 0 && this.phase === 'playing') {
          this.victoryHold = true;
          this.victoryHoldSince = Date.now();
          this.setManualPause(true);
          this._sfx('victory');
          return;
        }
      }

      // "借风": a soft, sustained blow is a tailwind — it slows incoming fire, pulls in loot and recharges the big gust
      // Noise gate with hysteresis + 150ms hold so a nearby speaker or chatter doesn't count as breath
      const gateOn = this.breathGate ? 0.18 : 0.26;
      if (inp.breath > gateOn) {
        this.breathGate = true;
        this.breathHold = 0.15;
      } else if (this.breathGate) {
        this.breathHold -= dt;
        if (this.breathHold <= 0) this.breathGate = false;
      }
      let rawBreath = this.breathGate ? inp.breath : 0;
      if (rawBreath > 0 && !this.lungsExhausted) {
        this.lungs = Math.max(0, this.lungs - (dt * 0.24) / mods.lungCapMult);
        if (this.lungs <= 0) {
          this.lungsExhausted = true;
          this.floatingTexts.push({ x: this._playerWorldX(), y: this._playerWorldY() - 70, text: '呼…换口气！', color: '#e0f2fe', life: 1 });
        }
      } else {
        this.lungs = Math.min(1, this.lungs + dt * 0.2 * mods.lungRegenMult);
        if (this.lungsExhausted && this.lungs >= 0.35) this.lungsExhausted = false;
      }
      if (this.lungsExhausted) rawBreath = 0;
      this.breath = lerp(this.breath, rawBreath, 1 - Math.exp(-dt * 6));
      this.breathPeak = Math.max(this.breathPeak - dt * 0.6, this.breathGate ? inp.micBreath : 0);
      if (this.breath > 0.1) {
        const b = this.breath;
        // Only real breath into the phone recharges the big gust (a held key is just a gentle breeze)
        if (inp.micBreath > 0.26) p.gustCooldown = Math.max(0, p.gustCooldown - dt * b * 1.2);
        const bx = this._playerWorldX();
        const by = this._playerWorldY();
        const breezeReflect = mods.breezeReflectChance || 0;
        for (const eb of this.enemyBullets) {
          if (eb.reflected) continue;
          const d = Math.hypot(eb.x - bx, eb.y - by);
          if (d < 320) {
            eb.vy -= 520 * b * dt * (1 - d / 320); // headwind for enemy shots near the craft
            if (breezeReflect > 0 && d < 185 && !eb.breezeTested) {
              eb.breezeTested = true;
              if (Math.random() < breezeReflect * clamp(b * 1.4, 0.5, 1)) {
                eb.vy = -580 - b * 240;
                eb.vx = (eb.x - bx) * 1.5;
                eb.reflected = true;
                eb.color = '#67e8f9';
              }
            }
          }
        }
        for (const pwp of this.powerups) {
          if (Math.hypot(pwp.x - bx, pwp.y - by) < 190 + 260 * b) pwp.magnet = true;
        }
        this.breezeAccum += dt * (6 + b * 30);
        while (this.breezeAccum >= 1 && this.windStreaks.length < 90) {
          this.breezeAccum -= 1;
          this.windStreaks.push({
            ox: (Math.random() - 0.5) * this.width * 1.2,
            oy: (Math.random() - 0.5) * this.height * 0.9,
            len: 40 + Math.random() * 80 * b,
            speed: 700 + Math.random() * 500,
            life: 0.45 + Math.random() * 0.3,
            a: 0.25 + b * 0.35
          });
        }
      }

      // Cockpit low-HP warning + chapter ambience (storm thunder & lightning on the sunset leg)
      if (p.hp <= p.maxHp * 0.3 && !this.rig.godMode) {
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
      const maxLatSpeed = 490 * this.traits.lateral;
      const startX = this._playerWorldX();
      const startY = this._playerWorldY();
      p.bank = lerp(p.bank, inp.vx, 1 - Math.exp(-dt * 11));

      if (this.rig.mode === 'tabletop') {
        p.screenX = this.width * 0.5;
        p.screenY = this.height * this.rig.anchorY;

        p.vx = lerp(p.vx, inp.vx * maxLatSpeed, 1 - Math.exp(-dt * 12));
        const forward = Math.max(0, -inp.vy);
        // Give partial stick travel more throttle while keeping the response smooth at neutral.
        const throttle = forward + 0.35 * forward * (1 - forward);
        const targetCruise = forward > 0
          ? lerp(TABLETOP_CRUISE_SPEED, TABLETOP_FULL_SPEED, throttle)
          : lerp(TABLETOP_CRUISE_SPEED, 155, inp.vy);
        const response = forward > 0 || p.cruiseSpeed > TABLETOP_CRUISE_SPEED ? FORWARD_RESPONSE : 8;
        const priorSpeed = p.cruiseSpeed;
        p.cruiseSpeed = lerp(p.cruiseSpeed, targetCruise, 1 - Math.exp(-dt * response));
        p.vy = -p.cruiseSpeed;

        p.worldX += p.vx * dt;
        // Integrate the changing speed across this step, keeping short dodges consistent across frame rates.
        p.worldY -= targetCruise * dt + (priorSpeed - p.cruiseSpeed) / response;

        const targetRoll = -p.bank * 0.132 + (p.rollTimer > 0 ? Math.sin((p.rollTimer / 0.62) * Math.PI * 2) * 0.24 : 0);
        p.cameraRoll = lerp(p.cameraRoll, targetRoll, 1 - Math.exp(-dt * 10));
      } else {
        p.cameraRoll = 0;
        p.cruiseSpeed = 280;
        p.vx = lerp(p.vx, inp.vx * 520 * this.traits.lateral, 1 - Math.exp(-dt * 14));
        const targetVy = inp.vy * (inp.vy < 0 ? ARCADE_FORWARD_SPEED : 480);
        const response = inp.vy < 0 || p.vy < 0 ? FORWARD_RESPONSE : 14;
        const priorVy = p.vy;
        p.vy = lerp(p.vy, targetVy, 1 - Math.exp(-dt * response));
        const halfW = 34;
        p.screenX = clamp(p.screenX + p.vx * dt, halfW, this.width - halfW);
        p.screenY = clamp(p.screenY + targetVy * dt + (priorVy - p.vy) / response, 56, this.height - 48);
        p.worldX = p.screenX;
        p.worldY -= p.cruiseSpeed * dt;
      }

      this.distanceKm += ((p.cruiseSpeed + this.breath * 170) / 420) * dt;
      p.vxSmooth = lerp(p.vxSmooth || 0, p.vx, 1 - Math.exp(-dt * 1.0)); // ~1s low-pass for spawn lead

      const px = this._playerWorldX();
      const py = this._playerWorldY();

      // Auto Weapon Fire
      p.fireCooldown -= dt;
      if (inp.firing && inp.railCharge < 0.2 && p.railBeamTimer <= 0 && p.fireCooldown <= 0) {
        this._fireMainGuns(px, py);
        const baseGap = [0.115, 0.115, 0.111, 0.104, 0.096, 0.088][clamp(p.weaponLv, 1, 5)];
        p.fireCooldown = (baseGap * this.traits.fireRate * SHOT_THIN) / mods.fireRateMult;
      }

      // Flanking Bit-Drones Auto Fire
      p.droneFireCooldown -= dt;
      if (inp.firing && p.droneCount > 0 && p.droneFireCooldown <= 0) {
        this._fireDroneGuns(px, py);
        p.droneFireCooldown = 0.42 / mods.fireRateMult;
      }

      // Active Railgun Continuous Sweep Damage
      if (p.railBeamTimer > 0) {
        const beamHalfW = (16 + p.railBeamPower * 28) * (mods.railAwakened ? 1.35 : 1);
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
            // A perfect (fully charged) shot is the answer to an enraged boss core
            const coreBonus = p.railPerfect && e.isBoss && e.enraged ? 2 : 1;
            this._damageEnemy(e, (260 + 220 * p.railBeamPower) * mods.railDamageMult * coreBonus * dt, i);
          }
        }
      }

      if (this.scenery) {
        this.scenery.step(dt, {
          sky: this.getEffectiveSky(),
          phase: this.phase,
          scrollSpeed: p.cruiseSpeed + this.breath * 140,
          boost: this._visualBoost(),
          cameraVx: this.rig.mode === 'tabletop' ? p.vx : p.vx * 0.18,
          time: this.time,
          calm: this._calmFactors()
        });
      }

      if (this.tutorial) this._stepTutorial(dt, inp);
      this._stepCoach(dt);
      this._stepSpawner(dt, px, py);
      this._stepHazards(dt, px, py);
      this._stepPlayerBullets(dt, px, py);
      this._stepEnemies(dt, px, py);
      const isTabletop = this.rig.mode === 'tabletop';
      const stepCamSpeed = isTabletop ? (dt > 0 ? (startY - py) / dt : p.cruiseSpeed) : 0;
      const playerWorldVy = isTabletop ? -stepCamSpeed : 0;
      const forwardSurge = isTabletop ? Math.max(0, stepCamSpeed - TABLETOP_CRUISE_SPEED) : 0;
      const pickupSurgeVy = forwardSurge * TABLETOP_PICKUP_SURGE_SCALE;
      const surgeRatio = isTabletop ? clamp(forwardSurge / (TABLETOP_FULL_SPEED - TABLETOP_CRUISE_SPEED), 0, 1) : 0;
      const rigPad = isTabletop ? Math.max(0, Math.max(this.rig.width, this.rig.length) * 0.5 - 30) : 0;

      this._stepEnemyBullets(dt, px, py, startX, startY);
      this._stepStarRoute(dt, px, py, startX, startY, playerWorldVy, pickupSurgeVy);
      this._stepPowerups(dt, px, py, startX, startY, playerWorldVy, pickupSurgeVy, surgeRatio, rigPad);
      if (this.roguelite) {
        this.roguelite.step(dt, {
          playerX: px,
          playerY: py,
          startX,
          startY,
          W: this.width,
          H: this.height,
          worldVyOffset: playerWorldVy,
          pickupSurgeVy,
          surgeRatio,
          collectRadius: isTabletop ? Math.max(36, Math.max(this.rig.width, this.rig.length) * 0.54) : 30,
          magnetBonus: rigPad,
          starMagnet: this.starMagnet > 0,
          powerScale: this._skillPowerScale(),
          droneCount: p.droneCount,
          shieldCount: p.shield,
          breath: this.breath,
          gustActive: p.gustTimer > 0,
          tutorial: Boolean(this.tutorial),
          isPaused: this.isPaused,
          phase: this.phase,
          enemies: this.enemies,
          enemyBullets: this.enemyBullets
        });
      }
      this._stepParticles(dt);
      this._stepContrails(dt, px, py);
      this._stepCloudInteraction(dt, px, py);
    }

    _visualBoost() {
      const speed = this.player.cruiseSpeed + this.breath * 140;
      if (this.rig.mode === 'arcade') return clamp((speed - 260) / 300, 0, 1);
      return clamp((speed - TABLETOP_CRUISE_SPEED) / (TABLETOP_FULL_SPEED - TABLETOP_CRUISE_SPEED), 0, 1);
    }

    _muzzleOffsetY() {
      return this.rig.mode === 'tabletop' ? -(this.rig.length * 0.5 + 10) : -28;
    }

    _droneSideOffsetX() {
      return this.rig.mode === 'tabletop' ? (this.rig.width * 0.5 + 30) : 44;
    }

    // Formation slots for up to 6 flanking bit-drones (relative to the craft centre)
    _droneSlots() {
      const side = this._droneSideOffsetX();
      const back = this.rig.mode === 'tabletop' ? this.rig.length * 0.32 + 14 : 30;
      const mods = this._mods();
      const slots = [
        { x: -side, y: 8 },
        { x: side, y: 8 },
        { x: -side * 0.62, y: 8 + back },
        { x: side * 0.62, y: 8 + back },
        { x: -side * 1.28, y: 18 + back * 0.45 },
        { x: side * 1.28, y: 18 + back * 0.45 }
      ];
      return slots.slice(0, clamp(this.player.droneCount, 0, mods.maxDrones || 4));
    }

    // Resolve shot silhouette & cool-spectrum tint from manual style or dynamic craft + skill build evolution
    _resolveBulletVisual(slotRole, baseTint, mods, isCrit, isTeslaCharged) {
      const SHOT = { '#0369a1': '#38bdf8', '#ea580c': '#7dd3fc', '#dc2626': '#e0f2fe' };
      const sk = (this.roguelite && this.roguelite.skills) || {};
      const manual = this.rig.bulletStyle && this.rig.bulletStyle !== 'auto' ? this.rig.bulletStyle : null;

      if (manual) {
        const color = isCrit
          ? '#fde047'
          : (isTeslaCharged ? '#c4b5fd' : (mods.pierceCount > 0 && slotRole === 'core' ? '#a5b4fc' : (SHOT[baseTint] || '#38bdf8')));
        return { shape: manual, color };
      }

      if (isCrit) {
        return { shape: sk.awakening_barrage ? 'sword' : 'star', color: '#fde047' };
      }
      if (sk.awakening_barrage) {
        return { shape: 'sword', color: slotRole === 'core' ? '#fef08a' : '#7dd3fc' };
      }
      if (sk.awakening_tempest) {
        return { shape: 'blade', color: slotRole === 'core' ? '#99f6e4' : '#2dd4bf' };
      }
      if (sk.awakening_rail && slotRole === 'core') {
        return { shape: 'lance', color: '#a5f3fc' };
      }
      if (slotRole === 'split') {
        return { shape: 'prism', color: mods.pierceCount > 0 ? '#a5b4fc' : '#38bdf8' };
      }
      if (mods.pierceCount > 0) {
        return { shape: 'lance', color: slotRole === 'core' ? '#c7d2fe' : '#818cf8' };
      }
      if (isTeslaCharged) {
        return { shape: 'prism', color: '#c4b5fd' };
      }
      if (sk.awakening_aegis && this.player.shield > 0 && slotRole === 'core') {
        return { shape: 'prism', color: '#67e8f9' };
      }
      if ((sk.wind_blades || 0) > 0 && slotRole === 'wing') {
        return { shape: 'blade', color: '#5eead4' };
      }

      // Baseline craft identity: agile jet = supersonic laser, tank car = heavy slug, guardian orb = crescent pulse
      if (this.rig.shape === 'car') {
        return { shape: 'slug', color: slotRole === 'core' ? '#bae6fd' : '#7dd3fc' };
      }
      if (this.rig.shape === 'orb') {
        return { shape: 'blade', color: slotRole === 'core' ? '#a5f3fc' : '#67e8f9' };
      }
      return { shape: 'laser', color: SHOT[baseTint] || '#38bdf8' };
    }

    _fireMainGuns(px, py) {
      const my = py + this._muzzleOffsetY();
      const worldVyOffset = this.rig.mode === 'tabletop' ? -this.player.cruiseSpeed : 0;
      const baseVy = worldVyOffset - 920;
      const lv = this.player.weaponLv;
      const mods = this._mods();
      const isTeslaCharged = Boolean(
        this.roguelite && (this.roguelite.skills.tesla_chain || 0) > 0 && (this.roguelite.teslaShotCounter + 1) >= 5
      );

      this.sfx.laser(lv);

      // Player palette stays cool (cyan / ice / teal / indigo) unless landing a golden Crit / Barrage!
      const addShot = (ox, vx, dmg, color = '#0369a1', w = 4.5, h = 19, slotRole = 'wing') => {
        const heavy = this.traits.dmg;
        const isCrit = mods.critChance > 0 && Math.random() < mods.critChance;
        const finalDmg = dmg * heavy * SHOT_THIN * mods.damageMult * (isCrit ? mods.critMult : 1);
        const vis = this._resolveBulletVisual(slotRole, color, mods, isCrit, isTeslaCharged);
        const pierceStretch = mods.pierceCount > 0 ? 1 + mods.pierceCount * 0.08 : 1;
        this.bullets.push({
          x: px + ox,
          y: my,
          vx,
          vy: baseVy,
          dmg: finalDmg,
          crit: isCrit,
          pierceLeft: mods.pierceCount || 0,
          hitSet: mods.pierceCount > 0 ? new Set() : null,
          shape: vis.shape,
          color: vis.color,
          w: (heavy > 1.1 ? w * 1.28 : w) * (isCrit ? 1.25 : 1),
          h: h * pierceStretch * (isCrit ? 1.18 : 1),
          life: 1.35
        });
      };

      const spreadBase = this.rig.mode === 'tabletop' ? Math.min(26, this.rig.width * 0.24) : 11;
      if (lv === 1) {
        addShot(-spreadBase, 0, 14, '#0369a1', 4.5, 19, 'core');
        addShot(spreadBase, 0, 14, '#0369a1', 4.5, 19, 'core');
      } else if (lv === 2) {
        addShot(0, 0, 17, '#ea580c', 5, 22, 'core');
        addShot(-spreadBase * 1.18, -62, 12.5, '#0369a1', 4.5, 19, 'wing');
        addShot(spreadBase * 1.18, 62, 12.5, '#0369a1', 4.5, 19, 'wing');
      } else if (lv === 3) {
        addShot(-spreadBase * 0.62, 0, 16.5, '#ea580c', 5, 22, 'core');
        addShot(spreadBase * 0.62, 0, 16.5, '#ea580c', 5, 22, 'core');
        addShot(-spreadBase * 1.38, -115, 13, '#0369a1', 4.5, 19, 'wing');
        addShot(spreadBase * 1.38, 115, 13, '#0369a1', 4.5, 19, 'wing');
      } else if (lv === 4) {
        addShot(0, 0, 21, '#dc2626', 6, 24, 'core');
        addShot(-spreadBase * 0.95, -58, 15.5, '#ea580c', 5, 20, 'core');
        addShot(spreadBase * 0.95, 58, 15.5, '#ea580c', 5, 20, 'core');
        addShot(-spreadBase * 1.6, -165, 13, '#0369a1', 4.5, 19, 'wing');
        addShot(spreadBase * 1.6, 165, 13, '#0369a1', 4.5, 19, 'wing');
      } else {
        // Lv5 (endless route): twin heavy cores + focused triple fan
        addShot(-spreadBase * 0.45, 0, 21, '#dc2626', 6, 26, 'core');
        addShot(spreadBase * 0.45, 0, 21, '#dc2626', 6, 26, 'core');
        addShot(-spreadBase * 1.05, -65, 16, '#ea580c', 5, 21, 'core');
        addShot(spreadBase * 1.05, 65, 16, '#ea580c', 5, 21, 'core');
        addShot(-spreadBase * 1.68, -175, 14, '#0369a1', 4.5, 19, 'wing');
        addShot(spreadBase * 1.68, 175, 14, '#0369a1', 4.5, 19, 'wing');
        addShot(-spreadBase * 2.05, -265, 12, '#0369a1', 4.5, 18, 'wing');
        addShot(spreadBase * 2.05, 265, 12, '#0369a1', 4.5, 18, 'wing');
      }

      // Roguelite Split-Prism extra diagonal volleys + Sword Barrage / Tesla counter
      if (mods.splitShots > 0) {
        const splitDmg = 10.2 + lv * 0.8;
        for (let s = 1; s <= mods.splitShots; s++) {
          const svx = 105 * s;
          addShot(-spreadBase * 0.78, -svx, splitDmg, '#0369a1', 4.2, 17.5, 'split');
          addShot(spreadBase * 0.78, svx, splitDmg, '#0369a1', 4.2, 17.5, 'split');
        }
      }
      if (this.roguelite) {
        this.roguelite.powerScale = this._skillPowerScale();
        this.roguelite.notifyMainShot(px, my, (15 + lv * 1.6) * this.traits.dmg * (mods.globalDmgMult || 1), worldVyOffset, this.enemies);
      }
    }

    _fireDroneGuns(px, py) {
      const baseVy = (this.rig.mode === 'tabletop' ? -this.player.cruiseSpeed : 0) - 780;
      const mods = this._mods();
      const droneDmg = (16 + (this.player.weaponLv - 1) * 1.5) * mods.droneDamageMult;

      let target = null;
      let bestDist = 680;
      for (const e of this.enemies) {
        const d = Math.hypot(e.x - px, e.y - py) - (e.marked > 0 ? 2000 : 0); // ground-crew marks come first
        if (e.y < py + 40 && d < bestDist) {
          bestDist = d;
          target = e;
        }
      }

      const slots = this._droneSlots();
      for (const slot of slots) {
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
        this.bullets.push({
          x: dx, y: dy - 12, vx, vy, dmg: droneDmg,
          shape: mods.hiveAwakened ? 'lance' : 'drone',
          color: mods.hiveAwakened ? '#fde047' : '#4ade80',
          w: mods.hiveAwakened ? 4.4 : 3.8, h: mods.hiveAwakened ? 16 : 13.5,
          life: 1.2, drone: true
        });
      }
      if (slots.length > 0 && this.roguelite) {
        this.roguelite.powerScale = this._skillPowerScale();
        this.roguelite.notifyDroneVolley(px, py, this.enemies, droneDmg);
      }
    }

    // Aim with lead: in tabletop the craft can strafe at ~490px/s, so pure aimed fire would always trail behind
    _aimAngle(x, y, speed) {
      const px = this._playerWorldX();
      const py = this._playerWorldY();
      const t = Math.hypot(px - x, py - y) / Math.max(60, speed * this.tier.bulletSpeed);
      const leadX = this.player.vx * t * (this.rig.mode === 'tabletop' ? 0.8 : 0.45);
      return Math.atan2(py - y, px + leadX - x);
    }

    get traits() {
      return TOY_TRAITS[this.rig.shape] || TOY_TRAITS.jet;
    }

    get toyLabel() {
      return this.rig.toyName || '桌面小飞机';
    }

    // Radius of the bullet hit core (independent of the toy's physical size)
    get hitCoreR() {
      return this.traits.core * (HIT_SIZE[this.rig.hitSize] || 1);
    }

    _applyToyTraits(refill) {
      const p = this.player;
      const t = this.traits;
      const mods = this._mods();
      const prevMax = p.maxHp > 0 ? p.maxHp : t.maxHp;
      const bonus = this.phase === 'playing' ? ((this.hullBonus || 0) + (mods.maxHpBonus || 0)) : 0;
      const nextMax = t.maxHp + bonus;
      p.maxHp = nextMax;
      if (refill) {
        p.hp = nextMax;
      } else if (nextMax !== prevMax) {
        const ratio = clamp(p.hp / prevMax, 0, 1);
        p.hp = clamp(nextMax * ratio, p.hp > 0 ? 1 : 0, nextMax);
      } else {
        p.hp = Math.min(nextMax, p.hp);
      }
      p.gustMaxCooldown = 6 * t.gustCd * (mods.gustCdMult || 1);
    }

    get tier() {
      return DIFFICULTY[this.rig.difficulty] || DIFFICULTY.normal;
    }

    // Seconds of regular flight before this chapter's blockade boss
    _chapterLength() {
      const ch = this.getCurrentChapter();
      return ch.loop > 0 ? ENDLESS_LENGTH : CHAPTER_LENGTH[ch.idx];
    }

    get chapterProgress() {
      return clamp(this.chapterTime / this._chapterLength(), 0, 1);
    }

    // Overall pressure: 0 at take-off, 1 at the end of act III, then keeps climbing on the endless route.
    // Everything that makes the sky harder (spawn rate, enemy hull, fire rate) reads from this one curve,
    // so the voyage ramps up smoothly instead of spiking.
    _pressure() {
      const ch = this.getCurrentChapter();
      const prog = this.boss ? 1 : this.chapterProgress;
      if (ch.loop === 0) return (ch.idx + prog) / STORY_CHAPTERS.length;
      return 1 + ((ch.loop - 1) * STORY_CHAPTERS.length + ch.idx + prog) * 0.12;
    }

    // Enemy hull multiplier
    _difficulty() {
      return 0.8 + this._pressure() * 1.2;
    }

    // Multiplier on enemy re-fire delays: early skies shoot noticeably less
    _fireGap() {
      const pr = this._pressure();
      return pr <= 1 ? lerp(1.6, 1.0, pr) : Math.max(0.72, 1 - (pr - 1) * 0.2);
    }

    get weaponCap() {
      return clamp(this.wave + 1, 2, MAX_WEAPON_LV);
    }

    _topSpawnY(py) {
      return this.rig.mode === 'tabletop'
        ? py - this.height * this.rig.anchorY - 70
        : -60;
    }

    _stepSpawner(dt, px, py) {
      const topSpawnY = this._topSpawnY(py);
      if (this.tutorial) return; // the guided first flight places its own enemies

      if (!this.boss && this.victoryHoldTimer <= 0) {
        this.chapterTime += dt;
        const len = this._chapterLength();
        // Half-way supply drop: a guaranteed, visible step up in strength every chapter
        if (!this.supplyDropped && this.chapterTime >= len * 0.5) {
          this.supplyDropped = true;
          this._supplyDrop(px, py);
        }
        // Breather just before the blockade: stop sending fresh enemies for the last few seconds
        if (this.chapterTime >= len) {
          if (this.enemies.length === 0 || this.chapterTime >= len + 6) this._spawnBoss(px, topSpawnY);
          return;
        }
        if (this.chapterTime >= len - 4) return;
      }

      this.spawnTimer -= dt;
      if (this.spawnTimer > 0) return;

      const difficulty = this._difficulty();
      const pr = this._pressure();
      const gap = pr <= 1 ? lerp(2.5, 0.95, pr) : Math.max(0.6, 0.95 - (pr - 1) * 0.25);
      this.spawnTimer = (this.boss ? 2.6 : gap) * this.tier.spawn;

      // Bosses only get light escorts; the story table decides the rest, unlocking types as the chapter goes on
      const ch = this.getCurrentChapter();
      const table = SPAWN_TABLES[ch.idx];
      const prog = this.chapterProgress;
      const unlocked = ch.loop > 0 ? table : table.filter(([, , at]) => prog >= at);
      const pool = this.boss ? unlocked.filter(([t]) => t === 'scout' || t === 'mine') : unlocked;
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
      // Meet a strafing craft where it will be by the time this group reaches its altitude (~2.5s)
      if (this.rig.mode === 'tabletop') {
        // Smoothed velocity: a sustained strafe gets full lead, a left-right dodger (≈0 average) gets almost none
        px += clamp((this.player.vxSmooth || 0) * 2.4, -this.width, this.width);
      }
      this._tip(type);
      const spanW = Math.min(this.width * 0.84, 760);
      const hp = ENEMY_HULL[type] * difficulty;
      const base = (extra) => ({ hp, maxHp: hp, phase: Math.random() * Math.PI * 2, age: 0, hitFlash: 0, ...extra });

      if (type === 'scout') {
        const pr = this._pressure();
        const count = (pr < 0.15 ? 2 : 3) + Math.floor(Math.random() * (pr < 0.33 ? 2 : 3));
        const startX = px + (Math.random() - 0.5) * (spanW * 0.65);
        const dir = Math.random() < 0.5 ? 1 : -1;
        for (let i = 0; i < count; i++) {
          this.enemies.push(base({
            type: 'scout', x: startX + dir * i * 48, y: topSpawnY - i * 42,
            vx: -dir * 65, vy: 155 * Math.min(1.5, difficulty * 0.75),
            radius: 20,
            fireTimer: 0.9 + i * 0.25, scoreVal: 110
          }));
        }
      } else if (type === 'gunship') {
        this.enemies.push(base({
          type: 'gunship', x: px + (Math.random() - 0.5) * spanW * 0.75, y: topSpawnY - 20,
          vx: 0, vy: 95, radius: 32,
          fireTimer: 0.8, dropsLoot: true, scoreVal: 340
        }));
      } else if (type === 'lancer') {
        const n = this.wave >= 2 && Math.random() < 0.5 ? 2 : 1;
        for (let i = 0; i < n; i++) {
          this.enemies.push(base({
            type: 'lancer', x: px + (Math.random() - 0.5) * spanW * 0.85, y: topSpawnY - 10 - i * 60,
            vx: 0, vy: 60, radius: 21,
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
            radius: 18,
            fireTimer: 1.2 + i * 0.3, scoreVal: 150, sideCull: true
          }));
        }
      } else if (type === 'bomber') {
        this.enemies.push(base({
          type: 'bomber', x: px + (Math.random() - 0.5) * spanW * 0.6, y: topSpawnY - 30,
          vx: (Math.random() < 0.5 ? -1 : 1) * 45, vy: 62,
          radius: 40, fireTimer: 1.4, mineTimer: 1.1, dropsLoot: true, scoreVal: 520
        }));
      } else if (type === 'sentinel') {
        // Parks in the upper sky and spins a flower of bullets until destroyed
        this.enemies.push(base({
          type: 'sentinel', x: px + (Math.random() - 0.5) * spanW * 0.6, y: topSpawnY - 20,
          vx: 0, vy: 140, parkY: 0.24 + Math.random() * 0.14,
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
      const hp = ENEMY_HULL.mine * difficulty;
      this.enemies.push({
        type: 'mine', x, y, vx: 0, vy: 0, phase: Math.random() * 6, age: 0, hitFlash: 0,
        hp, maxHp: hp, radius: 15, fireTimer: 99,
        armTimer: -1, scoreVal: 80, worldStatic: true
      });
    }

    _spawnBoss(px, topSpawnY) {
      this.starRoute = null;
      const ch = this.getCurrentChapter();
      const kind = BOSS_ORDER[ch.idx];
      const def = BOSS_DEFS[kind];
      const endlessBase = Math.max(BOSS_HP[ch.idx] * 1.3, 6000 + ch.idx * 900);
      const hp = Math.round((ch.loop === 0 ? BOSS_HP[ch.idx] : endlessBase) * (1 + this.loopIndex * 0.36));
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
      this._tip('boss');
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

        let removeBullet = false;
        for (let j = this.enemies.length - 1; j >= 0; j--) {
          const e = this.enemies[j];
          if (!e || e.dead) continue;
          if (b.hitSet && b.hitSet.has(e)) continue;
          if (Math.abs(b.x - e.x) < e.radius + b.w && Math.abs(b.y - e.y) < e.radius + b.h * 0.5) {
            this._spawnExplosion(b.x, b.y, b.color, b.crit ? 5 : 3, b.crit ? 115 : 85);
            this.sfx.enemyHit();
            if (b.crit && Math.random() < 0.35) {
              this.floatingTexts.push({ x: e.x + (Math.random() - 0.5) * 18, y: e.y - 16, text: `暴击 ${Math.round(b.dmg)}`, color: '#fde047', life: 0.55 });
            }
            if ((b.crit || b.drone) && this.roguelite) {
              this.roguelite.notifyCritOrDroneHit(e, this.enemies, b.dmg);
            }
            this._damageEnemy(e, b.dmg, j);
            if (b.pierceLeft && b.pierceLeft > 0) {
              b.pierceLeft -= 1;
              if (!b.hitSet) b.hitSet = new Set();
              b.hitSet.add(e);
            } else {
              removeBullet = true;
              break;
            }
          }
        }
        if (removeBullet) this.bullets.splice(i, 1);
      }
    }

    _damageEnemy(e, dmg, indexInArray, meta = {}) {
      if (e.dead) return;
      if (e.bossKind === 'fog' && !(e.unveiled > 0) && dmg < 1e6) dmg *= 0.5;
      if ((e.launchShield > 0 || e.blownBack) && dmg < 1e6 && !this._nuking) return; // fresh hangar escorts: blow them back!
      if (e.marked > 0) dmg *= 1.5; // ground-crew target mark
      const prevHpRatio = e.maxHp > 0 ? e.hp / e.maxHp : 1;
      e.hp -= dmg;
      e.hitFlash = 0.08;

      // Boss phase XP fountain: every 20% HP lost showers XP gems so player levels up mid-boss too!
      if (e.isBoss && this.roguelite) {
        const xpScale = this._xpDropScale();
        for (const threshold of BOSS_XP_THRESHOLDS) {
          if (prevHpRatio > threshold && e.hp <= e.maxHp * threshold) {
            this.roguelite.spawnXpBurst(e.x, e.y + 24, Math.round(34 * xpScale), 7);
          }
        }
      }

      // Boss enrage at half HP: new choreography + visual overdrive
      if (e.isBoss && !e.enraged && e.hp > 0 && e.hp <= e.maxHp * 0.5) {
        e.enraged = true;
        e.fireTimer = 1.1;
        this.screenShake = Math.max(this.screenShake, 14);
        this.flashAlpha = Math.max(this.flashAlpha, 0.22);
        this._sfx('bossPhase');
        this._rumbleGamepad(0.7, 300);
        this.onTelemetry({ warn: 'enrage' });
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
        this.comboPulse = 0.6; // the HUD counter flashes; no big text in front of the craft
      }
      const mult = 1 + Math.min(2.0, this.combo * 0.05);
      const pts = Math.round(e.scoreVal * mult * (1 + this.loopIndex * 0.5));
      this.score += pts;
      this.kills++;
      if (this.tutorial && e.tutorial) this.tutorial.kills++;
      if (!this._nuking) this.killsForNuke++;

      if (this.killsForNuke >= 48) {
        this.killsForNuke = 0;
        if (this.player.nukes < this.player.maxNukes) {
          this.player.nukes++;
          this.floatingTexts.push({ x: e.x, y: e.y - 24, text: '+1 战术核弹充能', color: '#f97316', life: 1.2 });
        }
      }

      const xpScale = this._xpDropScale();
      if (e.isBoss) {
        if (this.roguelite && !this._nuking) this.roguelite.spawnXpFromKill(e.x, e.y, 'boss', true, xpScale);
        this._onBossDefeated(e);
      } else if (e.type === 'mine') {
        if (this.roguelite && !this._nuking) this.roguelite.spawnXpFromKill(e.x, e.y, 'mine', false, xpScale);
        // Shot mines pop harmlessly (only proximity detonation throws shrapnel)
        this.sfx.enemyBoom(false);
        this._spawnExplosion(e.x, e.y, '#fca5a5', 10, 160);
        this.shockwaves.push({ x: e.x, y: e.y, r: 6, maxR: 70, color: '#fda4af', life: 0.3, maxLife: 0.3, width: 4 });
      } else {
        if (this.roguelite && !this._nuking) this.roguelite.spawnXpFromKill(e.x, e.y, e.fromHangar ? 'escort' : e.type, false, xpScale);
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
          else kind = r < 0.36 ? 'weapon' : (r < 0.58 ? 'heal' : (r < 0.78 ? 'shield' : (r < 0.9 ? 'drone' : 'nuke')));
          this._spawnPowerup(e.x, e.y, kind);
        } else if (Math.random() < 0.08) {
          this._spawnPowerup(e.x, e.y, Math.random() < 0.6 ? 'weapon' : 'heal');
        }
        // Gold medals: chain-collect them for ever-rising bonus points
        if (Math.random() < (big ? 1 : 0.32)) {
          this._spawnPowerup(e.x + (Math.random() - 0.5) * 20, e.y, 'medal');
        }
      }
      this._stateDirty = true; // flushed once per frame: a nuke can kill dozens at once
    }

    _onBossDefeated(e) {
      this.boss = null;
      this.bossKills++;
      const clearedWave = this.wave;
      this.wave++;
      this.starRouteIndex = 0;
      this.starRoute = null;
      // The next chapter's clock starts from zero: it gets its full length before the next blockade
      this.chapterTime = 0;
      this.supplyDropped = false;
      this.spawnTimer = 3;
      const upgrade = this._chapterUpgrade();
      // Expire (rather than truncate) projectiles & lanes: this can run from inside their own update loops
      for (const b of this.enemyBullets) b.life = 0;
      for (const hz of this.hazards) hz.dead = true;
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
        this.victoryHoldTimer = 4.6; // let the fireworks play, then offer: continue endless or land
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
        this.storyBanner.subtitle = `强化：${upgrade}`;
        this.storyBanner.timer = this.storyBanner.maxTimer = 5;
      }
    }

    // Clearing a blockade makes the craft permanently stronger for the rest of the voyage
    _chapterUpgrade() {
      const p = this.player;
      const mods = this._mods();
      const parts = [];
      this.hullBonus = (this.hullBonus || 0) + 15;
      p.maxHp = this.traits.maxHp + this.hullBonus + (mods.maxHpBonus || 0);
      p.hp = Math.min(p.maxHp, p.hp + 15 + p.maxHp * 0.35);
      parts.push('机体上限 +15');
      if (p.droneCount < (mods.maxDrones || 4)) {
        p.droneCount++;
        parts.push(`僚机 ×${p.droneCount}`);
      }
      if (p.nukes < p.maxNukes) {
        p.nukes++;
        parts.push('核弹 +1');
      }
      if (this.weaponCap > p.weaponLv) parts.push(`火力上限 Lv.${this.weaponCap}`);
      this.floatingTexts.push({ x: this._playerWorldX(), y: this._playerWorldY() - 130, text: '⬆ 航段强化！', color: '#86efac', life: 2, big: true });
      this._stateDirty = true;
      return parts.join(' · ');
    }

    // ===================== Guided first flight & one-time tips =====================

    _startTutorial() {
      this.tutorial = { idx: -1, t: 0, kills: 0, moved: 0, gusted: false, railed: false, picked: null };
      this._enterTutorialStep(0);
    }

    get tutorialStep() {
      return this.tutorial ? TUTORIAL_STEPS[this.tutorial.idx] : null;
    }

    _enterTutorialStep(idx) {
      const tu = this.tutorial;
      if (!tu) return;
      if (idx >= TUTORIAL_STEPS.length) {
        this._finishTutorial(false);
        return;
      }
      tu.idx = idx;
      tu.t = 0;
      tu.kills = 0;
      tu.picked = null;
      tu.gusted = false;
      tu.railed = false;
      tu.timedOut = false;
      const p = this.player;
      const id = TUTORIAL_STEPS[idx].id;
      if (idx > 0) this._sfx('medal', Math.min(10, idx + 2));
      if (id === 'shoot') this._tutorialSpawn('shoot');
      else if (id === 'pickup') this._tutorialSpawn('pickup');
      else if (id === 'dodge') this._tutorialSpawn('dodge');
      else if (id === 'gust') {
        p.gustCooldown = 0;
        this._tutorialSpawn('gust');
      } else if (id === 'rail') {
        p.railCooldown = 0;
        this._tutorialSpawn('rail');
      }
      this._emitCoach();
    }

    // Places the enemies / items a step needs, tagged so the step can tell when they are gone
    _tutorialSpawn(id) {
      const px = this._playerWorldX();
      const py = this._playerWorldY();
      const top = this._topSpawnY(py);
      const before = this.enemies.length;
      if (id === 'shoot') {
        this._spawnGroup('scout', px, py, top, 0.8);
        this._spawnGroup('scout', px, py, top - 160, 0.8);
      } else if (id === 'pickup') {
        const ahead = this.rig.mode === 'tabletop' ? this.height * 0.42 : this.height * 0.4;
        this._spawnPowerup(px, this.rig.mode === 'tabletop' ? py - ahead : Math.max(90, py - ahead), 'weapon');
        const pw = this.powerups[this.powerups.length - 1];
        pw.life = 20;
        pw.tutorial = true;
      } else if (id === 'dodge') {
        this._spawnGroup('gunship', px, py, top, 2); // sturdier, so there is time to watch its shots
      } else if (id === 'gust') {
        this._spawnGroup('gunship', px - 120, py, top, 0.8);
        this._spawnGroup('gunship', px + 120, py, top - 40, 0.8);
      } else if (id === 'rail') {
        this._spawnGroup('bomber', px, py, top, 3);
      }
      for (let i = before; i < this.enemies.length; i++) {
        const e = this.enemies[i];
        e.tutorial = true;
        if (id === 'shoot') e.fireTimer = 99; // first targets don't shoot back
        if (id === 'rail') e.mineTimer = 99;
        if (id === 'dodge' || id === 'gust') e.fireTimer = 0.6;
      }
    }

    _stepTutorial(dt, inp) {
      const tu = this.tutorial;
      const step = this.tutorialStep;
      if (!tu || !step) return;
      tu.t += dt;
      const tagged = this.enemies.some((e) => e.tutorial);
      let done = false;
      if (step.id === 'move') {
        if (Math.abs(inp.vx) + Math.abs(inp.vy) > 0.25) tu.moved += dt;
        done = tu.moved >= 0.9;
      } else if (step.id === 'shoot') {
        done = tu.kills >= step.need;
        if (!done && !tagged) this._tutorialSpawn('shoot');
      } else if (step.id === 'pickup') {
        done = tu.picked === 'weapon';
        const pw = this.powerups.find((it) => it.tutorial);
        if (pw && (tu.t > 3 || pw.y > this._playerWorldY() + 60)) pw.magnet = true; // don't let it slip past
        if (!done && !pw) this._tutorialSpawn('pickup');
      } else if (step.id === 'dodge') {
        done = tu.kills >= 1 && !tagged;
        if (!done && !tagged) this._tutorialSpawn('dodge');
      } else if (step.id === 'gust') {
        done = tu.gusted;
        if (!done && !tagged) this._tutorialSpawn('gust');
      } else if (step.id === 'rail') {
        done = tu.railed;
        if (!done && !tagged) this._tutorialSpawn('rail');
      } else if (step.id === 'done') {
        done = tu.t >= step.timeout;
      }
      if (!done && tu.t >= step.timeout) {
        done = true;
        if (step.id !== 'done') {
          this.floatingTexts.push({ x: this._playerWorldX(), y: this._playerWorldY() - 96, text: '没关系，飞行中随时可以再试', color: '#e0f2fe', life: 1.6 });
        }
      }
      if (done) {
        if (step.id !== 'done') {
          this.floatingTexts.push({ x: this._playerWorldX(), y: this._playerWorldY() - 120, text: '✔ 完成！', color: '#86efac', life: 1.1, big: true });
        }
        this._enterTutorialStep(tu.idx + 1);
      } else if (step.id === 'shoot' && tu.kills !== tu.lastKills) {
        tu.lastKills = tu.kills;
        this._emitCoach();
      }
    }

    // skipped: the player pressed "skip"; either way the guided flight is not forced again
    _finishTutorial(skipped) {
      if (!this.tutorial) return;
      this.tutorial = null;
      this.tutorialDone = true;
      saveJSON(TUTORIAL_KEY, true);
      // What the tutorial already explained doesn't need a tip later
      for (const k of ['scout', 'gunship', 'bomber', 'weapon']) this.tipsSeen[k] = true;
      saveJSON(TIPS_KEY, this.tipsSeen);
      for (const e of this.enemies) if (e.tutorial) e.tutorial = false;
      this.player.gustCooldown = 0;
      this.player.railCooldown = 0;
      this.chapterTime = 0;
      this.spawnTimer = skipped ? 1.6 : 2.4;
      this._announceChapter(this.wave);
      this._emitCoach();
      this._stateDirty = true;
    }

    skipTutorial() {
      if (this.tutorial) this._finishTutorial(true);
    }

    // Queue a one-time explanation the first time something turns up
    _tip(key) {
      if (this.tutorial || this.tipsSeen[key] || !FIRST_TIPS[key] || this.phase !== 'playing') return;
      this.tipsSeen[key] = true;
      saveJSON(TIPS_KEY, this.tipsSeen);
      if (this.coachQueue.length < 4) this.coachQueue.push({ key, ...FIRST_TIPS[key] });
    }

    resetTips() {
      this.tipsSeen = {};
      saveJSON(TIPS_KEY, this.tipsSeen);
    }

    _stepCoach(dt) {
      if (this.tutorial) return;
      if (this.coach) {
        this.coach.life -= dt;
        if (this.coach.life <= 0) {
          this.coach = null;
          this.coachCooldown = 0.6;
          this._emitCoach();
        }
        return;
      }
      if (this.coachCooldown > 0) {
        this.coachCooldown -= dt;
        return;
      }
      if (this.coachQueue.length) {
        this.coach = { ...this.coachQueue.shift(), life: 6.5 };
        this._emitCoach();
      }
    }

    // What the coach card should show right now (null = nothing)
    getCoach() {
      if (this.phase !== 'playing') return null;
      const step = this.tutorialStep;
      if (step) {
        const tu = this.tutorial;
        return {
          kind: 'tutorial',
          step: tu.idx + 1,
          total: TUTORIAL_STEPS.length,
          id: step.id,
          title: step.title,
          goal: step.goal,
          progress: step.id === 'shoot' ? `${Math.min(tu.kills, step.need)}/${step.need}` : '',
          phone: step.phone,
          touch: step.touch,
          keys: step.keys,
          target: step.target
        };
      }
      if (this.coach) {
        const c = this.coach;
        return { kind: 'tip', key: c.key, icon: c.icon, color: c.color || '', title: c.title, text: c.text };
      }
      return null;
    }

    _emitCoach() {
      try {
        this.onCoach(this.getCoach());
      } catch (e) { /* UI must never break the game loop */ }
    }

    // Mid-chapter care package: always a weapon step and a wingman (or a shield once the formation is full)
    _supplyDrop(px, py) {
      const ahead = this.rig.mode === 'tabletop' ? this.height * 0.45 : this.height * 0.4;
      const yTop = this.rig.mode === 'tabletop' ? py - ahead : Math.max(80, py - ahead);
      const p = this.player;
      this._spawnPowerup(px - 36, yTop, p.weaponLv < this.weaponCap ? 'weapon' : 'heal');
      this._spawnPowerup(px + 36, yTop, p.droneCount < 4 ? 'drone' : 'shield');
      this._spawnPowerup(px, yTop - 30, 'medal');
      this.floatingTexts.push({ x: px, y: yTop + 40, text: '📦 中途补给到达！', color: '#fde68a', life: 1.8, big: true });
      this._sfx('shieldUp');
      this._tip('supply');
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
        const arcadeSky = fx.firework && this.rig.mode === 'arcade';
        const x = arcadeSky ? this.width * 0.5 + fx.dx : px + fx.dx;
        const y = arcadeSky ? this.height * 0.5 + fx.dy : py + fx.dy;
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

    _stepStarRoute(dt, px, py, startX = px, startY = py, playerWorldVy = null, pickupSurgeVy = 0) {
      if (this.phase !== 'playing') return;
      this.starMagnet = Math.max(0, this.starMagnet - dt);
      if (this.tutorial || this.boss || this.victoryHoldTimer > 0) return;
      const tabletop = this.rig.mode === 'tabletop';
      const threshold = STAR_ROUTE.chapterMarks[this.starRouteIndex];
      if (!this.starRoute && threshold !== undefined && this.chapterProgress >= threshold) {
        let direction = (this.starRouteIndex + this.wave) % 2 ? 1 : -1;
        this.starRouteIndex++;
        const bend = Math.min(145, this.width * 0.22);
        const outerX = px + direction * bend;
        if (!tabletop && (outerX > this.width - 36 || outerX < 36)) direction *= -1;
        const lead = Math.min(220, this.height * 0.38);
        const stars = Array.from({ length: STAR_ROUTE.count }, (_, i) => ({
          x: px + direction * bend * Math.sin(i * Math.PI / (STAR_ROUTE.count - 1)),
          y: py - lead - i * 80, collected: false
        }));
        this.starRoute = { stars, collected: 0, born: this.time };
      }
      const route = this.starRoute;
      if (!route) return;
      const baseWorldVy = playerWorldVy !== null ? playerWorldVy : (tabletop ? -this.player.cruiseSpeed : 0);
      // Cruise keeps a steady screen drift; pushing forward surges into the star line just like arcade mode.
      const dy = (STAR_ROUTE.drift + baseWorldVy + pickupSurgeVy) * dt;
      const rx = tabletop ? clamp(this.rig.width * 0.46, 30, 64) : 32;
      const ry = tabletop ? clamp(this.rig.length * 0.52, 34, 88) : 32;
      const refX = route.born === this.time ? px : startX;
      const refY = route.born === this.time ? py : startY;
      for (const star of route.stars) {
        const fromX = (star.x - refX) / rx;
        const fromY = (star.y - refY) / ry;
        star.y += dy;
        if (star.collected) continue;
        const toX = (star.x - px) / rx;
        const toY = (star.y - py) / ry;
        const pathX = toX - fromX;
        const pathY = toY - fromY;
        const path2 = pathX * pathX + pathY * pathY;
        const t = path2 ? clamp(-(fromX * pathX + fromY * pathY) / path2, 0, 1) : 1;
        if (Math.hypot(fromX + pathX * t, fromY + pathY * t) > 1) continue;
        star.collected = true;
        route.collected++;
        this.score += STAR_ROUTE.points;
        this._sfx('medal', route.collected);
      }
      if (route.collected === STAR_ROUTE.count) {
        this.score += STAR_ROUTE.bonus;
        this.perfectRoutes++;
        this.starMagnet = STAR_ROUTE.magnetSeconds;
        this._sfx('shieldUp');
        this.floatingTexts.push({ x: px, y: py - 62, text: `星线全收 +${STAR_ROUTE.bonus}`, color: '#a5f3fc', life: 1.4 });
        this._stateDirty = true;
        this.starRoute = null;
      } else {
        const bottom = tabletop ? py + this.height * (1 - this.rig.anchorY) : this.height;
        if (route.stars[route.stars.length - 1].y > bottom + ry) this.starRoute = null;
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
        born: this.time,
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
        if (e.launchShield > 0) e.launchShield -= dt;
        if (e.marked > 0) e.marked -= dt;
        e.phase = (e.phase || 0) + dt * 3;
        e.age = (e.age || 0) + dt;

        if (e.isBoss) {
          this._stepBoss(e, dt, px, py, worldStepY);
        } else if (e.blownBack) {
          const boss = this.boss;
          if (!boss) {
            e.blownBack = false;
          } else {
            const ang = Math.atan2(boss.y - e.y, boss.x - e.x);
            e.x += Math.cos(ang) * 620 * dt;
            e.y += worldStepY + Math.sin(ang) * 620 * dt;
            if (Math.random() < dt * 40) {
              this.particles.push({ x: e.x, y: e.y, vx: 0, vy: this._camDrift(0.6), r: 3, color: '#67e8f9', life: 0.3, maxLife: 0.3 });
            }
            if (Math.hypot(boss.x - e.x, boss.y - e.y) < boss.radius) {
              this._spawnFireball(e.x, e.y, 50);
              this.floatingTexts.push({ x: e.x, y: e.y - 20, text: '倒灌机库！', color: '#67e8f9', life: 0.9 });
              this.enemies.splice(i, 1);
              e.dead = true;
              this.score += 150;
              this._damageEnemy(boss, 180);
              continue;
            }
          }
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
            const ang = this._aimAngle(e.x, e.y, 230);
            this._spawnEnemyBullet(e.x, e.y + 12, Math.cos(ang) * 230, Math.sin(ang) * 230, '#e879f9', 5);
            e.fireTimer = 2.3 * this._fireGap();
          }
        } else if (e.type === 'bomber') {
          e.x += (e.vx + Math.sin(e.phase * 0.5) * 20) * dt;
          e.y += worldStepY + e.vy * dt;
          e.mineTimer -= dt;
          if (e.mineTimer <= 0 && e.y < py - 140) {
            this._spawnMine(e.x + (Math.random() - 0.5) * 30, e.y - 34);
            e.mineTimer = 1.7 * this._fireGap();
          }
          e.fireTimer -= dt;
          if (e.fireTimer <= 0 && e.y < py - 80) {
            for (let s = -2; s <= 2; s++) {
              const a = Math.PI * 0.5 + s * 0.2;
              this._spawnEnemyBullet(e.x, e.y + 30, Math.cos(a) * 170, Math.sin(a) * 170, '#f59e0b', 6.5);
            }
            e.fireTimer = 2.4 * this._fireGap();
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
            if (this.warnThrottle <= 0) {
              this.warnThrottle = 1.2;
              this.onTelemetry({ warn: 'mine' });
            }
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
              const ang = this._aimAngle(e.x, e.y, 245);
              this._spawnEnemyBullet(e.x, e.y + 14, Math.cos(ang) * 245, Math.sin(ang) * 245, '#e11d48', 5.5);
              e.fireTimer = 1.9 * this._fireGap();
            } else if (e.type === 'gunship') {
              const baseAng = this._aimAngle(e.x, e.y, 255);
              for (let s = -1; s <= 1; s++) {
                const a = baseAng + s * 0.22;
                this._spawnEnemyBullet(e.x, e.y + 22, Math.cos(a) * 255, Math.sin(a) * 255, '#ea580c', 6);
              }
              e.fireTimer = 1.55 * this._fireGap();
            }
          }
        }

        if (Math.abs(e.x - px) < e.radius + hitHalfW && Math.abs(e.y - py) < e.radius + hitHalfL) {
          if (this.traits.bumper && !e.isBoss && e.radius <= 24) {
            // Tank-type toy (car): small attackers bounce off the bumper and explode
            this.floatingTexts.push({ x: e.x, y: e.y - 20, text: '撞飞！', color: '#fdba74', life: 0.8 });
            this.screenShake = Math.max(this.screenShake, 6);
            this._rumbleGamepad(0.4, 120);
            this._damageEnemy(e, 9999, i);
            if (e.dead) continue;
          }
          const landed = this._hurtPlayer(INCOMING_DAMAGE.collision);
          if (!e.isBoss) {
            // A real collision destroys the attacker; brushing past while invulnerable only scrapes it
            this._damageEnemy(e, landed ? 9999 : 160 * dt, i);
            if (e.dead) continue;
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
      const desiredY = this.rig.mode === 'tabletop'
        ? py - this.height * this.rig.anchorY * 0.66
        : Math.max(110, this.height * 0.2);
      e.y += worldStepY;
      e.y = lerp(e.y, desiredY, 1 - Math.exp(-dt * 3.5));
      const sway = Math.min(220, this.width * 0.28) * (e.enraged ? 1.15 : 1);
      e.x = lerp(e.x, px + Math.sin(this.time * (e.enraged ? 1.25 : 0.95)) * sway, 1 - Math.exp(-dt * 2.4));
      const def = BOSS_DEFS[e.bossKind] || BOSS_DEFS.fog;
      if (e.unveiled > 0) {
        e.unveiled -= dt;
        if (e.unveiled <= 0) this.floatingTexts.push({ x: e.x, y: e.y + 90, text: '灰雾重新聚拢……', color: '#cbd5e1', life: 1.2 });
      } else if (e.bossKind === 'fog') {
        // Remind (tablet + phone buzz) every 8s while the fog armour is still up
        e.blowPrompt = (e.blowPrompt === undefined ? 3 : e.blowPrompt) - dt;
        if (e.blowPrompt <= 0) {
          e.blowPrompt = 8;
          this.floatingTexts.push({ x: e.x, y: e.y + 96, text: '💨 吹一口气，吹散灰雾护甲！', color: '#e0f2fe', life: 1.8, big: true });
          this.onTelemetry({ warn: 'blow' });
        }
      }
      const loopBoost = 1 + this.loopIndex * 0.12;
      // Earlier blockades fire a little slower: act I is where people learn the boss mechanics
      const storyEase = this.loopIndex === 0 ? [1.25, 1.1, 1][this.getCurrentChapter().idx] : 1;
      const rate = ((e.enraged ? 0.78 : 1) / loopBoost) * storyEase;

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
              this._spawnEnemyBullet(e.x, e.y + 10, Math.cos(b) * 150, Math.sin(b) * 150, def.bulletAlt, 5);
            }
          }
        }
      }

      e.fireTimer -= dt;
      if (e.fireTimer > 0 || e.age < 1.6) return;
      e.patternIdx = (e.patternIdx + 1) % (e.enraged ? 4 : 3);
      const pat = e.patternIdx;
      const aimAt = (ox) => this._aimAngle(e.x + ox, e.y, 300);

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
            for (let tries = 0; tries < 6 && used.some((u) => Math.abs(u - x) < 110); tries++) {
              x = px + (Math.random() - 0.5) * this.width * 0.8;
            }
            used.push(x);
            this.hazards.push({ kind: 'lane', x, halfW: 30, warn: 1.05 + k * 0.18, active: 0.42, seed: Math.random() * 100 });
          }
          this.onTelemetry({ warn: 'lane' });
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
              this._spawnEnemyBullet(e.x + side, e.y + 10, Math.cos(a) * 240, Math.sin(a) * 240, def.bulletAlt, 5.5);
            }
          }
          e.fireTimer = 1.0 * rate;
        }
      } else {
        if (pat === 0) {
          // Hangar launch: mothership deploys escort scouts
          const n = e.enraged ? 4 : 3;
          const escortHp = ENEMY_HULL.escort * this._difficulty();
          for (let k = 0; k < n; k++) {
            const side = k % 2 ? 1 : -1;
            this.enemies.push({
              type: 'scout', x: e.x + side * (50 + k * 14), y: e.y + 20, vx: side * 120, vy: 140,
              hp: escortHp, maxHp: escortHp, radius: 18,
              fireTimer: 1.4 + k * 0.2, phase: k, age: 0, hitFlash: 0, scoreVal: 90, fromHangar: true, launchShield: 1.3
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
              this._spawnEnemyBullet(e.x, e.y + 10, Math.cos(a) * spd, Math.sin(a) * spd, ring ? def.bulletAlt : def.bullet, 6);
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
        if (!hz) continue;
        if (hz.dead) {
          this.hazards.splice(i, 1);
          continue;
        }
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
        if (Math.abs(px - hz.x) < hz.halfW + hitHalfW) {
          this._hurtPlayer(INCOMING_DAMAGE.lightning);
          if (this.phase !== 'playing') {
            this.hazards.length = 0;
            return;
          }
        }
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
      const spd = this.tier.bulletSpeed;
      vx *= spd;
      vy *= spd;
      // Shots share the level's cruise, so even a shot fired during a held forward dodge can be cleared.
      const worldVyOffset = this.rig.mode === 'tabletop' ? -TABLETOP_CRUISE_SPEED : 0;
      this.enemyBullets.push({
        x,
        y,
        vx,
        vy: vy + worldVyOffset,
        color,
        r,
        grazed: false,
        reflected: false,
        born: this.time,
        life: 5.5
      });
    }

    _stepEnemyBullets(dt, px, py, startX = px, startY = py) {
      // Only a small, visible core takes bullet damage (shmup convention); the rest of the toy can graze
      const coreR = this.hitCoreR;
      const sat = this._satellitePos();
      const mods = this._mods();
      const grazeW = (this.rig.mode === 'tabletop' ? this.rig.width * 0.54 : 30) * mods.grazeRadiusMult;
      const grazeL = (this.rig.mode === 'tabletop' ? this.rig.length * 0.54 : 34) * mods.grazeRadiusMult;

      for (let i = this.enemyBullets.length - 1; i >= 0; i--) {
        const b = this.enemyBullets[i];
        if (!b) continue;
        if (this.player.gustTimer > 0 && !b.reflected && b.born <= this.player.gustStartedAt) {
          b.vy -= 1400 * dt;
          b.reflected = true;
          b.color = '#06b6d4';
        }
        if (b.reflected && mods.windReflectHoming && this.enemies.length > 0) {
          let near = null;
          let bestD = 320 * 320;
          for (const e of this.enemies) {
            const d2 = (e.x - b.x) ** 2 + (e.y - b.y) ** 2;
            if (d2 < bestD) { bestD = d2; near = e; }
          }
          if (near) {
            const ang = Math.atan2(near.y - b.y, near.x - b.x);
            b.vx = lerp(b.vx, Math.cos(ang) * 760, Math.min(1, dt * 6));
            b.vy = lerp(b.vy, Math.sin(ang) * 760, Math.min(1, dt * 6));
          }
        }
        const fromX = b.x - (b.born === this.time ? px : startX);
        const fromY = b.y - (b.born === this.time ? py : startY);
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
              this._damageEnemy(e, 24 * (mods.windReflectMult || 1.8) * this._skillPowerScale(), j);
              this._spawnExplosion(b.x, b.y, '#67e8f9', 4, 90);
              hitEnemy = true;
              break;
            }
          }
          if (hitEnemy) this.enemyBullets.splice(i, 1);
          continue;
        }

        if (sat && Math.hypot(b.x - sat.x, b.y - sat.y) < sat.r + b.r) {
          // Guardian-type toy (orb): the orbiting guard ball eats bullets
          this.enemyBullets.splice(i, 1);
          this._spawnExplosion(b.x, b.y, '#c4b5fd', 3, 80);
          this.score += 10;
          continue;
        }

        const dx = Math.abs(b.x - px);
        const dy = Math.abs(b.y - py);

        // Test the relative path through the hit core so a fast opposing pass cannot skip a hit.
        const pathX = b.x - px - fromX;
        const pathY = b.y - py - fromY;
        const path2 = pathX * pathX + pathY * pathY;
        const t = path2 ? clamp(-(fromX * pathX + fromY * pathY) / path2, 0, 1) : 0;
        if (Math.hypot(fromX + pathX * t, fromY + pathY * t) < coreR + b.r * 0.6) {
          this.enemyBullets.splice(i, 1);
          this._hurtPlayer(INCOMING_DAMAGE.bullet);
          continue;
        }

        if (!b.grazed && dx < grazeW + b.r && dy < grazeL + b.r) {
          b.grazed = true;
          this.score += 35;
          if (mods.grazeGustReduce > 0) {
            this.player.gustCooldown = Math.max(0, this.player.gustCooldown - mods.grazeGustReduce);
          }
          if (this.roguelite) {
            this.roguelite.addRawXp(1.5 + (mods.grazeXp || 0));
          }
          this._spawnExplosion(b.x, b.y, '#38bdf8', 2, 60);
        }
      }
    }

    _stepPowerups(dt, px, py, startX = px, startY = py, playerWorldVy = null, pickupSurgeVy = 0, surgeRatio = 0, rigPad = 0) {
      const worldVyOffset = playerWorldVy !== null ? playerWorldVy : (this.rig.mode === 'tabletop' ? -this.player.cruiseSpeed : 0);
      const collectR = (this.rig.mode === 'tabletop' ? Math.max(this.rig.width, this.rig.length) * 0.58 : 34) + 16;
      const p = this.player;
      const mods = this._mods();

      for (let i = this.powerups.length - 1; i >= 0; i--) {
        const pw = this.powerups[i];
        pw.life -= dt;
        pw.spin += dt * 4;
        const headOn = clamp((py - pw.y) / 48, 0, 1);
        const d = Math.hypot(px - pw.x, py - pw.y);
        const baseMag = ((pw.kind === 'medal' ? 150 : 190) + rigPad) * mods.pickupRadiusMult * (1 + 0.18 * surgeRatio * headOn);
        const magnetRadius = Math.max(baseMag, this.starMagnet > 0 ? 420 + rigPad : 0);
        if (d < magnetRadius) pw.magnet = true;

        const refX = pw.born === this.time ? px : startX;
        const refY = pw.born === this.time ? py : startY;
        const fromX = pw.x - refX;
        const fromY = pw.y - refY;

        if (pw.magnet) {
          const ang = Math.atan2(py - pw.y, px - pw.x);
          pw.x += Math.cos(ang) * 640 * dt;
          pw.y += (Math.sin(ang) * 640 + worldVyOffset + pickupSurgeVy * headOn) * dt;
        } else {
          pw.vy = Math.min(135, pw.vy + 180 * dt);
          pw.vx *= Math.exp(-dt * 1.5);
          pw.x += pw.vx * dt;
          pw.y += (pw.vy + worldVyOffset + pickupSurgeVy) * dt;
        }

        const toX = pw.x - px;
        const toY = pw.y - py;
        const pathX = toX - fromX;
        const pathY = toY - fromY;
        const path2 = pathX * pathX + pathY * pathY;
        const t = path2 ? clamp(-(fromX * pathX + fromY * pathY) / path2, 0, 1) : 1;
        const minDist = Math.hypot(fromX + pathX * t, fromY + pathY * t);

        if (minDist < collectR) {
          this._tip(pw.kind);
          if (this.tutorial && pw.tutorial) this.tutorial.picked = pw.kind;
          let text = '';
          let color = '#fef08a';
          if (pw.kind === 'medal') {
            this.score += this.medalValue;
            this._sfx('medal', Math.min(10, Math.round(this.medalValue / 100) - 1));
            text = `★ ${this.medalValue}`;
            color = '#fde047';
            this.medalsCollected++;
            if (this.medalsCollected === 3) this._tip('medal');
            this.medalValue = Math.min(1000, this.medalValue + 100);
          } else {
            this.sfx.powerup();
            if (pw.kind === 'weapon') {
              if (p.weaponLv < this.weaponCap) {
                p.weaponLv++;
                text = `火力升级 Lv.${p.weaponLv}！`;
              } else {
                this.score += 300;
                text = p.weaponLv >= MAX_WEAPON_LV ? '满级火力 +300' : `本幕火力已满 Lv.${p.weaponLv} · +300`;
              }
            } else if (pw.kind === 'heal') {
              const repaired = Math.min(30, p.maxHp - p.hp);
              p.hp += repaired;
              text = repaired > 0 ? `机体修复 +${Math.ceil(repaired)} 点` : '机体耐久已满';
              color = '#86efac';
            } else if (pw.kind === 'nuke') {
              p.nukes = Math.min(p.maxNukes, p.nukes + 1);
              text = '核弹补给 +1';
              color = '#fed7aa';
            } else if (pw.kind === 'shield') {
              const maxS = mods.maxShields || 2;
              if (p.shield < maxS) {
                p.shield++;
                text = p.shield >= 3 ? '三层星神护盾！' : (p.shield === 2 ? '双层能量护盾！' : '能量护盾展开');
              } else {
                this.score += 400;
                text = '护盾满载 +400';
              }
              color = '#67e8f9';
              this._sfx('shieldUp');
            } else if (pw.kind === 'drone') {
              const maxD = mods.maxDrones || 4;
              if (p.droneCount < maxD) {
                p.droneCount++;
                text = `浮游僚机 ×${p.droneCount}`;
              } else {
                this.score += 400;
                text = '僚机满编 +400';
              }
              color = '#6ee7b7';
            }
          }
          if (pw.kind !== 'medal') this.floatingTexts.push({ x: px, y: py - 45, text, color, life: 1.15 });
          this.powerups.splice(i, 1);
          if (pw.kind !== 'medal') this._stateDirty = true;
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
      if (p.invulnTimer > 0 || this.phase !== 'playing') return false;

      if (this.tutorial) {
        // Guided flight: show the hit, but never cost hull while learning
        p.invulnTimer = 1.0;
        const hx = this._playerWorldX();
        const hy = this._playerWorldY();
        this.screenShake = Math.max(this.screenShake, 6);
        this._sfx('shieldBreak');
        this.shockwaves.push({ x: hx, y: hy, r: 12, maxR: 110, color: '#f87171', life: 0.35, maxLife: 0.35, width: 4 });
        this.floatingTexts.push({ x: hx, y: hy - 56, text: '被打中了！引导中不扣血', color: '#fecaca', life: 1.1 });
        this.onTelemetry({ hitVibrate: true });
        return true;
      }

      if (p.shield > 0) {
        p.shield--;
        this.hitsTaken++;
        p.invulnTimer = 1.0;
        const sx = this._playerWorldX();
        const sy = this._playerWorldY();
        this.screenShake = Math.max(this.screenShake, 8);
        this._sfx('shieldBreak');
        this._rumbleGamepad(0.5, 160);
        this.shockwaves.push({ x: sx, y: sy, r: 30, maxR: 190, color: '#67e8f9', life: 0.45, maxLife: 0.45, width: 7 });
        this._spawnExplosion(sx, sy, '#a5f3fc', 18, 260);
        if (this.roguelite) {
          this.roguelite.powerScale = this._skillPowerScale();
          this.roguelite.notifyShieldBreak(sx, sy, this.enemies, this.enemyBullets);
        }
        this.floatingTexts.push({ x: sx, y: sy - 52, text: this._mods().aegisAwakened ? '👑 星神护盾反震清场！' : '能量护盾抵消！', color: '#67e8f9', life: 1.0 });
        this.onTelemetry({ hitVibrate: true });
        this.onStateChange(this.getPublicState());
        return true;
      }

      p.invulnTimer = 1.05;
      this.combo = 0;
      this.hitsTaken++;
      this.medalValue = 100; // getting hit breaks the gold-medal chain
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
        return true;
      }

      p.hp = Math.max(0, p.hp - amount * this.tier.dmg);
      if (p.hp > 0 && p.hp <= p.maxHp * 0.35) this._tip('lowHp');
      // Firepower never drops on a hit: strength only grows over the voyage
      this.onTelemetry({ hitVibrate: true });

      if (p.hp <= 0) {
        this.phase = 'gameover';
        this.gameOver = true;
        this._spawnExplosion(px, py, '#fb923c', 36, 300);
        this._spawnFireball(px, py, 90);
        this._endRun();
      }
      this.onStateChange(this.getPublicState());
      return true;
    }

    _camDrift(f) {
      return this.rig.mode === 'tabletop' ? -this.player.cruiseSpeed * f : 0;
    }

    // Bright core flash that blooms outward, followed by lingering smoke puffs
    _spawnFireball(x, y, size = 40) {
      if (this.particles.length > 1100) return;
      this.particles.push({ kind: 'flash', df: 0.9, x, y, vx: 0, vy: this._camDrift(0.9), r: size * 0.35, grow: size * 2.4, color: '#fff7ed', life: 0.32, maxLife: 0.32 });
      const puffs = Math.min(6, 2 + Math.floor(size / 30));
      size = Math.min(size, 70); // keep smoke from swallowing the screen after huge blasts
      for (let i = 0; i < puffs; i++) {
        const ang = Math.random() * Math.PI * 2;
        const spd = 20 + Math.random() * size * 0.9;
        const life = 0.7 + Math.random() * 0.6;
        this.particles.push({
          kind: 'smoke', df: 0.85, x: x + Math.cos(ang) * size * 0.2, y: y + Math.sin(ang) * size * 0.2,
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
          kind: 'debris', df: 0.6, x, y, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd + this._camDrift(0.6),
          r: 3 + Math.random() * 6, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 18, drag: 1.4,
          color, life, maxLife: life
        });
      }
    }

    _spawnFirework(x, y, color) {
      this._sfx('medal', 6 + Math.floor(Math.random() * 4));
      this.particles.push({ kind: 'flash', df: 1, x, y, vx: 0, vy: this._camDrift(1), r: 10, grow: 160, color, life: 0.3, maxLife: 0.3 });
      const n = 34;
      for (let i = 0; i < n && this.particles.length < 1200; i++) {
        const ang = (i / n) * Math.PI * 2 + Math.random() * 0.1;
        const spd = 180 + Math.random() * 120;
        const life = 1.0 + Math.random() * 0.5;
        this.particles.push({
          kind: 'spark', df: 1, x, y, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd + this._camDrift(1),
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
          const drift = this._camDrift(pt.df || 0.6);
          const k = Math.exp(-pt.drag * dt);
          pt.vx *= k;
          pt.vy = drift + (pt.vy - drift) * k;
        }
        if (pt.gravity) pt.vy += pt.gravity * dt;
        if (pt.grow) pt.r += pt.grow * dt;
        if (pt.vr) pt.rot += pt.vr * dt;
        pt.x += pt.vx * dt;
        pt.y += pt.vy * dt;
        // Once the voyage stops (game over) the camera no longer moves, so cancel the baked-in drift
        if (this.phase === 'gameover') pt.y -= this._camDrift(pt.df || 0.6) * dt;
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

    // Smooth dual wingtip condensation ribbons anchored accurately in both tabletop and arcade modes
    _stepContrails(dt, px, py) {
      if (!this.contrails) return;
      const p = this.player;
      const isTabletop = this.rig.mode === 'tabletop';
      const arcadeScroll = isTabletop ? 0 : (p.cruiseSpeed + this.breath * 140) * dt;
      const maxLife = 0.56 + this._visualBoost() * 0.18 + this.breath * 0.14;

      for (const side of ['left', 'right']) {
        const list = this.contrails[side];
        for (let i = list.length - 1; i >= 0; i--) {
          const pt = list[i];
          pt.x += pt.vx * dt;
          pt.y += pt.vy * dt + arcadeScroll;
          pt.life -= dt;
          if (pt.life <= 0) list.splice(i, 1);
        }
      }

      this._contrailAccum = (this._contrailAccum || 0) + dt;
      if (this._contrailAccum < 0.022) return;
      this._contrailAccum = Math.min(this._contrailAccum - 0.022, 0.022);

      let wingX;
      let wingY;
      if (isTabletop) {
        if (this.rig.shape === 'car') {
          wingX = this.rig.width * 0.42;
          wingY = this.rig.length * 0.36;
        } else if (this.rig.shape === 'orb') {
          wingX = this.rig.width * 0.44;
          wingY = this.rig.length * 0.08;
        } else {
          wingX = this.rig.width * 0.48;
          wingY = this.rig.length * 0.16;
        }
      } else if (this.rig.shape === 'car') {
        wingX = 24;
        wingY = 22;
      } else if (this.rig.shape === 'orb') {
        wingX = 27;
        wingY = 4;
      } else {
        wingX = 35;
        wingY = 8;
      }

      const rollPhase = p.rollTimer > 0 ? (1 - p.rollTimer / 0.62) * Math.PI * 2 : 0;
      const rollCos = Math.cos(rollPhase);
      const bankShrink = 1 - Math.abs(p.bank) * 0.22;
      const span = wingX * bankShrink * rollCos;
      const cosR = isTabletop ? Math.cos(-p.cameraRoll) : 1;
      const sinR = isTabletop ? Math.sin(-p.cameraRoll) : 0;
      const boost = this._visualBoost();
      const intensity = clamp(0.45 + boost * 0.4 + Math.abs(p.bank) * 0.28 + this.breath * 0.35 + (p.rollTimer > 0 ? 0.35 : 0), 0.35, 1);

      const pushTip = (list, ox, oy, dir) => {
        const wx = px + ox * cosR - oy * sinR;
        const wy = py + ox * sinR + oy * cosR;
        list.push({
          x: wx,
          y: wy,
          vx: dir * (10 + Math.abs(p.bank) * 14),
          vy: 14,
          life: maxLife,
          maxLife,
          strength: intensity
        });
        if (list.length > 28) list.shift();
      };

      pushTip(this.contrails.left, -span, wingY + p.bank * 4, -1);
      pushTip(this.contrails.right, span, wingY - p.bank * 4, 1);
    }

    // Cloud-top altitude shadow + delicate mist streaks when skimming over volumetric cloud banks
    _stepCloudInteraction(dt, px, py) {
      const p = this.player;
      const isTabletop = this.rig.mode === 'tabletop';
      const arcadeScroll = isTabletop ? 0 : (p.cruiseSpeed + this.breath * 140) * dt;

      if (this.cloudWisps) {
        for (let i = this.cloudWisps.length - 1; i >= 0; i--) {
          const w = this.cloudWisps[i];
          w.x += w.vx * dt;
          w.y += w.vy * dt + arcadeScroll;
          w.life -= dt;
          if (w.life <= 0) this.cloudWisps.splice(i, 1);
        }
      }

      if (!this.scenery || typeof this.scenery.sampleCloudCover !== 'function') {
        this._cloudCover.density = lerp(this._cloudCover.density, 0, 1 - Math.exp(-dt * 8));
        return;
      }

      const W = this.width;
      const H = this.height;
      const anchorX = isTabletop ? W * 0.5 : p.screenX;
      const anchorY = isTabletop ? H * this.rig.anchorY : p.screenY;
      const sceneCamX = isTabletop ? px : W * 0.5 + (p.screenX - W * 0.5) * 0.18;
      const sceneCamY = isTabletop ? py : p.worldY;
      const corridorOff = ((this._laneCamX ?? sceneCamX) - sceneCamX) * LANE_PF;

      const sample = this.scenery.sampleCloudCover({
        W,
        H,
        screenX: anchorX,
        screenY: anchorY,
        anchorX: isTabletop ? anchorX : W * 0.5,
        anchorY: isTabletop ? anchorY : H * 0.75,
        scrollDist: -sceneCamY,
        worldOffsetX: isTabletop ? sceneCamX : (sceneCamX - W * 0.5),
        corridorOffset: corridorOff,
        sky: this.getEffectiveSky(),
        phase: this.phase,
        calm: this._calmFactors()
      });

      const smoothK = 1 - Math.exp(-dt * 9);
      this._cloudCover.density = lerp(this._cloudCover.density, sample.density, smoothK);
      this._cloudCover.heightFactor = lerp(this._cloudCover.heightFactor, sample.heightFactor, smoothK);

      this._cloudMistTimer = Math.max(0, (this._cloudMistTimer || 0) - dt);
      if (this._cloudCover.density > 0.34 && this._cloudMistTimer <= 0 && this.cloudWisps && this.cloudWisps.length < 26) {
        this._cloudMistTimer = 0.075;
        const halfW = isTabletop ? this.rig.width * 0.46 : 34;
        for (const side of [-1, 1]) {
          const life = 0.34 + Math.random() * 0.2;
          this.cloudWisps.push({
            x: px + side * (halfW * (0.7 + Math.random() * 0.45)),
            y: py + (Math.random() - 0.2) * 18,
            vx: side * (46 + Math.random() * 48) - p.vx * 0.12,
            vy: 42 + Math.random() * 44,
            len: 22 + Math.random() * 24,
            life,
            maxLife: life,
            alpha: clamp(this._cloudCover.density * 0.42, 0.1, 0.34)
          });
        }
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
      const rg = this.roguelite ? this.roguelite.getSummary() : { level: 1, xpRatio: 0 };
      this.onTelemetry({
        phase: this.phase,
        paused: this.isPaused,
        manualPaused: this.manualPaused,
        setupPaused: this.setupPaused,
        skillDraftOpen: this.skillDraftOpen,
        level: rg.level,
        xpRatio: Number((rg.xpRatio || 0).toFixed(3)),
        score: Math.floor(this.score),
        distanceKm: Number(this.distanceKm.toFixed(1)),
        wave: this.wave,
        chapterTitle: ch.title,
        hp: Math.ceil((p.hp / p.maxHp) * 100),
        weaponLv: p.weaponLv,
        nukes: p.nukes,
        coach: this._phoneCoach(),
        gustReady: p.gustCooldown <= 0 ? 1 : Number((1 - p.gustCooldown / p.gustMaxCooldown).toFixed(2)),
        railReady: p.railCooldown <= 0 ? 1 : 0,
        bossHp: this.boss ? Number((this.boss.hp / this.boss.maxHp).toFixed(2)) : 0,
        bossName: this.boss ? this.boss.name : '',
        victoryHold: this.victoryHold,
        crew: Object.fromEntries(Object.keys(CREW_COOLDOWNS).map((k) => [k, Number((1 - this.crewCd[k] / CREW_COOLDOWNS[k]).toFixed(2))])),
        crewAssists: this.crewAssists,
        shield: p.shield,
        droneCount: p.droneCount,
        combo: this.combo,
        loop: this.loopIndex,
        storyCleared: this.storyCleared,
        mode: this.rig.mode,
        pureCamera: this.rig.pureCamera,
        godMode: this.rig.godMode,
        visualFilter: this.rig.visualFilter,
        bulletStyle: this.rig.bulletStyle,
        sky: this.getEffectiveSky(),
        bank: Number((p.bank || 0).toFixed(3)),
        speedRatio: Number(this._visualBoost().toFixed(2)),
        rollActive: p.rollTimer > 0,
        gameOver: this.phase === 'gameover',
        blips
      });
    }

    // Compact hint for the phone cockpit: phone-specific wording plus which control to light up
    _phoneCoach() {
      const c = this.getCoach();
      if (!c) return null;
      if (c.kind === 'tutorial') {
        return { kind: 'tutorial', title: `${c.step}/${c.total} ${c.title}${c.progress ? ` ${c.progress}` : ''}`, text: c.phone, target: c.target };
      }
      return { kind: 'tip', title: `${c.icon} ${c.title}`, text: c.text, target: '' };
    }

    // ===================== RENDERING =====================

    // Screen-space geometry of the corridor for this frame
    _laneFrame(W, H, camX, camY, ax, ay) {
      // Narrow (portrait phone) screens: a wider, straighter lane so the walls stay at the very edges
      const narrow = W < 600;
      const amp1 = narrow ? W * 0.05 : Math.min(W * 0.13, 150);
      const amp2 = narrow ? W * 0.02 : Math.min(W * 0.05, 50);
      const hw = narrow ? W * 0.42 : clamp(W * 0.3, 140, 330);
      const off = clamp(((this._laneCamX ?? camX) - camX) * LANE_PF, -hw * 0.35, hw * 0.35);
      const lyAt = (sy) => camY * LANE_PF + (sy - ay);
      const curve = (ly) => amp1 * Math.sin(ly * 0.0011) + amp2 * Math.sin(ly * 0.0027 + 1.3);
      const cxAt = (sy) => ax + off + curve(lyAt(sy));
      return {
        W, H, ax, ay, camX, camY, hw, lyAt, cxAt,
        // 0.12 in the middle of the lane, 1 outside it: loose clouds & islands fade out of the flight path
        mask: (sx, sy) => clamp((Math.abs(sx - cxAt(sy)) - hw * 0.45) / (hw * 0.6), 0.12, 1)
      };
    }

    // Soft cloud banks on both sides of the lane (no markings, no lights: just the feeling of a corridor)
    _renderLaneWalls(ctx, skyMode, calm) {
      const L = this._lane;
      if (!L) return;
      const st = LANE_STYLE[skyMode] || LANE_STYLE.day;
      const { W, H, ay, hw } = L;
      const y0 = -H * 0.3;
      const y1 = H * 1.3;
      ctx.save();
      if (this.rig.mode === 'tabletop') {
        ctx.translate(L.ax, ay);
        ctx.rotate(this.player.cameraRoll);
        ctx.translate(-L.ax, -ay);
      }
      const strength = st.wallA * (0.55 + 0.45 * calm.cloud);
      // Three soft strata per side give the walls a feathered inner edge
      const strata = [{ inset: 0, a: 0.16 }, { inset: 30, a: 0.18 }, { inset: 78, a: 0.24 }];
      for (const side of [-1, 1]) {
        for (const layer of strata) {
          ctx.fillStyle = `rgba(${st.wall}, ${(layer.a * strength).toFixed(3)})`;
          ctx.beginPath();
          let first = true;
          for (let y = y0; y <= y1; y += 20) {
            const ly = L.lyAt(y);
            const bump = 16 * Math.sin(ly * 0.021 + side * 2) + 9 * Math.sin(ly * 0.053 + side);
            const x = L.cxAt(y) + side * (hw + layer.inset + bump);
            if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
          }
          const farX = side > 0 ? W * 1.7 : -W * 0.7;
          ctx.lineTo(farX, y1);
          ctx.lineTo(farX, y0);
          ctx.closePath();
          ctx.fill();
        }
        // Puffy cloud heads along the wall edge
        ctx.fillStyle = `rgba(${st.wall}, ${(0.16 * strength).toFixed(3)})`;
        const S = 95;
        const k0 = Math.floor(L.lyAt(y0) / S);
        const k1 = Math.ceil(L.lyAt(y1) / S);
        ctx.beginPath();
        for (let k = k0; k <= k1; k++) {
          const sy = ay + k * S - L.camY * LANE_PF;
          const hsh = hash2D(k, side > 0 ? 17 : 29);
          const r = 26 + hsh * 30;
          const x = L.cxAt(sy) + side * (hw + 24 + hsh * 30);
          ctx.moveTo(x + r, sy);
          ctx.arc(x, sy, r, 0, Math.PI * 2);
        }
        ctx.fill();
      }
      ctx.restore();
    }

    // Scenery calm-down for the current phase, eased so take-off fades the sky back instead of snapping
    _calmFactors(dt = 0) {
      const target = this.phase === 'title' ? BG_CALM_TITLE : (BG_CALM[this.rig.bgDim] || BG_CALM.normal);
      const cur = this._calm || (this._calm = { ...target });
      if (dt > 0) {
        const k = 1 - Math.exp(-dt * 2.2); // ~1s ease
        for (const key of ['veil', 'cloud', 'sun', 'lines']) cur[key] = lerp(cur[key], target[key], k);
      }
      return cur;
    }

    _getPixelBuffer(W, H) {
      if (typeof document === 'undefined' || !document.createElement) return null;
      const pxScale = 3;
      const pw = Math.max(160, Math.round(W / pxScale));
      const ph = Math.max(120, Math.round(H / pxScale));
      if (!this._pixelBuffer) this._pixelBuffer = document.createElement('canvas');
      if (this._pixelBuffer.width !== pw || this._pixelBuffer.height !== ph) {
        this._pixelBuffer.width = pw;
        this._pixelBuffer.height = ph;
      }
      return this._pixelBuffer;
    }

    // Pre-baked 4x4 ordered Bayer dither micro-pattern (single fillRect, near-zero cost)
    _getDitherPattern(ctx) {
      if (this._ditherPattern) return this._ditherPattern;
      if (typeof document === 'undefined' || !document.createElement || !ctx.createPattern) return null;
      const c = document.createElement('canvas');
      c.width = 8;
      c.height = 8;
      const g = c.getContext('2d');
      const bayer = [
        [0, 8, 2, 10],
        [12, 4, 14, 6],
        [3, 11, 1, 9],
        [15, 7, 13, 5]
      ];
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          const v = bayer[y][x];
          g.fillStyle = v < 6 ? 'rgba(8, 18, 28, 0.24)' : (v > 10 ? 'rgba(255, 248, 232, 0.14)' : 'rgba(0,0,0,0)');
          g.fillRect(x * 2, y * 2, 2, 2);
        }
      }
      this._ditherPattern = ctx.createPattern(c, 'repeat');
      return this._ditherPattern;
    }

    // Pre-baked subtle warm analog grain tile for the 'film' filter
    _getFilmPattern(ctx) {
      if (this._filmPattern) return this._filmPattern;
      if (typeof document === 'undefined' || !document.createElement || !ctx.createPattern) return null;
      const c = document.createElement('canvas');
      c.width = 96;
      c.height = 96;
      const g = c.getContext('2d');
      for (let y = 0; y < 96; y += 2) {
        for (let x = 0; x < 96; x += 2) {
          const h = hash2D(x * 7 + 11, y * 13 + 5);
          if (h > 0.68) {
            g.fillStyle = `rgba(255, 245, 224, ${((h - 0.68) * 0.32).toFixed(3)})`;
            g.fillRect(x, y, 2, 2);
          } else if (h < 0.28) {
            g.fillStyle = `rgba(18, 24, 30, ${((0.28 - h) * 0.32).toFixed(3)})`;
            g.fillRect(x, y, 2, 2);
          }
        }
      }
      this._filmPattern = ctx.createPattern(c, 'repeat');
      return this._filmPattern;
    }

    // Dual wingtip condensation ribbons — curved trails that make top-down flight feel vividly 3D
    _renderContrails(ctx, skyMode) {
      if (!this.contrails) return;
      const rgb = skyMode === 'sunset'
        ? '255, 236, 206'
        : (skyMode === 'night' ? '202, 240, 255' : '252, 249, 240');
      const calmA = this.phase === 'playing' ? 0.56 : 0.42;

      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const side of ['left', 'right']) {
        const list = this.contrails[side];
        if (!list || list.length < 2) continue;
        for (let i = 1; i < list.length; i++) {
          const prev = list[i - 1];
          const cur = list[i];
          const age = clamp(cur.life / Math.max(0.05, cur.maxLife), 0, 1);
          const alpha = age * age * calmA * (cur.strength || 0.7);
          if (alpha <= 0.015) continue;
          const w = 0.7 + age * 2.1;
          ctx.strokeStyle = `rgba(${rgb}, ${alpha.toFixed(3)})`;
          ctx.lineWidth = w;
          ctx.beginPath();
          ctx.moveTo(prev.x, prev.y);
          ctx.lineTo(cur.x, cur.y);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    // Soft cast shadow on volumetric cloud tops directly beneath the craft
    _renderCloudCastShadow(ctx, ax, ay, skyMode) {
      const cover = this._cloudCover;
      if (!cover || cover.density <= 0.14 || this.phase === 'gameover') return;
      const p = this.player;
      const isTabletop = this.rig.mode === 'tabletop';
      const hf = cover.heightFactor || 0.85;
      const offX = (18 + hf * 16) - p.bank * 14;
      const offY = (20 + hf * 18) + this._visualBoost() * 8;
      const rw = isTabletop ? this.rig.width : 72;
      const rl = isTabletop ? this.rig.length : 84;
      const alpha = clamp(cover.density * (skyMode === 'night' ? 0.22 : 0.30), 0, 0.32);

      ctx.save();
      ctx.translate(ax + offX, ay + offY);
      ctx.scale((1.06 - Math.abs(p.bank) * 0.12) * (0.94 + hf * 0.12), 0.94 + hf * 0.12);
      this._traceRigShapePath(ctx, rw, rl, this.rig.shape);
      ctx.fillStyle = skyMode === 'sunset'
        ? `rgba(48, 22, 34, ${alpha.toFixed(3)})`
        : `rgba(11, 34, 48, ${alpha.toFixed(3)})`;
      ctx.fill();
      ctx.restore();
    }

    // Soft elongated mist ribbons whipped outward when skimming across thick clouds (never dot-shaped)
    _renderCloudWisps(ctx, skyMode) {
      if (!this.cloudWisps || this.cloudWisps.length === 0) return;
      const rgb = skyMode === 'sunset'
        ? '255, 226, 194'
        : (skyMode === 'night' ? '186, 224, 248' : '255, 253, 246');
      ctx.save();
      ctx.lineCap = 'round';
      for (const w of this.cloudWisps) {
        const t = clamp(w.life / Math.max(0.05, w.maxLife), 0, 1);
        const a = Math.sin(t * Math.PI) * w.alpha;
        if (a <= 0.015) continue;
        const spd = Math.hypot(w.vx, w.vy) || 1;
        const ux = w.vx / spd;
        const uy = w.vy / spd;
        ctx.strokeStyle = `rgba(${rgb}, ${a.toFixed(3)})`;
        ctx.lineWidth = 1.6 + (1 - t) * 2.2;
        ctx.beginPath();
        ctx.moveTo(w.x - ux * w.len * 0.5, w.y - uy * w.len * 0.5);
        ctx.lineTo(w.x + ux * w.len * 0.5, w.y + uy * w.len * 0.5);
        ctx.stroke();
      }
      ctx.restore();
    }

    _applyPixelDither(ctx, W, H) {
      const pat = this._getDitherPattern(ctx);
      if (!pat) return;
      ctx.save();
      ctx.globalAlpha = 0.42;
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    _applyFilmGrade(ctx, W, H, skyMode) {
      ctx.save();
      // Subtle warm vintage tint
      ctx.fillStyle = skyMode === 'sunset'
        ? 'rgba(255, 182, 128, 0.10)'
        : (skyMode === 'night' ? 'rgba(182, 226, 210, 0.06)' : 'rgba(255, 214, 152, 0.09)');
      ctx.fillRect(0, 0, W, H);

      // Gentle 35mm optical vignette
      const rOuter = Math.hypot(W, H) * 0.58;
      const vg = ctx.createRadialGradient(W * 0.5, H * 0.5, Math.min(W, H) * 0.28, W * 0.5, H * 0.5, rOuter);
      vg.addColorStop(0, 'rgba(16, 14, 12, 0)');
      vg.addColorStop(1, 'rgba(14, 12, 10, 0.28)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);

      // Subtle analog grain tile shifted gently at 12fps to stay calm yet alive
      const pat = this._getFilmPattern(ctx);
      if (pat) {
        const tick = Math.floor(this.time * 12);
        const gx = (tick * 19) % 48;
        const gy = (tick * 31) % 48;
        ctx.globalAlpha = 0.24;
        ctx.translate(-gx, -gy);
        ctx.fillStyle = pat;
        ctx.fillRect(gx, gy, W + 48, H + 48);
      }
      ctx.restore();
    }

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

      // 1 & 2. Next-Gen 2.5D Scenery Renderer (with optional lightweight retro pixel/film filter easter egg)
      const skyMode = this.getEffectiveSky();
      const calm = this._calmFactors();
      const px = this._playerWorldX();
      const py = this._playerWorldY();
      const anchorX = this.rig.mode === 'tabletop' ? W * 0.5 : this.player.screenX;
      const anchorY = this.rig.mode === 'tabletop' ? H * this.rig.anchorY : this.player.screenY;
      const tabletopCam = this.rig.mode === 'tabletop';
      const sceneCamX = tabletopCam ? px : W * 0.5 + (this.player.screenX - W * 0.5) * 0.18;
      const sceneCamY = tabletopCam ? py : this.player.worldY;
      this._lane = this._laneFrame(W, H, sceneCamX, sceneCamY, tabletopCam ? anchorX : W * 0.5, tabletopCam ? anchorY : H * 0.5);

      const filter = this.rig.visualFilter || 'normal';
      const pixelBuf = (filter === 'pixel' && !this.calibDrawerOpen) ? this._getPixelBuffer(W, H) : null;
      const pctx = pixelBuf ? pixelBuf.getContext('2d') : null;
      const worldCtx = pctx || ctx;
      if (pctx) {
        pctx.clearRect(0, 0, pixelBuf.width, pixelBuf.height);
        pctx.save();
        pctx.scale(pixelBuf.width / W, pixelBuf.height / H);
      }

      const art = this.departureArt;
      if (this.phase === 'title' && !this.calibDrawerOpen && this.rig.skyTheme === 'auto' && art?.complete && art.naturalWidth) {
        const scale = Math.max(W / art.naturalWidth, H / art.naturalHeight);
        const width = art.naturalWidth * scale;
        const height = art.naturalHeight * scale;
        worldCtx.drawImage(art, (W - width) * 0.78, (H - height) * 0.38, width, height);
      } else if (this.scenery) {
        const corridorOff = ((this._laneCamX ?? sceneCamX) - sceneCamX) * LANE_PF;
        this.scenery.render(worldCtx, {
          W,
          H,
          sky: skyMode,
          phase: this.phase,
          time: this.time,
          scrollDist: -sceneCamY,
          worldOffsetX: tabletopCam ? sceneCamX : (sceneCamX - W * 0.5),
          bankAngle: tabletopCam ? this.player.cameraRoll : 0,
          anchorX: tabletopCam ? anchorX : W * 0.5,
          anchorY: tabletopCam ? anchorY : H * 0.75,
          corridorOffset: corridorOff,
          calm,
          pureCamera: this.rig.pureCamera,
          bossActive: Boolean(this.boss),
          bossEnraged: Boolean(this.boss && this.boss.enraged)
        });
      } else {
        const skyGrad = worldCtx.createLinearGradient(0, 0, 0, H);
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
        worldCtx.fillStyle = skyGrad;
        worldCtx.fillRect(-30, -30, W + 60, H + 60);
        this._renderSkyAtmosphere(worldCtx, W, H, skyMode, calm);
        worldCtx.save();
        if (tabletopCam) {
          worldCtx.translate(anchorX, anchorY);
          worldCtx.rotate(this.player.cameraRoll);
          worldCtx.translate(-px, -py);
        } else {
          worldCtx.translate(W * 0.5 - sceneCamX, H * 0.5 - sceneCamY);
        }
        this._renderParallaxWorld(worldCtx, sceneCamX, sceneCamY, W, H, skyMode, calm);
        worldCtx.restore();
        this._renderLaneWalls(worldCtx, skyMode, calm);
        if (calm.veil > 0.005) {
          worldCtx.fillStyle = `rgba(${VEIL_RGB[skyMode] || VEIL_RGB.day}, ${calm.veil.toFixed(3)})`;
          worldCtx.fillRect(-30, -30, W + 60, H + 60);
        }
      }

      const applyCam = (targetCtx) => {
        if (this.rig.mode === 'tabletop') {
          targetCtx.translate(anchorX, anchorY);
          targetCtx.rotate(this.player.cameraRoll);
          targetCtx.translate(-px, -py);
        }
      };

      // 2.5 Soft aircraft shadow projected onto clouds directly below
      if (this.phase === 'playing') {
        this._renderCloudCastShadow(worldCtx, anchorX, anchorY, skyMode);
      }

      // 3. Mid layer: wingtip contrails, cloud-skimming wisps, pickups, XP gems, enemies, explosions & our shots
      if (this.phase !== 'title') {
        worldCtx.save();
        applyCam(worldCtx);
        this._renderContrails(worldCtx, skyMode);
        this._renderCloudWisps(worldCtx, skyMode);
        if (this.phase === 'playing') this._renderHazards(worldCtx, py, H);
        this._renderPowerups(worldCtx);
        if (this.roguelite) this.roguelite.renderWorld(worldCtx, this.time, px, py);
        this._renderEnemies(worldCtx, py);
        this._renderParticlesAndWaves(worldCtx);
        this._renderPlayerBullets(worldCtx);
        this._renderRailBeam(worldCtx, px, py, H);
        worldCtx.restore();
      }

      // 4. Player Craft / Tabletop Helipad Layer (visible on Title, Playing, or whenever Calibrating!)
      if (this.phase !== 'gameover' || this.calibDrawerOpen) {
        // Soft dark pocket behind the craft: bright clouds can never swallow its outline
        if (this.phase === 'playing' && calm.veil > 0) {
          const ax = anchorX;
          const ay = anchorY;
          const rr = this.rig.mode === 'tabletop' ? Math.max(this.rig.width, this.rig.length) * 0.95 : 70;
          const pocket = worldCtx.createRadialGradient(ax, ay, rr * 0.2, ax, ay, rr);
          pocket.addColorStop(0, `rgba(${VEIL_RGB[skyMode] || VEIL_RGB.day}, ${(0.12 + calm.veil * 0.4).toFixed(3)})`);
          pocket.addColorStop(1, `rgba(${VEIL_RGB[skyMode] || VEIL_RGB.day}, 0)`);
          worldCtx.fillStyle = pocket;
          worldCtx.fillRect(ax - rr, ay - rr, rr * 2, rr * 2);
        }
        if (this.rig.mode === 'tabletop') {
          this._renderTabletopRig(worldCtx, W * 0.5, H * this.rig.anchorY);
        } else {
          this._renderVirtualFighter(worldCtx, this.player.screenX, this.player.screenY);
        }
      }

      // Foreground gust streaks stay below the danger layer
      this._renderForegroundWind(worldCtx, W, H);

      // Blit pixelated world buffer crisply to the HD main canvas, then keep enemy shots & HUD razor-sharp!
      if (pctx) {
        pctx.restore();
        const prevSmooth = ctx.imageSmoothingEnabled;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(pixelBuf, 0, 0, W, H);
        ctx.imageSmoothingEnabled = prevSmooth;
        this._applyPixelDither(ctx, W, H);
      } else if (filter === 'film') {
        this._applyFilmGrade(ctx, W, H, skyMode);
      }

      // 5. Top layer (always HD): enemy bullets above everything (craft, flames, explosions), then floating text
      if (this.phase !== 'title') {
        ctx.save();
        applyCam(ctx);
        this._renderEnemyBullets(ctx);
        this._renderFloatingTexts(ctx);
        ctx.restore();
      }

      // 6. Screen flash & storm lightning: softened in flight so a white-out never hides incoming fire
      const flashScale = this.phase === 'playing' ? 0.55 : 1;
      if (this.flashAlpha > 0.01) {
        ctx.fillStyle = `rgba(255, 250, 235, ${(this.flashAlpha * flashScale).toFixed(3)})`;
        ctx.fillRect(0, 0, W, H);
      }
      if (this.lightningFlash > 0.01) {
        const flicker = this.lightningFlash * (0.55 + 0.45 * Math.abs(Math.sin(this.time * 47)));
        ctx.fillStyle = `rgba(224, 231, 255, ${(flicker * 0.45 * flashScale).toFixed(3)})`;
        ctx.fillRect(0, 0, W, H);
      }
      if (this.phase === 'playing' && this.player.hp <= this.player.maxHp * 0.3 && !this.rig.godMode) {
        const pulse = 0.28 + 0.18 * Math.sin(this.time * 6);
        const vg = ctx.createRadialGradient(W * 0.5, H * 0.5, Math.min(W, H) * 0.35, W * 0.5, H * 0.5, Math.hypot(W, H) * 0.6);
        vg.addColorStop(0, 'rgba(220, 38, 38, 0)');
        vg.addColorStop(1, `rgba(220, 38, 38, ${pulse.toFixed(3)})`);
        ctx.fillStyle = vg;
        ctx.fillRect(0, 0, W, H);
      }

      // 7. Frameless Aviation Telemetry HUD & Cinematic Story Chapter Banner (only when playing & not pureCamera)
      if (!this.rig.pureCamera && this.phase !== 'title') {
        this._renderMinimalHUD(ctx, W, H);
        if (this.roguelite && this.phase === 'playing' && !this.boss) {
          this.roguelite.renderHudBar(ctx, W, H, this.hudTop + this._hudPanelH() - 15, this._hudAlpha ?? 1, this._hudPanelW(W));
        }
        this._renderBossBar(ctx, W);
        this._renderStoryBanner(ctx, W);
      }

      ctx.restore();
    }

    _renderSkyAtmosphere(ctx, W, H, skyMode, calm = BG_CALM_TITLE) {
      const p = this.player;
      const t = this.time;
      ctx.save();
      // Sun glare and twinkling stars compete with bullets (bright round dots) - tone them down in flight
      ctx.globalAlpha = skyMode === 'night' ? 1 : calm.sun;
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
        const starA = 0.25 + calm.lines * 0.75;
        const starS = 0.55 + calm.lines * 0.45;
        for (const st of this._stars) {
          const x = (((st.x * W - offX) % W) + W) % W;
          const y = (((st.y * H - offY) % H) + H) % H;
          ctx.globalAlpha = (0.35 + 0.65 * Math.abs(Math.sin(t * 1.3 + st.tw))) * starA;
          ctx.fillRect(x, y, st.s * starS, st.s * starS);
        }
        ctx.globalAlpha = 0.5 + calm.cloud * 0.5;
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
      ctx.restore();
    }

    _renderHazards(ctx, py, H) {
      for (const hz of this.hazards) {
        if (hz.dead) continue;
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

    _renderParallaxWorld(ctx, camX, camY, W, H, skyMode, calm = BG_CALM_TITLE) {
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
      ctx.globalAlpha = calm.lines;
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

      // Procedural islands (saturated green blobs: pushed back even further than clouds)
      const islandA = calm.cloud * (calm.cloud < 1 ? 0.75 : 1);
      for (let gx = startGX; gx <= endGX; gx++) {
        for (let gy = startGY; gy <= endGY; gy++) {
          const h = hash2D(gx, gy);
          if (h > 0.68) {
            const wx = (gx + 0.25 + (h * 13 % 0.5)) * cell + effX0;
            const wy = (gy + 0.25 + (h * 29 % 0.5)) * cell + effY0;
            const r = 24 + (h - 0.68) * 150;
            ctx.globalAlpha = islandA * this._laneMaskWorld(wx, wy, camX, camY);
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

      ctx.globalAlpha = calm.cloud;
      this._renderCloudLayer(ctx, camX, camY, pad, 0.78, 300, c1, 71);
      this._renderCloudLayer(ctx, camX, camY, pad, 1.28, 260, c2, 193);
      // Speed lines are thin bright vertical strokes - exactly what a player shot looks like - so fade them hardest
      ctx.globalAlpha = calm.lines;

      // Airflow speed lines
      const boostRatio = this._visualBoost();
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
      ctx.globalAlpha = 1;
    }

    _renderCloudLayer(ctx, camX, camY, pad, factor, cell, fillStyle, seedOffset) {
      const effX = camX * (1 - factor);
      const effY = camY * (1 - factor);
      const x0 = Math.floor((camX - pad - effX) / cell);
      const x1 = Math.ceil((camX + pad - effX) / cell);
      const y0 = Math.floor((camY - pad - effY) / cell);
      const y1 = Math.ceil((camY + pad - effY) / cell);

      ctx.fillStyle = fillStyle;
      const baseA = ctx.globalAlpha;
      for (let gx = x0; gx <= x1; gx++) {
        for (let gy = y0; gy <= y1; gy++) {
          const h = hash2D(gx + seedOffset, gy - seedOffset);
          if (h > 0.6) {
            const wx = (gx + (h * 19 % 0.8)) * cell + effX;
            const wy = (gy + (h * 43 % 0.8)) * cell + effY;
            const r = 34 + (h - 0.6) * 145;
            ctx.globalAlpha = baseA * this._laneMaskWorld(wx, wy, camX, camY);
            ctx.beginPath();
            ctx.arc(wx, wy, r, 0, Math.PI * 2);
            ctx.arc(wx + r * 0.68, wy + r * 0.16, r * 0.76, 0, Math.PI * 2);
            ctx.arc(wx - r * 0.62, wy + r * 0.22, r * 0.68, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      ctx.globalAlpha = baseA;
    }

    // Lane mask for a scenery point given in the scenery's own (camera) coordinates
    _laneMaskWorld(wx, wy, camX, camY) {
      const L = this._lane;
      if (!L) return 1;
      return L.mask(L.ax + (wx - camX), L.ay + (wy - camY));
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
      const charge = this._railCharge();
      const boost = this._visualBoost();
      const onTitle = this.phase === 'title';
      const mods = this._mods();

      ctx.save();
      ctx.translate(cx, cy);

      if (global.SkyAircraftRenderer && global.SkyAircraftRenderer.drawTabletopRig) {
        const sinceFull = this.fullChargeAt !== null && this.fullChargeAt !== undefined ? this.time - this.fullChargeAt : -1;
        const perfWin = 0.45 * mods.railPerfectWindowMult;
        const inWindow = sinceFull >= 0 && sinceFull <= perfWin;
        const overheat = sinceFull > perfWin;
        global.SkyAircraftRenderer.drawTabletopRig(ctx, {
          shape: this.rig.shape,
          width: rw,
          length: rl,
          bank: p.bank,
          boost,
          phase: this.phase,
          calibOpen: this.calibDrawerOpen,
          pureCamera: this.rig.pureCamera,
          weaponLv: p.weaponLv,
          shield: p.shield,
          invincible: p.invulnTimer > 0,
          rollTimer: p.rollTimer,
          breath: this.breath,
          railCharge: charge,
          railPerfect: inWindow,
          railOvercharge: overheat,
          muzzleFlash: !onTitle && p.fireCooldown > 0.065,
          drawRailSphere: false,
          time: this.time,
          evoTier: mods.evoTier
        });
      } else {
        // Legacy fallback shadow + flames
        const shOffX = -p.bank * 24 + 8;
        const shOffY = (onTitle ? 10 : 16) + boost * 10;
        ctx.save();
        ctx.translate(shOffX, shOffY);
        ctx.scale(1.04 - Math.abs(p.bank) * 0.08, 1.04);
        this._traceRigShapePath(ctx, rw, rl, this.rig.shape);
        ctx.fillStyle = 'rgba(2, 10, 24, 0.46)';
        ctx.fill();
        ctx.restore();
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

        const sinceFull = this.fullChargeAt !== null && this.fullChargeAt !== undefined ? this.time - this.fullChargeAt : -1;
        const inWindow = sinceFull >= 0 && sinceFull <= 0.45;
        const overheat = sinceFull > 0.45;
        const cg = ctx.createRadialGradient(0, noseY - 6, 2, 0, noseY - 6, r * (inWindow ? 2.1 : 1.5));
        cg.addColorStop(0, '#ffffff');
        cg.addColorStop(0.45, overheat ? '#f87171' : (inWindow ? '#fef9c3' : '#67e8f9'));
        cg.addColorStop(1, 'rgba(56, 189, 248, 0)');
        ctx.fillStyle = cg;
        ctx.beginPath();
        ctx.arc(0, noseY - 6, r * (inWindow ? 2.1 : 1.5), 0, Math.PI * 2);
        ctx.fill();
        if (inWindow || overheat) {
          ctx.font = '800 13px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillStyle = inWindow ? '#fef08a' : '#fca5a5';
          ctx.fillText(inWindow ? '松手！' : '过热', 0, noseY - r * 2.2 - 8);
        }
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
          const tip = onTitle ? '▲ 停机坪 · 机头朝上' : '▲ 机头朝前 · 实物校准框';
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

      if (!onTitle && this.phase === 'playing') this._drawThreatRing(ctx, rw, rl);

      // 5. Flanking Autonomous Bit-Drones
      this._drawDroneFormation(ctx);
      this._drawSatellite(ctx);
      this._drawShieldBubble(ctx, Math.max(rw, rl) * 0.5 + 26);
      this._drawHitCore(ctx);

      ctx.restore();
    }

    _renderVirtualFighter(ctx, sx, sy) {
      const p = this.player;
      const mods = this._mods();
      const charge = this._railCharge();
      const sinceFull = this.fullChargeAt !== null && this.fullChargeAt !== undefined ? this.time - this.fullChargeAt : -1;
      const perfWin = 0.45 * mods.railPerfectWindowMult;
      const inWindow = sinceFull >= 0 && sinceFull <= perfWin;
      const overheat = sinceFull > perfWin;

      ctx.save();
      ctx.translate(sx, sy);

      if (global.SkyAircraftRenderer && global.SkyAircraftRenderer.drawVirtualPlayer) {
        global.SkyAircraftRenderer.drawVirtualPlayer(ctx, {
          shape: this.rig.shape,
          width: 82,
          length: 96,
          bank: p.bank,
          rollTimer: p.rollTimer,
          rollDuration: 0.62,
          weaponLv: p.weaponLv,
          hpRatio: clamp(p.hp / Math.max(1, p.maxHp), 0, 1),
          shield: p.shield,
          invincible: p.invulnTimer > 0 && this.phase === 'playing',
          breath: this.breath,
          railCharge: this.phase === 'playing' ? charge : 0,
          railPerfect: inWindow,
          railOvercharge: overheat,
          time: this.time,
          evoTier: mods.evoTier
        });
      }

      this._drawDroneFormation(ctx);
      this._drawSatellite(ctx);
      this._drawShieldBubble(ctx, 46);
      this._drawHitCore(ctx);

      if (this.phase === 'playing' && charge > 0.05 && (inWindow || overheat)) {
        ctx.font = '800 13px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = inWindow ? '#fef08a' : '#fca5a5';
        ctx.fillText(inWindow ? '松手！' : '过热', 0, -56);
      }

      ctx.restore();
    }

    // Edge glow on the toy's perimeter pointing at incoming shots: the real toy covers the bullets beneath it
    _drawThreatRing(ctx, rw, rl) {
      const px = this._playerWorldX();
      const py = this._playerWorldY();
      const R = Math.max(rw, rl) * 0.5 + 16;
      const range = R + 150;
      const roll = this.player.cameraRoll;
      const cos = Math.cos(roll);
      const sin = Math.sin(roll);
      ctx.save();
      ctx.lineCap = 'round';
      let drawn = 0;
      for (const b of this.enemyBullets) {
        if (b.reflected) continue;
        const dx = b.x - px;
        const dy = b.y - py;
        const d = Math.hypot(dx, dy);
        if (d > range || d < 1) continue;
        // closing in? (relative velocity in the camera frame points toward the craft)
        const rvy = b.vy + (this.rig.mode === 'tabletop' ? this.player.cruiseSpeed : 0);
        if (dx * (b.vx - this.player.vx) + dy * rvy >= 0) continue;
        const sx = dx * cos - dy * sin;
        const sy = dx * sin + dy * cos;
        const ang = Math.atan2(sy, sx);
        const urgency = clamp(1 - (d - R) / 150, 0, 1);
        ctx.strokeStyle = `rgba(248, 113, 113, ${(0.25 + urgency * 0.7).toFixed(2)})`;
        ctx.lineWidth = 3 + urgency * 4;
        ctx.beginPath();
        ctx.arc(0, 0, R + 6, ang - 0.22, ang + 0.22);
        ctx.stroke();
        if (++drawn > 24) break;
      }
      ctx.restore();
    }

    // World position of the guardian orb (orb-type toys only), or null
    _satellitePos() {
      if (!this.traits.satellite || this.phase === 'title') return null;
      const R = this.rig.mode === 'tabletop' ? Math.max(this.rig.width, this.rig.length) * 0.5 + 36 : 50;
      const a = this.time * 2.6;
      return { x: this._playerWorldX() + Math.cos(a) * R, y: this._playerWorldY() + Math.sin(a) * R, r: 13, a, R };
    }

    // Glowing bullet hit core (+ guardian orb): shows exactly what counts as a hit
    _drawHitCore(ctx) {
      if (this.phase !== 'playing' && !this.calibDrawerOpen) return;
      const r = this.hitCoreR;
      const pulse = 0.65 + Math.sin(this.time * 7) * 0.2;
      ctx.save();
      ctx.fillStyle = `rgba(248, 250, 252, ${pulse.toFixed(2)})`;
      ctx.strokeStyle = 'rgba(244, 63, 94, 0.95)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#f43f5e';
      ctx.beginPath();
      ctx.arc(0, 0, Math.max(2.5, r * 0.32), 0, Math.PI * 2);
      ctx.fill();
      if (this.calibDrawerOpen) {
        ctx.font = '700 11px system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillStyle = '#fecdd3';
        ctx.fillText(`受击判定 r=${Math.round(r)}px`, r + 8, 4);
      }
      ctx.restore();
    }

    _drawSatellite(ctx) {
      const sat = this._satellitePos();
      if (!sat) return;
      // Drawn in craft-local screen space (rig layer is not camera-rolled)
      const x = Math.cos(sat.a) * sat.R;
      const y = Math.sin(sat.a) * sat.R;
      ctx.save();
      ctx.strokeStyle = 'rgba(196, 181, 253, 0.25)';
      ctx.setLineDash([4, 8]);
      ctx.beginPath();
      ctx.arc(0, 0, sat.R, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      const g = ctx.createRadialGradient(x, y, 1, x, y, sat.r * 1.6);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.4, '#c4b5fd');
      g.addColorStop(1, 'rgba(139, 92, 246, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, sat.r * 1.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    _drawDroneFormation(ctx) {
      const p = this.player;
      const mods = this._mods();
      this._droneSlots().forEach((slot, k) => {
        const dir = slot.x < 0 ? -1 : 1;
        const dx = slot.x - p.bank * 10;
        const dy = slot.y + Math.sin(this.time * 5 + k) * 4 + dir * p.bank * 8;
        if (global.SkyAircraftRenderer && global.SkyAircraftRenderer.drawDrone) {
          global.SkyAircraftRenderer.drawDrone(ctx, {
            x: dx,
            y: dy,
            index: k,
            bank: p.bank,
            time: this.time,
            hasLightning: mods.hasLightning,
            weaponLv: p.weaponLv
          });
        } else {
          this._drawBitDrone(ctx, dx, dy);
        }
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

        if (e.marked > 0) {
          // Ground-crew target mark: rotating yellow brackets
          const R = e.radius + 12 + Math.sin(this.time * 8) * 3;
          ctx.save();
          ctx.rotate(this.time * 2);
          ctx.strokeStyle = `rgba(250, 204, 21, ${Math.min(1, e.marked).toFixed(2)})`;
          ctx.lineWidth = 3;
          for (let k = 0; k < 4; k++) {
            ctx.beginPath();
            ctx.arc(0, 0, R, k * Math.PI / 2 + 0.2, k * Math.PI / 2 + 1.0);
            ctx.stroke();
          }
          ctx.restore();
        }

        if (e.launchShield > 0 || e.blownBack) {
          ctx.strokeStyle = `rgba(103, 232, 249, ${(0.5 + Math.sin(this.time * 16) * 0.3).toFixed(2)})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(0, 0, 26, 0, Math.PI * 2);
          ctx.stroke();
          if (e.launchShield > 0) {
            ctx.fillStyle = '#e0f2fe';
            ctx.font = '800 12px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('吹!', 0, -32);
          }
        }

        if (e.isBoss) {
          if (global.SkyAircraftRenderer && global.SkyAircraftRenderer.drawBoss) {
            global.SkyAircraftRenderer.drawBoss(ctx, e, { time: this.time, def: BOSS_DEFS[e.bossKind] });
          } else {
            this._renderBoss(ctx, e, flash, engineGlow, poly);
          }
        } else if (global.SkyAircraftRenderer && global.SkyAircraftRenderer.drawEnemy) {
          global.SkyAircraftRenderer.drawEnemy(ctx, e, { time: this.time });
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
        // Fog vents trailing grey vapour around a hexagonal fortress (thick while the fog armour is up)
        const shrouded = !(e.unveiled > 0);
        ctx.fillStyle = shrouded ? 'rgba(226, 232, 240, 0.42)' : 'rgba(203, 213, 225, 0.16)';
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
        if (shrouded) {
          // Fog armour veil: blow it away (gust / nuke) to expose the hull
          const veil = ctx.createRadialGradient(0, 0, 30, 0, 0, 120);
          veil.addColorStop(0, `rgba(241, 245, 249, ${(0.32 + Math.sin(t * 2) * 0.05).toFixed(3)})`);
          veil.addColorStop(1, 'rgba(241, 245, 249, 0)');
          ctx.fillStyle = veil;
          ctx.beginPath();
          ctx.ellipse(0, 0, 120, 80, 0, 0, Math.PI * 2);
          ctx.fill();
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
        const arcSeed = Math.floor(t * 24);
        ctx.strokeStyle = `rgba(253, 230, 138, ${(0.45 + hash2D(arcSeed, 3) * 0.5).toFixed(2)})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-92, 8);
        for (let k = 1; k <= 8; k++) ctx.lineTo(-92 + k * 23, 8 + (hash2D(arcSeed, k) - 0.5) * 22);
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

    // Our shots: oriented along their screen flight vector and cached as crisp vector sprites per (shape, colour).
    // Stays in the cool/bright spectrum with a subtle dark rim so shots read on bright clouds without hiding enemy fire.
    _renderPlayerBullets(ctx) {
      if (this.bullets.length === 0) return;
      const worldVyOffset = this.rig.mode === 'tabletop' ? -this.player.cruiseSpeed : 0;
      ctx.save();
      for (const b of this.bullets) {
        const shape = b.shape || (b.drone ? 'drone' : 'laser');
        const spr = this._playerBulletSprite(shape, b.color || '#38bdf8');
        const relVy = b.vy - worldVyOffset;
        const rot = (Math.abs(b.vx) > 1 || relVy > 0) ? Math.atan2(relVy, b.vx) + Math.PI * 0.5 : 0;
        ctx.globalAlpha = b.drone ? 0.68 : (b.crit ? 0.94 : 0.84);

        if (spr && spr.canvas && spr.canvas.width > 0) {
          const drawW = b.w * spr.wScale;
          const drawH = b.h * spr.hScale;
          if (rot !== 0) {
            ctx.save();
            ctx.translate(b.x, b.y);
            ctx.rotate(rot);
            ctx.drawImage(spr.canvas, -drawW * 0.5, -drawH * 0.5, drawW, drawH);
            ctx.restore();
          } else {
            ctx.drawImage(spr.canvas, b.x - drawW * 0.5, b.y - drawH * 0.5, drawW, drawH);
          }
        } else {
          // Headless / test fallback when offscreen canvas is unavailable
          ctx.fillStyle = b.color || '#38bdf8';
          ctx.fillRect(b.x - b.w * 0.5, b.y - b.h * 0.5, b.w, b.h);
        }
      }
      ctx.restore();
    }

    _playerBulletSprite(shape, color) {
      if (!this._playerShotCache) this._playerShotCache = new Map();
      const key = `${shape}|${color}`;
      let spr = this._playerShotCache.get(key);
      if (spr) return spr;

      const c = (global.document && global.document.createElement) ? global.document.createElement('canvas') : null;
      if (!c || typeof c.getContext !== 'function') return null;
      const g = c.getContext('2d');
      if (!g || typeof g.beginPath !== 'function') return null;

      // Canonical sprite canvas: 36x64 logical units @ 2x supersampling, nose pointing -Y
      const W = 36, H = 64, scale = 2;
      c.width = W * scale;
      c.height = H * scale;
      g.scale(scale, scale);
      g.translate(W * 0.5, H * 0.5);

      const rim = 'rgba(7, 18, 36, 0.72)';
      const drawSymmetric = (pts, fill, stroke, lw = 1.6) => {
        g.beginPath();
        pts.forEach(([px, py], idx) => { if (idx === 0) g.moveTo(px, py); else g.lineTo(px, py); });
        for (let i = pts.length - 2; i >= 1; i--) g.lineTo(-pts[i][0], pts[i][1]);
        g.closePath();
        if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.lineJoin = 'round'; g.stroke(); }
        if (fill) { g.fillStyle = fill; g.fill(); }
      };

      // Soft outer aura + trailing ion wake
      const wake = g.createLinearGradient(0, -24, 0, 28);
      wake.addColorStop(0, color);
      wake.addColorStop(0.65, color);
      wake.addColorStop(1, 'rgba(56, 189, 248, 0)');
      g.globalAlpha = 0.24;
      g.fillStyle = wake;
      g.beginPath();
      g.ellipse(0, 2, shape === 'blade' || shape === 'star' ? 11 : 7.5, 25, 0, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;

      let wScale = 3.2, hScale = 1.55;

      if (shape === 'sword') {
        // Flying spirit sword: sharp tip, fuller ridge, cross-guard wings & pommel tassel
        wScale = 3.8; hScale = 1.68;
        drawSymmetric([[0, -27], [3.6, -12], [3.2, 7], [9.5, 10.5], [3.5, 13.5], [2.2, 22], [0, 26]], color, rim, 2);
        drawSymmetric([[0, -23], [1.5, -10], [1.2, 9], [0, 17]], '#ffffff', null);
      } else if (shape === 'blade') {
        // Crescent wind-arc wave: curved leading edge with hollowed trailing arc
        wScale = 4.1; hScale = 1.42;
        g.beginPath();
        g.moveTo(-12.5, 12);
        g.quadraticCurveTo(0, -28, 12.5, 12);
        g.quadraticCurveTo(0, -5, -12.5, 12);
        g.closePath();
        g.strokeStyle = rim; g.lineWidth = 2.2; g.lineJoin = 'round'; g.stroke();
        g.fillStyle = color; g.fill();
        g.beginPath();
        g.moveTo(-7.5, 6);
        g.quadraticCurveTo(0, -20, 7.5, 6);
        g.quadraticCurveTo(0, -7, -7.5, 6);
        g.closePath();
        g.fillStyle = '#ffffff'; g.fill();
      } else if (shape === 'prism') {
        // Faceted crystal shard: hexagonal diamond with inner specular facet
        wScale = 3.5; hScale = 1.5;
        drawSymmetric([[0, -25], [7.2, -5], [4.6, 13], [0, 24]], color, rim, 2);
        drawSymmetric([[0, -19], [3.3, -4], [1.8, 9], [0, 16]], '#ffffff', null);
      } else if (shape === 'lance') {
        // Piercing plasma spear: elongated needle tip + swept twin barbs
        wScale = 3.6; hScale = 1.72;
        drawSymmetric([[0, -29], [3.2, -8], [8.2, 3], [3.0, 1.5], [2.2, 25], [0, 29]], color, rim, 1.9);
        drawSymmetric([[0, -25], [1.4, -5], [1.1, 18], [0, 23]], '#ffffff', null);
      } else if (shape === 'slug') {
        // Tank heavy autocannon shell: broad armor-piercing ogive + twin mach shock rings
        wScale = 3.3; hScale = 1.48;
        drawSymmetric([[0, -23], [6.2, -11], [6.2, 9], [4.2, 16], [0, 18]], color, rim, 2.2);
        drawSymmetric([[0, -18], [3.1, -9], [3.1, 7], [0, 12]], '#ffffff', null);
        g.strokeStyle = '#ffffff'; g.lineWidth = 1.5; g.globalAlpha = 0.7;
        g.beginPath(); g.ellipse(0, 21, 5.2, 2, 0, 0, Math.PI * 2); g.stroke();
      } else if (shape === 'star') {
        // Critical overload starbolt: blazing 4-point cross-flare
        wScale = 4.2; hScale = 1.62;
        drawSymmetric([[0, -27], [3.4, -7], [12.5, -2], [3.4, 3], [2.4, 21], [0, 26]], color, rim, 2);
        drawSymmetric([[0, -21], [1.8, -5], [7.5, -2], [1.8, 1.5], [0, 16]], '#ffffff', null);
      } else if (shape === 'drone') {
        // Compact autonomous bit-bolt
        wScale = 3.1; hScale = 1.45;
        drawSymmetric([[0, -20], [5.2, -2], [2.8, 14], [0, 20]], color, rim, 1.8);
        drawSymmetric([[0, -14], [2.2, -2], [0, 11]], '#f8fdff', null);
      } else {
        // 'laser' supersonic aero-capsule: sleek tapered bolt + hot core
        wScale = 3.0; hScale = 1.55;
        drawSymmetric([[0, -24], [4.6, -12], [4.2, 12], [2.2, 22], [0, 25]], color, rim, 1.9);
        drawSymmetric([[0, -19], [2.0, -10], [1.6, 10], [0, 17]], '#f8fdff', null);
      }

      spr = { canvas: c, wScale, hScale };
      if (this._playerShotCache.size > 72) this._playerShotCache.clear();
      this._playerShotCache.set(key, spr);
      return spr;
    }

    // Enemy fire is the top layer: drawn above the craft, flames, explosions and wind.
    _renderEnemyBullets(ctx) {
      for (const eb of this.enemyBullets) {
        const spr = this._bulletSprite(eb.color, eb.r);
        ctx.drawImage(spr.canvas, eb.x - spr.half, eb.y - spr.half, spr.half * 2, spr.half * 2);
      }
    }

    // Pre-rendered halo + body + core per (colour, radius): hundreds of bullets become cheap drawImage calls
    _bulletSprite(color, r) {
      if (!this._spriteCache) this._spriteCache = new Map();
      const key = `${color}|${r}`;
      let spr = this._spriteCache.get(key);
      if (spr) return spr;
      const half = Math.ceil(r * 1.8) + 1;
      const scale = 2;
      const c = (global.document && global.document.createElement) ? global.document.createElement('canvas') : null;
      if (!c) return { canvas: { width: 0 }, half: 0 };
      c.width = c.height = half * 2 * scale;
      const g = c.getContext('2d');
      g.scale(scale, scale);
      g.translate(half, half);
      // Classic danmaku read: coloured glow, dark rim, coloured body, white-hot core.
      // The rim separates it from bright sky / clouds, the core and glow from dark sky.
      g.globalAlpha = 0.3;
      g.fillStyle = color;
      g.beginPath(); g.arc(0, 0, r * 1.8, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 0.9;
      g.fillStyle = '#0b1220';
      g.beginPath(); g.arc(0, 0, r + 1.6, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 1;
      g.fillStyle = color;
      g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ffffff';
      g.beginPath(); g.arc(0, 0, r * 0.5, 0, Math.PI * 2); g.fill();
      spr = { canvas: c, half };
      if (this._spriteCache.size > 64) this._spriteCache.clear();
      this._spriteCache.set(key, spr);
      return spr;
    }

    _renderPowerups(ctx) {
      const route = this.starRoute;
      if (route) {
        ctx.save();
        ctx.strokeStyle = 'rgba(103, 232, 249, 0.52)';
        ctx.setLineDash([4, 8]);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(route.stars[0].x, route.stars[0].y);
        for (let i = 1; i < route.stars.length; i++) ctx.lineTo(route.stars[i].x, route.stars[i].y);
        ctx.stroke();
        ctx.setLineDash([]);
        for (const star of route.stars) {
          if (star.collected) continue;
          ctx.beginPath();
          ctx.arc(star.x, star.y, 15, 0, Math.PI * 2);
          ctx.fillStyle = '#143444';
          ctx.fill();
          ctx.strokeStyle = '#8ff3f7';
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(star.x, star.y - 11);
          for (let k = 1; k < 8; k++) {
            const angle = k * Math.PI / 4 - Math.PI / 2;
            const r = k % 2 ? 3.6 : 11;
            ctx.lineTo(star.x + Math.cos(angle) * r, star.y + Math.sin(angle) * r);
          }
          ctx.closePath();
          ctx.fillStyle = '#fee799';
          ctx.fill();
        }
        const last = route.stars[route.stars.length - 1];
        if (!last.collected) {
          ctx.textAlign = 'center';
          ctx.font = '700 13px system-ui, sans-serif';
          ctx.strokeStyle = '#143444';
          ctx.lineWidth = 3;
          ctx.fillStyle = '#d9ffff';
          const label = `全收 +${STAR_ROUTE.bonus}`;
          ctx.strokeText(label, last.x, last.y - 24);
          ctx.fillText(label, last.x, last.y - 24);
        }
        ctx.restore();
      }
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
          ctx.globalAlpha = 1;
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

      for (const mk of this.marks) {
        const t = 1 - mk.life / 0.8;
        ctx.strokeStyle = `rgba(250, 204, 21, ${(1 - t).toFixed(2)})`;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(mk.x, mk.y, 12 + t * 50, 0, Math.PI * 2);
        ctx.stroke();
      }

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
    }

    // Battlefield text is kept small and sparse: only the 3 newest messages show, at reduced opacity
    _renderFloatingTexts(ctx) {
      if (!this.rig.pureCamera) {
        ctx.textAlign = 'center';
        const shown = this.floatingTexts.slice(-3);
        for (const ft of shown) {
          const age = (ft.maxLife || (ft.maxLife = ft.life)) - ft.life;
          const pop = ft.big ? 1 + Math.max(0, 0.35 - age) * 1.6 : 1;
          const size = ft.big ? 16 : (ft.small ? 11 : 12.5);
          ctx.globalAlpha = clamp(ft.life * 1.5, 0, 1) * 0.85;
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
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.6;
      for (const ws of this.windStreaks) {
        ctx.globalAlpha = clamp((ws.a || 0.78) * 0.6 * Math.min(1, ws.life * 3), 0, 1);
        ctx.beginPath();
        ctx.moveTo(ws.ox, ws.oy);
        ctx.lineTo(ws.ox, ws.oy + ws.len);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
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
      const boxW = Math.min(sb.victory ? 520 : 460, W - 32);
      const boxH = sb.victory ? 64 : 54;
      const boxX = (W - boxW) * 0.5;
      const boxY = (this.boss ? this._bossBarY(W) + 36 : this._bannerBaseY(W)) + slide;
      const accent = sb.alert ? '#e86b49' : (sb.victory ? '#ffbe69' : '#93ded0');

      ctx.fillStyle = 'rgba(9, 32, 38, 0.78)';
      this._roundRectPath(ctx, boxX, boxY, boxW, boxH, 10);
      ctx.fill();
      ctx.strokeStyle = accent;
      ctx.globalAlpha = alpha * (sb.alert ? 0.55 + 0.45 * Math.abs(Math.sin(this.time * 8)) : 0.65);
      ctx.lineWidth = 1.25;
      ctx.stroke();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = accent;
      ctx.fillRect(boxX + 18, boxY + boxH - 3, (boxW - 36) * clamp(sb.timer / sb.maxTimer, 0, 1), 2);

      ctx.fillStyle = sb.alert ? '#ffc7b7' : '#ffbe69';
      ctx.font = `800 ${sb.victory ? 17 : 15}px system-ui, -apple-system, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(sb.title, W * 0.5, boxY + (sb.victory ? 26 : 23), boxW - 24);

      ctx.fillStyle = '#faf3e1';
      ctx.font = '500 12px system-ui, -apple-system, sans-serif';
      ctx.fillText(sb.subtitle, W * 0.5, boxY + (sb.victory ? 48 : 42), boxW - 24);
      ctx.restore();
    }

    _hudPanelW(W) {
      return W < 560 ? 174 : 210;
    }

    _hudPanelH() {
      const extraRow = (this.starRoute || this.starMagnet > 0 || this.medalValue > 100 || this.breath > 0.1 || this.lungs < 0.999) ? 16 : 0;
      return 54 + extraRow + (this.roguelite ? 18 : 0);
    }

    // Boss bar and banners sit beside the telemetry clusters on wide screens, beneath them on narrow ones
    _bossBarY(W) {
      const barW = Math.min(460, W - 40);
      const clearsSides = (W - barW) * 0.5 - 12 > Math.max(14 + this._hudPanelW(W) + 8, 210);
      return this.hudTop + (clearsSides ? 16 : this._hudPanelH() + 24);
    }

    _bannerBaseY(W) {
      const boxW = Math.min(460, W - 32);
      const clearsSides = (W - boxW) * 0.5 > Math.max(14 + this._hudPanelW(W) + 8, 210);
      return this.hudTop + (clearsSides ? 4 : this._hudPanelH() + 10);
    }

    _renderBossBar(ctx, W) {
      const b = this.boss;
      if (!b || this.phase !== 'playing') return;
      const def = BOSS_DEFS[b.bossKind] || BOSS_DEFS.fog;
      const intro = clamp(1 - this.bossIntro / 2.6 + 0.25, 0, 1);
      const barW = Math.min(460, W - 40);
      const x = (W - barW) * 0.5;
      const y = this._bossBarY(W);
      ctx.save();
      // Sleek frameless aviation boss bar with crisp corner ticks
      ctx.fillStyle = 'rgba(7, 25, 31, 0.58)';
      ctx.fillRect(x - 10, y - 18, barW + 20, 32);
      ctx.strokeStyle = b.enraged ? 'rgba(248, 113, 113, 0.65)' : 'rgba(255, 190, 105, 0.55)';
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.moveTo(x - 10, y - 10); ctx.lineTo(x - 10, y - 18); ctx.lineTo(x - 2, y - 18);
      ctx.moveTo(x + barW + 2, y - 18); ctx.lineTo(x + barW + 10, y - 18); ctx.lineTo(x + barW + 10, y - 10);
      ctx.moveTo(x - 10, y + 6); ctx.lineTo(x - 10, y + 14); ctx.lineTo(x - 2, y + 14);
      ctx.moveTo(x + barW + 2, y + 14); ctx.lineTo(x + barW + 10, y + 14); ctx.lineTo(x + barW + 10, y + 6);
      ctx.stroke();

      ctx.shadowColor = 'rgba(4, 16, 22, 0.85)';
      ctx.shadowBlur = 4;
      ctx.font = '700 11.5px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillStyle = b.enraged ? '#fca5a5' : '#faf3e1';
      ctx.fillText(`${b.name}${b.enraged ? ' · 狂暴' : ''}`, x, y - 4);
      ctx.textAlign = 'right';
      ctx.font = '700 11px "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.fillStyle = b.enraged ? '#fca5a5' : '#ffbe69';
      ctx.fillText(`${Math.max(0, Math.ceil((b.hp / b.maxHp) * 100))}%`, x + barW, y - 4);

      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(7, 25, 31, 0.82)';
      ctx.fillRect(x, y + 3, barW, 6);
      const frac = clamp(b.hp / b.maxHp, 0, 1) * intro;
      const g = ctx.createLinearGradient(x, 0, x + barW, 0);
      g.addColorStop(0, b.enraged ? '#e86b49' : (def.trim || '#93ded0'));
      g.addColorStop(1, b.enraged ? '#ffbe69' : (def.core || '#ffbe69'));
      ctx.fillStyle = g;
      ctx.fillRect(x, y + 3, barW * frac, 6);
      ctx.fillStyle = 'rgba(250, 243, 225, 0.78)';
      ctx.fillRect(x + barW * 0.5 - 0.75, y + 1, 1.5, 10);
      ctx.restore();
    }

    // Frameless aviation telemetry HUD split cleanly across top corners so the sky stays open.
    // Each corner fades gently whenever the player craft flies underneath it.
    _renderMinimalHUD(ctx, W, H) {
      const p = this.player;
      const ch = this.getCurrentChapter();
      const panelW = this._hudPanelW(W);
      const panelH = this._hudPanelH();
      const x0 = 14;
      const y0 = this.hudTop;
      const monoFont = '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
      const sansFont = 'system-ui, -apple-system, "PingFang SC", sans-serif';

      const sx = this.rig.mode === 'tabletop' ? W * 0.5 : p.screenX;
      const sy = this.rig.mode === 'tabletop' ? H * this.rig.anchorY : p.screenY;
      const underLeft = sx < x0 + panelW + 48 && sy < y0 + panelH + 56;
      const underRight = sx > W - 210 && sy < y0 + 96;
      this._hudAlpha = lerp(this._hudAlpha ?? 1, underLeft ? 0.26 : 1, 0.15);
      this._hudRightAlpha = lerp(this._hudRightAlpha ?? 1, underRight ? 0.26 : 1, 0.15);

      const L = x0 + 6;
      const R = x0 + panelW;

      // ===== TOP-LEFT: Frameless Hull, Loadout & Chapter Telemetry =====
      ctx.save();
      ctx.globalAlpha = this._hudAlpha;

      // Delicate aviation left-edge calibration hairline + micro brackets (no heavy box)
      const bracketH = panelH - (this.roguelite && !this.boss ? 2 : 6);
      ctx.strokeStyle = 'rgba(250, 243, 225, 0.36)';
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.moveTo(x0 + 5, y0 + 1);
      ctx.lineTo(x0, y0 + 1);
      ctx.lineTo(x0, y0 + bracketH);
      ctx.lineTo(x0 + 5, y0 + bracketH);
      ctx.stroke();

      ctx.shadowColor = 'rgba(4, 16, 22, 0.85)';
      ctx.shadowBlur = 4;

      // Row 1: Hull bar + shield pips + percentage
      const frac = clamp(p.hp / p.maxHp, 0, 1);
      const hpPct = Math.max(0, Math.ceil(frac * 100));
      const maxShieldPips = this._mods().maxShields || 2;
      const pipsW = 2 + maxShieldPips * 11;
      const pctW = 30;
      const barX = L + 26;
      const barW = Math.max(46, R - pipsW - pctW - barX);

      ctx.textAlign = 'left';
      ctx.font = `700 10px ${sansFont}`;
      ctx.fillStyle = '#d2e1dc';
      ctx.fillText('机体', L, y0 + 12);

      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(7, 25, 31, 0.62)';
      ctx.fillRect(barX, y0 + 6, barW, 5);
      ctx.strokeStyle = 'rgba(250, 243, 225, 0.24)';
      ctx.lineWidth = 0.75;
      ctx.strokeRect(barX - 0.5, y0 + 5.5, barW + 1, 6);

      ctx.fillStyle = this.rig.godMode
        ? '#ffbe69'
        : (frac > 0.6 ? '#93ded0' : (frac > 0.3 ? '#ffbe69' : '#e86b49'));
      if (frac > 0) {
        ctx.fillRect(barX, y0 + 6, Math.max(2, barW * frac), 5);
      }

      ctx.shadowColor = 'rgba(4, 16, 22, 0.85)';
      ctx.shadowBlur = 3;
      ctx.textAlign = 'right';
      ctx.font = `700 10px ${monoFont}`;
      ctx.fillStyle = frac <= 0.3 && !this.rig.godMode ? '#fca5a5' : '#faf3e1';
      ctx.fillText(this.rig.godMode ? '护航' : `${hpPct}%`, R - pipsW - 2, y0 + 12);

      ctx.shadowBlur = 0;
      for (let k = 0; k < maxShieldPips; k++) {
        ctx.strokeStyle = k === 2 ? '#fde047' : '#93ded0';
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.arc(R - pipsW + 7 + k * 11, y0 + 8.5, 3.6, 0, Math.PI * 2);
        if (k < p.shield) {
          ctx.fillStyle = k === 2 ? '#fde047' : '#93ded0';
          ctx.fill();
        }
        ctx.stroke();
      }

      // Row 2: Firepower segments, wingmen, nukes, gust readiness
      const ry = y0 + 28;
      ctx.shadowColor = 'rgba(4, 16, 22, 0.85)';
      ctx.shadowBlur = 3;
      ctx.textAlign = 'left';
      ctx.font = `700 10px ${monoFont}`;
      ctx.fillStyle = '#ffbe69';
      ctx.fillText('P', L, ry);

      ctx.shadowBlur = 0;
      for (let k = 0; k < MAX_WEAPON_LV; k++) {
        ctx.fillStyle = k < p.weaponLv
          ? '#ffbe69'
          : (k < this.weaponCap ? 'rgba(250, 243, 225, 0.34)' : 'rgba(148, 163, 184, 0.16)');
        ctx.fillRect(L + 10 + k * 6.5, ry - 7.5, 4.5, 8);
      }

      ctx.shadowColor = 'rgba(4, 16, 22, 0.85)';
      ctx.shadowBlur = 3;
      ctx.font = `700 10.5px ${sansFont}`;
      ctx.fillStyle = p.droneCount > 0 ? '#93ded0' : 'rgba(210, 225, 220, 0.45)';
      ctx.fillText(`僚${p.droneCount}`, L + 48, ry);
      ctx.fillStyle = p.nukes > 0 ? '#ffbe69' : 'rgba(210, 225, 220, 0.45)';
      ctx.fillText(`核${p.nukes}`, L + 74, ry);

      const gustPct = p.gustCooldown <= 0 ? 1 : 1 - p.gustCooldown / p.gustMaxCooldown;
      const gx = L + 109;
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(250, 243, 225, 0.24)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(gx, ry - 3.5, 5.4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = gustPct >= 1 ? '#93ded0' : '#85a29e';
      ctx.beginPath();
      ctx.arc(gx, ry - 3.5, 5.4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * gustPct);
      ctx.stroke();
      ctx.shadowColor = 'rgba(4, 16, 22, 0.85)';
      ctx.shadowBlur = 3;
      ctx.fillStyle = gustPct >= 1 ? '#faf3e1' : '#b3cbc8';
      ctx.fillText(gustPct >= 1 ? '顺风' : '充能', gx + 9, ry);

      // Row 3: Chapter progress towards the blockade (or tutorial / boss state)
      const py4 = y0 + 44;
      ctx.font = `700 10px ${sansFont}`;
      ctx.fillStyle = '#d2e1dc';
      const roman = ['Ⅰ', 'Ⅱ', 'Ⅲ'][ch.idx] || '';
      const tag = ch.loop > 0 ? `∞${ch.loop + 1}·${roman}` : roman;
      if (this.tutorial) {
        ctx.fillStyle = '#ffbe69';
        ctx.fillText('🎓 新手引导中', L, py4);
      } else if (this.boss) {
        ctx.fillStyle = '#fca5a5';
        ctx.fillText(`${tag} 封锁线交战中`, L, py4);
      } else {
        ctx.fillText(tag, L, py4);
        const bx = L + 22;
        const bw = Math.max(48, R - bx - 14);
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(7, 25, 31, 0.62)';
        ctx.fillRect(bx, py4 - 4.5, bw, 3);
        ctx.fillStyle = '#ffbe69';
        ctx.fillRect(bx, py4 - 4.5, bw * this.chapterProgress, 3);
        ctx.fillStyle = 'rgba(250, 243, 225, 0.88)';
        ctx.fillRect(bx + bw * 0.5 - 0.75, py4 - 6.5, 1.5, 7); // supply drop marker
        ctx.shadowColor = 'rgba(4, 16, 22, 0.85)';
        ctx.shadowBlur = 3;
        ctx.textAlign = 'right';
        ctx.fillStyle = '#fca5a5';
        ctx.fillText('☠', R, py4);
      }

      // Row 4 (only while active): star route / medal chain and lung gauge
      const hasExtraRow = this.starRoute || this.starMagnet > 0 || this.medalValue > 100 || this.breath > 0.1 || this.lungs < 0.999;
      if (hasExtraRow) {
        const r5 = y0 + 59;
        ctx.textAlign = 'left';
        ctx.font = `700 10px ${sansFont}`;
        if (this.starRoute || this.starMagnet > 0) {
          ctx.fillStyle = '#93ded0';
          ctx.fillText(this.starRoute ? `✦ 星线 ${this.starRoute.collected}/${STAR_ROUTE.count}` : `吸附 ${Math.ceil(this.starMagnet)}s`, L, r5);
        } else if (this.medalValue > 100) {
          ctx.fillStyle = '#ffbe69';
          ctx.fillText(`★${this.medalValue}`, L, r5);
        }
        if (this.breath > 0.1 || this.lungs < 0.999) {
          const lx = L + 60;
          ctx.fillStyle = this.lungsExhausted ? '#94a3b8' : '#93ded0';
          ctx.fillText(this.lungsExhausted ? '换气中' : '肺活量', lx, r5);
          const lw = Math.max(24, R - (lx + 38));
          ctx.shadowBlur = 0;
          ctx.fillStyle = 'rgba(7, 25, 31, 0.65)';
          ctx.fillRect(lx + 38, r5 - 5.5, lw, 3.5);
          ctx.fillStyle = this.lungsExhausted ? '#64748b' : '#93ded0';
          ctx.fillRect(lx + 38, r5 - 5.5, lw * clamp(this.lungs, 0, 1), 3.5);
        }
      }
      ctx.restore();

      // ===== TOP-RIGHT: Frameless Aviation Score, Dynamic Heading & Distance =====
      ctx.save();
      ctx.globalAlpha = this._hudRightAlpha;
      const wide = W >= 460;
      const rx = W - (wide ? 62 : 56);
      const rightY = y0;

      ctx.shadowColor = 'rgba(4, 16, 22, 0.88)';
      ctx.shadowBlur = 4;
      ctx.textAlign = 'right';
      ctx.font = `700 ${wide ? 15.5 : 13}px ${monoFont}`;
      ctx.fillStyle = '#faf3e1';
      ctx.fillText(String(Math.floor(this.score)).padStart(7, '0'), rx, rightY + 14);

      const hdgDeg = ((Math.round((p.bank || 0) * 18) % 360) + 360) % 360;
      const hdgStr = String(hdgDeg).padStart(3, '0');
      ctx.font = `600 10px ${monoFont}`;
      ctx.fillStyle = '#93ded0';
      const rightSub = wide
        ? `HDG ${hdgStr}° · ${this.distanceKm.toFixed(1)} KM`
        : `${this.distanceKm.toFixed(1)} KM`;
      ctx.fillText(rightSub, rx, rightY + 27);

      // Subtle right-edge aviation tick next to the pause FAB
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255, 190, 105, 0.42)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(rx + 5, rightY + 3);
      ctx.lineTo(rx + 5, rightY + 29);
      ctx.stroke();

      // Combo: clean typographic counter nestled below top-right telemetry
      if (this.combo >= 5) {
        const mult = 1 + Math.min(2.0, this.combo * 0.05);
        const cx = wide ? rx : W - 14;
        const cy = y0 + (wide ? 54 : 62);
        ctx.shadowColor = 'rgba(4, 16, 22, 0.78)';
        ctx.shadowBlur = 4;
        const pulse = this.comboPulse > 0 ? 1 + this.comboPulse * 0.85 : 1;
        ctx.font = `800 ${Math.round(18 * pulse)}px ${monoFont}`;
        ctx.fillStyle = this.combo >= 50 ? '#ff9582' : '#ffbe69';
        ctx.fillText(`${this.combo}`, cx, cy);
        ctx.font = `700 10px ${sansFont}`;
        ctx.fillStyle = '#faf3e1';
        ctx.fillText(`连击 ×${mult.toFixed(2)}`, cx, cy + 13);
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(7, 25, 31, 0.55)';
        ctx.fillRect(cx - 54, cy + 18, 54, 2);
        ctx.fillStyle = this.combo >= 50 ? '#ff9582' : '#ffbe69';
        ctx.fillRect(cx - 54, cy + 18, 54 * clamp(this.comboTimer / 3.2, 0, 1), 2);
      }
      ctx.restore();
    }
  }

  global.SkyStrikerEngine = SkyStrikerEngine;
  global.STORY_CHAPTERS = STORY_CHAPTERS;
})(typeof window !== 'undefined' ? window : globalThis);
