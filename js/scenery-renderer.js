/**
 * Tabletop Sky Striker -《借风计划》v2.0 Next-Gen 2.5D Scenery Renderer
 * Pure Canvas 2D + Offscreen Pre-baked Volumetric Sprite Atlas Cache (60fps zero-jank)
 *
 * Chapters:
 *  - 'day'    : 晴空借风 · Cerulean ocean, sunbeams, sun glint, coral reef islands (lighthouse / rotating windmill),
 *               multi-layer volumetric cumulus clouds with ocean cast shadows, V-flock seabirds & canyon cloud walls
 *  - 'sunset' : 暮色穿云 · Indigo-crimson-molten-gold sky, setting sun disc, rim-lit fiery clouds, floating basalt spires
 *               with golden waterfalls & warm cliff lights, subsurface storm anvil lightning & rising embers
 *  - 'night'  : 星海灯塔 · Deep cosmos, pre-baked fluid nebulae (teal/violet/magenta), dancing Aurora Borealis curtains,
 *               glowing crystal floating islands, distant Celestial Orbital Lighthouse with sweeping beams & meteors
 */
(function (global) {
  'use strict';

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const mod = (n, m) => ((n % m) + m) % m;
  const TAU = Math.PI * 2;

  const DEFAULT_CALM_TITLE = Object.freeze({ veil: 0, cloud: 1, sun: 1, lines: 1 });
  const DEFAULT_CALM_PLAYING = Object.freeze({ veil: 0.3, cloud: 0.26, sun: 0.25, lines: 0.12 });

  const VEIL_RGB = {
    day: '9, 32, 64',
    sunset: '30, 11, 36',
    night: '2, 6, 18'
  };

  const LANE_PF = 0.62;

  // Fast deterministic 32-bit spatial hash -> [0, 1)
  function hash2D(ix, iy) {
    let n = Math.imul(ix | 0, 374761393) + Math.imul(iy | 0, 668265263);
    n = (n ^ (n >>> 13)) >>> 0;
    n = Math.imul(n, 1274126177) >>> 0;
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }

  function hash1D(i) {
    return hash2D(i, 97531);
  }

  // Smooth value noise for organic coastlines, rock facets & nebula wisps
  function smoothNoise(x, y, seed = 0) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const a = hash2D(ix + seed, iy - seed);
    const b = hash2D(ix + 1 + seed, iy - seed);
    const c = hash2D(ix + seed, iy + 1 - seed);
    const d = hash2D(ix + 1 + seed, iy + 1 - seed);
    return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
  }

  function fbm2D(x, y, octaves = 3, seed = 0) {
    let val = 0;
    let amp = 0.5;
    let freq = 1;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      val += amp * smoothNoise(x * freq, y * freq, seed + i * 37);
      norm += amp;
      amp *= 0.5;
      freq *= 2.03;
    }
    return val / (norm || 1);
  }

  function createBuffer(w, h) {
    const pw = Math.max(2, Math.round(w));
    const ph = Math.max(2, Math.round(h));
    if (typeof document !== 'undefined' && document.createElement) {
      const c = document.createElement('canvas');
      c.width = pw;
      c.height = ph;
      return c;
    }
    if (typeof OffscreenCanvas !== 'undefined') {
      return new OffscreenCanvas(pw, ph);
    }
    return null;
  }

  function traceClosedCurve(ctx, pts) {
    const n = pts.length;
    if (n < 3) return;
    ctx.beginPath();
    const mx0 = (pts[n - 1].x + pts[0].x) * 0.5;
    const my0 = (pts[n - 1].y + pts[0].y) * 0.5;
    ctx.moveTo(mx0, my0);
    for (let i = 0; i < n; i++) {
      const p0 = pts[i];
      const p1 = pts[(i + 1) % n];
      ctx.quadraticCurveTo(p0.x, p0.y, (p0.x + p1.x) * 0.5, (p0.y + p1.y) * 0.5);
    }
    ctx.closePath();
  }

  class SkySceneryRenderer {
    constructor() {
      this.width = 1280;
      this.height = 800;
      this.dpr = 1;
      this._bakeScale = 0;
      this._sprites = null;
      this._backdrops = {};
      this._backdropKey = '';

      // Simulation & camera tracking fallbacks
      this.time = 0;
      this._scrollDist = 0;
      this._worldOffsetX = 0;
      this._scrollSpeed = 240;
      this._cameraVx = 0;
      this._corridorOffset = 0;
      this._lazyCamX = undefined;
      this._calm = { ...DEFAULT_CALM_TITLE };

      // Ambient living entities
      this._stars = [];
      this._birdFlocks = [];
      this._birdTimer = 1.8;
      this._motes = [];
      this._cloudFlashes = [];
      this._flashTimer = 2.6;
      this._meteors = [];
      this._meteorTimer = 2.2;

      this._initStarsAndMotes();
    }

    _initStarsAndMotes() {
      this._stars.length = 0;
      for (let i = 0; i < 190; i++) {
        const tier = hash2D(i, 91);
        this._stars.push({
          x: hash2D(i, 7),
          y: hash2D(i, 19),
          size: tier > 0.88 ? 1.55 + hash2D(i, 31) * 0.75 : 0.65 + hash2D(i, 31) * 0.95,
          twinkle: hash2D(i, 43) * TAU,
          speed: 0.9 + hash2D(i, 59) * 1.6,
          depth: tier > 0.6 ? 0.032 : 0.015,
          tint: tier > 0.82 ? '#bae6fd' : (tier > 0.64 ? '#ddd6fe' : '#f1f5f9'),
          sparkle: tier > 0.91
        });
      }

      this._motes.length = 0;
      for (let i = 0; i < 36; i++) {
        this._motes.push({
          nx: hash2D(i, 113),
          ny: hash2D(i, 157),
          len: 8 + hash2D(i, 199) * 16,
          driftX: (hash2D(i, 211) - 0.5) * 28,
          speedY: 32 + hash2D(i, 239) * 58,
          phase: hash2D(i, 271) * TAU
        });
      }
    }

    resize(W, H, dpr = 1) {
      const nextW = Math.max(320, Number(W) || 1280);
      const nextH = Math.max(320, Number(H) || 800);
      const nextDpr = clamp(Number(dpr) || 1, 1, 2);

      this.width = nextW;
      this.height = nextH;
      this.dpr = nextDpr;

      const targetBakeScale = nextDpr >= 1.45 ? 1.75 : 1.25;
      if (!this._sprites || Math.abs(this._bakeScale - targetBakeScale) > 0.2) {
        this._bakeScale = targetBakeScale;
        this._bakeAllSprites(targetBakeScale);
      }

      const bKey = `${Math.round(nextW)}x${Math.round(nextH)}@${targetBakeScale.toFixed(2)}`;
      if (this._backdropKey !== bKey) {
        this._backdropKey = bKey;
        this._bakeSkyBackdrops(nextW, nextH);
      }
    }

    step(dt, state = {}) {
      const safeDt = clamp(Number(dt) || 0, 0, 0.1);
      if (safeDt <= 0) return;

      const sky = ['day', 'sunset', 'night'].includes(state.sky) ? state.sky : 'day';
      const phase = state.phase || 'title';
      const scrollSpeed = typeof state.scrollSpeed === 'number'
        ? state.scrollSpeed
        : (phase === 'title' ? 145 : 280);
      const cameraVx = Number(state.cameraVx) || 0;

      this._scrollSpeed = scrollSpeed;
      this._cameraVx = cameraVx;
      this.time = typeof state.time === 'number' ? state.time : (this.time + safeDt);
      this._scrollDist += scrollSpeed * safeDt;
      this._worldOffsetX += cameraVx * safeDt;

      if (typeof state.corridorOffset === 'number') {
        this._corridorOffset = state.corridorOffset;
      } else {
        if (this._lazyCamX === undefined) this._lazyCamX = this._worldOffsetX;
        this._lazyCamX = lerp(this._lazyCamX, this._worldOffsetX, 1 - Math.exp(-safeDt * 0.55));
        this._corridorOffset = (this._lazyCamX - this._worldOffsetX) * LANE_PF;
      }

      if (state.calm && typeof state.calm === 'object') {
        this._calm = {
          veil: clamp(Number(state.calm.veil) || 0, 0, 0.9),
          cloud: clamp(state.calm.cloud !== undefined ? Number(state.calm.cloud) : 1, 0, 1),
          sun: clamp(state.calm.sun !== undefined ? Number(state.calm.sun) : 1, 0, 1),
          lines: clamp(state.calm.lines !== undefined ? Number(state.calm.lines) : 1, 0, 1)
        };
      }

      // 1. Day: V-formation white seabird flocks gliding above the ocean
      if (sky === 'day') {
        this._birdTimer -= safeDt;
        if (this._birdTimer <= 0 && this._birdFlocks.length < 3) {
          this._birdTimer = 4.2 + Math.random() * 5.2;
          const fromLeft = Math.random() < 0.5;
          const count = 4 + Math.floor(Math.random() * 4);
          const birds = [];
          const headAngle = fromLeft ? (0.35 + Math.random() * 0.35) : (Math.PI - 0.35 - Math.random() * 0.35);
          const speed = 52 + Math.random() * 34;
          for (let i = 0; i < count; i++) {
            const rank = Math.ceil(i * 0.5);
            const side = i === 0 ? 0 : (i % 2 === 1 ? 1 : -1);
            birds.push({
              ox: -Math.cos(headAngle) * rank * 15 + Math.sin(headAngle) * side * rank * 12,
              oy: -Math.sin(headAngle) * rank * 15 - Math.cos(headAngle) * side * rank * 12,
              flapOffset: i * 0.75 + Math.random() * 0.4,
              span: 5.5 + (i === 0 ? 1.4 : 0)
            });
          }
          this._birdFlocks.push({
            x: fromLeft ? -60 : this.width + 60,
            y: this.height * (0.12 + Math.random() * 0.42),
            vx: Math.cos(headAngle) * speed,
            vy: Math.sin(headAngle) * speed + scrollSpeed * 0.22,
            angle: headAngle,
            birds,
            life: 0,
            maxLife: 16
          });
        }
        for (let i = this._birdFlocks.length - 1; i >= 0; i--) {
          const fl = this._birdFlocks[i];
          fl.life += safeDt;
          fl.x += (fl.vx - cameraVx * 0.32) * safeDt;
          fl.y += fl.vy * safeDt;
          if (fl.life > fl.maxLife || fl.x < -180 || fl.x > this.width + 180 || fl.y > this.height + 160) {
            this._birdFlocks.splice(i, 1);
          }
        }
      } else if (this._birdFlocks.length > 0) {
        this._birdFlocks.length = 0;
      }

      // 2. Sunset: Subsurface storm anvil cloud lightning pulses (gentle internal cloud glow)
      if (sky === 'sunset') {
        this._flashTimer -= safeDt;
        if (this._flashTimer <= 0 && this._cloudFlashes.length < 3) {
          this._flashTimer = 2.6 + Math.random() * 4.2;
          this._cloudFlashes.push({
            nx: 0.14 + Math.random() * 0.72,
            ny: 0.08 + Math.random() * 0.28,
            radius: 120 + Math.random() * 110,
            life: 0,
            duration: 0.42 + Math.random() * 0.32,
            seed: Math.floor(Math.random() * 1000)
          });
        }
        for (let i = this._cloudFlashes.length - 1; i >= 0; i--) {
          const cf = this._cloudFlashes[i];
          cf.life += safeDt;
          if (cf.life >= cf.duration) this._cloudFlashes.splice(i, 1);
        }
      } else if (this._cloudFlashes.length > 0) {
        this._cloudFlashes.length = 0;
      }

      // 3. Night: Occasional high-altitude shooting stars with long fading tails
      if (sky === 'night') {
        this._meteorTimer -= safeDt;
        if (this._meteorTimer <= 0 && this._meteors.length < 2) {
          this._meteorTimer = 2.8 + Math.random() * 4.8;
          const startX = this.width * (0.15 + Math.random() * 0.75);
          const startY = this.height * (0.04 + Math.random() * 0.24);
          const dir = Math.random() < 0.65 ? 1 : -1;
          const angle = dir > 0 ? (0.42 + Math.random() * 0.28) : (Math.PI - 0.42 - Math.random() * 0.28);
          const spd = 680 + Math.random() * 340;
          this._meteors.push({
            x: startX,
            y: startY,
            vx: Math.cos(angle) * spd,
            vy: Math.sin(angle) * spd,
            tailLen: 85 + Math.random() * 65,
            life: 0,
            duration: 0.38 + Math.random() * 0.22
          });
        }
        for (let i = this._meteors.length - 1; i >= 0; i--) {
          const m = this._meteors[i];
          m.life += safeDt;
          m.x += m.vx * safeDt;
          m.y += m.vy * safeDt;
          if (m.life >= m.duration) this._meteors.splice(i, 1);
        }
      } else if (this._meteors.length > 0) {
        this._meteors.length = 0;
      }
    }

    // =========================================================================
    // OFFSCREEN SPRITE ATLAS PRE-BAKING (Executed once on init / DPR change)
    // =========================================================================

    _bakeAllSprites(scale) {
      this._sprites = {
        dayIslands: this._bakeDayIslands(scale),
        dayClouds: this._bakeVolumetricCloudSet('day', 5, scale),
        cloudShadow: this._bakeCloudShadow(scale),
        sunsetIslands: this._bakeSunsetIslands(scale),
        sunsetClouds: this._bakeVolumetricCloudSet('sunset', 5, scale),
        stormAnvils: this._bakeStormAnvils(scale),
        nightNebulae: this._bakeNightNebulae(scale),
        nightIslands: this._bakeNightIslands(scale),
        nightClouds: this._bakeVolumetricCloudSet('night', 5, scale)
      };
    }

    _bakeSkyBackdrops(W, H) {
      const diag = Math.ceil(Math.hypot(W, H) * 1.18);
      this._backdrops = {
        diag,
        day: this._createBackdropCanvas(diag, diag, 'day'),
        sunset: this._createBackdropCanvas(diag, diag, 'sunset'),
        night: this._createBackdropCanvas(diag, diag, 'night')
      };
    }

    _createBackdropCanvas(w, h, sky) {
      const c = createBuffer(w, h);
      if (!c) return null;
      const ctx = c.getContext('2d');
      ctx.save();
      const g = ctx.createLinearGradient(0, 0, 0, h);
      if (sky === 'day') {
        g.addColorStop(0, '#094382');
        g.addColorStop(0.24, '#0c6abf');
        g.addColorStop(0.52, '#0ea5e9');
        g.addColorStop(0.78, '#22c7f0');
        g.addColorStop(1, '#5eead4');
      } else if (sky === 'sunset') {
        g.addColorStop(0, '#17133b');
        g.addColorStop(0.22, '#311b61');
        g.addColorStop(0.44, '#7c1d4f');
        g.addColorStop(0.66, '#c2410c');
        g.addColorStop(0.85, '#f59e0b');
        g.addColorStop(1, '#fde047');
      } else {
        g.addColorStop(0, '#020612');
        g.addColorStop(0.28, '#061126');
        g.addColorStop(0.58, '#0a1e3c');
        g.addColorStop(0.84, '#102c52');
        g.addColorStop(1, '#163b68');
      }
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);

      // Subtle atmospheric horizon bloom baked directly into backdrop
      if (sky === 'day') {
        const sunGlow = ctx.createRadialGradient(w * 0.34, h * 0.26, 0, w * 0.34, h * 0.26, w * 0.55);
        sunGlow.addColorStop(0, 'rgba(255, 252, 232, 0.34)');
        sunGlow.addColorStop(0.35, 'rgba(186, 230, 253, 0.16)');
        sunGlow.addColorStop(1, 'rgba(56, 189, 248, 0)');
        ctx.fillStyle = sunGlow;
        ctx.fillRect(0, 0, w, h);
      } else if (sky === 'sunset') {
        const horizonGlow = ctx.createRadialGradient(w * 0.5, h * 0.36, 0, w * 0.5, h * 0.36, w * 0.52);
        horizonGlow.addColorStop(0, 'rgba(254, 240, 138, 0.32)');
        horizonGlow.addColorStop(0.42, 'rgba(251, 146, 60, 0.18)');
        horizonGlow.addColorStop(1, 'rgba(124, 45, 18, 0)');
        ctx.fillStyle = horizonGlow;
        ctx.fillRect(0, 0, w, h);
      } else {
        const deepGlow = ctx.createRadialGradient(w * 0.58, h * 0.38, 0, w * 0.58, h * 0.38, w * 0.5);
        deepGlow.addColorStop(0, 'rgba(45, 212, 191, 0.08)');
        deepGlow.addColorStop(0.5, 'rgba(109, 40, 217, 0.07)');
        deepGlow.addColorStop(1, 'rgba(2, 6, 18, 0)');
        ctx.fillStyle = deepGlow;
        ctx.fillRect(0, 0, w, h);
      }

      ctx.restore();
      return c;
    }

    // Bake 5 distinct Ghibli/Sky-Force style volumetric cumulus clouds per chapter
    _bakeVolumetricCloudSet(sky, count, scale) {
      const palettes = {
        day: {
          shadow: [96, 138, 178, 0.72],
          deepMid: [182, 212, 238, 0.88],
          mid: [232, 244, 252, 0.94],
          lit: [255, 253, 246, 0.97],
          rim: 'rgba(255, 255, 255, 0.95)',
          lightDir: { x: -0.68, y: -0.73 }
        },
        sunset: {
          shadow: [58, 24, 72, 0.84],
          deepMid: [136, 38, 78, 0.86],
          mid: [217, 92, 38, 0.90],
          lit: [253, 186, 116, 0.95],
          rim: 'rgba(254, 240, 138, 0.96)',
          lightDir: { x: 0.0, y: -1.0 }
        },
        night: {
          shadow: [11, 25, 54, 0.84],
          deepMid: [23, 49, 94, 0.84],
          mid: [42, 85, 145, 0.82],
          lit: [96, 165, 225, 0.78],
          rim: 'rgba(165, 243, 252, 0.65)',
          lightDir: { x: 0.35, y: -0.94 }
        }
      };
      const pal = palettes[sky] || palettes.day;
      const list = [];

      for (let idx = 0; idx < count; idx++) {
        const lw = 300;
        const lh = 210;
        const c = createBuffer(lw * scale, lh * scale);
        if (!c) continue;
        const ctx = c.getContext('2d');
        ctx.save();
        ctx.scale(scale, scale);

        const cx = lw * 0.5;
        const cy = lh * 0.54;
        const puffs = [];
        const puffCount = 15 + (idx % 3) * 3;

        // Core central billows + flanking lobes
        for (let p = 0; p < puffCount; p++) {
          const h1 = hash2D(idx * 31 + p, 17);
          const h2 = hash2D(idx * 31 + p, 53);
          const h3 = hash2D(idx * 31 + p, 89);
          const t = (p / (puffCount - 1)) * 2 - 1; // -1..1 across width
          const spreadX = t * (74 + (idx % 2) * 14) + (h1 - 0.5) * 28;
          const archY = (t * t) * 22 - 14 + (h2 - 0.5) * 26;
          const radius = (1 - Math.abs(t) * 0.42) * (32 + h3 * 24);
          puffs.push({ x: cx + spreadX, y: cy + archY, r: Math.max(18, radius) });
        }

        const lx = pal.lightDir.x;
        const ly = pal.lightDir.y;

        // Pass 1: Soft underside ambient shadow (back-lit cool slate/violet)
        for (const pf of puffs) {
          const sx = pf.x - lx * pf.r * 0.28;
          const sy = pf.y - ly * pf.r * 0.32 + 5;
          const g = ctx.createRadialGradient(sx, sy, pf.r * 0.15, sx, sy, pf.r * 1.08);
          g.addColorStop(0, `rgba(${pal.shadow[0]}, ${pal.shadow[1]}, ${pal.shadow[2]}, ${pal.shadow[3]})`);
          g.addColorStop(0.68, `rgba(${pal.shadow[0]}, ${pal.shadow[1]}, ${pal.shadow[2]}, ${(pal.shadow[3] * 0.52).toFixed(3)})`);
          g.addColorStop(1, `rgba(${pal.shadow[0]}, ${pal.shadow[1]}, ${pal.shadow[2]}, 0)`);
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(sx, sy, pf.r * 1.08, 0, TAU);
          ctx.fill();
        }

        // Pass 2: Deep mid-volume body
        for (const pf of puffs) {
          const g = ctx.createRadialGradient(pf.x, pf.y + 2, pf.r * 0.1, pf.x, pf.y + 2, pf.r * 0.98);
          g.addColorStop(0, `rgba(${pal.deepMid[0]}, ${pal.deepMid[1]}, ${pal.deepMid[2]}, ${pal.deepMid[3]})`);
          g.addColorStop(0.72, `rgba(${pal.deepMid[0]}, ${pal.deepMid[1]}, ${pal.deepMid[2]}, ${(pal.deepMid[3] * 0.55).toFixed(3)})`);
          g.addColorStop(1, `rgba(${pal.deepMid[0]}, ${pal.deepMid[1]}, ${pal.deepMid[2]}, 0)`);
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(pf.x, pf.y + 2, pf.r * 0.98, 0, TAU);
          ctx.fill();
        }

        // Pass 3: Soft mid-tone billow transition
        for (const pf of puffs) {
          const mx = pf.x + lx * pf.r * 0.14;
          const my = pf.y + ly * pf.r * 0.16;
          const r = pf.r * 0.88;
          const g = ctx.createRadialGradient(mx, my, r * 0.08, mx, my, r);
          g.addColorStop(0, `rgba(${pal.mid[0]}, ${pal.mid[1]}, ${pal.mid[2]}, ${pal.mid[3]})`);
          g.addColorStop(0.7, `rgba(${pal.mid[0]}, ${pal.mid[1]}, ${pal.mid[2]}, ${(pal.mid[3] * 0.58).toFixed(3)})`);
          g.addColorStop(1, `rgba(${pal.mid[0]}, ${pal.mid[1]}, ${pal.mid[2]}, 0)`);
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(mx, my, r, 0, TAU);
          ctx.fill();
        }

        // Pass 4: Crisp sunlit crown puffs & painter's rim-light
        for (const pf of puffs) {
          const hx = pf.x + lx * pf.r * 0.28;
          const hy = pf.y + ly * pf.r * 0.30;
          const r = pf.r * 0.74;
          const g = ctx.createRadialGradient(hx, hy, r * 0.05, hx, hy, r);
          g.addColorStop(0, `rgba(${pal.lit[0]}, ${pal.lit[1]}, ${pal.lit[2]}, ${pal.lit[3]})`);
          g.addColorStop(0.62, `rgba(${pal.lit[0]}, ${pal.lit[1]}, ${pal.lit[2]}, ${(pal.lit[3] * 0.5).toFixed(3)})`);
          g.addColorStop(1, `rgba(${pal.lit[0]}, ${pal.lit[1]}, ${pal.lit[2]}, 0)`);
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(hx, hy, r, 0, TAU);
          ctx.fill();

          // Organic painterly crescent rim-light on sun-facing upper puffs (tapered, zero hard stroke ends!)
          if (pf.y <= cy + 6) {
            const lightAngle = Math.atan2(ly, lx);
            ctx.save();
            ctx.translate(pf.x + lx * 1.5, pf.y + ly * 1.5);
            ctx.rotate(lightAngle + Math.PI * 0.5);
            const rr = pf.r * 0.79;
            ctx.fillStyle = pal.rim;
            ctx.beginPath();
            ctx.arc(0, 0, rr, Math.PI * 1.08, Math.PI * 1.92, false);
            ctx.arc(0, rr * 0.13, rr * 0.96, Math.PI * 1.90, Math.PI * 1.10, true);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
          }
        }

        ctx.restore();
        list.push({ canvas: c, w: lw, h: lh });
      }
      return list;
    }

    _bakeCloudShadow(scale) {
      const lw = 240;
      const lh = 160;
      const c = createBuffer(lw * scale, lh * scale);
      if (!c) return null;
      const ctx = c.getContext('2d');
      ctx.save();
      ctx.scale(scale, scale);
      const g = ctx.createRadialGradient(lw * 0.5, lh * 0.5, 12, lw * 0.5, lh * 0.5, lw * 0.46);
      g.addColorStop(0, 'rgba(6, 38, 76, 0.28)');
      g.addColorStop(0.58, 'rgba(6, 38, 76, 0.14)');
      g.addColorStop(1, 'rgba(6, 38, 76, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(lw * 0.5, lh * 0.5, lw * 0.46, lh * 0.42, -0.15, 0, TAU);
      ctx.fill();
      ctx.restore();
      return { canvas: c, w: lw, h: lh };
    }

    // Bake 4 intricate miniature tropical coral islands for Chapter 1 ('day')
    // 0: Lighthouse headland island | 1: Windmill meadow island | 2: Crescent emerald atoll | 3: Twin sandbar archipelago
    _bakeDayIslands(scale) {
      const list = [];
      const lw = 280;
      const lh = 280;
      const cx = lw * 0.5;
      const cy = lh * 0.5;

      for (let variant = 0; variant < 4; variant++) {
        const c = createBuffer(lw * scale, lh * scale);
        if (!c) continue;
        const ctx = c.getContext('2d');
        ctx.save();
        ctx.scale(scale, scale);

        const N = 28;
        const reefPts = [];
        const sandPts = [];
        const grassPts = [];

        for (let i = 0; i < N; i++) {
          const ang = (i / N) * TAU;
          const nx = Math.cos(ang) * 1.4 + 3.1;
          const ny = Math.sin(ang) * 1.4 + 3.1;
          let rBase = 62 + fbm2D(nx, ny, 3, variant * 53 + 11) * 34;

          if (variant === 0 && Math.abs(ang - 0.55) < 0.42) {
            // Rocky lighthouse peninsula jutting SE
            rBase += Math.cos((ang - 0.55) / 0.42 * Math.PI * 0.5) * 28;
          } else if (variant === 2 && Math.abs(ang - 2.2) < 0.95) {
            // Crescent cove indentation
            rBase -= Math.cos((ang - 2.2) / 0.95 * Math.PI * 0.5) * 34;
          } else if (variant === 3) {
            rBase *= 0.86 + 0.18 * Math.cos(ang * 2);
          }

          const reefR = rBase + 24 + smoothNoise(nx * 2, ny * 2, variant + 9) * 12;
          reefPts.push({ x: cx + Math.cos(ang) * reefR, y: cy + Math.sin(ang) * reefR });
          sandPts.push({ x: cx + Math.cos(ang) * rBase, y: cy + Math.sin(ang) * rBase });
          grassPts.push({ x: cx + Math.cos(ang) * (rBase * 0.78), y: cy + Math.sin(ang) * (rBase * 0.78) });
        }

        // 1. Outer Turquoise Coral Reef Lagoon Halo
        const reefGrad = ctx.createRadialGradient(cx, cy, 18, cx, cy, 126);
        reefGrad.addColorStop(0, 'rgba(16, 185, 129, 0.72)');
        reefGrad.addColorStop(0.55, 'rgba(45, 212, 191, 0.58)');
        reefGrad.addColorStop(0.84, 'rgba(34, 211, 238, 0.28)');
        reefGrad.addColorStop(1, 'rgba(34, 211, 238, 0)');
        ctx.fillStyle = reefGrad;
        ctx.beginPath();
        ctx.arc(cx, cy, 126, 0, TAU);
        ctx.fill();

        traceClosedCurve(ctx, reefPts);
        ctx.fillStyle = 'rgba(20, 184, 166, 0.46)';
        ctx.fill();

        // Coral reef mottling patches under shallow turquoise water
        ctx.fillStyle = 'rgba(15, 118, 110, 0.28)';
        for (let k = 0; k < 12; k++) {
          const ka = hash2D(k, variant * 19 + 3) * TAU;
          const kr = 56 + hash2D(k, variant * 19 + 7) * 32;
          ctx.beginPath();
          ctx.ellipse(cx + Math.cos(ka) * kr, cy + Math.sin(ka) * kr, 9, 5, ka, 0, TAU);
          ctx.fill();
        }

        // 2. Underwater Island Drop Shadow (SE offset)
        ctx.save();
        ctx.translate(6, 8);
        traceClosedCurve(ctx, sandPts);
        ctx.fillStyle = 'rgba(8, 47, 73, 0.34)';
        ctx.fill();
        ctx.restore();

        // 3. Soft White Shoreline Foam Cushion
        ctx.save();
        ctx.translate(cx - 1, cy - 1);
        ctx.scale(1.04, 1.04);
        ctx.translate(-cx, -cy);
        traceClosedCurve(ctx, sandPts);
        ctx.strokeStyle = 'rgba(240, 253, 250, 0.78)';
        ctx.lineWidth = 4.5;
        ctx.stroke();
        ctx.restore();

        // 4. Warm Golden Sandbar Beach
        traceClosedCurve(ctx, sandPts);
        const sandGrad = ctx.createLinearGradient(cx - 70, cy - 70, cx + 70, cy + 70);
        sandGrad.addColorStop(0, '#fef9c3');
        sandGrad.addColorStop(0.55, '#fde68a');
        sandGrad.addColorStop(1, '#f59e0b');
        ctx.fillStyle = sandGrad;
        ctx.fill();

        // 5. Lush Terraced Forest Canopy (shadow base + layered sunlit tree clusters)
        ctx.save();
        ctx.translate(4, 5);
        traceClosedCurve(ctx, grassPts);
        ctx.fillStyle = '#064e3b';
        ctx.fill();
        ctx.restore();

        traceClosedCurve(ctx, grassPts);
        const forestGrad = ctx.createLinearGradient(cx - 55, cy - 55, cx + 55, cy + 55);
        forestGrad.addColorStop(0, '#4ade80');
        forestGrad.addColorStop(0.5, '#16a34a');
        forestGrad.addColorStop(1, '#14532d');
        ctx.fillStyle = forestGrad;
        ctx.fill();

        // Clustered Ghibli tree crowns & sunlit ridges
        for (let t = 0; t < 24; t++) {
          const h1 = hash2D(t, variant * 41 + 5);
          const h2 = hash2D(t, variant * 41 + 13);
          const h3 = hash2D(t, variant * 41 + 29);
          const ang = h1 * TAU;
          const dist = Math.sqrt(h2) * 42;
          if (variant === 2 && Math.abs(ang - 2.2) < 0.85 && dist > 18) continue;
          const tx = cx + Math.cos(ang) * dist;
          const ty = cy + Math.sin(ang) * dist;
          const tr = 9 + h3 * 13;

          ctx.fillStyle = 'rgba(6, 78, 59, 0.42)';
          ctx.beginPath();
          ctx.arc(tx + 2.5, ty + 3, tr, 0, TAU);
          ctx.fill();

          const tg = ctx.createRadialGradient(tx - tr * 0.32, ty - tr * 0.32, 1, tx, ty, tr);
          tg.addColorStop(0, h3 > 0.6 ? '#bbf7d0' : '#86efac');
          tg.addColorStop(0.55, '#22c55e');
          tg.addColorStop(1, '#15803d');
          ctx.fillStyle = tg;
          ctx.beginPath();
          ctx.arc(tx, ty, tr, 0, TAU);
          ctx.fill();
        }

        // Companion islet for Variant 3
        if (variant === 3) {
          const ix = cx - 64;
          const iy = cy + 54;
          ctx.fillStyle = 'rgba(45, 212, 191, 0.45)';
          ctx.beginPath();
          ctx.arc(ix, iy, 34, 0, TAU);
          ctx.fill();
          ctx.fillStyle = '#fde68a';
          ctx.beginPath();
          ctx.ellipse(ix, iy, 22, 17, 0.4, 0, TAU);
          ctx.fill();
          ctx.fillStyle = '#22c55e';
          ctx.beginPath();
          ctx.ellipse(ix - 1, iy - 1, 14, 11, 0.4, 0, TAU);
          ctx.fill();
        }

        // 6. Signature Miniature Landmarks!
        let windmillHub = null;
        if (variant === 0) {
          // Cape grey rock + miniature white & red Lighthouse + wooden pier
          const lx = cx + Math.cos(0.55) * 76;
          const ly = cy + Math.sin(0.55) * 76;
          ctx.fillStyle = '#64748b';
          ctx.beginPath();
          ctx.arc(lx, ly, 10, 0, TAU);
          ctx.fill();
          ctx.fillStyle = '#94a3b8';
          ctx.beginPath();
          ctx.arc(lx - 2, ly - 2, 7, 0, TAU);
          ctx.fill();
          // Cast shadow of lighthouse tower
          ctx.strokeStyle = 'rgba(15, 23, 42, 0.38)';
          ctx.lineWidth = 5;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(lx, ly);
          ctx.lineTo(lx + 12, ly + 11);
          ctx.stroke();
          // White lighthouse tower & red lantern dome
          ctx.fillStyle = '#f8fafc';
          ctx.beginPath();
          ctx.arc(lx, ly, 5.5, 0, TAU);
          ctx.fill();
          ctx.fillStyle = '#ef4444';
          ctx.beginPath();
          ctx.arc(lx - 0.8, ly - 0.8, 3.2, 0, TAU);
          ctx.fill();
          // Tiny wooden pier on calm NW side
          ctx.strokeStyle = '#92400e';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(cx - 48, cy - 36);
          ctx.lineTo(cx - 64, cy - 48);
          ctx.stroke();
        } else if (variant === 1) {
          // Meadow hilltop + miniature white Windmill tower (blades rotate live in render!)
          const wx = cx + 14;
          const wy = cy - 12;
          ctx.fillStyle = '#86efac';
          ctx.beginPath();
          ctx.arc(wx, wy, 15, 0, TAU);
          ctx.fill();
          ctx.fillStyle = 'rgba(15, 23, 42, 0.32)';
          ctx.beginPath();
          ctx.ellipse(wx + 5, wy + 5, 7, 5, 0.5, 0, TAU);
          ctx.fill();
          ctx.fillStyle = '#f8fafc';
          ctx.beginPath();
          ctx.arc(wx, wy, 5.8, 0, TAU);
          ctx.fill();
          ctx.fillStyle = '#d97706';
          ctx.beginPath();
          ctx.arc(wx - 0.8, wy - 0.8, 2.8, 0, TAU);
          ctx.fill();
          windmillHub = { x: wx - cx, y: wy - cy };
        } else if (variant === 2) {
          // Tiny white sailboat anchored inside the emerald crescent lagoon
          const bx = cx - 34;
          const by = cy + 36;
          ctx.fillStyle = 'rgba(15, 23, 42, 0.25)';
          ctx.beginPath();
          ctx.ellipse(bx + 2, by + 2, 5.5, 2.2, -0.5, 0, TAU);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.ellipse(bx, by, 5.5, 2.1, -0.5, 0, TAU);
          ctx.fill();
        }

        ctx.restore();
        list.push({
          canvas: c,
          w: lw,
          h: lh,
          coastPts: sandPts.map((p) => ({ dx: p.x - cx, dy: p.y - cy })),
          windmillHub
        });
      }
      return list;
    }

    // Bake 4 steep floating basalt sky-spires for Chapter 2 ('sunset')
    // Rim-lit golden ridges, dark violet-umber silhouettes, golden waterfalls & warm cliff lights
    _bakeSunsetIslands(scale) {
      const list = [];
      const lw = 280;
      const lh = 310;
      const cx = lw * 0.5;
      const cy = lh * 0.48;

      for (let variant = 0; variant < 4; variant++) {
        const c = createBuffer(lw * scale, lh * scale);
        if (!c) continue;
        const ctx = c.getContext('2d');
        ctx.save();
        ctx.scale(scale, scale);

        // Warm misty updraft glow beneath floating island
        const mist = ctx.createRadialGradient(cx, cy + 40, 10, cx, cy + 40, 105);
        mist.addColorStop(0, 'rgba(251, 146, 60, 0.30)');
        mist.addColorStop(0.55, 'rgba(157, 23, 77, 0.16)');
        mist.addColorStop(1, 'rgba(88, 28, 135, 0)');
        ctx.fillStyle = mist;
        ctx.fillRect(0, 0, lw, lh);

        const mainW = 64 + (variant % 2) * 14;
        const topY = cy - 62;
        const botY = cy + 92;

        // Tapered inverted basalt spire silhouette
        ctx.beginPath();
        ctx.moveTo(cx - mainW * 0.85, cy - 22);
        ctx.lineTo(cx - mainW * 0.52, topY + 12);
        ctx.lineTo(cx - mainW * 0.12, topY - 8);
        ctx.lineTo(cx + mainW * 0.44, topY + 6);
        ctx.lineTo(cx + mainW * 0.88, cy - 16);
        ctx.lineTo(cx + mainW * 0.56, cy + 32);
        ctx.lineTo(cx + mainW * 0.16, botY - 14);
        ctx.lineTo(cx - mainW * 0.04, botY);
        ctx.lineTo(cx - mainW * 0.32, cy + 46);
        ctx.lineTo(cx - mainW * 0.68, cy + 16);
        ctx.closePath();

        const rockGrad = ctx.createLinearGradient(cx, topY, cx, botY);
        rockGrad.addColorStop(0, '#4c1d4b');
        rockGrad.addColorStop(0.38, '#2b1237');
        rockGrad.addColorStop(1, '#160921');
        ctx.fillStyle = rockGrad;
        ctx.fill();

        // Sunlit top plateau & angular columnar basalt facets
        ctx.beginPath();
        ctx.moveTo(cx - mainW * 0.85, cy - 22);
        ctx.lineTo(cx - mainW * 0.52, topY + 12);
        ctx.lineTo(cx - mainW * 0.12, topY - 8);
        ctx.lineTo(cx + mainW * 0.44, topY + 6);
        ctx.lineTo(cx + mainW * 0.88, cy - 16);
        ctx.lineTo(cx + mainW * 0.25, cy - 4);
        ctx.lineTo(cx - mainW * 0.28, cy - 8);
        ctx.closePath();
        const topGrad = ctx.createLinearGradient(cx, topY - 10, cx, cy);
        topGrad.addColorStop(0, '#f59e0b');
        topGrad.addColorStop(0.45, '#b45309');
        topGrad.addColorStop(1, '#581c45');
        ctx.fillStyle = topGrad;
        ctx.fill();

        // Left sun-kissed cliff facet
        ctx.fillStyle = 'rgba(217, 119, 6, 0.36)';
        ctx.beginPath();
        ctx.moveTo(cx - mainW * 0.52, topY + 12);
        ctx.lineTo(cx - mainW * 0.12, topY - 8);
        ctx.lineTo(cx - mainW * 0.06, cy + 42);
        ctx.lineTo(cx - mainW * 0.32, cy + 46);
        ctx.closePath();
        ctx.fill();

        // Molten gold rim-light along upper sunlit crest
        ctx.strokeStyle = '#fde047';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(cx - mainW * 0.83, cy - 21);
        ctx.lineTo(cx - mainW * 0.52, topY + 12);
        ctx.lineTo(cx - mainW * 0.12, topY - 8);
        ctx.lineTo(cx + mainW * 0.44, topY + 6);
        ctx.lineTo(cx + mainW * 0.86, cy - 15);
        ctx.stroke();

        // Smaller floating satellite rock shards around the spire
        for (let s = 0; s < 4; s++) {
          const sx = cx + (s % 2 === 0 ? -1 : 1) * (mainW * 0.72 + s * 10);
          const sy = cy + 28 + s * 18;
          const sw = 8 + (s % 2) * 5;
          ctx.fillStyle = '#240f30';
          ctx.beginPath();
          ctx.moveTo(sx - sw, sy);
          ctx.lineTo(sx, sy - sw * 0.9);
          ctx.lineTo(sx + sw, sy - 2);
          ctx.lineTo(sx + 1, sy + sw * 1.5);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = 'rgba(251, 191, 36, 0.75)';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(sx - sw, sy);
          ctx.lineTo(sx, sy - sw * 0.9);
          ctx.lineTo(sx + sw, sy - 2);
          ctx.stroke();
        }

        // Variant details: Golden waterfall OR miniature warm cliff monastery windows
        if (variant === 0 || variant === 2) {
          const fx = cx + (variant === 0 ? 10 : -12);
          const fy0 = cy - 8;
          const fy1 = botY + 24;
          const wg = ctx.createLinearGradient(fx, fy0, fx, fy1);
          wg.addColorStop(0, '#fef9c3');
          wg.addColorStop(0.35, 'rgba(251, 191, 36, 0.88)');
          wg.addColorStop(0.75, 'rgba(249, 115, 22, 0.45)');
          wg.addColorStop(1, 'rgba(249, 115, 22, 0)');
          ctx.fillStyle = wg;
          ctx.fillRect(fx - 2.5, fy0, 5, fy1 - fy0);

          const spray = ctx.createRadialGradient(fx, fy0 + 56, 2, fx, fy0 + 56, 22);
          spray.addColorStop(0, 'rgba(254, 240, 138, 0.55)');
          spray.addColorStop(1, 'rgba(251, 146, 60, 0)');
          ctx.fillStyle = spray;
          ctx.beginPath();
          ctx.arc(fx, fy0 + 56, 22, 0, TAU);
          ctx.fill();
        } else {
          // Tiny warm architectural cliff-watch silhouette & square window slits (not round dots!)
          const tx = cx - 6;
          const ty = topY - 16;
          ctx.fillStyle = '#240f30';
          ctx.fillRect(tx - 7, ty, 14, 14);
          ctx.beginPath();
          ctx.moveTo(tx - 10, ty);
          ctx.lineTo(tx, ty - 9);
          ctx.lineTo(tx + 10, ty);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = 'rgba(253, 224, 71, 0.85)';
          ctx.fillRect(tx - 3, ty + 4, 2.2, 4.2);
          ctx.fillRect(tx + 1.5, ty + 4, 2.2, 4.2);
          ctx.fillRect(cx + 8, cy + 6, 2.2, 3.8);
        }

        ctx.restore();
        list.push({ canvas: c, w: lw, h: lh });
      }
      return list;
    }

    _bakeStormAnvils(scale) {
      const list = [];
      for (let k = 0; k < 2; k++) {
        const lw = 380;
        const lh = 200;
        const c = createBuffer(lw * scale, lh * scale);
        if (!c) continue;
        const ctx = c.getContext('2d');
        ctx.save();
        ctx.scale(scale, scale);

        for (let p = 0; p < 16; p++) {
          const t = (p / 15) * 2 - 1;
          const px = lw * 0.5 + t * 125 + (hash2D(p, k * 23) - 0.5) * 22;
          const py = lh * 0.55 + (t * t) * 18 + (hash2D(p, k * 47) - 0.5) * 20;
          const r = 34 + hash2D(p, k * 71) * 28;
          const g = ctx.createRadialGradient(px, py - r * 0.25, r * 0.1, px, py, r);
          g.addColorStop(0, 'rgba(76, 29, 95, 0.72)');
          g.addColorStop(0.65, 'rgba(38, 16, 56, 0.52)');
          g.addColorStop(1, 'rgba(30, 12, 46, 0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(px, py, r, 0, TAU);
          ctx.fill();
        }

        ctx.restore();
        list.push({ canvas: c, w: lw, h: lh });
      }
      return list;
    }

    // Bake 4 large fluid cosmic nebulae (teal, violet, magenta interwoven) for Chapter 3 ('night')
    _bakeNightNebulae(scale) {
      const configs = [
        [
          { dx: -40, dy: -25, r: 155, rgb: '20, 184, 166', a: 0.28 },
          { dx: 45, dy: 20, r: 145, rgb: '124, 58, 237', a: 0.26 },
          { dx: 5, dy: -5, r: 110, rgb: '56, 189, 248', a: 0.22 }
        ],
        [
          { dx: -30, dy: 25, r: 160, rgb: '109, 40, 217', a: 0.30 },
          { dx: 40, dy: -30, r: 140, rgb: '219, 39, 119', a: 0.22 },
          { dx: -5, dy: 0, r: 115, rgb: '167, 139, 250', a: 0.20 }
        ],
        [
          { dx: 35, dy: 30, r: 155, rgb: '13, 148, 136', a: 0.28 },
          { dx: -45, dy: -20, r: 145, rgb: '59, 130, 246', a: 0.24 },
          { dx: 10, dy: -25, r: 105, rgb: '236, 72, 153', a: 0.18 }
        ],
        [
          { dx: -25, dy: -35, r: 150, rgb: '190, 24, 93', a: 0.22 },
          { dx: 35, dy: 25, r: 155, rgb: '79, 70, 229', a: 0.28 },
          { dx: 0, dy: 10, r: 120, rgb: '45, 212, 191', a: 0.22 }
        ]
      ];

      const list = [];
      const size = 400;
      const half = size * 0.5;

      for (let i = 0; i < configs.length; i++) {
        const c = createBuffer(size * scale * 0.75, size * scale * 0.75);
        if (!c) continue;
        const ctx = c.getContext('2d');
        ctx.save();
        ctx.scale(scale * 0.75, scale * 0.75);

        ctx.globalCompositeOperation = 'lighter';
        for (const lobe of configs[i]) {
          for (let sub = 0; sub < 5; sub++) {
            const ox = lobe.dx + (hash2D(sub, i * 19 + 3) - 0.5) * 75;
            const oy = lobe.dy + (hash2D(sub, i * 19 + 11) - 0.5) * 75;
            const r = lobe.r * (0.65 + hash2D(sub, i * 19 + 29) * 0.45);
            const g = ctx.createRadialGradient(half + ox, half + oy, r * 0.05, half + ox, half + oy, r);
            g.addColorStop(0, `rgba(${lobe.rgb}, ${(lobe.a * 0.62).toFixed(3)})`);
            g.addColorStop(0.5, `rgba(${lobe.rgb}, ${(lobe.a * 0.32).toFixed(3)})`);
            g.addColorStop(1, `rgba(${lobe.rgb}, 0)`);
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.ellipse(half + ox, half + oy, r, r * 0.76, (i + sub) * 0.7, 0, TAU);
            ctx.fill();
          }
        }

        // Carve subtle cosmic dust lane for depth
        ctx.globalCompositeOperation = 'destination-out';
        const dust = ctx.createLinearGradient(half - 110, half - 40, half + 110, half + 40);
        dust.addColorStop(0, 'rgba(0,0,0,0)');
        dust.addColorStop(0.5, 'rgba(0,0,0,0.28)');
        dust.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = dust;
        ctx.beginPath();
        ctx.ellipse(half, half + 12, 135, 26, -0.35 + i * 0.5, 0, TAU);
        ctx.fill();

        ctx.restore();
        list.push({ canvas: c, w: size, h: size });
      }
      return list;
    }

    // Bake 4 glowing starlight crystal floating islands for Chapter 3 ('night')
    _bakeNightIslands(scale) {
      const list = [];
      const lw = 260;
      const lh = 280;
      const cx = lw * 0.5;
      const cy = lh * 0.5;

      for (let variant = 0; variant < 4; variant++) {
        const c = createBuffer(lw * scale, lh * scale);
        if (!c) continue;
        const ctx = c.getContext('2d');
        ctx.save();
        ctx.scale(scale, scale);

        const isViolet = variant % 2 === 1;
        const glowRgb = isViolet ? '167, 139, 250' : '45, 212, 191';

        // Ambient astral aura
        const aura = ctx.createRadialGradient(cx, cy - 8, 8, cx, cy - 8, 96);
        aura.addColorStop(0, `rgba(${glowRgb}, 0.34)`);
        aura.addColorStop(0.55, `rgba(${glowRgb}, 0.12)`);
        aura.addColorStop(1, `rgba(${glowRgb}, 0)`);
        ctx.fillStyle = aura;
        ctx.fillRect(0, 0, lw, lh);

        // Tilted orbital stone ring (back half)
        ctx.strokeStyle = `rgba(${glowRgb}, 0.35)`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy + 4, 78, 22, -0.18, Math.PI, TAU);
        ctx.stroke();

        // Obsidian floating rock base
        const rw = 54 + (variant % 2) * 10;
        ctx.beginPath();
        ctx.moveTo(cx - rw, cy - 6);
        ctx.lineTo(cx - rw * 0.55, cy - 28);
        ctx.lineTo(cx + rw * 0.48, cy - 26);
        ctx.lineTo(cx + rw, cy - 4);
        ctx.lineTo(cx + rw * 0.42, cy + 38);
        ctx.lineTo(cx + 4, cy + 72);
        ctx.lineTo(cx - rw * 0.38, cy + 36);
        ctx.closePath();
        const baseG = ctx.createLinearGradient(cx, cy - 28, cx, cy + 72);
        baseG.addColorStop(0, '#1e3a5f');
        baseG.addColorStop(0.45, '#0f213d');
        baseG.addColorStop(1, '#060d1f');
        ctx.fillStyle = baseG;
        ctx.fill();
        ctx.strokeStyle = `rgba(${glowRgb}, 0.55)`;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Luminous hexagonal crystal spires sprouting from the rock
        const spires = [
          { dx: -16, dy: -16, w: 9, h: 38, tilt: -0.22 },
          { dx: 14, dy: -14, w: 8, h: 32, tilt: 0.25 },
          { dx: 0, dy: -20, w: 12, h: 52, tilt: 0.04 }
        ];
        for (const sp of spires) {
          ctx.save();
          ctx.translate(cx + sp.dx, cy + sp.dy);
          ctx.rotate(sp.tilt);
          const cg = ctx.createLinearGradient(0, -sp.h, 0, 8);
          if (isViolet) {
            cg.addColorStop(0, '#f5f3ff');
            cg.addColorStop(0.35, '#c4b5fd');
            cg.addColorStop(1, '#6d28d9');
          } else {
            cg.addColorStop(0, '#f0fdfa');
            cg.addColorStop(0.35, '#5eead4');
            cg.addColorStop(1, '#0f766e');
          }
          ctx.fillStyle = cg;
          ctx.beginPath();
          ctx.moveTo(0, -sp.h);
          ctx.lineTo(sp.w, -sp.h * 0.62);
          ctx.lineTo(sp.w * 0.78, 8);
          ctx.lineTo(-sp.w * 0.78, 8);
          ctx.lineTo(-sp.w, -sp.h * 0.62);
          ctx.closePath();
          ctx.fill();

          // Central crystal facet ridge
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.72)';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(0, -sp.h);
          ctx.lineTo(0, 6);
          ctx.stroke();
          ctx.restore();
        }

        // Front half of orbital stardust ring
        ctx.strokeStyle = `rgba(${glowRgb}, 0.62)`;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.ellipse(cx, cy + 4, 78, 22, -0.18, 0, Math.PI);
        ctx.stroke();

        ctx.restore();
        list.push({ canvas: c, w: lw, h: lh });
      }
      return list;
    }

    // =========================================================================
    // REAL-TIME LAYERED RENDERING PIPELINE
    // =========================================================================

    _computeCorridor(W, H, anchorX, anchorY, scrollDist, corridorOffset) {
      const narrow = W < 600;
      const amp1 = narrow ? W * 0.05 : Math.min(W * 0.13, 150);
      const amp2 = narrow ? W * 0.02 : Math.min(W * 0.05, 50);
      const hw = narrow ? W * 0.42 : clamp(W * 0.30, 140, 330);
      const off = clamp(corridorOffset, -hw * 0.35, hw * 0.35);

      const lyAt = (sy) => (sy - anchorY) - scrollDist * LANE_PF;
      const curve = (ly) => amp1 * Math.sin(ly * 0.0011) + amp2 * Math.sin(ly * 0.0027 + 1.3);
      const cxAt = (sy) => anchorX + off + curve(lyAt(sy));

      return {
        W,
        H,
        anchorX,
        anchorY,
        hw,
        lyAt,
        cxAt,
        // Returns 1 on Title (full lush beauty everywhere, keeping 75% helipad crystal clear & scenic)
        // and fades busy mid-lane shapes during active combat according to calm.veil!
        mask(sx, sy, combatWeight) {
          if (combatWeight <= 0.001) return 1;
          const raw = clamp((Math.abs(sx - cxAt(sy)) - hw * 0.44) / (hw * 0.58), 0.14, 1);
          return lerp(1, raw, combatWeight);
        }
      };
    }

    render(ctx, params = {}) {
      if (!ctx) return;

      const W = Math.max(320, Number(params.W) || this.width || 1280);
      const H = Math.max(320, Number(params.H) || this.height || 800);
      if (!this._sprites || W !== this.width || H !== this.height) {
        this.resize(W, H, this.dpr || 1);
      }

      const sky = ['day', 'sunset', 'night'].includes(params.sky) ? params.sky : 'day';
      const phase = params.phase || 'playing';
      const onTitle = phase === 'title';
      const t = typeof params.time === 'number' ? params.time : this.time;
      const scrollDist = typeof params.scrollDist === 'number' ? params.scrollDist : this._scrollDist;
      const worldOffsetX = typeof params.worldOffsetX === 'number' ? params.worldOffsetX : this._worldOffsetX;
      const bankAngle = Number(params.bankAngle) || 0;
      const anchorX = typeof params.anchorX === 'number' ? params.anchorX : W * 0.5;
      const anchorY = typeof params.anchorY === 'number' ? params.anchorY : H * 0.75;
      const bossActive = Boolean(params.bossActive);
      const bossEnraged = Boolean(params.bossEnraged);

      const fallbackCalm = onTitle ? DEFAULT_CALM_TITLE : DEFAULT_CALM_PLAYING;
      const rawCalm = params.calm || this._calm || fallbackCalm;
      const calm = {
        veil: onTitle ? 0 : clamp(rawCalm.veil !== undefined ? Number(rawCalm.veil) : fallbackCalm.veil, 0, 0.9),
        cloud: clamp(rawCalm.cloud !== undefined ? Number(rawCalm.cloud) : fallbackCalm.cloud, 0, 1),
        sun: clamp(rawCalm.sun !== undefined ? Number(rawCalm.sun) : fallbackCalm.sun, 0, 1),
        lines: clamp(rawCalm.lines !== undefined ? Number(rawCalm.lines) : fallbackCalm.lines, 0, 1)
      };

      const combatWeight = onTitle ? 0 : clamp(calm.veil / 0.3, 0, 1);
      const corridorOff = typeof params.corridorOffset === 'number' ? params.corridorOffset : this._corridorOffset;
      const lane = this._computeCorridor(W, H, anchorX, anchorY, scrollDist, corridorOff);

      ctx.save();

      // 1. Sky Backdrop (tilts subtly with camera roll so horizon feels alive)
      this._renderBackdrop(ctx, W, H, anchorX, anchorY, bankAngle, sky);

      // 2. High-altitude Celestial & Atmospheric Layer (Sunbeams / Sunset Disc & Storm Anvils / Nebulae, Aurora & Lighthouse)
      this._renderCelestialLayer(ctx, W, H, sky, t, scrollDist, worldOffsetX, bankAngle, calm, bossActive, bossEnraged);

      // 3. 2.5D Rotated World Space: Ocean Currents / Islands / Cloud Shadows / Multi-layer Volumetric Clouds
      ctx.save();
      if (Math.abs(bankAngle) > 0.0005) {
        ctx.translate(anchorX, anchorY);
        ctx.rotate(bankAngle);
        ctx.translate(-anchorX, -anchorY);
      }

      if (sky === 'day') {
        this._renderDayOceanDetails(ctx, W, H, anchorX, anchorY, scrollDist, worldOffsetX, t, calm);
      }

      // Terrain & Islands layer (parallax 0.40)
      this._renderIslandsLayer(ctx, W, H, anchorX, anchorY, scrollDist, worldOffsetX, sky, t, calm, lane, combatWeight);

      // Day seabird V-formations gliding above the islands
      if (sky === 'day' && this._birdFlocks.length > 0) {
        this._renderBirdFlocks(ctx, t, calm);
      }

      // Mid-altitude Volumetric Clouds (parallax 0.76)
      this._renderVolumetricCloudLayer(ctx, W, H, anchorX, anchorY, scrollDist, worldOffsetX, sky, calm, lane, combatWeight, {
        parallax: 0.76,
        cell: 330,
        threshold: 0.56,
        scaleMin: 0.62,
        scaleMax: 1.05,
        alpha: sky === 'night' ? 0.42 : 0.62,
        seed: 71
      });

      // High-altitude Volumetric Clouds (parallax 1.18)
      this._renderVolumetricCloudLayer(ctx, W, H, anchorX, anchorY, scrollDist, worldOffsetX, sky, calm, lane, combatWeight, {
        parallax: 1.18,
        cell: 360,
        threshold: 0.62,
        scaleMin: 0.78,
        scaleMax: 1.24,
        alpha: sky === 'night' ? 0.52 : 0.82,
        seed: 193
      });

      // 4. Winding Volumetric Canyon Corridor Walls (frames the flight lane cleanly)
      this._renderCorridorWalls(ctx, sky, calm, lane, onTitle);

      // 5. Gentle Airflow Streaks & Soft Atmospheric Wisps (strictly non-bullet-like!)
      this._renderAtmosphericWisps(ctx, W, H, anchorX, anchorY, scrollDist, worldOffsetX, sky, t, calm);

      ctx.restore();

      // 6. Combat Readability Veil Wash & Soft Center Contrast Pocket
      if (calm.veil > 0.004) {
        const rgb = VEIL_RGB[sky] || VEIL_RGB.day;
        ctx.fillStyle = `rgba(${rgb}, ${calm.veil.toFixed(3)})`;
        ctx.fillRect(-16, -16, W + 32, H + 32);

        // Subtle calm velvet pocket along the active flight lane so bullets & XP gems pop crisply
        const cxMid = lane.cxAt(anchorY);
        const lanePocket = ctx.createLinearGradient(cxMid - lane.hw * 1.15, 0, cxMid + lane.hw * 1.15, 0);
        const midA = clamp(calm.veil * 0.24, 0, 0.16);
        lanePocket.addColorStop(0, `rgba(${rgb}, 0)`);
        lanePocket.addColorStop(0.35, `rgba(${rgb}, ${midA.toFixed(3)})`);
        lanePocket.addColorStop(0.65, `rgba(${rgb}, ${midA.toFixed(3)})`);
        lanePocket.addColorStop(1, `rgba(${rgb}, 0)`);
        ctx.fillStyle = lanePocket;
        ctx.fillRect(0, 0, W, H);
      }

      ctx.restore();
    }

    _renderBackdrop(ctx, W, H, anchorX, anchorY, bankAngle, sky) {
      const bd = this._backdrops && this._backdrops[sky];
      if (bd && this._backdrops.diag) {
        const diag = this._backdrops.diag;
        ctx.save();
        ctx.translate(W * 0.5, H * 0.5);
        ctx.rotate(bankAngle * 0.65);
        ctx.drawImage(bd, -diag * 0.5, -diag * 0.5, diag, diag);
        ctx.restore();
      } else {
        ctx.fillStyle = sky === 'day' ? '#0ea5e9' : (sky === 'sunset' ? '#7c2d12' : '#061126');
        ctx.fillRect(0, 0, W, H);
      }
    }

    _renderCelestialLayer(ctx, W, H, sky, t, scrollDist, worldOffsetX, bankAngle, calm, bossActive, bossEnraged) {
      ctx.save();
      if (Math.abs(bankAngle) > 0.0005) {
        ctx.translate(W * 0.5, H * 0.5);
        ctx.rotate(bankAngle * 0.55);
        ctx.translate(-W * 0.5, -H * 0.5);
      }
      const bleedX = W * 0.3;
      const bleedY = H * 0.3;

      if (sky === 'day') {
        // Soft sunlit source in upper-left sky + Ghibli/Shinkai crepuscular sunbeams + ocean sun glint
        const sunX = W * 0.20 - clamp(worldOffsetX * 0.025, -80, 80);
        const sunY = -H * 0.04;
        const sunVis = 0.25 + calm.sun * 0.75;

        ctx.save();
        ctx.globalAlpha = calm.sun;
        const halo = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, Math.max(W, H) * 0.52);
        halo.addColorStop(0, 'rgba(255, 253, 240, 0.82)');
        halo.addColorStop(0.18, 'rgba(254, 243, 199, 0.38)');
        halo.addColorStop(0.55, 'rgba(186, 230, 253, 0.12)');
        halo.addColorStop(1, 'rgba(56, 189, 248, 0)');
        ctx.fillStyle = halo;
        ctx.fillRect(-bleedX, -bleedY, W + bleedX * 2, H + bleedY * 2);

        // Crepuscular Tyndall Sunbeams (diagonal soft light shafts)
        const rays = [
          { ang: 0.52, spread: 0.065, len: 1.05, a: 0.16, ph: 0.2 },
          { ang: 0.68, spread: 0.095, len: 1.18, a: 0.20, ph: 1.4 },
          { ang: 0.86, spread: 0.055, len: 0.96, a: 0.14, ph: 2.7 },
          { ang: 1.04, spread: 0.080, len: 1.12, a: 0.17, ph: 4.1 },
          { ang: 1.22, spread: 0.050, len: 0.88, a: 0.11, ph: 5.3 }
        ];
        const maxR = Math.hypot(W, H);
        for (const r of rays) {
          const sway = Math.sin(t * 0.35 + r.ph) * 0.022;
          const a0 = r.ang + sway - r.spread;
          const a1 = r.ang + sway + r.spread;
          const dist = maxR * r.len;
          const breathe = 0.78 + 0.22 * Math.sin(t * 0.6 + r.ph);
          const rg = ctx.createLinearGradient(
            sunX,
            sunY,
            sunX + Math.cos(r.ang) * dist * 0.85,
            sunY + Math.sin(r.ang) * dist * 0.85
          );
          rg.addColorStop(0, `rgba(255, 253, 235, ${(r.a * breathe).toFixed(3)})`);
          rg.addColorStop(0.45, `rgba(254, 249, 195, ${(r.a * 0.45 * breathe).toFixed(3)})`);
          rg.addColorStop(1, 'rgba(255, 255, 255, 0)');
          ctx.fillStyle = rg;
          ctx.beginPath();
          ctx.moveTo(sunX, sunY);
          ctx.lineTo(sunX + Math.cos(a0) * dist, sunY + Math.sin(a0) * dist);
          ctx.lineTo(sunX + Math.cos(a1) * dist, sunY + Math.sin(a1) * dist);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();

        // Sparkling horizontal ocean sun-glint path (wide flat shimmer ribbons, never round dots)
        ctx.save();
        ctx.globalAlpha = calm.sun * 0.72 * sunVis;
        const glintCenterX = sunX + W * 0.12;
        for (let i = 0; i < 18; i++) {
          const rowRatio = (i + mod(scrollDist * 0.0025, 1)) / 18;
          const gy = H * (0.08 + rowRatio * 0.56);
          const wave = Math.sin(t * 2.1 + i * 1.7);
          const gw = (18 + (1 - rowRatio) * 46) * (0.65 + 0.35 * wave);
          const gx = glintCenterX + Math.sin(i * 2.9 + t * 0.8) * (24 + rowRatio * 55) + rowRatio * W * 0.08;
          ctx.fillStyle = i % 3 === 0 ? 'rgba(255, 253, 232, 0.48)' : 'rgba(186, 230, 253, 0.36)';
          ctx.beginPath();
          ctx.ellipse(gx, gy, gw, 1.3 + (1 - rowRatio) * 1.1, 0, 0, TAU);
          ctx.fill();
        }
        ctx.restore();
      } else if (sky === 'sunset') {
        // Grand Molten Setting Sun Disc + Dusk Cloud-Sea Shimmer + Distant Storm Anvils with Subsurface Lightning
        const sx = W * 0.5 - clamp(worldOffsetX * 0.03, -90, 90) - bankAngle * 90;
        const sy = H * 0.14;

        ctx.save();
        ctx.globalAlpha = 0.22 + calm.sun * 0.78;
        const sunR = Math.min(W, H) * 0.078;
        const corona = ctx.createRadialGradient(sx, sy, sunR * 0.2, sx, sy, Math.max(W, H) * 0.52);
        corona.addColorStop(0, 'rgba(255, 251, 235, 0.90)');
        corona.addColorStop(0.14, 'rgba(253, 224, 71, 0.56)');
        corona.addColorStop(0.36, 'rgba(249, 115, 22, 0.24)');
        corona.addColorStop(1, 'rgba(154, 52, 18, 0)');
        ctx.fillStyle = corona;
        ctx.fillRect(-bleedX, -bleedY, W + bleedX * 2, H + bleedY * 2);

        // Layered molten sun disc
        const discG = ctx.createLinearGradient(sx, sy - sunR, sx, sy + sunR);
        discG.addColorStop(0, '#fffbeb');
        discG.addColorStop(0.52, '#fde047');
        discG.addColorStop(1, '#fb923c');
        ctx.fillStyle = discG;
        ctx.beginPath();
        ctx.arc(sx, sy, sunR, 0, TAU);
        ctx.fill();

        // Thin crimson dusk haze bands slicing gently across the lower sun disc
        ctx.fillStyle = 'rgba(124, 29, 79, 0.34)';
        ctx.fillRect(sx - sunR * 1.3, sy + sunR * 0.26, sunR * 2.6, 3.5);
        ctx.fillRect(sx - sunR * 1.1, sy + sunR * 0.56, sunR * 2.2, 5);

        // Golden reflection ripples across the dusk cloud sea
        for (let i = 0; i < 9; i++) {
          const ry = sy + sunR * 1.25 + i * (H * 0.032);
          const rw = sunR * (1.5 - i * 0.11) * (0.85 + 0.15 * Math.sin(t * 1.6 + i));
          if (rw <= 4) continue;
          ctx.fillStyle = `rgba(254, 240, 138, ${(0.34 - i * 0.032).toFixed(3)})`;
          ctx.beginPath();
          ctx.ellipse(sx + Math.sin(t + i * 1.3) * 10, ry, rw, 2.2, 0, 0, TAU);
          ctx.fill();
        }
        ctx.restore();

        // Distant Storm Anvil Clouds & Subsurface Internal Cloud Lightning
        const anvils = this._sprites && this._sprites.stormAnvils;
        if (anvils && anvils.length > 0) {
          ctx.save();
          ctx.globalAlpha = 0.45 + calm.cloud * 0.55;
          for (let i = 0; i < 4; i++) {
            const spr = anvils[i % anvils.length];
            const ax = mod(i * (W * 0.34) - worldOffsetX * 0.06, W + 360) - 180;
            const ay = H * (0.06 + (i % 2) * 0.09) + Math.sin(t * 0.25 + i) * 6;
            ctx.drawImage(spr.canvas, ax - spr.w * 0.5, ay - spr.h * 0.4, spr.w, spr.h);
          }
          ctx.restore();
        }

        // Subsurface lightning glowing inside distant thunderheads (never harsh full-screen whiteout!)
        const extraPulse = bossEnraged ? (0.35 + 0.35 * Math.max(0, Math.sin(t * 7.3) * Math.sin(t * 19.1))) : 0;
        if (this._cloudFlashes.length > 0 || extraPulse > 0.28) {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          for (const cf of this._cloudFlashes) {
            const u = cf.life / cf.duration;
            const envelope = Math.sin(u * Math.PI) * (0.55 + 0.45 * Math.abs(Math.sin(cf.life * 42 + cf.seed)));
            const alpha = envelope * (0.28 + calm.cloud * 0.48);
            if (alpha <= 0.01) continue;
            const fx = cf.nx * W - clamp(worldOffsetX * 0.05, -60, 60);
            const fy = cf.ny * H;
            const lg = ctx.createRadialGradient(fx, fy, 4, fx, fy, cf.radius);
            lg.addColorStop(0, `rgba(254, 243, 199, ${alpha.toFixed(3)})`);
            lg.addColorStop(0.38, `rgba(196, 181, 253, ${(alpha * 0.62).toFixed(3)})`);
            lg.addColorStop(0.72, `rgba(249, 115, 22, ${(alpha * 0.25).toFixed(3)})`);
            lg.addColorStop(1, 'rgba(124, 58, 237, 0)');
            ctx.fillStyle = lg;
            ctx.beginPath();
            ctx.arc(fx, fy, cf.radius, 0, TAU);
            ctx.fill();

            // Soft branched vein hidden inside the cloud belly
            ctx.strokeStyle = `rgba(255, 251, 235, ${(alpha * 0.55).toFixed(3)})`;
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            let vx = fx - 18;
            let vy = fy - 14;
            ctx.moveTo(vx, vy);
            for (let seg = 1; seg <= 4; seg++) {
              vx += 9 + (hash2D(seg, cf.seed) - 0.5) * 14;
              vy += 7 + hash2D(seg + 9, cf.seed) * 8;
              ctx.lineTo(vx, vy);
            }
            ctx.stroke();
          }

          if (extraPulse > 0.28 && bossActive) {
            const bx = W * (0.25 + 0.5 * hash1D(Math.floor(t * 3)));
            const by = H * 0.14;
            const bg = ctx.createRadialGradient(bx, by, 4, bx, by, 140);
            const ba = (extraPulse - 0.28) * (0.25 + calm.cloud * 0.4);
            bg.addColorStop(0, `rgba(253, 224, 71, ${ba.toFixed(3)})`);
            bg.addColorStop(0.5, `rgba(167, 139, 250, ${(ba * 0.5).toFixed(3)})`);
            bg.addColorStop(1, 'rgba(88, 28, 135, 0)');
            ctx.fillStyle = bg;
            ctx.beginPath();
            ctx.arc(bx, by, 140, 0, TAU);
            ctx.fill();
          }
          ctx.restore();
        }
      } else {
        // Chapter 3 ('night'): Parallax Starfield + Fluid Nebulae + Aurora Borealis Curtains + Celestial Lighthouse + Meteors
        const nebulae = this._sprites && this._sprites.nightNebulae;
        if (nebulae && nebulae.length > 0) {
          ctx.save();
          ctx.globalAlpha = 0.42 + calm.cloud * 0.58;
          const cell = 440;
          const offX = worldOffsetX * 0.08;
          const offY = -scrollDist * 0.08;
          const gx0 = Math.floor((offX - 260) / cell);
          const gx1 = Math.ceil((offX + W + 260) / cell);
          const gy0 = Math.floor((offY - 260) / cell);
          const gy1 = Math.ceil((offY + H + 260) / cell);
          for (let gx = gx0; gx <= gx1; gx++) {
            for (let gy = gy0; gy <= gy1; gy++) {
              const h = hash2D(gx + 11, gy - 23);
              if (h < 0.35) continue;
              const spr = nebulae[Math.floor(h * 17) % nebulae.length];
              const sx = (gx + 0.5) * cell - offX + (h - 0.5) * 90;
              const sy = (gy + 0.5) * cell - offY + (hash2D(gx, gy + 7) - 0.5) * 90;
              const sc = 0.85 + (h - 0.35) * 0.9;
              ctx.drawImage(spr.canvas, sx - spr.w * sc * 0.5, sy - spr.h * sc * 0.5, spr.w * sc, spr.h * sc);
            }
          }
          ctx.restore();
        }

        // Layered twinkling starfield (tiny crisp pinpoints; dimmed in combat so they never mimic bullets!)
        ctx.save();
        const starAlphaScale = 0.18 + calm.lines * 0.82;
        for (const st of this._stars) {
          const sx = mod(st.x * W - worldOffsetX * st.depth, W);
          const sy = mod(st.y * H + scrollDist * st.depth, H);
          const tw = 0.32 + 0.68 * Math.abs(Math.sin(t * st.speed + st.twinkle));
          ctx.globalAlpha = tw * starAlphaScale;
          ctx.fillStyle = st.tint;
          const s = st.size * (0.65 + calm.lines * 0.35);
          ctx.fillRect(sx, sy, s, s);
          if (st.sparkle && calm.lines > 0.35) {
            ctx.globalAlpha = tw * starAlphaScale * 0.55;
            ctx.fillRect(sx - 2.5, sy + s * 0.35, 5 + s, 0.8);
            ctx.fillRect(sx + s * 0.35, sy - 2.5, 0.8, 5 + s);
          }
        }
        ctx.restore();

        // Silky Vertical-Curtain Aurora Borealis
        this._renderAuroraCurtains(ctx, W, H, t, worldOffsetX, calm);

        // Distant "星海灯塔" Celestial Orbital Lighthouse & Gently Sweeping Beacon Beams
        this._renderCelestialLighthouse(ctx, W, H, t, worldOffsetX, calm);

        // Occasional High-altitude Shooting Stars
        if (this._meteors.length > 0) {
          ctx.save();
          const maScale = 0.35 + calm.lines * 0.65;
          for (const m of this._meteors) {
            const u = m.life / m.duration;
            const a = Math.sin(u * Math.PI) * maScale;
            if (a <= 0.02) continue;
            const mag = Math.hypot(m.vx, m.vy) || 1;
            const tx = m.x - (m.vx / mag) * m.tailLen;
            const ty = m.y - (m.vy / mag) * m.tailLen;
            const mg = ctx.createLinearGradient(m.x, m.y, tx, ty);
            mg.addColorStop(0, `rgba(240, 253, 250, ${a.toFixed(3)})`);
            mg.addColorStop(0.35, `rgba(103, 232, 249, ${(a * 0.55).toFixed(3)})`);
            mg.addColorStop(1, 'rgba(103, 232, 249, 0)');
            ctx.strokeStyle = mg;
            ctx.lineWidth = 1.6;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(m.x, m.y);
            ctx.lineTo(tx, ty);
            ctx.stroke();
          }
          ctx.restore();
        }
      }

      ctx.restore();
    }

    _renderAuroraCurtains(ctx, W, H, t, worldOffsetX, calm) {
      ctx.save();
      const vis = 0.36 + calm.cloud * 0.64;
      const ribbons = [
        { baseY: H * 0.16, h: H * 0.17, rgbTop: '167, 139, 250', rgbBot: '52, 211, 153', freq: 0.0042, spd: 0.42, a: 0.22 * vis },
        { baseY: H * 0.25, h: H * 0.14, rgbTop: '56, 189, 248', rgbBot: '45, 212, 191', freq: 0.0055, spd: -0.31, a: 0.16 * vis }
      ];

      const xStart = -80;
      const xEnd = W + 80;
      const stepX = Math.max(16, Math.round(W / 60));

      for (const rb of ribbons) {
        const waveAt = (x) => {
          const wx = x + worldOffsetX * 0.04;
          return rb.baseY
            + Math.sin(wx * rb.freq + t * rb.spd) * 26
            + Math.sin(wx * rb.freq * 2.3 - t * rb.spd * 1.4) * 12;
        };

        // Pass 1: Continuous silky flowing aurora veil (zero blockiness!)
        const bandG = ctx.createLinearGradient(0, rb.baseY - rb.h * 0.9, 0, rb.baseY + rb.h * 0.55);
        bandG.addColorStop(0, `rgba(${rb.rgbTop}, 0)`);
        bandG.addColorStop(0.48, `rgba(${rb.rgbTop}, ${(rb.a * 0.42).toFixed(3)})`);
        bandG.addColorStop(0.82, `rgba(${rb.rgbBot}, ${(rb.a * 0.72).toFixed(3)})`);
        bandG.addColorStop(1, `rgba(${rb.rgbBot}, 0)`);
        ctx.fillStyle = bandG;
        ctx.beginPath();
        ctx.moveTo(xStart, waveAt(xStart) - rb.h);
        for (let x = xStart; x <= xEnd; x += 28) {
          ctx.lineTo(x, waveAt(x) - rb.h * 0.85);
        }
        for (let x = xEnd; x >= xStart; x -= 28) {
          ctx.lineTo(x, waveAt(x) + 28);
        }
        ctx.closePath();
        ctx.fill();

        // Pass 2: Shimmering vertical magnetic curtain rays
        for (let x = xStart; x <= xEnd; x += stepX) {
          const wx = x + worldOffsetX * 0.04;
          const shimmer = Math.pow(0.5 + 0.5 * Math.sin(wx * 0.023 + t * 1.45), 1.6);
          const colA = rb.a * 0.68 * shimmer;
          if (colA <= 0.012) continue;

          const yBot = waveAt(x) + 12;
          const yTop = yBot - rb.h * (0.65 + 0.45 * shimmer);
          const cg = ctx.createLinearGradient(0, yTop, 0, yBot + 12);
          cg.addColorStop(0, `rgba(${rb.rgbTop}, 0)`);
          cg.addColorStop(0.5, `rgba(${rb.rgbTop}, ${(colA * 0.45).toFixed(3)})`);
          cg.addColorStop(0.86, `rgba(${rb.rgbBot}, ${colA.toFixed(3)})`);
          cg.addColorStop(1, `rgba(${rb.rgbBot}, 0)`);
          ctx.fillStyle = cg;
          ctx.fillRect(x, yTop, stepX * 0.85, yBot + 12 - yTop);
        }
      }
      ctx.restore();
    }

    _renderCelestialLighthouse(ctx, W, H, t, worldOffsetX, calm) {
      const lx = W * 0.78 - clamp(worldOffsetX * 0.035, -110, 110);
      const ly = H * 0.16;
      const vis = 0.24 + calm.sun * 0.76;

      ctx.save();
      ctx.translate(lx, ly);

      // Sweeping orbital guidance beams (rotate gently across the starry horizon)
      const sweep = Math.sin(t * 0.48) * 0.32;
      const beamLen = Math.max(W, H) * 0.46;
      ctx.save();
      ctx.globalAlpha = vis * 0.52;
      for (const dir of [-1, 1]) {
        ctx.save();
        ctx.rotate(dir * (0.12 + sweep * 0.35));
        const bg = ctx.createLinearGradient(0, 0, dir * beamLen, 0);
        bg.addColorStop(0, 'rgba(165, 243, 252, 0.38)');
        bg.addColorStop(0.35, 'rgba(56, 189, 248, 0.14)');
        bg.addColorStop(1, 'rgba(56, 189, 248, 0)');
        ctx.fillStyle = bg;
        ctx.beginPath();
        ctx.moveTo(0, -2);
        ctx.lineTo(dir * beamLen, -34);
        ctx.lineTo(dir * beamLen, 34);
        ctx.lineTo(0, 2);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();

      // Spire silhouette & dual counter-rotating astrolabe rings
      ctx.globalAlpha = 0.38 + calm.cloud * 0.62;
      ctx.strokeStyle = 'rgba(125, 211, 252, 0.52)';
      ctx.lineWidth = 1.4;
      ctx.save();
      ctx.rotate(0.22 + Math.sin(t * 0.6) * 0.08);
      ctx.beginPath();
      ctx.ellipse(0, 0, 34, 9, 0, 0, TAU);
      ctx.stroke();
      ctx.restore();

      ctx.strokeStyle = 'rgba(196, 181, 253, 0.44)';
      ctx.save();
      ctx.rotate(-0.28 - Math.sin(t * 0.5) * 0.08);
      ctx.beginPath();
      ctx.ellipse(0, 0, 23, 7, 0, 0, TAU);
      ctx.stroke();
      ctx.restore();

      // Slender celestial spire body
      const towerG = ctx.createLinearGradient(0, -34, 0, 58);
      towerG.addColorStop(0, '#bae6fd');
      towerG.addColorStop(0.35, '#1e3a5f');
      towerG.addColorStop(1, 'rgba(10, 25, 48, 0)');
      ctx.fillStyle = towerG;
      ctx.beginPath();
      ctx.moveTo(0, -34);
      ctx.lineTo(4.5, 4);
      ctx.lineTo(9, 56);
      ctx.lineTo(-9, 56);
      ctx.lineTo(-4.5, 4);
      ctx.closePath();
      ctx.fill();

      // Soft lantern core glow (feathered halo, not a sharp bullet-like dot)
      const coreG = ctx.createRadialGradient(0, 0, 0, 0, 0, 18);
      coreG.addColorStop(0, `rgba(224, 242, 254, ${(0.65 * vis).toFixed(3)})`);
      coreG.addColorStop(0.45, `rgba(56, 189, 248, ${(0.28 * vis).toFixed(3)})`);
      coreG.addColorStop(1, 'rgba(56, 189, 248, 0)');
      ctx.fillStyle = coreG;
      ctx.beginPath();
      ctx.arc(0, 0, 18, 0, TAU);
      ctx.fill();

      ctx.restore();
    }

    _renderDayOceanDetails(ctx, W, H, anchorX, anchorY, scrollDist, worldOffsetX, t, calm) {
      const pad = Math.hypot(W, H) * 0.68;
      const pf = 0.34;
      const cell = 210;
      const xMin = anchorX - pad;
      const xMax = anchorX + pad;
      const yMin = anchorY - pad;
      const yMax = anchorY + pad;

      const wx0 = Math.floor((xMin - anchorX + worldOffsetX * pf) / cell);
      const wx1 = Math.ceil((xMax - anchorX + worldOffsetX * pf) / cell);
      const wy0 = Math.floor((yMin - anchorY - scrollDist * pf) / cell);
      const wy1 = Math.ceil((yMax - anchorY - scrollDist * pf) / cell);

      ctx.save();

      // Delicate chart grid lines (faded strongly in combat via calm.lines)
      if (calm.lines > 0.01) {
        ctx.strokeStyle = `rgba(255, 255, 255, ${(0.14 * calm.lines).toFixed(3)})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let gx = wx0; gx <= wx1; gx++) {
          const sx = anchorX + gx * cell - worldOffsetX * pf;
          ctx.moveTo(sx, yMin);
          ctx.lineTo(sx, yMax);
        }
        for (let gy = wy0; gy <= wy1; gy++) {
          const sy = anchorY + gy * cell + scrollDist * pf;
          ctx.moveTo(xMin, sy);
          ctx.lineTo(xMax, sy);
        }
        ctx.stroke();
      }

      // Subtle emerald-cerulean wave swell crests across the water surface
      ctx.strokeStyle = `rgba(224, 242, 254, ${(0.08 + 0.14 * calm.cloud).toFixed(3)})`;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      for (let gx = wx0; gx <= wx1; gx++) {
        for (let gy = wy0; gy <= wy1; gy++) {
          const h = hash2D(gx + 31, gy - 17);
          if (h < 0.48) continue;
          const sx = anchorX + (gx + (h * 7 % 0.85)) * cell - worldOffsetX * pf;
          const sy = anchorY + (gy + (h * 13 % 0.85)) * cell + scrollDist * pf;
          const w = 14 + (h - 0.48) * 28 + Math.sin(t * 1.8 + gx + gy) * 3;
          ctx.moveTo(sx - w, sy);
          ctx.quadraticCurveTo(sx, sy - 3.5, sx + w, sy);
        }
      }
      ctx.stroke();

      // Ocean cast shadows from the mid-layer clouds (gives huge 2.5D altitude sensation!)
      const shadowSpr = this._sprites && this._sprites.cloudShadow;
      if (shadowSpr && calm.cloud > 0.08) {
        const cpf = 0.76;
        const cCell = 330;
        const cx0 = Math.floor((xMin - anchorX + worldOffsetX * cpf) / cCell);
        const cx1 = Math.ceil((xMax - anchorX + worldOffsetX * cpf) / cCell);
        const cy0 = Math.floor((yMin - anchorY - scrollDist * cpf) / cCell);
        const cy1 = Math.ceil((yMax - anchorY - scrollDist * cpf) / cCell);
        ctx.globalAlpha = calm.cloud * 0.55;
        for (let gx = cx0; gx <= cx1; gx++) {
          for (let gy = cy0; gy <= cy1; gy++) {
            const h = hash2D(gx + 71, gy - 71);
            if (h <= 0.56) continue;
            const sx = anchorX + (gx + (h * 19 % 0.78)) * cCell - worldOffsetX * cpf + 46;
            const sy = anchorY + (gy + (h * 43 % 0.78)) * cCell + scrollDist * cpf + 58;
            const sc = 0.7 + (h - 0.56) * 0.95;
            ctx.drawImage(
              shadowSpr.canvas,
              sx - shadowSpr.w * sc * 0.5,
              sy - shadowSpr.h * sc * 0.5,
              shadowSpr.w * sc,
              shadowSpr.h * sc
            );
          }
        }
      }

      ctx.restore();
    }

    _renderIslandsLayer(ctx, W, H, anchorX, anchorY, scrollDist, worldOffsetX, sky, t, calm, lane, combatWeight) {
      const spriteSet = sky === 'day'
        ? this._sprites.dayIslands
        : (sky === 'sunset' ? this._sprites.sunsetIslands : this._sprites.nightIslands);
      if (!spriteSet || spriteSet.length === 0) return;

      const pad = Math.hypot(W, H) * 0.68;
      const pf = 0.40;
      const cell = 340;
      const xMin = anchorX - pad;
      const xMax = anchorX + pad;
      const yMin = anchorY - pad;
      const yMax = anchorY + pad;

      const gx0 = Math.floor((xMin - anchorX + worldOffsetX * pf) / cell);
      const gx1 = Math.ceil((xMax - anchorX + worldOffsetX * pf) / cell);
      const gy0 = Math.floor((yMin - anchorY - scrollDist * pf) / cell);
      const gy1 = Math.ceil((yMax - anchorY - scrollDist * pf) / cell);

      const baseOpacity = calm.cloud < 1 ? clamp(0.22 + calm.cloud * 0.78, 0.14, 1) : 1;

      ctx.save();
      for (let gx = gx0; gx <= gx1; gx++) {
        for (let gy = gy0; gy <= gy1; gy++) {
          const h = hash2D(gx + 5, gy - 13);
          if (h <= 0.56) continue;

          const variant = Math.floor(hash2D(gx * 3, gy * 7) * spriteSet.length) % spriteSet.length;
          const spr = spriteSet[variant];
          const jx = 0.18 + (h * 17 % 0.64);
          const jy = 0.18 + (h * 29 % 0.64);
          const sx = anchorX + (gx + jx) * cell - worldOffsetX * pf;
          const sy = anchorY + (gy + jy) * cell + scrollDist * pf;

          const maskA = lane.mask(sx, sy, combatWeight);
          const alpha = baseOpacity * maskA;
          if (alpha <= 0.03) continue;

          const sc = 0.62 + (h - 0.56) * 1.05;
          ctx.globalAlpha = alpha;

          // Day: Animated expanding white breaking surf rings around coral island coastline!
          if (sky === 'day' && spr.coastPts) {
            for (let ring = 0; ring < 2; ring++) {
              const wavePhase = (t * 0.36 + h * 3.1 + ring * 0.5) % 1;
              const expand = 1.0 + wavePhase * 0.22;
              const surfA = Math.sin(wavePhase * Math.PI) * 0.52 * alpha;
              if (surfA > 0.02) {
                ctx.save();
                ctx.translate(sx, sy);
                ctx.scale(sc * expand, sc * expand);
                const pts = spr.coastPts;
                ctx.beginPath();
                const n = pts.length;
                ctx.moveTo((pts[n - 1].dx + pts[0].dx) * 0.5, (pts[n - 1].dy + pts[0].dy) * 0.5);
                for (let i = 0; i < n; i++) {
                  const p0 = pts[i];
                  const p1 = pts[(i + 1) % n];
                  ctx.quadraticCurveTo(p0.dx, p0.dy, (p0.dx + p1.dx) * 0.5, (p0.dy + p1.dy) * 0.5);
                }
                ctx.closePath();
                ctx.strokeStyle = `rgba(255, 255, 255, ${surfA.toFixed(3)})`;
                ctx.lineWidth = (2.2 - wavePhase * 1.3) / sc;
                ctx.stroke();
                ctx.restore();
              }
            }
          }

          // Pre-baked high-detail island sprite
          const bobY = sky === 'day' ? 0 : Math.sin(t * 1.2 + h * TAU) * 3.5;
          ctx.drawImage(
            spr.canvas,
            sx - spr.w * sc * 0.5,
            sy + bobY - spr.h * sc * 0.5,
            spr.w * sc,
            spr.h * sc
          );

          // Day Variant 1: Live rotating 4-blade white Windmill sails!
          if (sky === 'day' && spr.windmillHub) {
            ctx.save();
            ctx.translate(sx + spr.windmillHub.x * sc, sy + spr.windmillHub.y * sc);
            ctx.rotate(t * 1.15 + h * TAU);
            const bladeR = 11.2 * sc;
            ctx.strokeStyle = '#e2e8f0';
            ctx.lineWidth = Math.max(1.0, 1.3 * sc);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
            for (let b = 0; b < 4; b++) {
              ctx.beginPath();
              ctx.moveTo(0, 0);
              ctx.lineTo(bladeR, 0);
              ctx.stroke();
              ctx.fillRect(bladeR * 0.28, 0.4 * sc, bladeR * 0.68, 2.4 * sc);
              ctx.rotate(Math.PI * 0.5);
            }
            ctx.restore();
          }
        }
      }
      ctx.restore();
    }

    _renderBirdFlocks(ctx, t, calm) {
      ctx.save();
      const vis = 0.25 + calm.cloud * 0.75;
      for (const fl of this._birdFlocks) {
        const fade = Math.min(1, fl.life * 0.8, (fl.maxLife - fl.life) * 0.5);
        const alpha = fade * vis * 0.88;
        if (alpha <= 0.02) continue;

        for (const b of fl.birds) {
          const bx = fl.x + b.ox;
          const by = fl.y + b.oy;
          const flap = Math.sin(t * 9.5 + b.flapOffset);
          const wingSpread = b.span * (0.68 + 0.32 * Math.abs(flap));

          // Soft shadow on the ocean below
          ctx.save();
          ctx.translate(bx + 12, by + 16);
          ctx.rotate(fl.angle + Math.PI * 0.5);
          ctx.strokeStyle = `rgba(6, 40, 78, ${(alpha * 0.26).toFixed(3)})`;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(-wingSpread, 2.5);
          ctx.quadraticCurveTo(-wingSpread * 0.4, -1, 0, 0);
          ctx.quadraticCurveTo(wingSpread * 0.4, -1, wingSpread, 2.5);
          ctx.stroke();
          ctx.restore();

          // White seabird V-wing silhouette
          ctx.save();
          ctx.translate(bx, by);
          ctx.rotate(fl.angle + Math.PI * 0.5);
          ctx.strokeStyle = `rgba(255, 255, 255, ${alpha.toFixed(3)})`;
          ctx.lineWidth = 1.6;
          ctx.lineCap = 'round';
          ctx.beginPath();
          const tipLift = flap * 2.4;
          ctx.moveTo(-wingSpread, 2.2 + tipLift);
          ctx.quadraticCurveTo(-wingSpread * 0.42, -1.6, 0, 0.4);
          ctx.quadraticCurveTo(wingSpread * 0.42, -1.6, wingSpread, 2.2 + tipLift);
          ctx.stroke();
          ctx.restore();
        }
      }
      ctx.restore();
    }

    _renderVolumetricCloudLayer(ctx, W, H, anchorX, anchorY, scrollDist, worldOffsetX, sky, calm, lane, combatWeight, cfg) {
      const cloudSet = sky === 'day'
        ? this._sprites.dayClouds
        : (sky === 'sunset' ? this._sprites.sunsetClouds : this._sprites.nightClouds);
      if (!cloudSet || cloudSet.length === 0) return;

      const baseA = cfg.alpha * (0.16 + calm.cloud * 0.84);
      if (baseA <= 0.015) return;

      const pad = Math.hypot(W, H) * 0.72;
      const pf = cfg.parallax;
      const cell = cfg.cell;
      const xMin = anchorX - pad;
      const xMax = anchorX + pad;
      const yMin = anchorY - pad;
      const yMax = anchorY + pad;

      const gx0 = Math.floor((xMin - anchorX + worldOffsetX * pf) / cell);
      const gx1 = Math.ceil((xMax - anchorX + worldOffsetX * pf) / cell);
      const gy0 = Math.floor((yMin - anchorY - scrollDist * pf) / cell);
      const gy1 = Math.ceil((yMax - anchorY - scrollDist * pf) / cell);

      ctx.save();
      for (let gx = gx0; gx <= gx1; gx++) {
        for (let gy = gy0; gy <= gy1; gy++) {
          const h = hash2D(gx + cfg.seed, gy - cfg.seed);
          if (h <= cfg.threshold) continue;

          const spr = cloudSet[Math.floor(h * 37) % cloudSet.length];
          const sx = anchorX + (gx + (h * 19 % 0.78)) * cell - worldOffsetX * pf;
          const sy = anchorY + (gy + (h * 43 % 0.78)) * cell + scrollDist * pf;

          const maskA = lane.mask(sx, sy, combatWeight);
          const alpha = baseA * maskA;
          if (alpha <= 0.02) continue;

          const tNorm = (h - cfg.threshold) / (1 - cfg.threshold);
          const sc = lerp(cfg.scaleMin, cfg.scaleMax, tNorm);
          ctx.globalAlpha = alpha;
          ctx.drawImage(
            spr.canvas,
            sx - spr.w * sc * 0.5,
            sy - spr.h * sc * 0.5,
            spr.w * sc,
            spr.h * sc
          );
        }
      }
      ctx.restore();
    }

    // Soft winding volumetric cloud canyon walls along both sides of the corridor
    _renderCorridorWalls(ctx, sky, calm, lane, onTitle) {
      const { W, H, anchorY, hw } = lane;
      // On Title screen, pull walls gently outward & keep airy so the 75% tabletop helipad below stays open & picturesque!
      const titleRetreat = onTitle ? Math.min(W * 0.14, 110) : 0;
      const effHw = hw + titleRetreat;

      const wallRgb = sky === 'day'
        ? '241, 248, 255'
        : (sky === 'sunset' ? '253, 186, 116' : '38, 72, 132');
      const deepRgb = sky === 'day'
        ? '186, 220, 248'
        : (sky === 'sunset' ? '124, 38, 78' : '15, 32, 68');

      const strength = (onTitle ? 0.52 : 1.0) * (0.48 + 0.52 * calm.cloud);
      const y0 = -H * 0.35;
      const y1 = H * 1.35;

      ctx.save();

      // 1. Feathered atmospheric bank strata framing the left & right valley edges
      const strata = [
        { inset: 4, a: 0.14, rgb: wallRgb },
        { inset: 36, a: 0.18, rgb: wallRgb },
        { inset: 82, a: 0.24, rgb: deepRgb }
      ];
      for (const side of [-1, 1]) {
        for (const layer of strata) {
          ctx.fillStyle = `rgba(${layer.rgb}, ${(layer.a * strength).toFixed(3)})`;
          ctx.beginPath();
          let first = true;
          for (let y = y0; y <= y1; y += 24) {
            const ly = lane.lyAt(y);
            const bump = 18 * Math.sin(ly * 0.019 + side * 2.1) + 10 * Math.sin(ly * 0.049 + side);
            const x = lane.cxAt(y) + side * (effHw + layer.inset + bump);
            if (first) {
              ctx.moveTo(x, y);
              first = false;
            } else {
              ctx.lineTo(x, y);
            }
          }
          const farX = side > 0 ? W * 1.75 : -W * 0.75;
          ctx.lineTo(farX, y1);
          ctx.lineTo(farX, y0);
          ctx.closePath();
          ctx.fill();
        }
      }

      // 2. Pre-baked Volumetric Billow Heads lining the canyon rim
      const cloudSet = sky === 'day'
        ? this._sprites.dayClouds
        : (sky === 'sunset' ? this._sprites.sunsetClouds : this._sprites.nightClouds);
      if (cloudSet && cloudSet.length > 0) {
        const spacing = 135;
        const k0 = Math.floor(lane.lyAt(y0) / spacing);
        const k1 = Math.ceil(lane.lyAt(y1) / spacing);
        const scrollShift = (lane.lyAt(anchorY)); // -scrollDist * LANE_PF

        ctx.globalAlpha = clamp(0.55 * strength, 0.12, 0.78);
        for (const side of [-1, 1]) {
          for (let k = k0; k <= k1; k++) {
            const sy = anchorY + (k * spacing - scrollShift);
            const hsh = hash2D(k, side > 0 ? 17 : 29);
            const spr = cloudSet[Math.floor(hsh * 23) % cloudSet.length];
            const sc = 0.62 + hsh * 0.42;
            const x = lane.cxAt(sy) + side * (effHw + 58 + hsh * 44);
            ctx.drawImage(
              spr.canvas,
              x - spr.w * sc * 0.5,
              sy - spr.h * sc * 0.5,
              spr.w * sc,
              spr.h * sc
            );
          }
        }
      }

      ctx.restore();
    }

    // Soft elongated wind streaks & gentle rising embers/motes (NEVER round dots that look like enemy bullets!)
    _renderAtmosphericWisps(ctx, W, H, anchorX, anchorY, scrollDist, worldOffsetX, sky, t, calm) {
      if (calm.lines <= 0.015) return;

      ctx.save();

      // 1. Ambient floating wisps (Day: soft warm sunlit breeze filaments | Sunset: rising golden ember ribbons)
      if (sky === 'day' || sky === 'sunset') {
        const wispA = calm.lines * (sky === 'day' ? 0.34 : 0.42);
        ctx.strokeStyle = sky === 'day'
          ? `rgba(255, 253, 240, ${wispA.toFixed(3)})`
          : `rgba(253, 186, 116, ${wispA.toFixed(3)})`;
        ctx.lineWidth = 1.4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        for (const m of this._motes) {
          const dirY = sky === 'sunset' ? -1 : 1;
          const sx = mod(m.nx * W + Math.sin(t * 0.9 + m.phase) * 26 - worldOffsetX * 0.5, W);
          const sy = mod(m.ny * H + (t * m.speedY * dirY) + scrollDist * (sky === 'day' ? 0.35 : 0.12), H);
          const sway = Math.sin(t * 1.7 + m.phase) * 4;
          ctx.moveTo(sx, sy);
          ctx.lineTo(sx + sway, sy + m.len);
        }
        ctx.stroke();
      }

      // 2. High-altitude speed airflow streaks
      const boostRatio = clamp((this._scrollSpeed - 260) / 300, 0, 1);
      const streakAlpha = calm.lines * (0.20 + boostRatio * 0.38);
      if (streakAlpha > 0.015) {
        const pad = Math.hypot(W, H) * 0.65;
        const pf = 1.42;
        const cell = 190;
        const gx0 = Math.floor((-pad + worldOffsetX * pf) / cell);
        const gx1 = Math.ceil((pad + worldOffsetX * pf) / cell);
        const gy0 = Math.floor((-pad - scrollDist * pf) / cell);
        const gy1 = Math.ceil((pad - scrollDist * pf) / cell);

        ctx.strokeStyle = sky === 'day'
          ? `rgba(255, 255, 255, ${streakAlpha.toFixed(3)})`
          : (sky === 'sunset'
            ? `rgba(254, 243, 199, ${(streakAlpha * 0.75).toFixed(3)})`
            : `rgba(125, 211, 252, ${(streakAlpha * 0.62).toFixed(3)})`);
        ctx.lineWidth = 1.2 + boostRatio * 0.9;
        ctx.beginPath();
        for (let gx = gx0; gx <= gx1; gx++) {
          for (let gy = gy0; gy <= gy1; gy++) {
            const h = hash2D(gx + 503, gy - 811);
            if (h <= 0.6) continue;
            const sx = anchorX + (gx + (h * 17 % 0.9)) * cell - worldOffsetX * pf;
            const sy = anchorY + (gy + (h * 31 % 0.9)) * cell + scrollDist * pf;
            const len = 26 + boostRatio * 64;
            ctx.moveTo(sx, sy);
            ctx.lineTo(sx, sy + len);
          }
        }
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  global.SkySceneryRenderer = SkySceneryRenderer;
})(typeof window !== 'undefined' ? window : globalThis);
