/**
 * Tabletop Sky Striker - Roguelite XP Gems & 3-Pick-1 Skill Card Evolution System
 * Provides XP gem physics/magnetism, 21-card synergy pool (including 3 Epic Awakenings),
 * active skill projectiles (homing missiles, wind blades, orbiting plasma orbs,
 * chain lightning, railgun aftershock, roll nova, golden sword barrage),
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
      awakening: `<path d="M12 2L14.8 8.2L21.5 9L16.4 13.5L17.9 20.2L12 16.8L6.1 20.2L7.6 13.5L2.5 9L9.2 8.2L12 2Z" fill="${accent}" fill-opacity="0.38" stroke="${accent}" stroke-width="2" stroke-linejoin="round"/>`
    };
    const body = icons[iconType] || icons.crit;
    return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">${body}</svg>`;
  }

  const SKILL_POOL = [
    // 1. 弹道系
    {
      id: 'split_prism', name: '分裂棱镜', category: '弹道', rarity: 'common', maxStars: 3, icon: 'split', iconEmoji: '💠',
      desc: (lv) => `主炮额外向两侧斜射 +${lv} 对分裂电浆弹，覆盖更宽空域。`
    },
    {
      id: 'plasma_pierce', name: '电浆穿透', category: '弹道', rarity: 'rare', maxStars: 3, icon: 'pierce', iconEmoji: '⚡',
      desc: (lv) => `主炮子弹可贯穿 +${lv} 个目标而不消失，编队清场利器。`
    },
    {
      id: 'homing_pod', name: '追踪微导弹', category: '弹道', rarity: 'rare', maxStars: 3, icon: 'missile', iconEmoji: '🚀',
      desc: (lv) => `每 ${[2.2, 1.65, 1.2][lv - 1]} 秒自动齐射 ${lv + 1} 枚智能寻敌微导弹。`
    },
    {
      id: 'overclock_barrel', name: '狂热射速', category: '弹道', rarity: 'common', maxStars: 3, icon: 'rapid', iconEmoji: '🔥',
      desc: (lv) => `主炮与僚机射击频率提升 +${[18, 35, 52][lv - 1]}%。`
    },
    {
      id: 'crit_core', name: '弱点超载', category: '弹道', rarity: 'common', maxStars: 3, icon: 'crit', iconEmoji: '🎯',
      desc: (lv) => `暴击率 +${[15, 28, 42][lv - 1]}%，暴击造成 ${[2.0, 2.3, 2.6][lv - 1]} 倍金红高能伤害。`
    },
    // 2. 借风气旋系
    {
      id: 'wind_blades', name: '顺风风刃', category: '借风', rarity: 'rare', maxStars: 3, icon: 'windblade', iconEmoji: '🌪',
      desc: (lv) => `大顺风或持续吹气时向前斩出 ${[2, 3, 5][lv - 1]} 道穿透弯月风刃。`
    },
    {
      id: 'wind_magnet', name: '气旋磁极', category: '借风', rarity: 'common', maxStars: 3, icon: 'magnet', iconEmoji: '🧲',
      desc: (lv) => `经验棱晶与道具吸附半径 +${[65, 130, 210][lv - 1]}%，经验获取 +${[15, 30, 45][lv - 1]}%。`
    },
    {
      id: 'iron_lungs', name: '涡轮肺活量', category: '借风', rarity: 'common', maxStars: 3, icon: 'lungs', iconEmoji: '💨',
      desc: (lv) => `吹气肺活量上限与恢复速度 +${[35, 70, 110][lv - 1]}%，大顺风冷却缩短 ${[15, 28, 40][lv - 1]}%。`
    },
    {
      id: 'storm_reflect', name: '风暴反噬', category: '借风', rarity: 'rare', maxStars: 3, icon: 'reflect', iconEmoji: '🌀',
      desc: (lv) => `顺风倒吹敌弹伤害升至 ${[2.5, 4.0, 6.0][lv - 1]} 倍，且倒吹时自动追踪最近敌机。`
    },
    // 3. 僚机与环轨系
    {
      id: 'drone_swarm', name: '蜂群编队', category: '僚机', rarity: 'rare', maxStars: 3, icon: 'drone', iconEmoji: '🛸',
      desc: (lv) => `立即 +1 架浮游僚机（上限扩至 6 架），全僚机伤害 +${[22, 44, 70][lv - 1]}%。`
    },
    {
      id: 'tesla_chain', name: '雷霆锁链', category: '僚机', rarity: 'rare', maxStars: 3, icon: 'tesla', iconEmoji: '🌩',
      desc: (lv) => `僚机与暴击命中触发跳跃 ${[2, 3, 5][lv - 1]} 个目标的蓝紫高压闪电链。`
    },
    {
      id: 'orbit_orbs', name: '环轨电浆球', category: '僚机', rarity: 'common', maxStars: 3, icon: 'orbit', iconEmoji: '🔮',
      desc: (lv) => `生成 ${lv} 颗环绕护体电浆球，灼烧敌机并抵消撞上的普通敌弹。`
    },
    // 4. 重武与战术系
    {
      id: 'rail_capacitor', name: '超导磁轨', category: '重武', rarity: 'common', maxStars: 3, icon: 'rail', iconEmoji: '🔋',
      desc: (lv) => `磁轨炮蓄力速度 +${[30, 60, 95][lv - 1]}%，完美蓄力松手窗口大幅延长。`
    },
    {
      id: 'rail_aftershock', name: '电离余震', category: '重武', rarity: 'rare', maxStars: 3, icon: 'aftershock', iconEmoji: '⚡',
      desc: (lv) => `磁轨炮路径残留持续 ${[2.0, 3.0, 4.2][lv - 1]} 秒的高压电离灼烧带，持续电击敌机。`
    },
    {
      id: 'tactical_arsenal', name: '核子补给', category: '重武', rarity: 'rare', maxStars: 3, icon: 'nuke', iconEmoji: '☢',
      desc: (lv) => `立即 +1 枚战术核弹，且每次翻滚原地释放震碎敌弹的脉冲新星（威力随星级提升）。`
    },
    // 5. 机甲生存系
    {
      id: 'nano_hull', name: '纳米装甲', category: '机甲', rarity: 'common', maxStars: 3, icon: 'hull', iconEmoji: '🛡',
      desc: (lv) => `最大耐久 +${[25, 50, 80][lv - 1]} 并立即回复 35% 耐久，获得每秒 ${[1.4, 2.8, 4.5][lv - 1]} 点自修。`
    },
    {
      id: 'phase_aegis', name: '相位护盾', category: '机甲', rarity: 'rare', maxStars: 3, icon: 'shield', iconEmoji: '🔷',
      desc: (lv) => `立即获得 1 层能量护盾，且每 ${[26, 20, 14][lv - 1]} 秒自动再生 1 层护盾。`
    },
    {
      id: 'graze_dynamo', name: '擦弹引擎', category: '机甲', rarity: 'common', maxStars: 3, icon: 'graze', iconEmoji: '✨',
      desc: (lv) => `擦弹判定圈 +35%，每次擦弹掉落经验并立刻缩短 ${[0.4, 0.7, 1.0][lv - 1]} 秒顺风冷却。`
    },
    // 6. 传说金色觉醒卡（Lv.5+ 且前置技能 Lv.2+）
    {
      id: 'awakening_barrage', name: '【觉醒】天穹万剑归宗', category: '觉醒', rarity: 'epic', maxStars: 1, icon: 'awakening', iconEmoji: '⚔️',
      requires: ['split_prism', 'homing_pod'], minLv: 5,
      desc: () => `战机形态觉醒！每 6 轮主炮自动齐射 8 枚金色追踪圣剑光弹，全伤害 +18%。`
    },
    {
      id: 'awakening_tempest', name: '【觉醒】九级飓风领域', category: '觉醒', rarity: 'epic', maxStars: 1, icon: 'awakening', iconEmoji: '🌪️',
      requires: ['wind_blades', 'iron_lungs'], minLv: 5,
      desc: () => `战机形态觉醒！吹气张开飓风力场自动偏转周围敌弹，并狂暴喷发大型青金风刃。`
    },
    {
      id: 'awakening_rail', name: '【觉醒】阳电子破城炮', category: '觉醒', rarity: 'epic', maxStars: 1, icon: 'awakening', iconEmoji: '🌟',
      requires: ['rail_capacitor', 'rail_aftershock'], minLv: 5,
      desc: () => `战机形态觉醒！磁轨炮进化为金青阳电子巨炮，伤害 +65% 并全屏感电震慑敌机。`
    }
  ];

  const SKILL_MAP = Object.fromEntries(SKILL_POOL.map((s) => [s.id, s]));

  function xpRequiredFor(level) {
    // Lv.1 -> Lv.2: 34 XP (~15-22s), then smooth growth so 8-10min run reaches Lv.11-14
    return Math.round(24 + level * 14 + Math.pow(level, 1.55) * 6);
  }

  class SkyRoguelite {
    constructor(callbacks = {}) {
      this.cb = callbacks;
      this.sfx = callbacks.sfx || null;
      this.skills = {}; // id -> stars
      this.pickOrder = [];
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
      this.orbs = []; // { angle, cooldown }

      this.missileTimer = 0;
      this.breathBladeTimer = 0;
      this.autoShieldTimer = 0;
      this.mainShotCounter = 0;
      this.levelFlash = 0;
      this.time = 0;

      this.draft = null; // { level, rerollsLeft, selectedIndex, choices: [...] }
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
          max-inline-size: min(920px, 95vw);
          inline-size: min(920px, 95vw);
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
        }
        .rg-cards {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: clamp(10px, 1.8vw, 16px);
        }
        @media (max-width: 680px) {
          .rg-cards {
            grid-template-columns: 1fr;
            gap: 10px;
          }
        }
        .rg-card {
          position: relative;
          appearance: none;
          text-align: left;
          cursor: pointer;
          border-radius: 16px;
          padding: 16px 14px 14px;
          border: 1.5px solid var(--rg-accent, #38bdf8);
          background: var(--rg-bg);
          color: #f8fafc;
          display: flex;
          flex-direction: column;
          gap: 9px;
          transition: transform 0.16s ease, box-shadow 0.16s ease, border-color 0.16s ease;
          box-shadow: 0 10px 26px rgba(0, 0, 0, 0.42), 0 0 0 1px rgba(255, 255, 255, 0.05) inset;
          overflow: hidden;
          min-block-size: 44px;
        }
        @media (max-width: 680px) {
          .rg-card {
            display: grid;
            grid-template-columns: 52px 1fr;
            grid-template-rows: auto auto;
            align-items: center;
            column-gap: 12px;
            row-gap: 4px;
            padding: 11px 12px;
          }
          .rg-card-top { grid-column: 1 / 2; grid-row: 1 / 3; flex-direction: column; align-items: center !important; gap: 4px !important; }
          .rg-card-head { grid-column: 2 / 3; }
          .rg-card-desc { grid-column: 2 / 3; }
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
        .rg-card.focused {
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
          letter-spacing: 1px;
          color: #fde047;
          font-weight: 800;
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
        .rg-foot {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
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
          gap: 6px;
          align-items: center;
          flex: 1;
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
            <p class="rg-sub">点击卡片 / 键盘 1 · 2 · 3 / 手柄或手机座舱同步选卡</p>
          </div>
          <div class="rg-cards" id="rg-cards-grid"></div>
          <div class="rg-foot">
            <button type="button" class="rg-reroll" id="rg-reroll-btn">🎲 换一批 (R)</button>
            <div class="rg-owned" id="rg-owned-list"></div>
          </div>
        </div>
      `;
      dlg.addEventListener('cancel', (ev) => {
        ev.preventDefault(); // Must pick a skill card
      });
      document.body.appendChild(dlg);

      this._dlg = dlg;
      this._titleEl = dlg.querySelector('#rg-draft-title');
      this._gridEl = dlg.querySelector('#rg-cards-grid');
      this._rerollBtn = dlg.querySelector('#rg-reroll-btn');
      this._ownedEl = dlg.querySelector('#rg-owned-list');

      this._rerollBtn.addEventListener('click', () => {
        this.reroll();
      });
    }

    reset(opts = {}) {
      this.skills = {};
      this.pickOrder = [];
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
      this.mainShotCounter = 0;
      this.levelFlash = 0;
      this.closeDraft(true);
    }

    _evoTier() {
      let tier = 0;
      if (this.skills.awakening_barrage) tier += 1;
      if (this.skills.awakening_tempest) tier += 1;
      if (this.skills.awakening_rail) tier += 1;
      return tier;
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
      const evoTier = this._evoTier();

      return {
        evoTier,
        splitShots: splitLv,
        pierceCount: pierceLv,
        fireRateMult: 1 + [0, 0.18, 0.35, 0.52][rapidLv],
        damageMult: 1 + (s.awakening_barrage ? 0.18 : 0),
        critChance: [0, 0.15, 0.28, 0.42][critLv],
        critMult: [1, 2.0, 2.3, 2.6][critLv],
        pickupRadiusMult: 1 + [0, 0.65, 1.3, 2.1][magLv],
        xpMult: 1 + [0, 0.15, 0.3, 0.45][magLv],
        lungCapMult: 1 + [0, 0.35, 0.7, 1.1][lungLv],
        lungRegenMult: 1 + [0, 0.35, 0.7, 1.1][lungLv],
        gustCdMult: [1, 0.85, 0.72, 0.6][lungLv],
        windReflectMult: [1.8, 2.5, 4.0, 6.0][reflectLv],
        windReflectHoming: reflectLv > 0,
        maxDrones: droneLv > 0 ? 4 + Math.min(2, droneLv) : 4,
        droneDamageMult: 1 + [0, 0.22, 0.44, 0.7][droneLv],
        hasLightning: (s.tesla_chain || 0) > 0,
        railChargeMult: 1 + [0, 0.3, 0.6, 0.95][railLv],
        railPerfectWindowMult: 1 + [0, 0.45, 0.9, 1.35][railLv],
        railAwakened: Boolean(s.awakening_rail),
        railDamageMult: s.awakening_rail ? 1.65 : 1,
        maxHpBonus: [0, 25, 50, 80][hullLv],
        hullRegenPerSec: [0, 1.4, 2.8, 4.5][hullLv],
        autoShieldInterval: shieldLv > 0 ? [0, 26, 20, 14][shieldLv] : 0,
        grazeRadiusMult: grazeLv > 0 ? 1.35 : 1,
        grazeGustReduce: [0, 0.4, 0.7, 1.0][grazeLv],
        grazeXp: [0, 3, 5, 8][grazeLv],
        tempestAura: Boolean(s.awakening_tempest)
      };
    }

    spawnXp(x, y, amount = 4, tier = 0) {
      const angle = Math.random() * Math.PI * 2;
      const spd = 40 + Math.random() * 75;
      this.gems.push({
        x, y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd - 35,
        amount,
        tier, // 0: cyan, 1: violet, 2: gold
        age: 0,
        phase: Math.random() * 6.28
      });
    }

    spawnXpFromKill(x, y, enemyType, isBoss = false) {
      if (isBoss) {
        this.spawnXpBurst(x, y, 90, 14);
        return;
      }
      const table = {
        scout: [4, 1, 0],
        weaver: [5, 1, 0],
        mine: [4, 1, 0],
        lancer: [7, 2, 0],
        gunship: [14, 3, 1],
        bomber: [22, 4, 1],
        sentinel: [20, 4, 1]
      };
      const [tot, cnt, tier] = table[enemyType] || [5, 1, 0];
      const per = Math.max(2, Math.round(tot / cnt));
      for (let i = 0; i < cnt; i++) {
        this.spawnXp(x + (Math.random() - 0.5) * 16, y + (Math.random() - 0.5) * 16, per, tier);
      }
    }

    spawnXpBurst(x, y, totalAmount = 45, count = 8) {
      const per = Math.max(3, Math.round(totalAmount / Math.max(1, count)));
      for (let i = 0; i < count; i++) {
        const tier = per >= 10 ? 2 : (per >= 6 ? 1 : 0);
        this.spawnXp(x + (Math.random() - 0.5) * 28, y + (Math.random() - 0.5) * 28, per, tier);
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

    _rollChoices(excludeIds = new Set()) {
      const eligible = SKILL_POOL.filter((sk) => {
        const cur = this.skills[sk.id] || 0;
        if (cur >= sk.maxStars) return false;
        if (sk.minLv && this.level < sk.minLv) return false;
        if (sk.requires && !sk.requires.some((reqId) => (this.skills[reqId] || 0) >= 2)) return false;
        return true;
      });
      if (eligible.length === 0) return [];

      let pool = eligible.filter((sk) => !excludeIds.has(sk.id));
      if (pool.length < Math.min(3, eligible.length)) pool = eligible.slice();

      const picked = [];
      const temp = pool.slice();
      while (picked.length < 3 && temp.length > 0) {
        const weights = temp.map((sk) => {
          let w = sk.rarity === 'epic' ? 3.2 : (sk.rarity === 'rare' ? 1.45 : 1.0);
          if ((this.skills[sk.id] || 0) > 0) w *= 1.35; // gentle bias toward leveling owned skills
          return w;
        });
        const total = weights.reduce((a, b) => a + b, 0);
        let r = Math.random() * total;
        let idx = 0;
        for (let i = 0; i < temp.length; i++) {
          r -= weights[i];
          if (r <= 0) { idx = i; break; }
        }
        const sk = temp.splice(idx, 1)[0];
        const nextStars = (this.skills[sk.id] || 0) + 1;
        picked.push({
          id: sk.id,
          name: sk.name,
          category: sk.category,
          rarity: sk.rarity,
          stars: nextStars,
          maxStars: sk.maxStars,
          isNew: nextStars === 1,
          icon: sk.icon,
          iconEmoji: sk.iconEmoji,
          desc: sk.desc(nextStars)
        });
      }
      return picked;
    }

    _openDraft() {
      const choices = this._rollChoices();
      if (choices.length === 0) {
        this.pendingLevelUps = 0;
        return;
      }
      this.draft = {
        level: this.level,
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
      if (this.cb.onDraftChange) this.cb.onDraftChange(this.getDraftState());
    }

    _renderDraftDom() {
      if (!this._dlg || !this.draft) return;
      this._titleEl.textContent = `借风核心升级 · Lv.${this.draft.level}`;
      this._rerollBtn.disabled = this.draft.rerollsLeft <= 0;
      this._rerollBtn.textContent = `🎲 换一批 (剩余 ${this.draft.rerollsLeft} 次 · R)`;

      this._gridEl.innerHTML = '';
      this.draft.choices.forEach((c, idx) => {
        const meta = RARITY_META[c.rarity] || RARITY_META.common;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'rg-card' + (idx === this.draft.selectedIndex ? ' focused' : '');
        btn.style.setProperty('--rg-accent', meta.color);
        btn.style.setProperty('--rg-glow', meta.glow);
        btn.style.setProperty('--rg-bg', meta.bg);
        const starsText = c.maxStars === 1
          ? '★ 觉醒'
          : '★'.repeat(c.stars) + '☆'.repeat(c.maxStars - c.stars);
        btn.innerHTML = `
          <div class="rg-card-top">
            <div class="rg-icon-wrap">${makeSkillSvg(c.icon, meta.color)}</div>
            <div class="rg-badges">
              <span class="rg-tag">${meta.label} · ${c.category}</span>
              <span class="rg-stars">${c.isNew && c.maxStars > 1 ? 'NEW ✨ ' : ''}${starsText}</span>
            </div>
          </div>
          <div class="rg-card-head">
            <span class="rg-name">${c.name}</span>
            <span class="rg-keyhint">[${idx + 1}]</span>
          </div>
          <div class="rg-card-desc">${c.desc}</div>
        `;
        btn.addEventListener('click', () => this.pickCard(idx));
        btn.addEventListener('pointerenter', () => {
          if (this.draft) {
            this.draft.selectedIndex = idx;
            this._updateFocusVisual();
          }
        });
        this._gridEl.appendChild(btn);
      });

      this._ownedEl.innerHTML = '';
      const owned = this.getSummary().pickedSkills;
      if (owned.length === 0) {
        const span = document.createElement('span');
        span.style.cssText = 'font-size:11.5px;color:#64748b';
        span.textContent = '首次进化：选择你的第一项核心技能';
        this._ownedEl.appendChild(span);
      } else {
        owned.slice(0, 8).forEach((sk) => {
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

    reroll() {
      if (!this.draft || this.draft.rerollsLeft <= 0) return false;
      const prevIds = new Set(this.draft.choices.map((c) => c.id));
      const next = this._rollChoices(prevIds);
      if (next.length === 0) return false;
      this.draft.rerollsLeft -= 1;
      this.draft.choices = next;
      this.draft.selectedIndex = 0;
      if (this.sfx && this.sfx.skillReroll) this.sfx.skillReroll();
      this._renderDraftDom();
      if (this.cb.onDraftChange) this.cb.onDraftChange(this.getDraftState());
      return true;
    }

    pickCard(index) {
      if (!this.draft) return false;
      const choice = this.draft.choices[index];
      if (!choice) return false;

      if (!this.skills[choice.id]) this.pickOrder.push(choice.id);
      this.skills[choice.id] = choice.stars;

      if (choice.id === 'orbit_orbs') {
        while (this.orbs.length < choice.stars) {
          this.orbs.push({ angle: (this.orbs.length / choice.stars) * Math.PI * 2, cooldown: 0 });
        }
        this.orbs.forEach((o, i) => { o.angle = (i / this.orbs.length) * Math.PI * 2; });
      }

      if (this.sfx && this.sfx.skillPick) this.sfx.skillPick(choice.rarity);
      if (this.cb.onApplyInstant) this.cb.onApplyInstant(choice);

      this.pendingLevelUps = Math.max(0, this.pendingLevelUps - 1);
      this.closeDraft(true);

      if (this.pendingLevelUps > 0) {
        this._openDraft();
      } else if (this.cb.onDraftChange) {
        this.cb.onDraftChange(null);
      }
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
        level: this.draft.level,
        rerollsLeft: this.draft.rerollsLeft,
        selectedIndex: this.draft.selectedIndex,
        choices: this.draft.choices.map((c) => ({
          id: c.id,
          name: c.name,
          category: c.category,
          rarity: c.rarity,
          stars: c.stars,
          maxStars: c.maxStars,
          isNew: c.isNew,
          desc: c.desc,
          iconEmoji: c.iconEmoji
        }))
      };
    }

    getSummary() {
      const pickedSkills = this.pickOrder.map((id) => {
        const def = SKILL_MAP[id];
        return {
          id,
          name: def ? def.name : id,
          iconEmoji: def ? def.iconEmoji : '⚡',
          stars: this.skills[id] || 1,
          rarity: def ? def.rarity : 'common'
        };
      });
      return {
        level: this.level,
        xp: Math.round(this.xp),
        xpNext: this.xpNext,
        xpRatio: clamp(this.xp / Math.max(1, this.xpNext), 0, 1),
        evoTier: this._evoTier(),
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
        const count = tempest ? 5 : [0, 2, 3, 5][lv];
        this._spawnWindBlades(px, py - 18, count, tempest ? 68 : 34 + lv * 14, tempest, worldVyOffset);
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
        const dur = [0, 2.0, 3.0, 4.2][lv];
        this.aftershocks.push({
          x,
          yStart: y,
          yTop: y - Math.max(480, reachLen),
          halfW: Math.max(22, width * 0.65),
          dmgPerSec: (48 + lv * 26) * Math.max(0.8, power),
          life: dur,
          maxLife: dur,
          tickTimer: 0
        });
      }
      if (this.skills.awakening_rail && Array.isArray(enemies) && this.cb.onDealDamage) {
        for (const e of enemies) {
          if (e.hp > 0) {
            this.cb.onDealDamage(e, 95 * power, { source: 'awakening_rail', stun: true });
            this.arcs.push({ x1: x, y1: y - 160, x2: e.x, y2: e.y, life: 0.26, maxLife: 0.26, gold: true });
          }
        }
      }
    }

    notifyBarrelRoll(px, py, enemies = [], enemyBullets = []) {
      const lv = this.skills.tactical_arsenal || 0;
      if (lv <= 0) return;
      const maxR = 125 + lv * 35;
      this.novas.push({ x: px, y: py, r: 16, maxR, life: 0.36, maxLife: 0.36 });
      const rSq = maxR * maxR;
      for (let i = enemyBullets.length - 1; i >= 0; i--) {
        const b = enemyBullets[i];
        if (distSq(px, py, b.x, b.y) <= rSq) {
          enemyBullets.splice(i, 1);
        }
      }
      if (this.cb.onDealDamage) {
        const dmg = 40 + lv * 28;
        for (const e of enemies) {
          if (e.hp > 0 && distSq(px, py, e.x, e.y) <= (maxR + (e.radius || 20)) ** 2) {
            this.cb.onDealDamage(e, dmg, { source: 'roll_nova' });
          }
        }
      }
    }

    notifyCritOrDroneHit(targetEnemy, enemies = [], baseDmg = 20) {
      const lv = this.skills.tesla_chain || 0;
      if (lv <= 0 || !targetEnemy || !this.cb.onDealDamage) return;
      const jumps = [0, 2, 3, 5][lv];
      let curr = targetEnemy;
      const visited = new Set([curr]);
      const chainDmg = Math.max(12, baseDmg * (0.62 + lv * 0.14));
      if (this.sfx && this.sfx.chainLightning) this.sfx.chainLightning();

      for (let k = 0; k < jumps; k++) {
        let nearest = null;
        let bestD = 240 * 240;
        for (const e of enemies) {
          if (!e || e.hp <= 0 || visited.has(e)) continue;
          const d = distSq(curr.x, curr.y, e.x, e.y);
          if (d < bestD) { bestD = d; nearest = e; }
        }
        if (!nearest) break;
        visited.add(nearest);
        this.arcs.push({ x1: curr.x, y1: curr.y, x2: nearest.x, y2: nearest.y, life: 0.22, maxLife: 0.22 });
        this.cb.onDealDamage(nearest, chainDmg, { source: 'lightning' });
        curr = nearest;
      }
    }

    notifyMainShot(px, py, baseDmg = 20, worldVyOffset = 0) {
      if (!this.skills.awakening_barrage) return;
      this.mainShotCounter += 1;
      if (this.mainShotCounter < 6) return;
      this.mainShotCounter = 0;
      const dmg = Math.max(22, baseDmg * 1.35);
      for (let i = 0; i < 8; i++) {
        const offset = (i / 7 - 0.5) * 2;
        const angle = -Math.PI / 2 + offset * 0.72;
        const speed = 360;
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
      if (this.xpChainTimer > 0) {
        this.xpChainTimer -= dt;
        if (this.xpChainTimer <= 0) this.xpChain = 0;
      }

      const {
        playerX = 0, playerY = 0, W = 800, H = 600,
        worldVyOffset = 0,
        breath = 0, gustActive = false, tutorial = false,
        isPaused = false, phase = 'playing',
        enemies = [], enemyBullets = []
      } = ctxState;

      if (phase !== 'playing') return;

      // Trigger pending level-up draft only when tutorial isn't blocking and not already paused
      if (!tutorial && !isPaused && !this.draft && this.pendingLevelUps > 0) {
        this._openDraft();
        return;
      }

      if (isPaused) return;

      const mods = this.getModifiers();

      // 1. XP Gems physics & magnetic pull
      const baseMagnet = 105 * mods.pickupRadiusMult;
      const blowing = breath > 0.14 || gustActive;
      for (let i = this.gems.length - 1; i >= 0; i--) {
        const g = this.gems[i];
        g.age += dt;
        const dx = playerX - g.x;
        const dy = playerY - g.y;
        const d2 = dx * dx + dy * dy;
        const magnetR = (blowing || g.gustPulled) ? Math.max(W, H) * 1.3 : baseMagnet;

        if (d2 < magnetR * magnetR) {
          const d = Math.max(1, Math.sqrt(d2));
          const pull = (blowing || g.gustPulled ? 760 : 480) + g.age * 170;
          g.vx = lerp(g.vx, (dx / d) * pull, Math.min(1, dt * 10));
          g.vy = lerp(g.vy, (dy / d) * pull + worldVyOffset, Math.min(1, dt * 10));
          g.x += g.vx * dt;
          g.y += g.vy * dt;
        } else {
          g.vx *= Math.pow(0.08, dt);
          g.vy = lerp(g.vy, 76, Math.min(1, dt * 2.5));
          g.x += g.vx * dt;
          g.y += (g.vy + worldVyOffset) * dt;
        }

        if (d2 <= 30 * 30) {
          this.addRawXp(g.amount);
          this.xpChain = Math.min(12, this.xpChain + 1);
          this.xpChainTimer = 0.7;
          if (this.sfx && this.sfx.xpPickup) this.sfx.xpPickup(this.xpChain);
          this.gems.splice(i, 1);
          continue;
        }
        if (g.y > playerY + H + 80 || g.age > 24) {
          this.gems.splice(i, 1);
        }
      }

      // 2. Homing Micro-Missiles
      const missileLv = this.skills.homing_pod || 0;
      if (missileLv > 0 && enemies.length > 0) {
        this.missileTimer -= dt;
        if (this.missileTimer <= 0) {
          this.missileTimer = [2.2, 1.65, 1.2][missileLv - 1] / mods.fireRateMult;
          const cnt = missileLv + 1;
          if (this.sfx && this.sfx.missileLaunch) this.sfx.missileLaunch();
          for (let k = 0; k < cnt; k++) {
            const spread = cnt > 1 ? (k / (cnt - 1) - 0.5) * 1.1 : 0;
            this.missiles.push({
              x: playerX + spread * 24,
              y: playerY - 12,
              vx: Math.sin(spread) * 190,
              vy: -340 + worldVyOffset,
              dmg: (26 + missileLv * 10) * mods.damageMult,
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
          const turn = (m.sword ? 7.8 : 5.6) * dt;
          const nextAng = curAng + clamp(diff, -turn, turn);
          const spd = m.sword ? 580 : 480;
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
          this.breathBladeTimer = hasTempest ? 0.65 : 1.15;
          const cnt = hasTempest ? 3 : Math.min(3, bladeLv + 1);
          this._spawnWindBlades(playerX, playerY - 18, cnt, hasTempest ? 54 : 26 + bladeLv * 12, hasTempest, worldVyOffset);
        }
      }
      if (blowing && hasTempest) {
        const auraR = 135;
        for (let i = enemyBullets.length - 1; i >= 0; i--) {
          const b = enemyBullets[i];
          const dx = b.x - playerX;
          const dy = b.y - playerY;
          const d2 = dx * dx + dy * dy;
          if (d2 < auraR * auraR && d2 > 1) {
            const d = Math.sqrt(d2);
            b.vx += (dx / d) * 420 * dt;
            b.vy += (dy / d) * 420 * dt - 180 * dt;
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

      // 4. Orbiting Plasma Orbs (damage enemies & cancel ordinary bullets)
      if (this.orbs.length > 0) {
        const orbitR = 54;
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
            if (distSq(ox, oy, b.x, b.y) <= 17 * 17) {
              enemyBullets.splice(bi, 1);
              o.cooldown = 2.4;
              break;
            }
          }
          if (o.cooldown <= 0 && this.cb.onDealDamage) {
            for (const e of enemies) {
              if (!e || e.hp <= 0) continue;
              const hr = (e.radius || 18) + 12;
              if (distSq(ox, oy, e.x, e.y) <= hr * hr) {
                this.cb.onDealDamage(e, 28 * dt * 8, { source: 'orbit_orb', quiet: true });
              }
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

      // 2. Roll Novas
      for (const nv of this.novas) {
        const alpha = clamp(nv.life / nv.maxLife, 0, 1);
        ctx.strokeStyle = `rgba(251, 146, 60, ${(0.85 * alpha).toFixed(3)})`;
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
        for (const o of this.orbs) {
          const ox = playerX + Math.cos(o.angle) * orbitR;
          const oy = playerY + Math.sin(o.angle) * orbitR;
          ctx.save();
          ctx.globalAlpha = o.cooldown > 0 ? 0.28 : 0.95;
          const g = ctx.createRadialGradient(ox, oy, 1, ox, oy, 12);
          g.addColorStop(0, '#ffffff');
          g.addColorStop(0.45, '#38bdf8');
          g.addColorStop(1, 'rgba(56, 189, 248, 0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(ox, oy, 12, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }

      ctx.restore();
    }

    renderHudBar(ctx, W, H, hudTop = 12, alpha = 1, panelWidth = 0) {
      const barW = panelWidth ? panelWidth - 59 : Math.min(300, Math.max(150, W - 260));
      const x = panelWidth ? 65 : (W - barW) * 0.5;
      const y = panelWidth ? hudTop : Math.max(8, hudTop - 2);
      const ratio = clamp(this.xp / Math.max(1, this.xpNext), 0, 1);

      ctx.save();
      ctx.globalAlpha = clamp(alpha, 0.25, 1);

      if (!panelWidth) {
        ctx.fillStyle = 'rgba(7, 20, 38, 0.65)';
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(x - 48, y, barW + 52, 18, 9) : ctx.rect(x - 48, y, barW + 52, 18);
        ctx.fill();
      }

      ctx.font = '900 10.5px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = this.levelFlash > 0 ? '#fde047' : '#7dd3fc';
      ctx.fillText(`Lv.${this.level}`, x - 40, y + 9.5);

      // Bar track
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(x, y + 5, barW - 4, 8, 4) : ctx.rect(x, y + 5, barW - 4, 8);
      ctx.fill();

      if (ratio > 0.01) {
        const g = ctx.createLinearGradient(x, 0, x + barW, 0);
        g.addColorStop(0, '#38bdf8');
        g.addColorStop(0.6, '#a78bfa');
        g.addColorStop(1, '#fde047');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(x, y + 5, Math.max(6, (barW - 4) * ratio), 8, 4) : ctx.rect(x, y + 5, Math.max(6, (barW - 4) * ratio), 8);
        ctx.fill();
      }

      ctx.restore();
    }
  }

  global.SkyRoguelite = SkyRoguelite;
})(typeof window !== 'undefined' ? window : globalThis);
