/**
 * Tabletop Sky Striker - Roguelite XP Gems & 3-Pick-1 Skill Card Evolution System
 * Provides XP gem physics/magnetism, 23-card 5-faction synergy pool (including 5 Epic Awakenings),
 * smart draft director (anti-dead-card guard, build-focus weighting, slot diversity, tiered awakenings),
 * active skill projectiles (homing missiles, wind blades, orbiting plasma orbs,
 * chain lightning with ICD & single-target focus, railgun aftershock, roll/aegis nova, golden sword barrage),
 * top-center glowing XP HUD bar, and native <dialog> 3-card draft UI.
 */
(function (global) {
  'use strict';

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const distSq = (x1, y1, x2, y2) => (x1 - x2) * (x1 - x2) + (y1 - y2) * (y1 - y2);

  const RARITY_META = {
    common: { label: '精良', color: '#38bdf8', glow: 'rgba(56, 189, 248, 0.45)', bg: 'linear-gradient(160deg, rgba(14, 34, 62, 0.94), rgba(10, 22, 42, 0.96))' },
    rare: { label: '稀有', color: '#c084fc', glow: 'rgba(192, 132, 252, 0.5)', bg: 'linear-gradient(160deg, rgba(40, 18, 68, 0.94), rgba(16, 14, 42, 0.96))' },
    epic: { label: '传说觉醒', color: '#fbbf24', glow: 'rgba(251, 191, 36, 0.62)', bg: 'linear-gradient(160deg, rgba(64, 38, 8, 0.95), rgba(24, 16, 8, 0.97))' }
  };

  // Tiered awakening unlock levels: 1st awakening at Lv.5, 2nd at Lv.8, 3rd (max) at Lv.11
  const AWAKENING_UNLOCK_LEVELS = [5, 8, 11];
  const MAX_AWAKENINGS = 3;

  // Inline colorful vector SVG icons per category/skill
  function makeSkillSvg(iconType, accent) {
    const icons = {
      split: `<path d="M12 21V11M12 11L5 4M12 11L19 4M5 4H9M5 4V8M19 4H15M19 4V8" stroke="${accent}" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="21" r="2.2" fill="#fff"/>`,
      pierce: `<path d="M4 20L20 4M20 4H13M20 4V11" stroke="${accent}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 7L17 17" stroke="#fff" stroke-width="1.6" stroke-dasharray="2 3" stroke-linecap="round"/>`,
      missile: `<path d="M12 3C15 7 16 11 16 15L19 18H15L14 21H10L9 18H5L8 15C8 11 9 7 12 3Z" fill="${accent}" fill-opacity="0.28" stroke="${accent}" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="11" r="2" fill="#fff"/>`,
      rapid: `<path d="M13 2L4 14H11L10 22L20 10H13L13 2Z" fill="${accent}" fill-opacity="0.3" stroke="${accent}" stroke-width="2" stroke-linejoin="round"/>`,
      crit: `<circle cx="12" cy="12" r="8" stroke="${accent}" stroke-width="2"/><path d="M12 2V6M12 18V22M2 12H6M18 12H22" stroke="${accent}" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="3" fill="#fde047"/>`,
      windblade: `<path d="M4 16C8 7 15 5 21 6C17 10 16 15 11 20C9 17 7 16 4 16Z" fill="${accent}" fill-opacity="0.32" stroke="${accent}" stroke-width="2" stroke-linejoin="round"/>`,
      magnet: `<path d="M6 4V12C6 15.3 8.7 18 12 18C15.3 18 18 15.3 18 12V4" stroke="${accent}" stroke-width="2.5" stroke-linecap="round"/><path d="M6 7H9M15 7H18" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>`,
      lungs: `<path d="M3 10C7 10 9 7 12 7C14.5 7 16 8.5 16 10.5C16 12.2 14.5 13.5 12.8 13.5H4M3 15H17C19 15 20.5 16.5 20.5 18C20.5 19.5 19 21 17 21" stroke="${accent}" stroke-width="2.2" stroke-linecap="round"/>`,
      reflect: `<path d="M4 12C4 7.6 7.6 4 12 4C15.3 4 18.1 6 19.3 8.8M20 4V9H15" stroke="${accent}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 12C20 16.4 16.4 20 12 20C8.7 20 5.9 18 4.7 15.2M4 20V15H9" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
      drone: `<polygon points="12,3 20,12 12,21 4,12" fill="${accent}" fill-opacity="0.28" stroke="${accent}" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" fill="#fff"/>`,
      tesla: `<path d="M15 2L7 12H12L9 22L18 11H13L15 2Z" fill="${accent}" stroke="#e0f2fe" stroke-width="1.6" stroke-linejoin="round"/>`,
      orbit: `<circle cx="12" cy="12" r="3.2" fill="#fff"/><ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(-30 12 12)" stroke="${accent}" stroke-width="1.8" fill="none"/><ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(30 12 12)" stroke="${accent}" stroke-width="1.8" fill="none"/><circle cx="18.5" cy="8.5" r="2" fill="${accent}"/>`,
      rail: `<rect x="4" y="9" width="16" height="6" rx="2" fill="${accent}" fill-opacity="0.28" stroke="${accent}" stroke-width="2"/><path d="M2 12H22" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>`,
      aftershock: `<path d="M12 2V22M7 6L12 10L17 6M7 18L12 14L17 18" stroke="${accent}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`,
      nuke: `<circle cx="12" cy="12" r="8.5" stroke="${accent}" stroke-width="2"/><circle cx="12" cy="12" r="2.2" fill="#fff"/><path d="M12 12L8 5.5A7.5 7.5 0 0 1 16 5.5Z M12 12L19.5 13A7.5 7.5 0 0 1 15 19Z M12 12L9 19A7.5 7.5 0 0 1 4.5 13Z" fill="${accent}" fill-opacity="0.45"/>`,
      hull: `<path d="M12 3L20 7V12C20 16.8 16.6 20.6 12 22C7.4 20.6 4 16.8 4 12V7L12 3Z" fill="${accent}" fill-opacity="0.25" stroke="${accent}" stroke-width="2" stroke-linejoin="round"/><path d="M12 9V15M9 12H15" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>`,
      shield: `<path d="M12 3L19 6.5V12C19 16.5 16 20 12 21.5C8 20 5 16.5 5 12V6.5L12 3Z" fill="${accent}" fill-opacity="0.32" stroke="${accent}" stroke-width="2"/><circle cx="12" cy="12" r="3" stroke="#fff" stroke-width="1.8" fill="none"/>`,
      graze: `<circle cx="12" cy="12" r="7" stroke="${accent}" stroke-width="1.8" stroke-dasharray="3 3"/><path d="M5 19L19 5" stroke="#fde047" stroke-width="2.3" stroke-linecap="round"/>`,
      hive: `<polygon points="12,2.5 19,6.5 19,14.5 12,18.5 5,14.5 5,6.5" fill="${accent}" fill-opacity="0.32" stroke="${accent}" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="10.5" r="2.6" fill="#fff"/><circle cx="6.5" cy="19.5" r="2" fill="${accent}"/><circle cx="17.5" cy="19.5" r="2" fill="${accent}"/>`,
      aegis: `<path d="M12 2.5L20 6.2V12.2C20 17.2 16.5 20.8 12 22.2C7.5 20.8 4 17.2 4 12.2V6.2L12 2.5Z" fill="${accent}" fill-opacity="0.35" stroke="${accent}" stroke-width="2" stroke-linejoin="round"/><path d="M8.5 11.5L12 7.5L15.5 11.5L12 15.5Z" fill="#fff"/>`,
      awakening: `<path d="M12 2L14.8 8.2L21.5 9L16.4 13.5L17.9 20.2L12 16.8L6.1 20.2L7.6 13.5L2.5 9L9.2 8.2L12 2Z" fill="${accent}" fill-opacity="0.38" stroke="${accent}" stroke-width="2" stroke-linejoin="round"/>`
    };
    const body = icons[iconType] || icons.crit;
    return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">${body}</svg>`;
  }

  // Shared combat constants so card descriptions and simulation math never drift apart.
  const MISSILE_INTERVAL = [0, 2.1, 1.8, 1.5];
  const MISSILE_DAMAGE = [0, 32, 40, 48];
  const RAPID_BONUS = [0, 0.18, 0.35, 0.52];
  const CRIT_CHANCE = [0, 0.15, 0.28, 0.42];
  const CRIT_MULT = [1, 2.0, 2.3, 2.6];

  const GUST_BLADE_COUNT = [0, 2, 3, 5];
  const GUST_BLADE_DMG = [0, 52, 68, 84];
  const BREATH_BLADE_COUNT = [0, 2, 3, 3];
  const BREATH_BLADE_DMG = [0, 38, 50, 64];
  const MAGNET_RADIUS_BONUS = [0, 0.65, 1.3, 2.1];
  const MAGNET_XP_BONUS = [0, 0.16, 0.32, 0.48];
  const LUNG_BONUS = [0, 0.35, 0.7, 1.1];
  const GUST_CD_MULT = [1, 0.84, 0.7, 0.58];
  const REFLECT_MULT = [1.8, 3.0, 4.5, 6.5]; // 24 * mult = 43.2 -> 72 / 108 / 156
  const BREEZE_REFLECT_CHANCE = [0, 0.18, 0.3, 0.45];

  const DRONE_DMG_BONUS = [0, 0.24, 0.48, 0.75];
  const TESLA_JUMPS = [0, 2, 3, 5];
  const TESLA_DMG_RATIO = [0, 0.78, 0.92, 1.08];
  const TESLA_ICD = 0.09;
  const ORB_DPS = [0, 96, 112, 128];
  const ORB_BLOCK_CD = [2.4, 2.4, 2.0, 1.6];

  const RAIL_CHARGE_BONUS = [0, 0.32, 0.64, 1.0];
  const RAIL_PERFECT_BONUS = [0, 0.45, 0.9, 1.35];
  const AFTERSHOCK_DUR = [0, 2.2, 3.2, 4.4];
  const AFTERSHOCK_DPS = [0, 78, 106, 136];
  const NOVA_RADIUS = [0, 165, 200, 235];
  const NOVA_DAMAGE = [0, 74, 108, 144];

  const HULL_BONUS = [0, 25, 50, 80];
  const HULL_REGEN = [0, 1.0, 1.8, 2.8];
  const SHIELD_INTERVAL = [0, 24, 18, 13];
  const GRAZE_XP_BONUS = [0, 2, 3.5, 5];
  const GRAZE_GUST_REDUCE = [0, 0.45, 0.75, 1.1];

  const SKILL_POOL = [
    // 1. 弹道系 (5)
    {
      id: 'split_prism', name: '分裂棱镜', category: '弹道', role: 'offense', starterOk: true,
      rarity: 'common', maxStars: 3, icon: 'split', iconEmoji: '💠',
      desc: (lv) => `主炮额外向两侧斜射 +${lv} 对聚焦分裂弹，兼顾宽域清场与近距集火。`
    },
    {
      id: 'plasma_pierce', name: '电浆穿透', category: '弹道', role: 'offense', starterOk: true,
      rarity: 'rare', maxStars: 3, icon: 'pierce', iconEmoji: '⚡',
      desc: (lv) => `主炮子弹可贯穿 +${lv} 个目标而不消失，密集编队清场利器。`
    },
    {
      id: 'homing_pod', name: '追踪微导弹', category: '弹道', role: 'offense', starterOk: true,
      rarity: 'rare', maxStars: 3, icon: 'missile', iconEmoji: '🚀',
      desc: (lv) => `每 ${MISSILE_INTERVAL[lv]} 秒自动齐射 ${lv + 1} 枚追踪导弹（单发基础 ${MISSILE_DAMAGE[lv]}，随火力成长）。`
    },
    {
      id: 'overclock_barrel', name: '狂热射速', category: '弹道', role: 'offense', starterOk: true,
      rarity: 'common', maxStars: 3, icon: 'rapid', iconEmoji: '🔥',
      desc: (lv) => `主炮、浮游僚机与追踪微导弹的发射频率提升 ${Math.round(RAPID_BONUS[lv] * 100)}%。`
    },
    {
      id: 'crit_core', name: '弱点超载', category: '弹道', role: 'offense', starterOk: true,
      rarity: 'common', maxStars: 3, icon: 'crit', iconEmoji: '🎯',
      desc: (lv) => `主炮暴击率 +${Math.round(CRIT_CHANCE[lv] * 100)}%，暴击造成 ${CRIT_MULT[lv].toFixed(1)} 倍金红高能伤害。`
    },

    // 2. 借风气旋系 (4)
    {
      id: 'wind_blades', name: '顺风风刃', category: '借风', role: 'offense', starterOk: true,
      rarity: 'rare', maxStars: 3, icon: 'windblade', iconEmoji: '🌪',
      desc: (lv) => `大顺风斩出 ${GUST_BLADE_COUNT[lv]} 道穿透风刃（基础 ${GUST_BLADE_DMG[lv]}）；持续吹气每 1.1 秒追加 ${BREATH_BLADE_COUNT[lv]} 道。`
    },
    {
      id: 'wind_magnet', name: '气旋磁极', category: '借风', role: 'utility', starterOk: false,
      rarity: 'common', maxStars: 3, icon: 'magnet', iconEmoji: '🧲',
      desc: (lv) => `经验棱晶与道具吸附半径 +${Math.round(MAGNET_RADIUS_BONUS[lv] * 100)}%，经验获取 +${Math.round(MAGNET_XP_BONUS[lv] * 100)}%。`
    },
    {
      id: 'iron_lungs', name: '涡轮肺活量', category: '借风', role: 'utility', starterOk: false,
      rarity: 'common', maxStars: 3, icon: 'lungs', iconEmoji: '💨',
      desc: (lv) => `吹气肺活量与恢复速度 +${Math.round(LUNG_BONUS[lv] * 100)}%，大顺风冷却缩短 ${Math.round((1 - GUST_CD_MULT[lv]) * 100)}%。`
    },
    {
      id: 'storm_reflect', name: '风暴反噬', category: '借风', role: 'offense', starterOk: true,
      rarity: 'rare', maxStars: 3, icon: 'reflect', iconEmoji: '🌀',
      desc: (lv) => `倒吹与翻滚反弹弹追踪敌机（基础伤害 ${Math.round(24 * REFLECT_MULT[lv])}）；轻吹迎风圈有 ${Math.round(BREEZE_REFLECT_CHANCE[lv] * 100)}% 概率直接吹反近身敌弹。`
    },

    // 3. 僚机与环轨系 (3)
    {
      id: 'drone_swarm', name: '蜂群编队', category: '僚机', role: 'offense', starterOk: true,
      rarity: 'rare', maxStars: 3, icon: 'drone', iconEmoji: '🛸',
      desc: (lv) => `立即 +1 架浮游僚机（上限 ${4 + Math.min(2, lv)} 架），全僚机伤害 +${Math.round(DRONE_DMG_BONUS[lv] * 100)}%。`
    },
    {
      id: 'tesla_chain', name: '雷霆锁链', category: '僚机', role: 'offense', starterOk: true,
      rarity: 'rare', maxStars: 3, icon: 'tesla', iconEmoji: '🌩',
      desc: (lv) => `僚机、暴击或每第 5 轮主炮触发跳跃 ${TESLA_JUMPS[lv]} 次的高压闪电链；对单目标时余电聚焦追加落雷伤害。`
    },
    {
      id: 'orbit_orbs', name: '环轨电浆球', category: '僚机', role: 'offense', starterOk: true,
      rarity: 'common', maxStars: 3, icon: 'orbit', iconEmoji: '🔮',
      desc: (lv) => `环绕 ${lv} 颗护体电浆球，持续灼烧近身敌机并抵消普通敌弹（充能 ${ORB_BLOCK_CD[lv]} 秒）。`
    },

    // 4. 重武与战术系 (3)
    {
      id: 'rail_capacitor', name: '超导磁轨', category: '重武', role: 'offense', starterOk: true,
      rarity: 'common', maxStars: 3, icon: 'rail', iconEmoji: '🔋',
      desc: (lv) => `磁轨炮蓄力速度 +${Math.round(RAIL_CHARGE_BONUS[lv] * 100)}%，完美释放窗口延长 ${Math.round(RAIL_PERFECT_BONUS[lv] * 100)}%。`
    },
    {
      id: 'rail_aftershock', name: '电离余震', category: '重武', role: 'offense', starterOk: true,
      rarity: 'rare', maxStars: 3, icon: 'aftershock', iconEmoji: '⚡',
      desc: (lv) => `磁轨炮路径残留持续 ${AFTERSHOCK_DUR[lv]} 秒的高压电离带（每秒基础 ${AFTERSHOCK_DPS[lv]} 电击伤害）。`
    },
    {
      id: 'tactical_arsenal', name: '核子补给', category: '重武', role: 'offense', starterOk: true,
      rarity: 'rare', maxStars: 3, icon: 'nuke', iconEmoji: '☢',
      desc: (lv) => `立即 +1 枚战术核弹；每次翻滚震碎半径 ${NOVA_RADIUS[lv]} 内敌弹并造成 ${NOVA_DAMAGE[lv]} 脉冲伤害。`
    },

    // 5. 机甲生存系 (3)
    {
      id: 'nano_hull', name: '纳米装甲', category: '机甲', role: 'defense', starterOk: false,
      rarity: 'common', maxStars: 3, icon: 'hull', iconEmoji: '🛡',
      desc: (lv) => `最大耐久 +${HULL_BONUS[lv]}，立即回复 30% 耐久；非受击状态每秒自修 ${HULL_REGEN[lv]} 点。`
    },
    {
      id: 'phase_aegis', name: '相位护盾', category: '机甲', role: 'defense', starterOk: true,
      rarity: 'rare', maxStars: 3, icon: 'shield', iconEmoji: '🔷',
      desc: (lv) => `立即获得 1 层能量护盾，且每 ${SHIELD_INTERVAL[lv]} 秒自动再生 1 层护盾。`
    },
    {
      id: 'graze_dynamo', name: '擦弹引擎', category: '机甲', role: 'utility', starterOk: false,
      rarity: 'common', maxStars: 3, icon: 'graze', iconEmoji: '✨',
      desc: (lv) => `擦弹圈 +35%，每次擦弹额外获 +${GRAZE_XP_BONUS[lv]} 经验并缩短 ${GRAZE_GUST_REDUCE[lv]} 秒顺风冷却。`
    },

    // 6. 五大流派传说金色觉醒卡（Lv.5 / Lv.8 / Lv.11 阶梯开启，对应流派任一技能 2★ 解锁）
    {
      id: 'awakening_barrage', name: '【觉醒】天穹万剑归宗', category: '觉醒', faction: '弹道', role: 'offense',
      rarity: 'epic', maxStars: 1, icon: 'awakening', iconEmoji: '⚔️',
      requires: ['split_prism', 'plasma_pierce', 'homing_pod', 'overclock_barrel', 'crit_core'], minLv: 5,
      desc: () => `每 5 轮主炮齐射 8 枚金色追踪飞剑；主炮与追踪微导弹伤害 +20%。`
    },
    {
      id: 'awakening_tempest', name: '【觉醒】九级飓风领域', category: '觉醒', faction: '借风', role: 'offense',
      rarity: 'epic', maxStars: 1, icon: 'awakening', iconEmoji: '🌪️',
      requires: ['wind_blades', 'wind_magnet', 'iron_lungs', 'storm_reflect'], minLv: 5,
      desc: () => `吹气展开偏转力场并高频喷发巨型青金风刃（继承风刃星级继续增伤），大顺风冷却再缩 15%。`
    },
    {
      id: 'awakening_hive', name: '【觉醒】苍穹蜂群矩阵', category: '觉醒', faction: '僚机', role: 'offense',
      rarity: 'epic', maxStars: 1, icon: 'hive', iconEmoji: '🛰️',
      requires: ['drone_swarm', 'tesla_chain', 'orbit_orbs'], minLv: 5,
      desc: () => `立即补编 +2 架僚机（上限升至 6 架），僚机与环轨电浆伤害 +35%，每次僚机齐射必触发高压闪电链！`
    },
    {
      id: 'awakening_rail', name: '【觉醒】阳电子破城炮', category: '觉醒', faction: '重武', role: 'offense',
      rarity: 'epic', maxStars: 1, icon: 'awakening', iconEmoji: '🌟',
      requires: ['rail_capacitor', 'rail_aftershock', 'tactical_arsenal'], minLv: 5,
      desc: () => `磁轨光束伤害 +65%、宽度 +35%，开火降下全屏阳电子感电落雷；完美蓄力返还 30% 冷却。`
    },
    {
      id: 'awakening_aegis', name: '【觉醒】不灭星神装甲', category: '觉醒', faction: '机甲', role: 'defense',
      rarity: 'epic', maxStars: 1, icon: 'aegis', iconEmoji: '👑',
      requires: ['nano_hull', 'phase_aegis', 'graze_dynamo'], minLv: 5,
      desc: () => `护盾上限升至 3 层并立得 2 层盾；破盾或翻滚释放清弹震波重创敌群，每层激活护盾使全伤害 +8%。`
    }
  ];

  const SKILL_MAP = Object.fromEntries(SKILL_POOL.map((s) => [s.id, s]));
  const FACTION_AWAKENING = Object.fromEntries(
    SKILL_POOL.filter((s) => s.rarity === 'epic' && s.faction).map((s) => [s.faction, s])
  );

  function xpRequiredFor(level) {
    // Lv.1 -> Lv.2 costs strictly 36 XP (nine scouts, or one bomber + one gunship).
    // Lv.2+ follows a smooth curve so Acts I, II and III each grant ~3-4 drafts consistently.
    if (level <= 1) return 36;
    return Math.round(28 + level * 20 + Math.pow(level - 1, 1.32) * 5);
  }

  class SkyRoguelite {
    constructor(callbacks = {}) {
      this.cb = callbacks;
      this.sfx = callbacks.sfx || null;
      this.skills = {}; // id -> stars
      this.pickOrder = [];
      this.overclockStacks = 0; // fallback reward when the entire skill pool is maxed in deep endless runs
      this.level = 1;
      this.xp = 0;
      this.xpNext = xpRequiredFor(1);
      this.pendingLevelUps = 0;
      this.xpChain = 0;
      this.xpChainTimer = 0;

      // World simulation entities
      this.gems = [];
      this.missiles = [];
      this.windBlades = [];
      this.arcs = [];
      this.aftershocks = [];
      this.novas = [];
      this.orbs = []; // { angle, cooldown, tickTimer }

      this.missileTimer = 0;
      this.breathBladeTimer = 0;
      this.autoShieldTimer = 0;
      this.lightningIcdTimer = 0;
      this.mainShotCounter = 0;
      this.teslaShotCounter = 0;
      this.powerScale = 1;
      this.droneCountHint = 0;
      this.activeShieldsHint = 0;
      this.levelFlash = 0;
      this.time = 0;

      this.draft = null;
      this.draftSession = Math.random().toString(36).slice(2);
      this.draftSequence = 0;
      this.hudBarRect = null;

      this._ensureUi();
    }

    _ensureUi() {
      if (typeof document === 'undefined') return;
      if (document.getElementById('roguelite-draft-style')) return;

      const style = document.createElement('style');
      style.id = 'roguelite-draft-style';
      style.textContent = `
        #roguelite-draft-dialog {
          margin: auto;
          padding: 0;
          border: none;
          background: transparent;
          color: #f8fafc;
          max-inline-size: min(940px, 95dvw);
          inline-size: min(940px, 95dvw);
          max-block-size: 92dvh;
          overflow: visible;
          font-family: system-ui, -apple-system, "Segoe UI", "PingFang SC", sans-serif;
          touch-action: manipulation;
          transform: translateZ(0);
          backface-visibility: hidden;
        }
        #roguelite-draft-dialog:modal {
          overscroll-behavior: contain;
        }
        #roguelite-draft-dialog::backdrop {
          background: radial-gradient(circle at 50% 35%, rgba(8, 22, 48, 0.86), rgba(3, 8, 18, 0.94));
          overflow: hidden;
          overscroll-behavior: contain;
        }
        .rg-shell {
          background: linear-gradient(175deg, rgba(11, 24, 46, 0.96), rgba(6, 13, 28, 0.98));
          border: 1px solid rgba(125, 211, 252, 0.28);
          border-radius: 22px;
          padding: clamp(14px, 2.5vw, 24px);
          max-block-size: 90dvh;
          overflow-y: auto;
          overscroll-behavior: contain;
          box-shadow: 0 28px 70px rgba(0, 0, 0, 0.7), inset 0 1px 0 rgba(255, 255, 255, 0.14);
          display: flex;
          flex-direction: column;
          gap: 14px;
          transform: translateZ(0);
          backface-visibility: hidden;
        }
        .rg-head {
          text-align: center;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .rg-kicker {
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 0.12em;
          color: #38bdf8;
          text-transform: uppercase;
        }
        .rg-title {
          margin: 0;
          font-size: clamp(19px, 2.8vw, 26px);
          font-weight: 900;
          background: linear-gradient(90deg, #fff, #bae6fd 50%, #fde047);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
        }
        .rg-sub {
          margin: 0;
          font-size: 12.5px;
          color: #94a3b8;
          transition: color 0.18s ease;
        }
        .rg-sub.nudge {
          color: #fde047;
        }
        .rg-cards {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          grid-template-rows: auto auto 1fr auto;
          gap: clamp(10px, 1.8vw, 16px);
        }
        .rg-card {
          position: relative;
          appearance: none;
          text-align: left;
          cursor: pointer;
          border-radius: 16px;
          padding: 16px 14px 13px;
          border: 1.5px solid var(--rg-accent, #38bdf8);
          background: var(--rg-bg);
          color: #f8fafc;
          grid-row: span 4;
          display: grid;
          grid-template-rows: auto auto 1fr auto;
          grid-template-rows: subgrid;
          row-gap: 8px;
          transition: transform 0.16s ease, box-shadow 0.16s ease, border-color 0.16s ease;
          box-shadow: 0 10px 26px rgba(0, 0, 0, 0.42), 0 0 0 1px rgba(255, 255, 255, 0.05) inset;
          overflow: clip;
          min-block-size: 44px;
        }
        @media (max-width: 680px) {
          .rg-cards {
            grid-template-columns: 1fr;
            grid-template-rows: none;
            gap: 10px;
          }
          .rg-card {
            grid-row: auto;
            display: grid;
            grid-template-columns: 52px minmax(0, 1fr);
            grid-template-rows: auto auto auto;
            align-items: center;
            column-gap: 12px;
            row-gap: 4px;
            padding: 11px 12px;
          }
          .rg-card-top { grid-column: 1 / 2; grid-row: 1 / 4; flex-direction: column; align-items: center !important; gap: 4px !important; }
          .rg-card-head { grid-column: 2 / 3; }
          .rg-card-desc { grid-column: 2 / 3; }
          .rg-card-synergy { grid-column: 2 / 3; }
        }
        @media (hover: hover) and (pointer: fine) {
          .rg-card::before {
            content: "";
            position: absolute;
            inset: -60% -40%;
            background: linear-gradient(125deg, transparent 42%, rgba(255, 255, 255, 0.14) 50%, transparent 58%);
            transform: translateX(-60%);
            transition: transform 0.55s ease;
            pointer-events: none;
          }
          .rg-card:hover {
            transform: translateY(-4px) scale(1.015);
            box-shadow: 0 16px 36px rgba(0, 0, 0, 0.55), 0 0 24px var(--rg-glow, rgba(56, 189, 248, 0.45));
            outline: none;
          }
          .rg-card:hover::before,
          .rg-card.focused::before {
            transform: translateX(65%);
          }
        }
        .rg-card.focused,
        .rg-card:focus-visible {
          border-width: 2.5px;
          box-shadow: 0 12px 28px rgba(0, 0, 0, 0.5), 0 0 20px var(--rg-glow, rgba(56, 189, 248, 0.45));
          outline: none;
        }
        .rg-card-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .rg-icon-wrap {
          inline-size: 46px;
          block-size: 46px;
          border-radius: 13px;
          background: rgba(15, 23, 42, 0.72);
          border: 1px solid rgba(255, 255, 255, 0.14);
          display: grid;
          place-items: center;
          box-shadow: 0 0 14px var(--rg-glow, rgba(56, 189, 248, 0.3));
          flex-shrink: 0;
        }
        .rg-icon-wrap svg {
          inline-size: 28px;
          block-size: 28px;
          display: block;
        }
        .rg-badges {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 4px;
        }
        .rg-tag {
          font-size: 11px;
          font-weight: 800;
          padding: 2px 8px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.09);
          border: 1px solid var(--rg-accent);
          color: var(--rg-accent);
          white-space: nowrap;
        }
        .rg-stars {
          font-size: 12px;
          letter-spacing: 0.8px;
          color: #fde047;
          font-weight: 800;
          white-space: nowrap;
        }
        .rg-card-head {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 6px;
        }
        .rg-name {
          font-size: 16px;
          font-weight: 900;
          color: #ffffff;
        }
        .rg-keyhint {
          font-size: 11px;
          font-weight: 800;
          color: #cbd5e1;
          background: rgba(255, 255, 255, 0.1);
          padding: 1px 6px;
          border-radius: 6px;
          flex-shrink: 0;
        }
        .rg-card-desc {
          font-size: 13px;
          line-height: 1.48;
          color: #cbd5e1;
        }
        .rg-card-synergy {
          font-size: 11.5px;
          font-weight: 700;
          color: #93c5fd;
          padding-top: 6px;
          border-top: 1px dashed rgba(148, 163, 184, 0.2);
          line-height: 1.35;
        }
        .rg-card-synergy.epic-ready {
          color: #fde047;
        }
        .rg-foot {
          display: flex;
          flex-wrap: wrap;
          align-items: safe center;
          justify-content: space-between;
          gap: 10px;
          padding-top: 4px;
          border-top: 1px solid rgba(148, 163, 184, 0.16);
        }
        .rg-reroll {
          appearance: none;
          border: 1px solid rgba(56, 189, 248, 0.45);
          background: rgba(14, 116, 144, 0.25);
          color: #e0f2fe;
          border-radius: 10px;
          padding: 7px 14px;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          min-block-size: 38px;
        }
        .rg-reroll:hover:not(:disabled) {
          background: rgba(14, 116, 144, 0.45);
        }
        .rg-reroll:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .rg-owned {
          display: flex;
          flex-wrap: wrap;
          flex-wrap: balance;
          gap: 6px;
          align-items: center;
          flex: 1 1 260px;
          min-inline-size: 0;
          justify-content: flex-end;
        }
        .rg-owned-chip {
          font-size: 11px;
          font-weight: 700;
          padding: 3px 8px;
          border-radius: 999px;
          background: rgba(30, 41, 59, 0.85);
          border: 1px solid rgba(148, 163, 184, 0.28);
          color: #e2e8f0;
        }
        .rg-owned-chip.epic {
          border-color: rgba(251, 191, 36, 0.65);
          color: #fde68a;
        }
      `;
      document.head.appendChild(style);

      const dlg = document.createElement('dialog');
      dlg.id = 'roguelite-draft-dialog';
      dlg.setAttribute('closedby', 'none');
      dlg.setAttribute('aria-labelledby', 'rg-draft-title');
      dlg.innerHTML = `
        <div class="rg-shell">
          <div class="rg-head">
            <div class="rg-kicker">LEVEL UP · 核心进化</div>
            <h2 class="rg-title" id="rg-draft-title">借风核心升级 · Lv.2</h2>
            <p class="rg-sub" id="rg-draft-sub">点击卡片 / 键盘 1 · 2 · 3 / 手柄或手机座舱同步选卡</p>
          </div>
          <div class="rg-cards" id="rg-cards-grid"></div>
          <div class="rg-foot">
            <button type="button" class="rg-reroll" id="rg-reroll-btn">🎲 换一批 (R)</button>
            <div class="rg-owned" id="rg-owned-list"></div>
          </div>
        </div>
      `;
      dlg.addEventListener('cancel', (ev) => {
        ev.preventDefault(); // Must pick a skill card; communicate why without layout shift
        if (this._subEl) {
          this._subEl.textContent = '请先选择一项核心进化技能后继续航程（键盘 1 · 2 · 3 或点击卡片）';
          this._subEl.classList.add('nudge');
        }
      });
      document.body.appendChild(dlg);

      this._dlg = dlg;
      this._titleEl = dlg.querySelector('#rg-draft-title');
      this._subEl = dlg.querySelector('#rg-draft-sub');
      this._gridEl = dlg.querySelector('#rg-cards-grid');
      this._rerollBtn = dlg.querySelector('#rg-reroll-btn');
      this._ownedEl = dlg.querySelector('#rg-owned-list');

      this._rerollBtn.addEventListener('click', () => {
        this.reroll();
      });
    }

    reset() {
      this.skills = {};
      this.pickOrder = [];
      this.overclockStacks = 0;
      this.level = 1;
      this.xp = 0;
      this.xpNext = xpRequiredFor(1);
      this.pendingLevelUps = 0;
      this.xpChain = 0;
      this.xpChainTimer = 0;
      this.gems = [];
      this.missiles = [];
      this.windBlades = [];
      this.arcs = [];
      this.aftershocks = [];
      this.novas = [];
      this.orbs = [];
      this.missileTimer = 0;
      this.breathBladeTimer = 0;
      this.autoShieldTimer = 0;
      this.lightningIcdTimer = 0;
      this.mainShotCounter = 0;
      this.teslaShotCounter = 0;
      this.powerScale = 1;
      this.droneCountHint = 0;
      this.activeShieldsHint = 0;
      this.levelFlash = 0;
      this.closeDraft(true);
    }

    _ownedAwakeningCount() {
      let count = 0;
      for (const sk of SKILL_POOL) {
        if (sk.rarity === 'epic' && this.skills[sk.id]) count += 1;
      }
      return count;
    }

    _evoTier() {
      return clamp(this._ownedAwakeningCount(), 0, 3);
    }

    _factionStars(category) {
      let sum = 0;
      for (const sk of SKILL_POOL) {
        if (sk.category === category && this.skills[sk.id]) sum += this.skills[sk.id];
      }
      return sum;
    }

    _nextAwakeningUnlockLevel() {
      const owned = this._ownedAwakeningCount();
      if (owned >= MAX_AWAKENINGS) return Infinity;
      return AWAKENING_UNLOCK_LEVELS[owned] || 11;
    }

    getModifiers() {
      const s = this.skills;
      const splitLv = s.split_prism || 0;
      const pierceLv = s.plasma_pierce || 0;
      const rapidLv = s.overclock_barrel || 0;
      const critLv = s.crit_core || 0;
      const magLv = s.wind_magnet || 0;
      const lungLv = s.iron_lungs || 0;
      const reflectLv = s.storm_reflect || 0;
      const droneLv = s.drone_swarm || 0;
      const railLv = s.rail_capacitor || 0;
      const hullLv = s.nano_hull || 0;
      const shieldLv = s.phase_aegis || 0;
      const grazeLv = s.graze_dynamo || 0;

      const hasBarrage = Boolean(s.awakening_barrage);
      const hasTempest = Boolean(s.awakening_tempest);
      const hasHive = Boolean(s.awakening_hive);
      const hasRail = Boolean(s.awakening_rail);
      const hasAegis = Boolean(s.awakening_aegis);
      const evoTier = this._evoTier();

      const aegisDmgBonus = hasAegis ? clamp(this.activeShieldsHint, 0, 3) * 0.08 : 0;
      const overclockBonus = this.overclockStacks * 0.06;
      const globalDmgMult = (1 + overclockBonus) * (1 + aegisDmgBonus);

      const baseMaxDrones = droneLv > 0 ? 4 + Math.min(2, droneLv) : 4;
      const maxDrones = hasHive ? 6 : baseMaxDrones;

      return {
        evoTier,
        globalDmgMult,
        splitShots: splitLv,
        pierceCount: pierceLv,
        fireRateMult: 1 + RAPID_BONUS[rapidLv],
        damageMult: globalDmgMult * (hasBarrage ? 1.2 : 1),
        critChance: CRIT_CHANCE[critLv],
        critMult: CRIT_MULT[critLv],
        pickupRadiusMult: 1 + MAGNET_RADIUS_BONUS[magLv],
        xpMult: 1 + MAGNET_XP_BONUS[magLv],
        lungCapMult: 1 + LUNG_BONUS[lungLv],
        lungRegenMult: 1 + LUNG_BONUS[lungLv],
        gustCdMult: GUST_CD_MULT[lungLv] * (hasTempest ? 0.85 : 1),
        windReflectMult: REFLECT_MULT[reflectLv],
        windReflectHoming: reflectLv > 0,
        breezeReflectChance: BREEZE_REFLECT_CHANCE[reflectLv],
        maxDrones,
        droneDamageMult: (1 + DRONE_DMG_BONUS[droneLv]) * (hasHive ? 1.35 : 1) * globalDmgMult,
        hiveAwakened: hasHive,
        hasLightning: (s.tesla_chain || 0) > 0 || hasHive,
        railChargeMult: 1 + RAIL_CHARGE_BONUS[railLv],
        railPerfectWindowMult: 1 + RAIL_PERFECT_BONUS[railLv],
        railAwakened: hasRail,
        railPerfectCdRefund: hasRail ? 0.3 : 0,
        railDamageMult: (hasRail ? 1.65 : 1) * globalDmgMult,
        maxHpBonus: HULL_BONUS[hullLv],
        hullRegenPerSec: HULL_REGEN[hullLv],
        maxShields: hasAegis ? 3 : 2,
        aegisAwakened: hasAegis,
        autoShieldInterval: shieldLv > 0 ? SHIELD_INTERVAL[shieldLv] : 0,
        grazeRadiusMult: grazeLv > 0 ? 1.35 : 1,
        grazeGustReduce: GRAZE_GUST_REDUCE[grazeLv],
        grazeXp: GRAZE_XP_BONUS[grazeLv],
        tempestAura: hasTempest
      };
    }

    spawnXp(x, y, amount = 4, tier = 0, autoPull = false) {
      const angle = Math.random() * Math.PI * 2;
      const spd = 40 + Math.random() * 75;
      this.gems.push({
        x, y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd - 35,
        amount,
        tier, // 0: cyan, 1: violet, 2: gold
        gustPulled: Boolean(autoPull),
        age: 0,
        phase: Math.random() * 6.28
      });
    }

    spawnXpFromKill(x, y, enemyType, isBoss = false, xpScale = 1) {
      const mult = Math.max(0.5, Number.isFinite(xpScale) ? xpScale : 1);
      if (isBoss) {
        this.spawnXpBurst(x, y, Math.round(90 * mult), 14, true);
        return;
      }
      const table = {
        scout: [4, 1, 0],
        escort: [4, 1, 0],
        weaver: [5, 1, 0],
        mine: [4, 1, 0],
        lancer: [7, 2, 0],
        gunship: [14, 3, 1],
        bomber: [22, 4, 1],
        sentinel: [20, 4, 1]
      };
      const [baseTot, cnt, tier] = table[enemyType] || [5, 1, 0];
      const tot = Math.max(1, Math.round(baseTot * mult));
      for (let i = 0; i < cnt; i++) {
        const amount = Math.floor(tot / cnt) + (i < tot % cnt ? 1 : 0);
        if (amount > 0) {
          this.spawnXp(x + (Math.random() - 0.5) * 16, y + (Math.random() - 0.5) * 16, amount, tier);
        }
      }
    }

    spawnXpBurst(x, y, totalAmount = 45, count = 8, autoPull = false) {
      const tot = Math.max(1, Math.round(totalAmount));
      for (let i = 0; i < count; i++) {
        const amount = Math.floor(tot / count) + (i < tot % count ? 1 : 0);
        if (amount <= 0) continue;
        const tier = amount >= 10 ? 2 : (amount >= 6 ? 1 : 0);
        this.spawnXp(x + (Math.random() - 0.5) * 28, y + (Math.random() - 0.5) * 28, amount, tier, autoPull);
      }
    }

    addRawXp(amount) {
      const mods = this.getModifiers();
      this.xp += amount * mods.xpMult;
      while (this.xp >= this.xpNext) {
        this.xp -= this.xpNext;
        this.level += 1;
        this.xpNext = xpRequiredFor(this.level);
        this.pendingLevelUps += 1;
        this.levelFlash = 1.1;
      }
    }

    _currentDraftLevel() {
      return Math.max(2, this.level - Math.max(0, this.pendingLevelUps - 1));
    }

    _buildSynergyHint(sk, nextStars, draftLevel) {
      if (sk.rarity === 'epic') {
        const wingTier = clamp(this._ownedAwakeningCount() + 1, 1, 3);
        return { text: `🌟 终极觉醒 · 解锁 ${wingTier} 阶流光进化翼`, epicReady: true };
      }
      const awk = FACTION_AWAKENING[sk.category];
      const ownedAwk = awk && this.skills[awk.id];
      const unlockLv = this._nextAwakeningUnlockLevel();
      const factionHas2Star = awk && awk.requires.some((id) => (this.skills[id] || 0) >= 2);
      if (awk && !ownedAwk && unlockLv < Infinity && nextStars === 2 && !factionHas2Star) {
        const lvNote = draftLevel >= unlockLv ? '下次升级即可刷出' : `Lv.${unlockLv} 开启`;
        return { text: `✦ 升至 2★ 激活${awk.name.replace('【觉醒】', '【')}（${lvNote}）`, epicReady: true };
      }
      if (nextStars === 3) {
        return { text: `★ 满星质变 · 达成【${sk.category}】顶阶强化`, epicReady: false };
      }
      const fStars = this._factionStars(sk.category);
      if (fStars > 0) {
        return { text: `🔗 【${sk.category}】共鸣 · 已投入 ${fStars}★`, epicReady: false };
      }
      return { text: `💡 开启【${sk.category}】流派构筑路线`, epicReady: false };
    }

    _weightForCandidate(sk, draftLevel, pickedSoFar = []) {
      const cur = this.skills[sk.id] || 0;
      const ownedTypes = this.pickOrder.filter((id) => (SKILL_MAP[id]?.rarity !== 'epic')).length;

      let w = sk.rarity === 'epic' ? 3.8 : (sk.rarity === 'rare' ? 1.38 : 1.0);

      // Help players reliably reach 2★ (awakening prerequisite) and 3★ capstones instead of 8 scattered 1★ cards
      if (cur === 1) w *= 1.8;
      else if (cur === 2) w *= 1.55;
      else if (ownedTypes >= 5 && sk.rarity !== 'epic') w *= 0.55;

      // Faction synergy nudge
      if (sk.rarity !== 'epic') {
        const fStars = this._factionStars(sk.category);
        if (fStars > 0) w *= Math.min(1.55, 1 + fStars * 0.18);
      }

      // Contextual smart guards: avoid low-impact picks before prerequisites exist
      if (sk.id === 'tesla_chain' && cur === 0) {
        const hasTrigger = this.droneCountHint > 0 || (this.skills.drone_swarm || 0) > 0 || (this.skills.crit_core || 0) > 0;
        w *= hasTrigger ? 1.5 : 0.6;
      }

      // Slot diversity: discourage packing all 3 slots with the exact same faction
      const sameCategoryCount = pickedSoFar.filter((p) => p.category === sk.category).length;
      if (draftLevel <= 2 && sameCategoryCount >= 1) w *= 0.05;
      else if (sameCategoryCount >= 2) w *= 0.12;
      else if (sameCategoryCount === 1) w *= 0.68;

      return Math.max(0.02, w);
    }

    _rollChoices(excludeIds = new Set(), draftLevel = this._currentDraftLevel()) {
      const isFirstPick = this.pickOrder.length === 0 && draftLevel <= 2;
      const nextAwakeningLv = this._nextAwakeningUnlockLevel();

      const eligible = SKILL_POOL.filter((sk) => {
        const cur = this.skills[sk.id] || 0;
        if (cur >= sk.maxStars) return false;
        if (sk.rarity === 'epic') {
          if (draftLevel < Math.max(sk.minLv || 5, nextAwakeningLv)) return false;
          if (sk.requires && !sk.requires.some((reqId) => (this.skills[reqId] || 0) >= 2)) return false;
          return true;
        }
        if (sk.minLv && draftLevel < sk.minLv) return false;
        return true;
      });
      if (eligible.length === 0) return [];

      let pool = eligible.filter((sk) => !excludeIds.has(sk.id));
      if (pool.length < Math.min(3, eligible.length)) pool = eligible.slice();

      // First draft guarantee: only immediate, active/tangible combat skills so Lv.2 always feels impactful
      if (isFirstPick) {
        const starters = pool.filter((sk) => sk.starterOk !== false);
        if (starters.length >= 3) pool = starters;
      }

      const picked = [];
      const temp = pool.slice();
      const targetCount = Math.min(3, temp.length);

      while (picked.length < targetCount && temp.length > 0) {
        let candidates = temp;
        // First draft strictly spans distinct factions whenever distinct factions remain
        if (isFirstPick && picked.length > 0) {
          const usedCats = new Set(picked.map((p) => p.category));
          const distinct = candidates.filter((sk) => !usedCats.has(sk.category));
          if (distinct.length > 0) candidates = distinct;
        }
        // Ensure at least one offensive option in the 3-card spread whenever available
        if (picked.length === targetCount - 1 && !picked.some((p) => p.role === 'offense')) {
          const offenseOnly = candidates.filter((sk) => sk.role === 'offense');
          if (offenseOnly.length > 0) candidates = offenseOnly;
        }

        const weights = candidates.map((sk) => this._weightForCandidate(sk, draftLevel, picked));
        const total = weights.reduce((a, b) => a + b, 0);
        let r = Math.random() * total;
        let chosen = candidates[0];
        for (let i = 0; i < candidates.length; i++) {
          r -= weights[i];
          if (r <= 0) { chosen = candidates[i]; break; }
        }

        const removeIdx = temp.indexOf(chosen);
        if (removeIdx >= 0) temp.splice(removeIdx, 1);

        const prevStars = this.skills[chosen.id] || 0;
        const nextStars = prevStars + 1;
        const hint = this._buildSynergyHint(chosen, nextStars, draftLevel);
        picked.push({
          id: chosen.id,
          name: chosen.name,
          category: chosen.category,
          role: chosen.role,
          rarity: chosen.rarity,
          prevStars,
          stars: nextStars,
          maxStars: chosen.maxStars,
          isNew: nextStars === 1,
          icon: chosen.icon,
          iconEmoji: chosen.iconEmoji,
          desc: chosen.desc(nextStars),
          synergyHint: hint.text,
          epicReady: hint.epicReady
        });
      }
      return picked;
    }

    _grantMaxedPoolOverclock() {
      while (this.pendingLevelUps > 0) {
        this.pendingLevelUps -= 1;
        this.overclockStacks += 1;
        if (this.sfx && this.sfx.levelUp) this.sfx.levelUp();
        if (this.cb.onApplyInstant) {
          this.cb.onApplyInstant({
            id: '_core_overclock',
            name: `核心超频 +${this.overclockStacks * 6}%`,
            rarity: 'epic',
            iconEmoji: '⚡'
          });
        }
      }
    }

    _openDraft() {
      const draftLevel = this._currentDraftLevel();
      const choices = this._rollChoices(new Set(), draftLevel);
      if (choices.length === 0) {
        this._grantMaxedPoolOverclock();
        return false;
      }
      this.draft = {
        version: `${this.draftSession}-${++this.draftSequence}`,
        level: draftLevel,
        rerollsLeft: 2,
        selectedIndex: 0,
        choices
      };
      if (this.sfx && this.sfx.levelUp) this.sfx.levelUp();
      this._renderDraftDom();
      if (this._dlg && !this._dlg.open) {
        try {
          this._dlg.showModal();
        } catch (e) {
          this._dlg.setAttribute('open', '');
        }
      }
      const firstCard = this._gridEl && this._gridEl.querySelector('.rg-card');
      if (firstCard && typeof firstCard.focus === 'function') {
        try { firstCard.focus({ preventScroll: true }); } catch (_) {}
      }
      if (this.cb.onDraftChange) this.cb.onDraftChange(this.getDraftState());
      return true;
    }

    _renderDraftDom() {
      if (!this._dlg || !this.draft) return;
      const { version } = this.draft;
      this._titleEl.textContent = `借风核心升级 · Lv.${this.draft.level}`;
      if (this._subEl) {
        this._subEl.textContent = '点击卡片 / 键盘 1 · 2 · 3 / 手柄或手机座舱同步选卡';
        this._subEl.classList.remove('nudge');
      }
      this._rerollBtn.disabled = this.draft.rerollsLeft <= 0;
      this._rerollBtn.textContent = `🎲 换一批 (剩余 ${this.draft.rerollsLeft} 次 · R)`;

      this._gridEl.innerHTML = '';
      this.draft.choices.forEach((c, idx) => {
        const meta = RARITY_META[c.rarity] || RARITY_META.common;
        const btn = document.createElement('button');
        btn.type = 'button';
        if (idx === 0) btn.autofocus = true;
        btn.className = 'rg-card' + (idx === this.draft.selectedIndex ? ' focused' : '');
        btn.style.setProperty('--rg-accent', meta.color);
        btn.style.setProperty('--rg-glow', meta.glow);
        btn.style.setProperty('--rg-bg', meta.bg);
        let starsText;
        if (c.maxStars === 1) {
          starsText = '★ 终极觉醒';
        } else if (c.prevStars > 0) {
          const before = '★'.repeat(c.prevStars) + '☆'.repeat(c.maxStars - c.prevStars);
          const after = '★'.repeat(c.stars) + '☆'.repeat(c.maxStars - c.stars);
          starsText = `${before} → ${after}`;
        } else {
          starsText = 'NEW ✨ ' + '★'.repeat(c.stars) + '☆'.repeat(c.maxStars - c.stars);
        }
        const synergyHtml = c.synergyHint
          ? `<div class="rg-card-synergy${c.epicReady ? ' epic-ready' : ''}">${c.synergyHint}</div>`
          : `<div class="rg-card-synergy"></div>`;
        btn.innerHTML = `
          <div class="rg-card-top">
            <div class="rg-icon-wrap">${makeSkillSvg(c.icon, meta.color)}</div>
            <div class="rg-badges">
              <span class="rg-tag">${meta.label} · ${c.category}</span>
              <span class="rg-stars">${starsText}</span>
            </div>
          </div>
          <div class="rg-card-head">
            <span class="rg-name">${c.name}</span>
            <span class="rg-keyhint">[${idx + 1}]</span>
          </div>
          <div class="rg-card-desc">${c.desc}</div>
          ${synergyHtml}
        `;
        btn.addEventListener('click', () => this.pickOfferedCard(version, c.id));
        btn.addEventListener('pointerenter', () => {
          if (this.draft?.version === version) {
            this.draft.selectedIndex = idx;
            this._updateFocusVisual();
          }
        });
        this._gridEl.appendChild(btn);
      });

      this._ownedEl.innerHTML = '';
      const summary = this.getSummary();
      const owned = summary.pickedSkills;
      if (owned.length === 0) {
        const span = document.createElement('span');
        span.style.cssText = 'font-size:11.5px;color:#64748b';
        span.textContent = '首次进化：从三大流派中选择你的第一项核心战技';
        this._ownedEl.appendChild(span);
      } else {
        const awkChip = document.createElement('span');
        awkChip.className = 'rg-owned-chip' + (summary.evoTier > 0 ? ' epic' : '');
        const nextUnlock = this._nextAwakeningUnlockLevel();
        awkChip.textContent = summary.evoTier >= MAX_AWAKENINGS
          ? `👑 觉醒满阶 ${summary.evoTier}/${MAX_AWAKENINGS}`
          : `🌟 觉醒槽 ${summary.evoTier}/${MAX_AWAKENINGS}${this.draft.level < nextUnlock ? ` (Lv.${nextUnlock}开启)` : ''}`;
        this._ownedEl.appendChild(awkChip);

        owned.slice(0, 7).forEach((sk) => {
          const chip = document.createElement('span');
          chip.className = 'rg-owned-chip' + (sk.rarity === 'epic' ? ' epic' : '');
          chip.textContent = `${sk.iconEmoji} ${sk.name} ${'★'.repeat(sk.stars)}`;
          this._ownedEl.appendChild(chip);
        });
      }
    }

    _updateFocusVisual() {
      if (!this._gridEl || !this.draft) return;
      const cards = this._gridEl.querySelectorAll('.rg-card');
      cards.forEach((el, i) => {
        el.classList.toggle('focused', i === this.draft.selectedIndex);
      });
    }

    isDraftOpen() {
      return Boolean(this.draft);
    }

    moveFocus(delta) {
      if (!this.draft || !this.draft.choices.length) return;
      const n = this.draft.choices.length;
      this.draft.selectedIndex = ((this.draft.selectedIndex + delta) % n + n) % n;
      this._updateFocusVisual();
    }

    confirmFocus() {
      if (!this.draft) return;
      this.pickCard(this.draft.selectedIndex || 0);
    }

    reroll(version = this.draft?.version) {
      if (!this.draft || this.draft.version !== version || this.draft.rerollsLeft <= 0) return false;
      const prevIds = new Set(this.draft.choices.map((c) => c.id));
      const next = this._rollChoices(prevIds, this.draft.level);
      if (next.length === 0) return false;
      this.draft.version = `${this.draftSession}-${++this.draftSequence}`;
      this.draft.rerollsLeft -= 1;
      this.draft.choices = next;
      this.draft.selectedIndex = 0;
      if (this.sfx && this.sfx.skillReroll) this.sfx.skillReroll();
      this._renderDraftDom();
      if (this.cb.onDraftChange) this.cb.onDraftChange(this.getDraftState());
      return true;
    }

    pickCard(index) {
      const choice = this.draft?.choices[index];
      return choice ? this.pickOfferedCard(this.draft.version, choice.id) : false;
    }

    pickOfferedCard(version, cardId) {
      if (!this.draft || this.draft.version !== version) return false;
      const choice = this.draft.choices.find((card) => card.id === cardId);
      if (!choice) return false;

      if (!this.skills[choice.id]) this.pickOrder.push(choice.id);
      this.skills[choice.id] = choice.stars;

      if (choice.id === 'orbit_orbs') {
        while (this.orbs.length < choice.stars) {
          this.orbs.push({ angle: (this.orbs.length / choice.stars) * Math.PI * 2, cooldown: 0, tickTimer: 0 });
        }
        this.orbs.forEach((o, i) => { o.angle = (i / this.orbs.length) * Math.PI * 2; });
      }

      if (this.sfx && this.sfx.skillPick) this.sfx.skillPick(choice.rarity);
      if (this.cb.onApplyInstant) this.cb.onApplyInstant(choice);

      this.pendingLevelUps = Math.max(0, this.pendingLevelUps - 1);
      this.closeDraft(true);

      if (this.pendingLevelUps > 0 && this._openDraft()) return true;
      if (this.cb.onDraftChange) this.cb.onDraftChange(null);
      return true;
    }

    closeDraft(silent = false) {
      this.draft = null;
      if (this._dlg && this._dlg.open) {
        try { this._dlg.close(); } catch (e) { this._dlg.removeAttribute('open'); }
      }
      if (!silent && this.cb.onDraftChange) this.cb.onDraftChange(null);
    }

    getDraftState() {
      if (!this.draft) return null;
      return {
        version: this.draft.version,
        level: this.draft.level,
        rerollsLeft: this.draft.rerollsLeft,
        selectedIndex: this.draft.selectedIndex,
        choices: this.draft.choices.map((c) => ({
          id: c.id,
          name: c.name,
          category: c.category,
          rarity: c.rarity,
          prevStars: c.prevStars || 0,
          stars: c.stars,
          maxStars: c.maxStars,
          isNew: c.isNew,
          desc: c.desc,
          synergyHint: c.synergyHint || '',
          epicReady: Boolean(c.epicReady),
          iconEmoji: c.iconEmoji
        }))
      };
    }

    getSummary() {
      const rarityRank = { epic: 3, rare: 2, common: 1 };
      const pickedSkills = this.pickOrder
        .map((id, orderIdx) => {
          const def = SKILL_MAP[id];
          return {
            id,
            name: def ? def.name : id,
            iconEmoji: def ? def.iconEmoji : '⚡',
            stars: this.skills[id] || 1,
            rarity: def ? def.rarity : 'common',
            _order: orderIdx
          };
        })
        .sort((a, b) => {
          const aEpic = a.rarity === 'epic' ? 1 : 0;
          const bEpic = b.rarity === 'epic' ? 1 : 0;
          if (bEpic !== aEpic) return bEpic - aEpic;
          if (b.stars !== a.stars) return b.stars - a.stars;
          const rDiff = (rarityRank[b.rarity] || 0) - (rarityRank[a.rarity] || 0);
          if (rDiff !== 0) return rDiff;
          return a._order - b._order;
        })
        .map(({ _order, ...rest }) => rest);
      return {
        level: this.level,
        xp: Math.round(this.xp),
        xpNext: this.xpNext,
        xpRatio: clamp(this.xp / Math.max(1, this.xpNext), 0, 1),
        evoTier: this._evoTier(),
        overclockStacks: this.overclockStacks,
        pickedSkills
      };
    }

    shiftWorldEntities(dx, dy) {
      for (const g of this.gems) { g.x += dx; g.y += dy; }
      for (const m of this.missiles) {
        m.x += dx;
        m.y += dy;
        for (const pt of m.trail) { pt.x += dx; pt.y += dy; }
      }
      for (const wb of this.windBlades) { wb.x += dx; wb.y += dy; }
      for (const a of this.aftershocks) { a.x += dx; a.yStart += dy; a.yTop += dy; }
      for (const arc of this.arcs) { arc.x1 += dx; arc.y1 += dy; arc.x2 += dx; arc.y2 += dy; }
      for (const nv of this.novas) { nv.x += dx; nv.y += dy; }
    }

    // ---- Active Skill Triggers ----

    notifyGust(px, py, power = 1, worldVyOffset = 0) {
      const lv = this.skills.wind_blades || 0;
      const tempest = Boolean(this.skills.awakening_tempest);
      if (lv > 0 || tempest) {
        const count = tempest ? (5 + Math.floor(lv / 2)) : GUST_BLADE_COUNT[lv];
        // Tempest stacks additively on top of wind_blades stars (never downgrades 3★ blade damage!)
        const baseDmg = tempest ? (88 + lv * 14) : GUST_BLADE_DMG[lv];
        const scale = this.powerScale * (0.85 + 0.25 * clamp(power, 0.4, 1));
        this._spawnWindBlades(px, py - 18, count, baseDmg * scale, tempest, worldVyOffset);
      }
      // Gust whips all XP gems toward player
      for (const g of this.gems) {
        g.gustPulled = true;
      }
    }

    _spawnWindBlades(x, y, count, dmg, giant = false, worldVyOffset = 0) {
      if (this.sfx && this.sfx.windBlade) this.sfx.windBlade();
      const spread = count > 1 ? 0.22 : 0;
      for (let i = 0; i < count; i++) {
        const offset = count === 1 ? 0 : (i / (count - 1) - 0.5) * 2;
        const angle = -Math.PI / 2 + offset * spread;
        const speed = giant ? 620 : 540;
        this.windBlades.push({
          x: x + offset * 24,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed + worldVyOffset,
          dmg,
          radius: giant ? 34 : 22,
          giant,
          life: 1.5,
          hitIds: new Set()
        });
      }
    }

    notifyRailgun(x, y, width, power = 1, enemies = [], reachLen = 960) {
      const lv = this.skills.rail_aftershock || 0;
      if (lv > 0) {
        const dur = AFTERSHOCK_DUR[lv];
        this.aftershocks.push({
          x,
          yStart: y,
          yTop: y - Math.max(480, reachLen),
          halfW: Math.max(22, width * 0.65),
          dmgPerSec: AFTERSHOCK_DPS[lv] * Math.max(0.8, power) * this.powerScale,
          life: dur,
          maxLife: dur,
          tickTimer: 0
        });
      }
      if (this.skills.awakening_rail && Array.isArray(enemies) && this.cb.onDealDamage) {
        const shockDmg = 105 * power * this.powerScale;
        for (const e of enemies) {
          if (e.hp > 0) {
            this.cb.onDealDamage(e, shockDmg, { source: 'awakening_rail', stun: true });
            this.arcs.push({ x1: x, y1: y - 160, x2: e.x, y2: e.y, life: 0.26, maxLife: 0.26, gold: true });
          }
        }
      }
    }

    _emitPulseNova(px, py, maxR, dmg, color, enemies = [], enemyBullets = []) {
      this.novas.push({ x: px, y: py, r: 16, maxR, life: 0.36, maxLife: 0.36, color });
      const rSq = maxR * maxR;
      for (let i = enemyBullets.length - 1; i >= 0; i--) {
        const b = enemyBullets[i];
        if (distSq(px, py, b.x, b.y) <= rSq) {
          enemyBullets.splice(i, 1);
        }
      }
      if (this.cb.onDealDamage) {
        for (let i = enemies.length - 1; i >= 0; i--) {
          const e = enemies[i];
          if (e && e.hp > 0 && distSq(px, py, e.x, e.y) <= (maxR + (e.radius || 20)) ** 2) {
            this.cb.onDealDamage(e, dmg, { source: 'roll_nova' });
          }
        }
      }
    }

    notifyBarrelRoll(px, py, enemies = [], enemyBullets = []) {
      const lv = this.skills.tactical_arsenal || 0;
      const hasAegis = Boolean(this.skills.awakening_aegis);
      if (lv <= 0 && !hasAegis) return;
      const maxR = Math.max(lv > 0 ? NOVA_RADIUS[lv] : 0, hasAegis ? 215 : 0);
      const baseDmg = (lv > 0 ? NOVA_DAMAGE[lv] : 0) + (hasAegis ? 92 : 0);
      const color = hasAegis ? 'rgba(103, 232, 249, ' : 'rgba(251, 146, 60, ';
      this._emitPulseNova(px, py, maxR, baseDmg * this.powerScale, color, enemies, enemyBullets);
    }

    notifyShieldBreak(px, py, enemies = [], enemyBullets = []) {
      if (!this.skills.awakening_aegis) return;
      this._emitPulseNova(px, py, 260, 145 * this.powerScale, 'rgba(253, 224, 71, ', enemies, enemyBullets);
    }

    _castChainLightning(targetEnemy, enemies = [], baseDmg = 20, forceBypassIcd = false) {
      const lv = this.skills.tesla_chain || 0;
      const hasHive = Boolean(this.skills.awakening_hive);
      const effLv = Math.max(lv, hasHive ? 1 : 0);
      if (effLv <= 0 || !targetEnemy || !this.cb.onDealDamage) return false;
      if (!forceBypassIcd && this.lightningIcdTimer > 0) return false;
      this.lightningIcdTimer = TESLA_ICD;

      const jumps = TESLA_JUMPS[effLv] + (hasHive && lv > 0 ? 1 : 0);
      let curr = targetEnemy;
      const visited = new Set([curr]);
      const chainDmg = Math.max(16 * this.powerScale, baseDmg * TESLA_DMG_RATIO[effLv]);
      if (this.sfx && this.sfx.chainLightning) this.sfx.chainLightning();

      let actualJumps = 0;
      for (let k = 0; k < jumps; k++) {
        let nearest = null;
        let bestD = 260 * 260;
        for (const e of enemies) {
          if (!e || e.hp <= 0 || visited.has(e)) continue;
          const d = distSq(curr.x, curr.y, e.x, e.y);
          if (d < bestD) { bestD = d; nearest = e; }
        }
        if (!nearest) break;
        visited.add(nearest);
        actualJumps += 1;
        this.arcs.push({ x1: curr.x, y1: curr.y, x2: nearest.x, y2: nearest.y, life: 0.22, maxLife: 0.22, gold: hasHive });
        this.cb.onDealDamage(nearest, chainDmg, { source: 'lightning' });
        curr = nearest;
      }

      // Single-target / Boss focus: unused jumps condense into a focused arc strike on the primary target
      const unused = jumps - actualJumps;
      if (unused > 0 && targetEnemy.hp > 0 && !targetEnemy.dead) {
        const focusDmg = chainDmg * Math.min(0.85, unused * 0.22);
        this.arcs.push({
          x1: targetEnemy.x + (Math.random() - 0.5) * 44,
          y1: targetEnemy.y - 46,
          x2: targetEnemy.x,
          y2: targetEnemy.y,
          life: 0.18,
          maxLife: 0.18,
          gold: hasHive
        });
        this.cb.onDealDamage(targetEnemy, focusDmg, { source: 'lightning_focus', quiet: true });
      }
      return true;
    }

    notifyCritOrDroneHit(targetEnemy, enemies = [], baseDmg = 20) {
      this._castChainLightning(targetEnemy, enemies, baseDmg, false);
    }

    notifyDroneVolley(px, py, enemies = [], baseDmg = 20) {
      if (!this.skills.awakening_hive || !Array.isArray(enemies) || enemies.length === 0) return;
      let nearest = null;
      let bestD = 720 * 720;
      for (const e of enemies) {
        if (!e || e.hp <= 0 || e.y > py + 50) continue;
        const d = distSq(px, py, e.x, e.y) - (e.marked > 0 ? 1e6 : 0);
        if (d < bestD) { bestD = d; nearest = e; }
      }
      if (nearest) {
        this.arcs.push({ x1: px, y1: py - 18, x2: nearest.x, y2: nearest.y, life: 0.2, maxLife: 0.2, gold: true });
        this._castChainLightning(nearest, enemies, baseDmg * 1.15, true);
      }
    }

    notifyMainShot(px, py, baseDmg = 20, worldVyOffset = 0, enemies = []) {
      // Guaranteed 5th-volley lightning discharge when owning tesla_chain (prevents 0-trigger dead card!)
      if ((this.skills.tesla_chain || 0) > 0 && Array.isArray(enemies) && enemies.length > 0) {
        this.teslaShotCounter += 1;
        if (this.teslaShotCounter >= 5) {
          this.teslaShotCounter = 0;
          let frontTarget = null;
          let bestScore = Infinity;
          for (const e of enemies) {
            if (!e || e.hp <= 0 || e.y > py + 20) continue;
            const score = Math.abs(e.x - px) * 1.6 + Math.abs(py - e.y) * 0.45;
            if (score < bestScore && score < 560) { bestScore = score; frontTarget = e; }
          }
          if (frontTarget) {
            this.arcs.push({ x1: px, y1: py, x2: frontTarget.x, y2: frontTarget.y, life: 0.2, maxLife: 0.2 });
            this._castChainLightning(frontTarget, enemies, baseDmg * 1.25, false);
          }
        }
      }

      if (!this.skills.awakening_barrage) return;
      this.mainShotCounter += 1;
      if (this.mainShotCounter < 5) return;
      this.mainShotCounter = 0;
      const dmg = Math.max(26 * this.powerScale, baseDmg * 1.4);
      for (let i = 0; i < 8; i++) {
        const offset = (i / 7 - 0.5) * 2;
        const angle = -Math.PI / 2 + offset * 0.72;
        const speed = 380;
        this.missiles.push({
          x: px + offset * 26,
          y: py - 10,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed + worldVyOffset,
          dmg,
          life: 2.4,
          sword: true,
          trail: []
        });
      }
    }

    // ---- Main Simulation Step ----

    step(dt, ctxState = {}) {
      this.time += dt;
      if (this.levelFlash > 0) this.levelFlash = Math.max(0, this.levelFlash - dt);
      if (this.lightningIcdTimer > 0) this.lightningIcdTimer = Math.max(0, this.lightningIcdTimer - dt);
      if (this.xpChainTimer > 0) {
        this.xpChainTimer -= dt;
        if (this.xpChainTimer <= 0) this.xpChain = 0;
      }

      const {
        playerX = 0, playerY = 0,
        startX = playerX, startY = playerY,
        W = 800, H = 600,
        worldVyOffset = 0,
        pickupSurgeVy = 0,
        surgeRatio = 0,
        collectRadius = 30,
        magnetBonus = 0,
        starMagnet = false,
        powerScale = 1,
        droneCount = 0,
        shieldCount = 0,
        breath = 0, gustActive = false, tutorial = false,
        isPaused = false, phase = 'playing',
        enemies = [], enemyBullets = []
      } = ctxState;

      this.powerScale = Math.max(0.5, Number.isFinite(powerScale) ? powerScale : 1);
      this.droneCountHint = droneCount;
      this.activeShieldsHint = shieldCount;

      if (phase !== 'playing') return;

      // Trigger pending level-up draft only when tutorial isn't blocking and not already paused
      if (!tutorial && !isPaused && !this.draft && this.pendingLevelUps > 0) {
        this._openDraft();
        return;
      }

      if (isPaused) return;

      const mods = this.getModifiers();

      // 1. XP Gems physics & magnetic pull
      // Keep g.vx / g.vy strictly in camera-relative local space and add worldVyOffset + surge on integration.
      const baseMagnet = (105 + magnetBonus) * mods.pickupRadiusMult;
      const blowing = breath > 0.14 || gustActive;
      const collectR2 = collectRadius * collectRadius;
      for (let i = this.gems.length - 1; i >= 0; i--) {
        const g = this.gems[i];
        const fresh = g.age === 0;
        g.age += dt;
        const dx = playerX - g.x;
        const dy = playerY - g.y;
        const d2 = dx * dx + dy * dy;
        const headOn = clamp(dy / 48, 0, 1);
        const surgeMag = baseMagnet * (1 + 0.18 * surgeRatio * headOn);
        const magnetR = (blowing || g.gustPulled)
          ? Math.max(W, H) * 1.4
          : Math.max(surgeMag, starMagnet ? 420 + magnetBonus : 0);

        const refX = fresh ? playerX : startX;
        const refY = fresh ? playerY : startY;
        const fromX = g.x - refX;
        const fromY = g.y - refY;

        if (d2 < magnetR * magnetR || g.magnet) {
          g.magnet = true;
          const d = Math.max(1, Math.sqrt(d2));
          const pull = (blowing || g.gustPulled ? 820 : 540) + g.age * 180;
          g.vx = lerp(g.vx, (dx / d) * pull, Math.min(1, dt * 12));
          g.vy = lerp(g.vy, (dy / d) * pull, Math.min(1, dt * 12));
          g.x += g.vx * dt;
          g.y += (g.vy + worldVyOffset + pickupSurgeVy * headOn) * dt;
        } else {
          g.vx *= Math.pow(0.08, dt);
          g.vy = lerp(g.vy, 76, Math.min(1, dt * 2.5));
          g.x += g.vx * dt;
          g.y += (g.vy + worldVyOffset + pickupSurgeVy) * dt;
        }

        const toX = g.x - playerX;
        const toY = g.y - playerY;
        const pathX = toX - fromX;
        const pathY = toY - fromY;
        const path2 = pathX * pathX + pathY * pathY;
        const t = path2 ? clamp(-(fromX * pathX + fromY * pathY) / path2, 0, 1) : 1;
        const minX = fromX + pathX * t;
        const minY = fromY + pathY * t;

        if (minX * minX + minY * minY <= collectR2) {
          this.addRawXp(g.amount);
          this.xpChain = Math.min(12, this.xpChain + 1);
          this.xpChainTimer = 0.7;
          if (this.sfx && this.sfx.xpPickup) this.sfx.xpPickup(this.xpChain);
          this.gems.splice(i, 1);
          continue;
        }
        if (g.y > playerY + H + 90 || g.age > 24) {
          this.gems.splice(i, 1);
        }
      }

      // 2. Homing Micro-Missiles
      const missileLv = this.skills.homing_pod || 0;
      if (missileLv > 0 && enemies.length > 0) {
        this.missileTimer -= dt;
        if (this.missileTimer <= 0) {
          this.missileTimer = MISSILE_INTERVAL[missileLv] / mods.fireRateMult;
          const cnt = missileLv + 1;
          if (this.sfx && this.sfx.missileLaunch) this.sfx.missileLaunch();
          for (let k = 0; k < cnt; k++) {
            const spread = cnt > 1 ? (k / (cnt - 1) - 0.5) * 1.1 : 0;
            this.missiles.push({
              x: playerX + spread * 24,
              y: playerY - 12,
              vx: Math.sin(spread) * 190,
              vy: -340 + worldVyOffset,
              dmg: MISSILE_DAMAGE[missileLv] * this.powerScale * (this.skills.awakening_barrage ? 1.2 : 1),
              life: 3.0,
              sword: false,
              trail: []
            });
          }
        }
      }

      for (let i = this.missiles.length - 1; i >= 0; i--) {
        const m = this.missiles[i];
        m.life -= dt;
        let target = null;
        let bestD = Infinity;
        for (const e of enemies) {
          if (!e || e.hp <= 0) continue;
          const d = distSq(m.x, m.y, e.x, e.y);
          if (d < bestD) { bestD = d; target = e; }
        }
        if (target) {
          const relVx = m.vx;
          const relVy = m.vy - worldVyOffset;
          const ang = Math.atan2(target.y - m.y, target.x - m.x);
          const curAng = Math.atan2(relVy, relVx);
          let diff = ang - curAng;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          const turn = (m.sword ? 8.2 : 5.8) * dt;
          const nextAng = curAng + clamp(diff, -turn, turn);
          const spd = m.sword ? 590 : 490;
          m.vx = Math.cos(nextAng) * spd;
          m.vy = Math.sin(nextAng) * spd + worldVyOffset;
        }
        m.x += m.vx * dt;
        m.y += m.vy * dt;
        m.trail.push({ x: m.x, y: m.y });
        if (m.trail.length > 7) m.trail.shift();

        let hit = false;
        for (const e of enemies) {
          if (!e || e.hp <= 0) continue;
          const hr = (e.radius || 20) + 10;
          if (distSq(m.x, m.y, e.x, e.y) <= hr * hr) {
            if (this.cb.onDealDamage) this.cb.onDealDamage(e, m.dmg, { source: m.sword ? 'sword' : 'missile' });
            hit = true;
            break;
          }
        }
        if (hit || m.life <= 0 || Math.abs(m.x - playerX) > W * 1.15 || Math.abs(m.y - playerY) > H * 1.3) {
          this.missiles.splice(i, 1);
        }
      }

      // 3. Sustained Breath Wind Blades & Tempest Aura
      const bladeLv = this.skills.wind_blades || 0;
      const hasTempest = Boolean(this.skills.awakening_tempest);
      if (blowing && (bladeLv > 0 || hasTempest)) {
        this.breathBladeTimer -= dt;
        if (this.breathBladeTimer <= 0) {
          this.breathBladeTimer = hasTempest ? 0.62 : 1.1;
          const cnt = hasTempest ? (3 + (bladeLv >= 3 ? 1 : 0)) : BREATH_BLADE_COUNT[bladeLv];
          const baseDmg = hasTempest ? (62 + bladeLv * 10) : BREATH_BLADE_DMG[bladeLv];
          this._spawnWindBlades(playerX, playerY - 18, cnt, baseDmg * this.powerScale, hasTempest, worldVyOffset);
        }
      }
      if (blowing && hasTempest) {
        const auraR = 145;
        for (let i = enemyBullets.length - 1; i >= 0; i--) {
          const b = enemyBullets[i];
          if (b.reflected) continue;
          const dx = b.x - playerX;
          const dy = b.y - playerY;
          const d2 = dx * dx + dy * dy;
          if (d2 < auraR * auraR && d2 > 1) {
            const d = Math.sqrt(d2);
            b.vx += (dx / d) * 440 * dt;
            b.vy += (dy / d) * 440 * dt - 200 * dt;
          }
        }
      }

      for (let i = this.windBlades.length - 1; i >= 0; i--) {
        const wb = this.windBlades[i];
        wb.life -= dt;
        wb.x += wb.vx * dt;
        wb.y += wb.vy * dt;
        for (const e of enemies) {
          if (!e || e.hp <= 0 || wb.hitIds.has(e)) continue;
          const hr = (e.radius || 20) + wb.radius;
          if (distSq(wb.x, wb.y, e.x, e.y) <= hr * hr) {
            wb.hitIds.add(e);
            if (this.cb.onDealDamage) this.cb.onDealDamage(e, wb.dmg, { source: 'wind_blade' });
          }
        }
        if (wb.life <= 0 || Math.abs(wb.y - playerY) > H * 1.25 || Math.abs(wb.x - playerX) > W * 1.1) {
          this.windBlades.splice(i, 1);
        }
      }

      // 4. Orbiting Plasma Orbs (0.15s pulsed contact damage + ordinary bullet cancellation)
      const orbLv = this.skills.orbit_orbs || 0;
      if (this.orbs.length > 0 && orbLv > 0) {
        const orbitR = 54;
        const orbDps = ORB_DPS[orbLv] * this.powerScale * (this.skills.awakening_hive ? 1.35 : 1);
        const blockCd = ORB_BLOCK_CD[orbLv];
        for (const o of this.orbs) {
          o.angle += 3.1 * dt;
          if (o.cooldown > 0) {
            o.cooldown = Math.max(0, o.cooldown - dt);
            continue;
          }
          const ox = playerX + Math.cos(o.angle) * orbitR;
          const oy = playerY + Math.sin(o.angle) * orbitR;
          for (let bi = enemyBullets.length - 1; bi >= 0; bi--) {
            const b = enemyBullets[bi];
            if (b.reflected) continue;
            if (distSq(ox, oy, b.x, b.y) <= 17 * 17) {
              enemyBullets.splice(bi, 1);
              o.cooldown = blockCd;
              break;
            }
          }
          if (o.cooldown <= 0 && this.cb.onDealDamage) {
            o.tickTimer = (o.tickTimer || 0) - dt;
            if (o.tickTimer <= 0) {
              let hitAny = false;
              for (const e of enemies) {
                if (!e || e.hp <= 0) continue;
                const hr = (e.radius || 18) + 13;
                if (distSq(ox, oy, e.x, e.y) <= hr * hr) {
                  this.cb.onDealDamage(e, orbDps * 0.15, { source: 'orbit_orb', quiet: true });
                  hitAny = true;
                }
              }
              o.tickTimer = hitAny ? 0.15 : 0.04;
            }
          }
        }
      }

      // 5. Railgun Aftershock Zones
      for (let i = this.aftershocks.length - 1; i >= 0; i--) {
        const a = this.aftershocks[i];
        a.life -= dt;
        a.yStart += worldVyOffset * dt;
        a.yTop += worldVyOffset * dt;
        a.tickTimer -= dt;
        if (a.tickTimer <= 0 && this.cb.onDealDamage) {
          a.tickTimer = 0.2;
          const tickDmg = a.dmgPerSec * 0.2;
          for (const e of enemies) {
            if (!e || e.hp <= 0) continue;
            if (e.y <= a.yStart && e.y >= a.yTop && Math.abs(e.x - a.x) <= a.halfW + (e.radius || 20)) {
              this.cb.onDealDamage(e, tickDmg, { source: 'aftershock' });
            }
          }
        }
        if (a.life <= 0) this.aftershocks.splice(i, 1);
      }

      // 6. Visual Arcs & Novas
      for (let i = this.arcs.length - 1; i >= 0; i--) {
        this.arcs[i].life -= dt;
        if (this.arcs[i].life <= 0) this.arcs.splice(i, 1);
      }
      for (let i = this.novas.length - 1; i >= 0; i--) {
        const nv = this.novas[i];
        nv.life -= dt;
        const p = 1 - nv.life / nv.maxLife;
        nv.r = lerp(16, nv.maxR, p);
        if (nv.life <= 0) this.novas.splice(i, 1);
      }

      // 7. Auto Shield Regeneration
      if (mods.autoShieldInterval > 0) {
        this.autoShieldTimer += dt;
        if (this.autoShieldTimer >= mods.autoShieldInterval) {
          this.autoShieldTimer = 0;
          if (this.cb.onApplyInstant) this.cb.onApplyInstant({ id: '_auto_shield' });
        }
      }

      this._lastPlayerX = playerX;
      this._lastPlayerY = playerY;
    }

    // ---- Canvas Rendering ----

    renderWorld(ctx, time, playerX, playerY) {
      ctx.save();

      // 1. Railgun Aftershock Ionized Strips
      for (const a of this.aftershocks) {
        const alpha = clamp(a.life / a.maxLife, 0, 1);
        const yTop = a.yTop !== undefined ? a.yTop : 0;
        const len = Math.max(20, a.yStart - yTop);
        const g = ctx.createLinearGradient(a.x - a.halfW, 0, a.x + a.halfW, 0);
        g.addColorStop(0, 'rgba(56, 189, 248, 0)');
        g.addColorStop(0.5, `rgba(103, 232, 249, ${(0.38 * alpha).toFixed(3)})`);
        g.addColorStop(1, 'rgba(56, 189, 248, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(a.x - a.halfW, yTop, a.halfW * 2, len);

        ctx.strokeStyle = `rgba(224, 242, 254, ${(0.75 * alpha).toFixed(3)})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        const segs = 12;
        for (let s = 0; s <= segs; s++) {
          const sy = yTop + (s / segs) * len;
          const sx = a.x + Math.sin(time * 28 + s * 1.9) * (a.halfW * 0.45);
          if (s === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
        }
        ctx.stroke();
      }

      // 2. Roll & Aegis Novas
      for (const nv of this.novas) {
        const alpha = clamp(nv.life / nv.maxLife, 0, 1);
        const prefix = nv.color || 'rgba(251, 146, 60, ';
        ctx.strokeStyle = `${prefix}${(0.85 * alpha).toFixed(3)})`;
        ctx.lineWidth = 4 * alpha + 1;
        ctx.beginPath();
        ctx.arc(nv.x, nv.y, nv.r, 0, Math.PI * 2);
        ctx.stroke();
      }

      // 3. XP Gems (Faceted Glowing Diamonds)
      const tierColors = [
        ['#e0f2fe', '#38bdf8', '#0284c7'],
        ['#f3e8ff', '#c084fc', '#7e22ce'],
        ['#fef9c3', '#facc15', '#ca8a04']
      ];
      for (const g of this.gems) {
        const [hi, mid, rim] = tierColors[g.tier] || tierColors[0];
        const r = g.tier === 2 ? 7.5 : (g.tier === 1 ? 6.2 : 5);
        const spin = Math.sin(time * 6 + g.phase) * 0.35 + 1;
        ctx.save();
        ctx.translate(g.x, g.y);
        ctx.scale(spin, 1);
        ctx.fillStyle = mid;
        ctx.strokeStyle = rim;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(0, -r * 1.3);
        ctx.lineTo(r, 0);
        ctx.lineTo(0, r * 1.3);
        ctx.lineTo(-r, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = hi;
        ctx.beginPath();
        ctx.moveTo(0, -r * 0.9);
        ctx.lineTo(r * 0.45, -r * 0.1);
        ctx.lineTo(0, r * 0.3);
        ctx.lineTo(-r * 0.45, -r * 0.1);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      // 4. Wind Blades
      for (const wb of this.windBlades) {
        ctx.save();
        ctx.translate(wb.x, wb.y);
        ctx.rotate(Math.atan2(wb.vy, wb.vx) + Math.PI / 2);
        const w = wb.radius;
        ctx.fillStyle = wb.giant ? 'rgba(253, 224, 71, 0.35)' : 'rgba(103, 232, 249, 0.35)';
        ctx.strokeStyle = wb.giant ? '#fef08a' : '#a5f3fc';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(-w, 6);
        ctx.quadraticCurveTo(0, -w * 0.85, w, 6);
        ctx.quadraticCurveTo(0, -w * 0.25, -w, 6);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      // 5. Homing Missiles & Golden Swords
      for (const m of this.missiles) {
        if (m.trail.length > 1) {
          ctx.strokeStyle = m.sword ? 'rgba(253, 224, 71, 0.55)' : 'rgba(226, 232, 240, 0.5)';
          ctx.lineWidth = m.sword ? 2.6 : 2;
          ctx.beginPath();
          m.trail.forEach((pt, idx) => {
            if (idx === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y);
          });
          ctx.stroke();
        }
        ctx.save();
        ctx.translate(m.x, m.y);
        ctx.rotate(Math.atan2(m.vy, m.vx) + Math.PI / 2);
        if (m.sword) {
          ctx.fillStyle = '#fde047';
          ctx.strokeStyle = '#fffbeb';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(0, -13);
          ctx.lineTo(4, 3);
          ctx.lineTo(0, 9);
          ctx.lineTo(-4, 3);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        } else {
          ctx.fillStyle = '#f8fafc';
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(0, -8);
          ctx.lineTo(3.5, 5);
          ctx.lineTo(-3.5, 5);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
        ctx.restore();
      }

      // 6. Chain Lightning Arcs
      for (const arc of this.arcs) {
        const a = clamp(arc.life / arc.maxLife, 0, 1);
        ctx.strokeStyle = arc.gold
          ? `rgba(253, 224, 71, ${a.toFixed(2)})`
          : `rgba(165, 243, 252, ${a.toFixed(2)})`;
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.moveTo(arc.x1, arc.y1);
        const steps = 5;
        for (let k = 1; k < steps; k++) {
          const t = k / steps;
          const jx = lerp(arc.x1, arc.x2, t) + (Math.random() - 0.5) * 20;
          const jy = lerp(arc.y1, arc.y2, t) + (Math.random() - 0.5) * 20;
          ctx.lineTo(jx, jy);
        }
        ctx.lineTo(arc.x2, arc.y2);
        ctx.stroke();
      }

      // 7. Orbiting Plasma Orbs around Player
      if (this.orbs.length > 0 && typeof playerX === 'number' && typeof playerY === 'number') {
        const orbitR = 54;
        const hiveBoost = Boolean(this.skills.awakening_hive);
        for (const o of this.orbs) {
          const ox = playerX + Math.cos(o.angle) * orbitR;
          const oy = playerY + Math.sin(o.angle) * orbitR;
          ctx.save();
          ctx.globalAlpha = o.cooldown > 0 ? 0.28 : 0.95;
          const g = ctx.createRadialGradient(ox, oy, 1, ox, oy, hiveBoost ? 14 : 12);
          g.addColorStop(0, '#ffffff');
          g.addColorStop(0.45, hiveBoost ? '#fde047' : '#38bdf8');
          g.addColorStop(1, 'rgba(56, 189, 248, 0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(ox, oy, hiveBoost ? 14 : 12, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }

      ctx.restore();
    }

    renderHudBar(ctx, W, H, hudTop = 12, alpha = 1, panelWidth = 0) {
      const x0 = panelWidth ? 20 : Math.max(20, (W - Math.min(260, Math.max(150, W - 260))) * 0.5);
      const totalW = panelWidth ? Math.max(130, panelWidth - 6) : Math.min(260, Math.max(150, W - 260));
      const labelW = 34;
      const barX = x0 + labelW;
      const barW = Math.max(48, totalW - labelW);
      const y = panelWidth ? hudTop : Math.max(8, hudTop - 2);
      const ratio = clamp(this.xp / Math.max(1, this.xpNext), 0, 1);

      ctx.save();
      ctx.globalAlpha = clamp(alpha, 0.25, 1);
      ctx.shadowColor = 'rgba(5, 18, 24, 0.78)';
      ctx.shadowBlur = 4;

      ctx.font = '700 10px "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = this.levelFlash > 0 ? '#faf3e1' : '#ffbe69';
      ctx.fillText(`LV.${this.level}`, x0, y + 7);

      // Sleek frameless aviation XP gauge track
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(7, 25, 31, 0.62)';
      ctx.fillRect(barX, y + 5, barW, 4);
      ctx.strokeStyle = 'rgba(250, 243, 225, 0.22)';
      ctx.lineWidth = 0.75;
      ctx.strokeRect(barX - 0.5, y + 4.5, barW + 1, 5);

      if (ratio > 0.008) {
        const fillW = Math.max(3, barW * ratio);
        const g = ctx.createLinearGradient(barX, 0, barX + barW, 0);
        g.addColorStop(0, '#93ded0');
        g.addColorStop(0.65, '#ffbe69');
        g.addColorStop(1, '#faf3e1');
        ctx.fillStyle = g;
        ctx.fillRect(barX, y + 5, fillW, 4);
      }

      ctx.restore();
    }
  }

  SkyRoguelite.SKILL_POOL = SKILL_POOL;
  SkyRoguelite.xpRequiredFor = xpRequiredFor;
  global.SkyRoguelite = SkyRoguelite;
})(typeof window !== 'undefined' ? window : globalThis);
