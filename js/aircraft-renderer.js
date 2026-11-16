/**
 * Tabletop Sky Striker -《借风计划》v2.0 High-Precision Vector Mecha & Aircraft Renderer
 * Pure native Canvas 2D layered vector shading, metallic gradients, panel lines,
 * translucent canopy highlights, dynamic Mach-diamond exhaust plumes & evolution wings.
 * Zero external image dependencies, strictly balanced ctx.save()/ctx.restore(), 60fps+ ready.
 */
(function (global) {
  'use strict';

  const TAU = Math.PI * 2;
  const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);
  const lerp = (a, b, t) => a + (b - a) * t;

  // Fast deterministic hash in [0, 1) for procedural arcs, sparks & smoke without allocations
  function hash1D(n) {
    let x = Math.imul((n | 0) + 0x9e3779b9, 0x85ebca6b);
    x ^= x >>> 13;
    x = Math.imul(x, 0xc2b2ae35);
    x ^= x >>> 16;
    return (x >>> 0) / 4294967296;
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, Math.abs(w) * 0.5, Math.abs(h) * 0.5));
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(x, y, w, h, rr);
    } else {
      ctx.moveTo(x + rr, y);
      ctx.lineTo(x + w - rr, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
      ctx.lineTo(x + w, y + h - rr);
      ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
      ctx.lineTo(x + rr, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
      ctx.lineTo(x, y + rr);
      ctx.quadraticCurveTo(x, y, x + rr, y);
      ctx.closePath();
    }
  }

  function polyPath(ctx, pts, close) {
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) {
      ctx.lineTo(pts[i], pts[i + 1]);
    }
    if (close !== false) ctx.closePath();
  }

  // Lightweight radial glow (replaces expensive shadowBlur for crisp 60fps danmaku readability)
  function drawRadialGlow(ctx, x, y, r, innerCol, midCol, outerCol) {
    if (r <= 0.5) return;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, innerCol);
    g.addColorStop(0.42, midCol);
    g.addColorStop(1, outerCol || 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }

  /**
   * Multi-layered vector thruster plume with supersonic Mach shock diamonds.
   * Default orientation extends along +Y from (x, y); swayX bends the tip laterally.
   */
  function drawMachPlume(ctx, x, y, w, len, swayX, palette, time, diamonds) {
    if (len <= 1 || w <= 0.5) return;
    const flick = 0.9 + Math.sin(time * 54 + x * 0.37) * 0.1;
    const L = len * flick;
    const tipX = x + swayX;
    const tipY = y + L;

    // 1. Outer ionized plasma envelope
    const outerG = ctx.createLinearGradient(x, y, tipX, tipY);
    outerG.addColorStop(0, palette.outer0 || 'rgba(139, 92, 246, 0.72)');
    outerG.addColorStop(0.45, palette.outer1 || 'rgba(56, 189, 248, 0.52)');
    outerG.addColorStop(1, 'rgba(14, 165, 233, 0)');
    ctx.fillStyle = outerG;
    ctx.beginPath();
    ctx.moveTo(x - w * 1.15, y);
    ctx.quadraticCurveTo(x - w * 0.8 + swayX * 0.42, y + L * 0.52, tipX, tipY + 4);
    ctx.quadraticCurveTo(x + w * 0.8 + swayX * 0.42, y + L * 0.52, x + w * 1.15, y);
    ctx.closePath();
    ctx.fill();

    // 2. Mid supersonic jet core
    const midG = ctx.createLinearGradient(x, y, tipX, y + L * 0.86);
    midG.addColorStop(0, '#ffffff');
    midG.addColorStop(0.32, palette.mid || '#38bdf8');
    midG.addColorStop(0.75, palette.tail || 'rgba(99, 102, 241, 0.45)');
    midG.addColorStop(1, 'rgba(56, 189, 248, 0)');
    ctx.fillStyle = midG;
    ctx.beginPath();
    ctx.moveTo(x - w * 0.72, y);
    ctx.quadraticCurveTo(x - w * 0.32 + swayX * 0.36, y + L * 0.45, x + swayX * 0.85, y + L * 0.88);
    ctx.quadraticCurveTo(x + w * 0.32 + swayX * 0.36, y + L * 0.45, x + w * 0.72, y);
    ctx.closePath();
    ctx.fill();

    // 3. Crisp Mach shock diamonds along exhaust axis
    const count = diamonds || 3;
    for (let i = 0; i < count; i++) {
      const t0 = (i + 0.35) / (count + 0.55);
      const pulse = Math.sin(time * 62 - i * 1.6) * 0.03;
      const t = clamp(t0 + pulse, 0.06, 0.85);
      const dx = x + swayX * (t * t);
      const dy = y + L * t;
      const dw = w * (1 - t * 0.72) * 0.58;
      const dh = Math.max(2.2, (L / (count + 1.2)) * 0.42 * (1 - t * 0.35));
      ctx.fillStyle = i === 0 ? 'rgba(255, 255, 255, 0.95)' : (palette.diamond || 'rgba(224, 242, 254, 0.82)');
      ctx.beginPath();
      ctx.moveTo(dx, dy - dh);
      ctx.lineTo(dx + dw, dy);
      ctx.lineTo(dx, dy + dh * 1.25);
      ctx.lineTo(dx - dw, dy);
      ctx.closePath();
      ctx.fill();
    }
  }

  /**
   * Crisp jagged electric lightning arc between (x1, y1) and (x2, y2).
   */
  function drawElectricArc(ctx, x1, y1, x2, y2, segments, jitter, glowCol, coreCol, lineW, seed) {
    const n = Math.max(2, segments | 0);
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass === 0 ? glowCol : coreCol;
      ctx.lineWidth = pass === 0 ? lineW * 2.4 : lineW;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      for (let i = 1; i < n; i++) {
        const t = i / n;
        const env = Math.sin(t * Math.PI);
        const off = (hash1D(seed * 31 + i * 17) - 0.5) * 2 * jitter * env;
        ctx.lineTo(x1 + dx * t + nx * off, y1 + dy * t + ny * off);
      }
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Procedural battle-damage smoke puffs & electric sparks when HP drops below 50%.
   */
  function drawBattleDamage(ctx, radius, hpRatio, time, seedPhase) {
    if (hpRatio >= 0.5) return;
    const severity = clamp((0.5 - hpRatio) * 2, 0.15, 1);
    const puffCount = severity > 0.55 ? 4 : 2;
    const baseSeed = Math.floor((seedPhase || 0) * 100);

    ctx.save();
    // Rising dark smoke wisps (trailing toward -Y for enemies moving +Y, or gentle drift)
    for (let i = 0; i < puffCount; i++) {
      const cyc = (time * (1.5 + i * 0.35) + i * 0.41 + (seedPhase || 0)) % 1;
      const anchorX = (hash1D(baseSeed + i * 13) - 0.5) * radius * 0.85;
      const anchorY = (hash1D(baseSeed + i * 29) - 0.5) * radius * 0.55;
      const sx = anchorX + Math.sin(time * 4 + i * 2) * 4 * cyc;
      const sy = anchorY - cyc * (14 + radius * 0.35);
      const sr = (3.2 + radius * 0.08) * (0.55 + cyc * 0.9);
      const alpha = (1 - cyc) * 0.42 * severity;
      ctx.fillStyle = `rgba(15, 23, 42, ${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(sx, sy, sr, 0, TAU);
      ctx.fill();
    }

    // Intermittent micro-sparks
    const sparkTick = Math.floor(time * 18 + (seedPhase || 0) * 5);
    if (hash1D(sparkTick * 7 + baseSeed) < 0.38 * severity) {
      const sx = (hash1D(sparkTick * 11 + 3) - 0.5) * radius * 0.9;
      const sy = (hash1D(sparkTick * 19 + 9) - 0.5) * radius * 0.6;
      ctx.strokeStyle = '#fef08a';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let k = 0; k < 3; k++) {
        const a = hash1D(sparkTick * 23 + k * 5) * TAU;
        const l = 4 + hash1D(sparkTick * 29 + k) * 6;
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + Math.cos(a) * l, sy + Math.sin(a) * l);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Draws translucent luminous Roguelite Evolution Energy Wings (evoTier 1..3).
   * Works seamlessly for both virtual craft (spanX ~ 26..34) and tabletop helipad (spanX ~ hw + 8).
   */
  function drawEvolutionWings(ctx, spanX, baseY, evoTier, bank, time, scale) {
    if (evoTier <= 0) return;
    const s = scale || 1;
    const beat = Math.sin(time * 4.2) * 0.05;

    ctx.save();
    for (const side of [-1, 1]) {
      const persp = clamp(1 - side * bank * 0.22, 0.68, 1.28);
      ctx.save();
      ctx.translate(side * spanX, baseY);
      ctx.scale(side * persp, 1);
      ctx.rotate(beat + bank * side * 0.05);

      // Tier 1+: Swept Cyan-Azure Energy Feather Blade
      const g1 = ctx.createLinearGradient(0, 0, 38 * s, -18 * s);
      g1.addColorStop(0, 'rgba(56, 189, 248, 0.78)');
      g1.addColorStop(0.55, 'rgba(103, 232, 249, 0.42)');
      g1.addColorStop(1, 'rgba(186, 230, 253, 0.04)');
      ctx.fillStyle = g1;
      ctx.strokeStyle = 'rgba(186, 230, 253, 0.85)';
      ctx.lineWidth = 1.3;
      polyPath(ctx, [
        0, -6 * s,
        24 * s, -18 * s,
        42 * s, -8 * s,
        28 * s, 6 * s,
        4 * s, 10 * s
      ]);
      ctx.fill();
      ctx.stroke();

      // Inner circuit rib on Tier 1 blade
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(3 * s, -1 * s);
      ctx.lineTo(31 * s, -9 * s);
      ctx.stroke();

      // Tier 2+: Secondary Golden-Cyan Astral Pinion + Floating Stabilizer Fin
      if (evoTier >= 2) {
        const g2 = ctx.createLinearGradient(4 * s, -8 * s, 54 * s, -28 * s);
        g2.addColorStop(0, 'rgba(250, 204, 21, 0.82)');
        g2.addColorStop(0.5, 'rgba(56, 189, 248, 0.5)');
        g2.addColorStop(1, 'rgba(253, 224, 71, 0.04)');
        ctx.fillStyle = g2;
        ctx.strokeStyle = 'rgba(254, 240, 138, 0.88)';
        ctx.lineWidth = 1.25;
        polyPath(ctx, [
          4 * s, -10 * s,
          34 * s, -30 * s,
          56 * s, -22 * s,
          36 * s, -8 * s,
          8 * s, -2 * s
        ]);
        ctx.fill();
        ctx.stroke();

        // Floating golden stabilizer shard
        const hover = Math.sin(time * 6 + side) * 2.5 * s;
        ctx.fillStyle = '#fde047';
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 1.2;
        polyPath(ctx, [
          18 * s, 12 * s + hover,
          38 * s, 18 * s + hover,
          30 * s, 24 * s + hover,
          12 * s, 17 * s + hover
        ]);
        ctx.fill();
        ctx.stroke();
      }

      // Tier 3: Six-Winged Seraphic Overdrive Plumes + Halo Arc
      if (evoTier >= 3) {
        const g3 = ctx.createLinearGradient(2 * s, -14 * s, 68 * s, -44 * s);
        g3.addColorStop(0, 'rgba(254, 249, 195, 0.92)');
        g3.addColorStop(0.45, 'rgba(251, 191, 36, 0.65)');
        g3.addColorStop(0.8, 'rgba(56, 189, 248, 0.35)');
        g3.addColorStop(1, 'rgba(56, 189, 248, 0)');
        ctx.fillStyle = g3;
        polyPath(ctx, [
          2 * s, -15 * s,
          38 * s, -46 * s,
          70 * s, -38 * s,
          48 * s, -20 * s,
          10 * s, -8 * s
        ]);
        ctx.fill();

        // Lower trailing seraphic feather
        polyPath(ctx, [
          6 * s, 10 * s,
          36 * s, 26 * s,
          52 * s, 36 * s,
          24 * s, 28 * s,
          4 * s, 16 * s
        ]);
        ctx.fill();

        // Crisp golden edge filament
        ctx.strokeStyle = 'rgba(254, 249, 195, 0.9)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(4 * s, -15 * s);
        ctx.lineTo(38 * s, -45 * s);
        ctx.lineTo(68 * s, -38 * s);
        ctx.stroke();
      }

      ctx.restore();
    }

    // Tier 3 dorsal astral halo behind fuselage
    if (evoTier >= 3) {
      ctx.strokeStyle = `rgba(253, 224, 71, ${(0.48 + Math.sin(time * 5) * 0.16).toFixed(2)})`;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(0, baseY + 4 * s, spanX + 14 * s, Math.PI * 1.12, Math.PI * 1.88);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Railgun fusion sphere & converging arcs ahead of nose.
   */
  function drawRailFusionSphere(ctx, x, y, charge, perfect, overcharge, time) {
    if (charge <= 0.04) return;
    const r = 6 + charge * 15;
    const mainCol = overcharge ? '#f87171' : (perfect ? '#fde047' : '#38bdf8');
    const midCol = overcharge
      ? 'rgba(239, 68, 68, 0.58)'
      : (perfect ? 'rgba(250, 204, 21, 0.65)' : 'rgba(56, 189, 248, 0.55)');

    ctx.save();
    drawRadialGlow(ctx, x, y, r * (perfect ? 2.3 : 1.75), '#ffffff', midCol, 'rgba(56, 189, 248, 0)');

    // Rotating containment ring
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(time * (6 + charge * 8));
    ctx.strokeStyle = mainCol;
    ctx.lineWidth = 1.8;
    for (let k = 0; k < 3; k++) {
      const a0 = (k / 3) * TAU;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.95, a0, a0 + 1.15);
      ctx.stroke();
    }
    ctx.restore();

    // Converging electric filaments
    if (charge > 0.22) {
      const seed = Math.floor(time * 28);
      const arcs = charge > 0.7 ? 4 : 2;
      for (let k = 0; k < arcs; k++) {
        const ang = time * 3.5 + (k / arcs) * TAU;
        const ox = x + Math.cos(ang) * (r * 1.45);
        const oy = y + Math.sin(ang) * (r * 1.45);
        drawElectricArc(
          ctx, ox, oy, x, y, 4, 3.5,
          overcharge ? 'rgba(248, 113, 113, 0.7)' : 'rgba(103, 232, 249, 0.75)',
          '#ffffff', 1.1, seed + k * 19
        );
      }
    }

    // Bright fusion core
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y, r * 0.38, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  // ============================================================================
  // 1. VIRTUAL PLAYER CRAFT ('jet' | 'car' | 'orb') — Origin (0,0), Nose -Y
  // ============================================================================

  function drawJetCraft(ctx, o) {
    const bank = o.bank;
    const time = o.time;
    const weaponLv = o.weaponLv;
    const breath = o.breath;

    // Asymmetric 2.5D wing foreshortening for authentic roll depth
    const lSpan = clamp(1 + bank * 0.22 - Math.abs(bank) * 0.08, 0.58, 1.24);
    const rSpan = clamp(1 - bank * 0.22 - Math.abs(bank) * 0.08, 0.58, 1.24);
    const spineX = bank * 4.2;

    // Twin vector exhaust plumes (longer & cyan-white when blowing wind!)
    const plumePalette = breath > 0.12
      ? {
          outer0: 'rgba(56, 189, 248, 0.85)',
          outer1: 'rgba(165, 243, 252, 0.65)',
          mid: '#a5f3fc',
          tail: 'rgba(56, 189, 248, 0.5)',
          diamond: '#ffffff'
        }
      : {
          outer0: 'rgba(139, 92, 246, 0.78)',
          outer1: 'rgba(56, 189, 248, 0.55)',
          mid: '#38bdf8',
          tail: 'rgba(99, 102, 241, 0.45)',
          diamond: 'rgba(224, 242, 254, 0.9)'
        };
    const pLen = 28 + breath * 26 + (weaponLv - 1) * 2.2;
    const sway = -bank * 9;
    drawMachPlume(ctx, -8.5 + spineX * 0.35, 24, 5.2, pLen, sway, plumePalette, time, 4);
    drawMachPlume(ctx, 8.5 + spineX * 0.35, 24, 5.2, pLen, sway, plumePalette, time + 0.7, 4);

    // Evolution wings beneath main airframe
    drawEvolutionWings(ctx, 24, 4, o.evoTier, bank, time, 0.92);

    // Under-wing weapon pylons & plasma gun pods (scales with weaponLv 2..5)
    if (weaponLv >= 2) {
      for (const side of [-1, 1]) {
        const sp = side < 0 ? lSpan : rSpan;
        const px = side * 19 * sp + spineX * 0.45;
        ctx.fillStyle = '#334155';
        ctx.strokeStyle = '#090d16';
        ctx.lineWidth = 1.6;
        roundRectPath(ctx, px - 2.6, -10, 5.2, 20, 2);
        ctx.fill();
        ctx.stroke();
        // Glowing plasma barrel tip
        ctx.fillStyle = weaponLv >= 4 ? '#fde047' : '#38bdf8';
        ctx.beginPath();
        ctx.arc(px, -11, 2.1, 0, TAU);
        ctx.fill();

        if (weaponLv >= 4) {
          const px2 = side * 28 * sp + spineX * 0.35;
          ctx.fillStyle = '#1e293b';
          ctx.strokeStyle = '#090d16';
          ctx.lineWidth = 1.5;
          roundRectPath(ctx, px2 - 2.2, -5, 4.4, 17, 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#67e8f9';
          ctx.beginPath();
          ctx.arc(px2, -6, 2, 0, TAU);
          ctx.fill();
        }
      }
    }

    // Forward-swept main wings + canards (asymmetric 2.5D polygon)
    const wingGrad = ctx.createLinearGradient(-34 * lSpan, -8, 34 * rSpan, 14);
    if (bank >= 0) {
      wingGrad.addColorStop(0, '#ffffff');
      wingGrad.addColorStop(0.48, '#e2e8f0');
      wingGrad.addColorStop(1, '#94a3b8');
    } else {
      wingGrad.addColorStop(0, '#94a3b8');
      wingGrad.addColorStop(0.52, '#e2e8f0');
      wingGrad.addColorStop(1, '#ffffff');
    }

    ctx.fillStyle = wingGrad;
    ctx.strokeStyle = '#090d16';
    ctx.lineWidth = 2.4;
    ctx.lineJoin = 'round';

    // Forward-swept ace silhouette (inspired by VF-31 / X-29 stealth striker)
    polyPath(ctx, [
      spineX, -38,                          // Nose needleradome
      spineX + 5.5 * rSpan, -23,            // Right chine
      spineX + 16 * rSpan, -15,             // Right canard tip
      spineX + 9.5 * rSpan, -9,             // Canard notch
      spineX + 37 * rSpan, -12,             // Forward-swept right wingtip leading point!
      spineX + 39 * rSpan, -2,              // Right wingtip outer rail
      spineX + 23 * rSpan, 14,              // Right trailing root
      spineX + 14 * rSpan, 24,              // Right tail boom
      spineX + 5 * rSpan, 22,               // Right nozzle shroud
      spineX, 25,                           // Center tail sting
      spineX - 5 * lSpan, 22,               // Left nozzle shroud
      spineX - 14 * lSpan, 24,              // Left tail boom
      spineX - 23 * lSpan, 14,              // Left trailing root
      spineX - 39 * lSpan, -2,              // Left wingtip outer rail
      spineX - 37 * lSpan, -12,             // Forward-swept left wingtip leading point!
      spineX - 9.5 * lSpan, -9,             // Left canard notch
      spineX - 16 * lSpan, -15,             // Left canard tip
      spineX - 5.5 * lSpan, -23             // Left chine
    ]);
    ctx.fill();
    ctx.stroke();

    // Azure & royal gold squadron livery stripes on wings
    ctx.fillStyle = '#0284c7';
    polyPath(ctx, [
      spineX - 12 * lSpan, -4,
      spineX - 33 * lSpan, -9,
      spineX - 34 * lSpan, -3,
      spineX - 15 * lSpan, 7
    ]);
    ctx.fill();
    polyPath(ctx, [
      spineX + 12 * rSpan, -4,
      spineX + 33 * rSpan, -9,
      spineX + 34 * rSpan, -3,
      spineX + 15 * rSpan, 7
    ]);
    ctx.fill();

    // Golden trim accents along wing roots
    ctx.fillStyle = '#f59e0b';
    polyPath(ctx, [
      spineX - 11 * lSpan, -7,
      spineX - 28 * lSpan, -10.5,
      spineX - 27 * lSpan, -8,
      spineX - 11 * lSpan, -4.5
    ]);
    ctx.fill();
    polyPath(ctx, [
      spineX + 11 * rSpan, -7,
      spineX + 28 * rSpan, -10.5,
      spineX + 27 * rSpan, -8,
      spineX + 11 * rSpan, -4.5
    ]);
    ctx.fill();

    // Crisp mechanical panel lines
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.36)';
    ctx.lineWidth = 0.95;
    ctx.beginPath();
    ctx.moveTo(spineX - 10 * lSpan, 2); ctx.lineTo(spineX - 29 * lSpan, 6);
    ctx.moveTo(spineX + 10 * rSpan, 2); ctx.lineTo(spineX + 29 * rSpan, 6);
    ctx.moveTo(spineX - 7 * lSpan, -18); ctx.lineTo(spineX - 8 * lSpan, 18);
    ctx.moveTo(spineX + 7 * rSpan, -18); ctx.lineTo(spineX + 8 * rSpan, 18);
    ctx.stroke();

    // Central raised spine fuselage (metallic shading)
    const bodyG = ctx.createLinearGradient(spineX - 10, 0, spineX + 10, 0);
    bodyG.addColorStop(0, bank > 0 ? '#ffffff' : '#cbd5e1');
    bodyG.addColorStop(0.5, '#f8fafc');
    bodyG.addColorStop(1, bank < 0 ? '#ffffff' : '#94a3b8');
    ctx.fillStyle = bodyG;
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.5;
    polyPath(ctx, [
      spineX, -37,
      spineX + 7.2, -14,
      spineX + 8.5, 19,
      spineX, 25,
      spineX - 8.5, 19,
      spineX - 7.2, -14
    ]);
    ctx.fill();
    ctx.stroke();

    // Dark titanium serrated vector exhaust nozzles
    for (const nx of [-8.5, 8.5]) {
      const ex = nx + spineX * 0.35;
      ctx.fillStyle = '#1e293b';
      ctx.strokeStyle = '#090d16';
      ctx.lineWidth = 1.4;
      polyPath(ctx, [ex - 4.5, 19, ex + 4.5, 19, ex + 3.6, 25, ex - 3.6, 25]);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ex - 3.8, 21.5);
      ctx.lineTo(ex + 3.8, 21.5);
      ctx.stroke();
    }

    // Twin canted vertical tailfins (with 3D roll parallax)
    for (const side of [-1, 1]) {
      const sp = side < 0 ? lSpan : rSpan;
      const bx = spineX * 0.5 + side * 12 * sp;
      const tipShift = side * 4.5 * sp - bank * 3.5;
      ctx.fillStyle = side * bank < 0 ? '#e2e8f0' : '#64748b';
      ctx.strokeStyle = '#090d16';
      ctx.lineWidth = 1.6;
      polyPath(ctx, [
        bx, 6,
        bx + tipShift, 13,
        bx + tipShift * 0.85, 25,
        bx - side * 1.5, 22
      ]);
      ctx.fill();
      ctx.stroke();

      // Golden fin flash
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(bx + tipShift * 0.85, 14);
      ctx.lineTo(bx + tipShift * 0.75, 23);
      ctx.stroke();
    }

    // Teardrop bubble glass canopy (ice-blue & amber iridescent tint + specular reflection)
    const cx = spineX * 0.88;
    const canG = ctx.createLinearGradient(cx - 4, -22, cx + 4, 2);
    canG.addColorStop(0, '#082f49');
    canG.addColorStop(0.38, '#0284c7');
    canG.addColorStop(0.76, '#38bdf8');
    canG.addColorStop(1, '#fbbf24');
    ctx.fillStyle = canG;
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, -24);
    ctx.bezierCurveTo(cx + 5.6, -19, cx + 5.4, -4, cx, 3);
    ctx.bezierCurveTo(cx - 5.4, -4, cx - 5.6, -19, cx, -24);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Canopy frame arch & crisp glass specular streak
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(cx - 4.4, -10);
    ctx.quadraticCurveTo(cx, -12.5, cx + 4.4, -10);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.beginPath();
    ctx.ellipse(cx - 1.6, -14.5, 1.2, 5.2, -0.12, 0, TAU);
    ctx.fill();

    // Wingtip navigation strobes & contrail vortex dots
    const navBlink = 0.55 + Math.sin(time * 12) * 0.45;
    drawRadialGlow(ctx, spineX - 38 * lSpan, -6, 5.5, '#ffffff', `rgba(244, 63, 94, ${navBlink.toFixed(2)})`, 'rgba(244, 63, 94, 0)');
    drawRadialGlow(ctx, spineX + 38 * rSpan, -6, 5.5, '#ffffff', `rgba(56, 189, 248, ${navBlink.toFixed(2)})`, 'rgba(56, 189, 248, 0)');
  }

  function drawCarCraft(ctx, o) {
    const bank = o.bank;
    const time = o.time;
    const breath = o.breath;
    const weaponLv = o.weaponLv;
    const lSpan = clamp(1 + bank * 0.18, 0.72, 1.2);
    const rSpan = clamp(1 - bank * 0.18, 0.72, 1.2);
    const shiftX = bank * 3.5;

    // 1. Twin forward headlight cones (soft translucent beams toward -Y)
    for (const side of [-1, 1]) {
      const hx = shiftX + side * 11;
      const hg = ctx.createLinearGradient(hx, -32, hx + side * 8, -88);
      hg.addColorStop(0, 'rgba(254, 249, 195, 0.52)');
      hg.addColorStop(0.5, 'rgba(103, 232, 249, 0.18)');
      hg.addColorStop(1, 'rgba(103, 232, 249, 0)');
      ctx.fillStyle = hg;
      polyPath(ctx, [hx - 3, -31, hx - 13 + side * 4, -88, hx + 13 + side * 4, -88, hx + 3, -31]);
      ctx.fill();
    }

    // 2. Quad blue-flame afterburners at rear diffuser
    const quadPal = {
      outer0: 'rgba(59, 130, 246, 0.82)',
      outer1: 'rgba(56, 189, 248, 0.55)',
      mid: breath > 0.12 ? '#e0f2fe' : '#38bdf8',
      tail: 'rgba(37, 99, 235, 0.45)',
      diamond: '#ffffff'
    };
    const pLen = 22 + breath * 22;
    for (const ex of [-13, -5, 5, 13]) {
      drawMachPlume(ctx, ex + shiftX * 0.3, 28, 3.6, pLen * (Math.abs(ex) > 9 ? 0.85 : 1.05), -bank * 7, quadPal, time + ex, 3);
    }

    // Evolution wings behind hover-wings
    drawEvolutionWings(ctx, 26, 2, o.evoTier, bank, time, 0.9);

    // 3. Deployable folding aero hover-wings on both sides
    for (const side of [-1, 1]) {
      const sp = side < 0 ? lSpan : rSpan;
      ctx.save();
      ctx.translate(shiftX * 0.4 + side * 17, 2);
      ctx.scale(side * sp, 1);
      // Mechanical strut
      ctx.fillStyle = '#334155';
      ctx.strokeStyle = '#090d16';
      ctx.lineWidth = 1.8;
      polyPath(ctx, [0, -10, 18, -4, 22, 10, 0, 12]);
      ctx.fill();
      ctx.stroke();
      // Luminous cyan aero hover-blade
      const wg = ctx.createLinearGradient(4, -6, 26, 8);
      wg.addColorStop(0, '#0ea5e9');
      wg.addColorStop(1, '#67e8f9');
      ctx.fillStyle = wg;
      polyPath(ctx, [6, -7, 25, -1, 27, 8, 8, 9]);
      ctx.fill();
      ctx.stroke();

      if (weaponLv >= 2) {
        ctx.fillStyle = '#fde047';
        ctx.beginPath();
        ctx.arc(17, -6, 2.3, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }

    // 4. Heavy Golden Electromagnetic Ram Bumper at front nose (tank ramming trait!)
    const ramG = ctx.createLinearGradient(-18, -38, 18, -24);
    ramG.addColorStop(0, '#b45309');
    ramG.addColorStop(0.35, '#fde047');
    ramG.addColorStop(0.65, '#f59e0b');
    ramG.addColorStop(1, '#fef08a');
    ctx.fillStyle = ramG;
    ctx.strokeStyle = '#090d16';
    ctx.lineWidth = 2.3;
    polyPath(ctx, [
      shiftX, -39,
      shiftX + 15, -32,
      shiftX + 20, -23,
      shiftX + 13, -21,
      shiftX, -26,
      shiftX - 13, -21,
      shiftX - 20, -23,
      shiftX - 15, -32
    ]);
    ctx.fill();
    ctx.stroke();

    // Glowing electromagnetic ram coil seam
    ctx.strokeStyle = '#67e8f9';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(shiftX - 12, -28);
    ctx.lineTo(shiftX, -34);
    ctx.lineTo(shiftX + 12, -28);
    ctx.stroke();

    // 5. Streamlined wide-body cyber supercar chassis (metallic crimson-amber & pearl)
    const hullG = ctx.createLinearGradient(shiftX - 20, -26, shiftX + 20, 26);
    hullG.addColorStop(0, '#9a3412');
    hullG.addColorStop(0.3, '#ea580c');
    hullG.addColorStop(0.55, '#fb923c');
    hullG.addColorStop(0.85, '#dc2626');
    hullG.addColorStop(1, '#7f1d1d');
    ctx.fillStyle = hullG;
    ctx.strokeStyle = '#090d16';
    ctx.lineWidth = 2.4;
    polyPath(ctx, [
      shiftX - 14, -27,
      shiftX + 14, -27,
      shiftX + 19, -14,
      shiftX + 17, 0,
      shiftX + 20, 15,
      shiftX + 16, 28,
      shiftX - 16, 28,
      shiftX - 20, 15,
      shiftX - 17, 0,
      shiftX - 19, -14
    ]);
    ctx.fill();
    ctx.stroke();

    // Twin pearl-white racing stripes
    ctx.fillStyle = 'rgba(248, 250, 252, 0.9)';
    ctx.fillRect(shiftX - 5.2, -26, 3.2, 52);
    ctx.fillRect(shiftX + 2.0, -26, 3.2, 52);

    // Front hood carbon radiator louvers
    ctx.fillStyle = '#0f172a';
    roundRectPath(ctx, shiftX - 9.5, -22, 19, 8.5, 2);
    ctx.fill();
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let y = -20; y <= -15; y += 2.5) {
      ctx.moveTo(shiftX - 7.5, y);
      ctx.lineTo(shiftX + 7.5, y);
    }
    ctx.stroke();

    // Wrap-around cybernetic windshield & panoramic roof
    const winG = ctx.createLinearGradient(shiftX - 10, -10, shiftX + 10, 10);
    winG.addColorStop(0, '#082f49');
    winG.addColorStop(0.5, '#0284c7');
    winG.addColorStop(1, '#38bdf8');
    ctx.fillStyle = winG;
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.6;
    polyPath(ctx, [
      shiftX - 11, -9,
      shiftX + 11, -9,
      shiftX + 13, 2,
      shiftX + 9, 13,
      shiftX - 9, 13,
      shiftX - 13, 2
    ]);
    ctx.fill();
    ctx.stroke();

    // Windshield specular slash
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(shiftX - 7, -6.5);
    ctx.lineTo(shiftX + 3, -6.5);
    ctx.stroke();

    // Roof-mounted twin autocannon turret + rear spoiler wing
    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = '#090d16';
    ctx.lineWidth = 1.6;
    roundRectPath(ctx, shiftX - 18, 19, 36, 6, 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#fde047';
    ctx.fillRect(shiftX - 12, -28.5, 4.5, 2.5);
    ctx.fillRect(shiftX + 7.5, -28.5, 4.5, 2.5);
  }

  function drawOrbCraft(ctx, o) {
    const bank = o.bank;
    const time = o.time;
    const breath = o.breath;
    const R = 29;

    // Thruster wake from astrolabe bottom vents
    const orbPal = {
      outer0: 'rgba(56, 189, 248, 0.76)',
      outer1: 'rgba(167, 139, 250, 0.5)',
      mid: '#67e8f9',
      tail: 'rgba(99, 102, 241, 0.4)',
      diamond: '#ffffff'
    };
    const pLen = 22 + breath * 22;
    drawMachPlume(ctx, -9, R - 2, 4.2, pLen * 0.85, -bank * 6, orbPal, time, 3);
    drawMachPlume(ctx, 0, R, 5.2, pLen, -bank * 6, orbPal, time + 0.5, 3);
    drawMachPlume(ctx, 9, R - 2, 4.2, pLen * 0.85, -bank * 6, orbPal, time + 1.1, 3);

    // Evolution astral wings
    drawEvolutionWings(ctx, R - 2, 0, o.evoTier, bank, time, 0.92);

    ctx.save();
    ctx.scale(1 - Math.abs(bank) * 0.14, 1);

    // 1. Outer Mithril Relief Guide Ring + Forward Golden Spire (-Y orientation cue)
    const mithrilG = ctx.createLinearGradient(-R, -R, R, R);
    mithrilG.addColorStop(0, '#f8fafc');
    mithrilG.addColorStop(0.45, '#cbd5e1');
    mithrilG.addColorStop(0.75, '#64748b');
    mithrilG.addColorStop(1, '#e2e8f0');
    ctx.fillStyle = mithrilG;
    ctx.strokeStyle = '#090d16';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, TAU);
    ctx.fill();
    ctx.stroke();

    // Inner recess dark cosmic well
    ctx.fillStyle = '#0b132b';
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(0, 0, R - 6.5, 0, TAU);
    ctx.fill();
    ctx.stroke();

    // Forward golden navigator spire at -Y & 8 fluted mithril lugs
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU - Math.PI * 0.5;
      ctx.save();
      ctx.rotate(a);
      ctx.fillStyle = k === 0 ? '#fbbf24' : '#94a3b8';
      ctx.strokeStyle = '#090d16';
      ctx.lineWidth = 1.3;
      if (k === 0) {
        polyPath(ctx, [R - 4, -5, R + 9, 0, R - 4, 5]);
      } else {
        roundRectPath(ctx, R - 5, -3, 6.5, 6, 1.5);
      }
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // 2. Six Cyan Energy Conduit Channels radiating to core
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU - Math.PI * 0.5;
      ctx.save();
      ctx.rotate(a);
      const pulse = 0.65 + Math.sin(time * 7 + k) * 0.3;
      ctx.strokeStyle = `rgba(34, 211, 238, ${pulse.toFixed(2)})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(10, 0);
      ctx.lineTo(R - 7, 0);
      ctx.stroke();
      ctx.strokeStyle = '#ecfeff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(11, 0);
      ctx.lineTo(R - 8, 0);
      ctx.stroke();
      ctx.restore();
    }

    // 3. Counter-rotating Golden Astrolabe Graduated Ring
    ctx.save();
    ctx.rotate(-time * 1.35);
    const goldR = R - 10.5;
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(0, 0, goldR, 0, TAU);
    ctx.stroke();

    ctx.strokeStyle = '#fef08a';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * TAU;
      const inner = k % 4 === 0 ? goldR - 4.5 : goldR - 2.4;
      ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
      ctx.lineTo(Math.cos(a) * (goldR + 1.5), Math.sin(a) * (goldR + 1.5));
    }
    ctx.stroke();
    ctx.restore();

    // 4. Central Translucent Pulsing Sapphire Reactor Core
    const corePulse = 1 + Math.sin(time * 6) * 0.08;
    const cr = 10.5 * corePulse;
    drawRadialGlow(ctx, 0, 0, cr * 1.7, '#ffffff', 'rgba(56, 189, 248, 0.72)', 'rgba(14, 165, 233, 0)');

    const sapG = ctx.createRadialGradient(-3, -3, 1, 0, 0, cr);
    sapG.addColorStop(0, '#ffffff');
    sapG.addColorStop(0.35, '#67e8f9');
    sapG.addColorStop(0.75, '#0284c7');
    sapG.addColorStop(1, '#1e3a8a');
    ctx.fillStyle = sapG;
    ctx.strokeStyle = '#bae6fd';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(0, 0, cr, 0, TAU);
    ctx.fill();
    ctx.stroke();

    // Faceted star highlight inside sapphire
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    polyPath(ctx, [0, -cr * 0.68, 2.2, -2.2, cr * 0.68, 0, 2.2, 2.2, 0, cr * 0.68, -2.2, 2.2, -cr * 0.68, 0, -2.2, -2.2]);
    ctx.fill();

    ctx.restore();
  }

  function drawVirtualPlayer(ctx, opts) {
    if (!ctx) return;
    const o = opts || {};
    const shape = o.shape || 'jet';
    const bank = clamp(Number(o.bank) || 0, -1, 1);
    const rollTimer = Number(o.rollTimer) || 0;
    const rollDuration = Math.max(0.15, Number(o.rollDuration) || 0.42);
    const weaponLv = clamp(Math.round(Number(o.weaponLv) || 1), 1, 5);
    const hpRatio = o.hpRatio !== undefined ? clamp(Number(o.hpRatio), 0, 1) : 1;
    const invincible = Boolean(o.invincible) || Number(o.invulnTimer) > 0;
    const breath = clamp(Number(o.breath) || 0, 0, 1);
    const railCharge = clamp(Number(o.railCharge) || 0, 0, 1);
    const railOvercharge = Boolean(o.railOvercharge);
    const railPerfect = Boolean(o.railPerfect);
    const time = Number(o.time) || 0;
    const evoTier = clamp(Math.round(Number(o.evoTier) || 0), 0, 3);

    // Gentle scale normalization so craft always fits cleanly inside shield/hit-core bounds
    const wIn = Number(o.width) || 82;
    const lIn = Number(o.length) || 96;
    const craftScale = clamp(Math.min(wIn / 82, lIn / 96), 0.78, 1.18);

    const parsed = {
      shape, bank, rollTimer, rollDuration, weaponLv, hpRatio,
      invincible, breath, railCharge, railOvercharge, railPerfect, time, evoTier
    };

    ctx.save();

    // 1. Soft atmospheric backdrop contrast shadow + offset cloud shadow
    const shX = -bank * 15 + 7;
    const shY = 18;
    ctx.fillStyle = 'rgba(2, 8, 23, 0.28)';
    ctx.beginPath();
    ctx.ellipse(shX, shY, 28 * craftScale * (1 - Math.abs(bank) * 0.2), 18 * craftScale, bank * 0.12, 0, TAU);
    ctx.fill();

    // Subtle dark halo directly beneath airframe so bright white clouds never wash out edges
    drawRadialGlow(ctx, 0, 0, 44 * craftScale, 'rgba(2, 8, 23, 0.34)', 'rgba(2, 8, 23, 0.14)', 'rgba(2, 8, 23, 0)');

    // 2. Invincibility prism ring
    if (invincible) {
      const ia = 0.45 + Math.sin(time * 24) * 0.25;
      ctx.strokeStyle = `rgba(224, 242, 254, ${ia.toFixed(2)})`;
      ctx.lineWidth = 2.2;
      ctx.setLineDash([8, 6]);
      ctx.lineDashOffset = -time * 48;
      ctx.beginPath();
      ctx.arc(0, 0, 38 * craftScale, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
    }

    // 3. Main craft transform (tilt + 360-degree barrel roll animation)
    ctx.save();
    ctx.scale(craftScale, craftScale);
    ctx.rotate(bank * 0.13);

    if (rollTimer > 0) {
      const prog = 1 - clamp(rollTimer / rollDuration, 0, 1);
      const rollCos = Math.cos(prog * TAU);
      const rollScaleX = Math.sign(rollCos || 1) * Math.max(0.22, Math.abs(rollCos));
      ctx.scale(rollScaleX, 1);
    }

    if (shape === 'car') {
      drawCarCraft(ctx, parsed);
    } else if (shape === 'orb') {
      drawOrbCraft(ctx, parsed);
    } else {
      drawJetCraft(ctx, parsed);
    }

    // Low-HP battle sparks on player hull
    if (hpRatio < 0.45) {
      drawBattleDamage(ctx, 22, hpRatio, time, 1.7);
    }
    ctx.restore();

    // Barrel-roll slipstream vortex ring
    if (rollTimer > 0) {
      ctx.strokeStyle = 'rgba(186, 230, 253, 0.78)';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.ellipse(0, 0, 42 * craftScale, 16 * craftScale, bank * 0.2, 0, TAU);
      ctx.stroke();
    }

    // 4. Nose railgun charge fusion orb (unless host explicitly disables it)
    if (railCharge > 0.04 && o.drawRailSphere !== false) {
      drawRailFusionSphere(ctx, 0, -41 * craftScale, railCharge, railPerfect, railOvercharge, time);
    }

    ctx.restore();
  }

  // ============================================================================
  // 2. TABLETOP RIG & ACCOMPANIMENT FX — Origin (0,0), Interior CLEAR for Toy!
  // ============================================================================

  function traceRigOutline(ctx, w, l, shape) {
    const hw = w * 0.5;
    const hl = l * 0.5;
    if (shape === 'car') {
      roundRectPath(ctx, -hw, -hl, w, l, Math.min(hw * 0.45, 18));
    } else if (shape === 'orb') {
      ctx.beginPath();
      ctx.ellipse(0, 0, hw, hl, 0, 0, TAU);
    } else {
      polyPath(ctx, [
        0, -hl,
        hw * 0.34, -hl * 0.25,
        hw, hl * 0.35,
        hw * 0.42, hl * 0.68,
        hw * 0.28, hl,
        -hw * 0.28, hl,
        -hw * 0.42, hl * 0.68,
        -hw, hl * 0.35,
        -hw * 0.34, -hl * 0.25
      ]);
    }
  }

  function drawTabletopRig(ctx, opts) {
    if (!ctx) return;
    const o = opts || {};
    const shape = o.shape || 'jet';
    const rw = Math.max(36, Number(o.width) || 86);
    const rl = Math.max(44, Number(o.length) || 118);
    const hw = rw * 0.5;
    const hl = rl * 0.5;
    const bank = clamp(Number(o.bank) || 0, -1, 1);
    const rollTimer = Number(o.rollTimer) || 0;
    const weaponLv = clamp(Math.round(Number(o.weaponLv) || 1), 1, 5);
    const invincible = Boolean(o.invincible) || Number(o.invulnTimer) > 0;
    const breath = clamp(Number(o.breath) || 0, 0, 1);
    const boost = o.boost !== undefined ? clamp(Number(o.boost), 0, 1) : clamp(breath * 0.85, 0, 1);
    const railCharge = clamp(Number(o.railCharge) || 0, 0, 1);
    const railOvercharge = Boolean(o.railOvercharge);
    const railPerfect = Boolean(o.railPerfect);
    const time = Number(o.time) || 0;
    const evoTier = clamp(Math.round(Number(o.evoTier) || 0), 0, 3);
    const phase = o.phase || 'playing';
    const onTitle = phase === 'title';
    const calibOpen = Boolean(o.calibOpen);
    const pureCamera = Boolean(o.pureCamera);

    ctx.save();

    // 1. Multi-layered soft realistic cast shadow (counter-shifted by bank, clipped outside interior!)
    const shOffX = -bank * 24 + 8;
    const shOffY = (onTitle ? 11 : 17) + boost * 10;
    for (let layer = 0; layer < 2; layer++) {
      const expand = layer === 0 ? 12 : 3;
      ctx.save();
      // Even-odd exterior clip keeps the real toy's interior window crystal clear!
      ctx.beginPath();
      ctx.rect(-rw * 2.5, -rl * 2.5, rw * 5, rl * 5);
      if (shape === 'orb') {
        ctx.ellipse(0, 0, hw - 1, hl - 1, 0, 0, TAU);
      } else {
        ctx.rect(-hw + 1, -hl + 1, rw - 2, rl - 2);
      }
      ctx.clip('evenodd');

      ctx.translate(shOffX, shOffY);
      ctx.scale(1.04 - Math.abs(bank) * 0.08, 1.04);
      traceRigOutline(ctx, rw + expand, rl + expand, shape);
      ctx.fillStyle = layer === 0 ? 'rgba(2, 10, 24, 0.22)' : 'rgba(2, 10, 24, 0.38)';
      ctx.fill();
      ctx.restore();
    }

    // 2. Holographic Evolution Wings flanking the tabletop pad (outside ±hw!)
    if (evoTier > 0) {
      const wingScale = clamp(Math.min(rw, rl) / 92, 0.85, 1.35);
      drawEvolutionWings(ctx, hw + 10, 4, evoTier, bank, time, wingScale);
    }

    // 3. Rim-mounted Twin Scramjet Nozzles & Mach-Diamond Plumes (grows cyan-white with breath!)
    const tailY = hl + 3;
    const swayX = -bank * 18;
    const baseFlame = onTitle ? 22 : (38 + boost * 42 + breath * 36);
    const engineOffsets = shape === 'jet' && rw < 54
      ? [0]
      : (shape === 'car' && rw >= 76 ? [-rw * 0.28, -rw * 0.11, rw * 0.11, rw * 0.28] : [-rw * 0.24, rw * 0.24]);
    const nozzleW = engineOffsets.length > 2 ? 4.5 : 6.8;

    const rigPlumePal = breath > 0.1
      ? {
          outer0: 'rgba(34, 211, 238, 0.88)',
          outer1: 'rgba(165, 243, 252, 0.68)',
          mid: '#ecfeff',
          tail: 'rgba(56, 189, 248, 0.52)',
          diamond: '#ffffff'
        }
      : {
          outer0: 'rgba(249, 115, 22, 0.78)',
          outer1: 'rgba(251, 191, 36, 0.55)',
          mid: '#fde047',
          tail: 'rgba(234, 88, 12, 0.45)',
          diamond: '#ffffff'
        };

    for (let i = 0; i < engineOffsets.length; i++) {
      const ex = engineOffsets[i];
      // Crisp external titanium thruster collar right on the rear border
      ctx.fillStyle = '#1e293b';
      ctx.strokeStyle = breath > 0.1 ? '#67e8f9' : '#fbbf24';
      ctx.lineWidth = 1.4;
      polyPath(ctx, [ex - nozzleW, tailY - 2, ex + nozzleW, tailY - 2, ex + nozzleW * 0.82, tailY + 4, ex - nozzleW * 0.82, tailY + 4]);
      ctx.fill();
      ctx.stroke();

      drawMachPlume(ctx, ex, tailY + 3, nozzleW, baseFlame, swayX, rigPlumePal, time + i * 0.6, 4);
    }

    // 4. Aerodynamic Perimeter Shield Contour (hugs outside of rw x rl)
    const contourAlpha = rollTimer > 0
      ? 0.95
      : (invincible ? 0.52 + Math.sin(time * 26) * 0.24 : (onTitle || calibOpen ? 0.65 : 0.26));
    traceRigOutline(ctx, rw + 8, rl + 8, shape);
    ctx.strokeStyle = rollTimer > 0
      ? 'rgba(186, 230, 253, 0.96)'
      : `rgba(226, 232, 240, ${contourAlpha.toFixed(2)})`;
    ctx.lineWidth = rollTimer > 0 ? 3.8 : 1.8;
    ctx.stroke();

    // 5. Precision Golden Holographic Mechanical Corner Latches & Breathing Scale Rails
    if (!pureCamera) {
      const uiBright = onTitle || calibOpen || (Number(o.calibHighlightTimer) > 0);
      const pulse = 0.82 + Math.sin(time * 4) * 0.14;
      const latchA = uiBright ? pulse : 0.34;
      const bx = hw + 11;
      const by = hl + 11;
      const arm = Math.min(20, Math.min(rw, rl) * 0.24);

      // Lateral breathing scale guide rails along left & right flanks
      const railX = hw + 9;
      const railH = rl * 0.56;
      ctx.strokeStyle = `rgba(56, 189, 248, ${(latchA * 0.55).toFixed(2)})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(-railX, -railH * 0.5); ctx.lineTo(-railX, railH * 0.5);
      ctx.moveTo(railX, -railH * 0.5); ctx.lineTo(railX, railH * 0.5);
      ctx.stroke();

      // Graduated tick pips along guide rails (lights up with breath & weaponLv)
      const ticks = 5;
      const litCount = Math.round(clamp(breath * ticks, 0, ticks));
      for (let t = 0; t < ticks; t++) {
        const ty = lerp(railH * 0.44, -railH * 0.44, t / (ticks - 1));
        const active = t < litCount || t < weaponLv - 1;
        ctx.strokeStyle = active
          ? `rgba(103, 232, 249, ${(0.75 + Math.sin(time * 10 + t) * 0.2).toFixed(2)})`
          : `rgba(251, 191, 36, ${(latchA * 0.6).toFixed(2)})`;
        ctx.lineWidth = active ? 2.2 : 1.3;
        ctx.beginPath();
        ctx.moveTo(-railX - 4, ty); ctx.lineTo(-railX + 1, ty);
        ctx.moveTo(railX - 1, ty); ctx.lineTo(railX + 4, ty);
        ctx.stroke();
      }

      // Four precision beveled golden holographic corner clasps
      const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
      for (const [sx, sy] of corners) {
        const cx = sx * bx;
        const cy = sy * by;
        ctx.strokeStyle = `rgba(251, 191, 36, ${latchA.toFixed(2)})`;
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.moveTo(cx, cy - sy * arm);
        ctx.lineTo(cx, cy - sy * 3);
        ctx.lineTo(cx - sx * 3, cy);
        ctx.lineTo(cx - sx * arm, cy);
        ctx.stroke();

        // Inner cyan optical Pip at clasp joint
        ctx.fillStyle = `rgba(103, 232, 249, ${(latchA * 0.9).toFixed(2)})`;
        ctx.beginPath();
        ctx.arc(cx - sx * 2.5, cy - sy * 2.5, 2, 0, TAU);
        ctx.fill();
      }
    }

    // 6. Forward Fire-Control Reticle & Railgun Fusion Sphere ahead of nose (-hl)
    const noseY = -hl - 12;
    if (!pureCamera && !calibOpen) {
      const retA = onTitle ? 0.55 : 0.42;
      ctx.strokeStyle = `rgba(103, 232, 249, ${retA.toFixed(2)})`;
      ctx.lineWidth = 1.5;
      // Forward chevron reticle
      ctx.beginPath();
      ctx.moveTo(-9, noseY + 4);
      ctx.lineTo(0, noseY - 3);
      ctx.lineTo(9, noseY + 4);
      ctx.moveTo(-14, noseY + 2);
      ctx.lineTo(-18, noseY + 2);
      ctx.moveTo(14, noseY + 2);
      ctx.lineTo(18, noseY + 2);
      ctx.stroke();
    }

    if (!onTitle && Boolean(o.muzzleFlash) && railCharge <= 0.04) {
      drawRadialGlow(ctx, -rw * 0.2, noseY + 3, 8, '#ffffff', 'rgba(254, 240, 138, 0.85)', 'rgba(56, 189, 248, 0)');
      drawRadialGlow(ctx, rw * 0.2, noseY + 3, 8, '#ffffff', 'rgba(254, 240, 138, 0.85)', 'rgba(56, 189, 248, 0)');
    }

    if (!onTitle && railCharge > 0.04 && o.drawRailSphere !== false) {
      drawRailFusionSphere(ctx, 0, noseY - 4, railCharge, railPerfect, railOvercharge, time);
    }

    ctx.restore();
  }

  // ============================================================================
  // 3. AUTONOMOUS BIT-DRONE ('drawDrone')
  // ============================================================================

  function drawDrone(ctx, opts) {
    if (!ctx) return;
    const o = opts || {};
    const x = Number(o.x) || 0;
    const y = Number(o.y) || 0;
    const index = Number(o.index) || 0;
    const bank = clamp(Number(o.bank) || 0, -1, 1);
    const time = Number(o.time) || 0;
    const hasLightning = Boolean(o.hasLightning);
    const weaponLv = clamp(Math.round(Number(o.weaponLv) || 1), 1, 5);

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-bank * 0.16 + Math.sin(time * 4.5 + index * 1.7) * 0.08);

    // Micro exhaust plume
    const dPal = hasLightning
      ? { outer0: 'rgba(139, 92, 246, 0.75)', outer1: 'rgba(56, 189, 248, 0.5)', mid: '#67e8f9', diamond: '#ffffff' }
      : { outer0: 'rgba(16, 185, 129, 0.72)', outer1: 'rgba(52, 211, 153, 0.45)', mid: '#6ee7b7', diamond: '#ffffff' };
    drawMachPlume(ctx, 0, 8, 2.8, 10 + Math.sin(time * 40 + index) * 2, 0, dPal, time + index, 2);

    // Diamond bit-wing metallic chassis
    const hullG = ctx.createLinearGradient(-10, -10, 10, 10);
    hullG.addColorStop(0, '#f8fafc');
    hullG.addColorStop(0.5, '#94a3b8');
    hullG.addColorStop(1, '#334155');
    ctx.fillStyle = hullG;
    ctx.strokeStyle = '#090d16';
    ctx.lineWidth = 1.8;
    ctx.lineJoin = 'round';

    const spread = weaponLv >= 3 ? 12.5 : 10.5;
    polyPath(ctx, [
      0, -12,
      spread, 1,
      6.5, 9,
      2.5, 7,
      0, 10,
      -2.5, 7,
      -6.5, 9,
      -spread, 1
    ]);
    ctx.fill();
    ctx.stroke();

    // Accent winglet trims
    ctx.strokeStyle = hasLightning ? '#38bdf8' : '#34d399';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(-spread + 2.5, 1); ctx.lineTo(-3, -6);
    ctx.moveTo(spread - 2.5, 1); ctx.lineTo(3, -6);
    ctx.stroke();

    // Central luminous energy core
    const coreCol = hasLightning ? '#38bdf8' : '#34d399';
    drawRadialGlow(ctx, 0, -1, 7.5, '#ffffff', hasLightning ? 'rgba(56, 189, 248, 0.75)' : 'rgba(52, 211, 153, 0.75)', 'rgba(0,0,0,0)');
    ctx.fillStyle = coreCol;
    polyPath(ctx, [0, -5, 3.4, -1, 0, 3.2, -3.4, -1]);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, -1, 1.5, 0, TAU);
    ctx.fill();

    // Crackling miniature electric arcs when Tesla Chain skill is active
    if (hasLightning) {
      const seed = Math.floor(time * 26) + index * 37;
      for (let k = 0; k < 2; k++) {
        const a1 = time * 4 + k * Math.PI + index;
        const a2 = a1 + 1.9;
        drawElectricArc(
          ctx,
          Math.cos(a1) * 11, Math.sin(a1) * 11,
          Math.cos(a2) * 11, Math.sin(a2) * 11,
          4, 3.2, 'rgba(168, 85, 247, 0.78)', '#e0f2fe', 1.0, seed + k * 13
        );
      }
    }

    ctx.restore();
  }

  // ============================================================================
  // 4. SEVEN ENEMY MECHA ARCHETYPES — Origin (0,0), Facing +Y (Downward)
  // ============================================================================

  function drawEnemyThruster(ctx, x, y, w, len, col, time) {
    // Enemy nozzles sit on -Y rear edge and point toward -Y (upward)
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, -1);
    drawMachPlume(ctx, 0, 0, w, len, 0, {
      outer0: col,
      outer1: 'rgba(251, 146, 60, 0.35)',
      mid: '#fde047',
      tail: 'rgba(239, 68, 68, 0.25)',
      diamond: '#ffffff'
    }, time, 2);
    ctx.restore();
  }

  function drawScout(ctx, e, time, flashAlpha) {
    // Crimson Falcon Drone: agile forward-swept delta drone + bright orange mono-eye + single thruster
    drawEnemyThruster(ctx, 0, -13, 3.8, 14, 'rgba(249, 115, 22, 0.8)', time + (e.phase || 0));

    const g = ctx.createLinearGradient(-18, -14, 18, 18);
    g.addColorStop(0, '#450a0a');
    g.addColorStop(0.45, '#991b1b');
    g.addColorStop(1, '#dc2626');
    ctx.fillStyle = g;
    ctx.strokeStyle = '#090d16';
    ctx.lineWidth = 2.2;
    ctx.lineJoin = 'round';
    polyPath(ctx, [
      0, 21,
      7, 8,
      20, -4,
      17, -14,
      6, -9,
      0, -14,
      -6, -9,
      -17, -14,
      -20, -4,
      -7, 8
    ]);
    ctx.fill();
    ctx.stroke();

    // Dark slate stealth shoulder plates & panel lines
    ctx.fillStyle = '#1e293b';
    polyPath(ctx, [-6, -9, -16, -12, -13, -3, -5, 4]);
    ctx.fill();
    polyPath(ctx, [6, -9, 16, -12, 13, -3, 5, 4]);
    ctx.fill();

    ctx.strokeStyle = 'rgba(254, 202, 202, 0.55)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(-6, 6); ctx.lineTo(-17, -4);
    ctx.moveTo(6, 6); ctx.lineTo(17, -4);
    ctx.stroke();

    // Bright orange mono-eye sensor dome
    drawRadialGlow(ctx, 0, 3, 7.5, '#ffffff', 'rgba(251, 146, 60, 0.85)', 'rgba(234, 88, 12, 0)');
    ctx.fillStyle = '#ea580c';
    ctx.strokeStyle = '#090d16';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, 3, 4.2, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fef08a';
    ctx.beginPath();
    ctx.arc(-1.1, 1.8, 1.4, 0, TAU);
    ctx.fill();

    if (flashAlpha > 0) {
      ctx.fillStyle = `rgba(224, 247, 255, ${flashAlpha.toFixed(2)})`;
      polyPath(ctx, [0, 21, 20, -4, 17, -14, 0, -14, -17, -14, -20, -4]);
      ctx.fill();
    }
  }

  function drawGunship(ctx, e, time, flashAlpha) {
    // Heavy Twin-Engine Gunship: titanium broad-wing armor, triple nose cannon, glowing turbofan intakes
    drawEnemyThruster(ctx, -15, -25, 5.2, 18, 'rgba(251, 146, 60, 0.85)', time);
    drawEnemyThruster(ctx, 15, -25, 5.2, 18, 'rgba(251, 146, 60, 0.85)', time + 0.8);

    // Triple nose cannon barrels (+Y)
    ctx.fillStyle = '#0f172a';
    ctx.strokeStyle = '#090d16';
    ctx.lineWidth = 1.4;
    for (const bx of [-6, 0, 6]) {
      const len = bx === 0 ? 11 : 8;
      roundRectPath(ctx, bx - 1.8, 22, 3.6, len, 1.2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fb923c';
      ctx.fillRect(bx - 1.2, 22 + len - 2.2, 2.4, 2);
      ctx.fillStyle = '#0f172a';
    }

    // Broad titanium armor hull
    const hullG = ctx.createLinearGradient(-34, -24, 34, 24);
    hullG.addColorStop(0, '#64748b');
    hullG.addColorStop(0.5, '#334155');
    hullG.addColorStop(1, '#1e293b');
    ctx.fillStyle = hullG;
    ctx.strokeStyle = '#090d16';
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    polyPath(ctx, [
      0, 26,
      12, 22,
      20, 8,
      36, 0,
      38, -14,
      24, -25,
      -24, -25,
      -38, -14,
      -36, 0,
      -20, 8,
      -12, 22
    ]);
    ctx.fill();
    ctx.stroke();

    // Orange hazard trim plates on wings
    ctx.fillStyle = '#f97316';
    polyPath(ctx, [-34, -2, -22, 5, -20, -4, -35, -11]);
    ctx.fill();
    polyPath(ctx, [34, -2, 22, 5, 20, -4, 35, -11]);
    ctx.fill();

    // Panel seams
    ctx.strokeStyle = 'rgba(203, 213, 225, 0.35)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(-14, -22); ctx.lineTo(-12, 18);
    ctx.moveTo(14, -22); ctx.lineTo(12, 18);
    ctx.moveTo(-32, -8); ctx.lineTo(32, -8);
    ctx.stroke();

    // Twin wing-mounted glowing turbofan intakes
    for (const tx of [-22, 22]) {
      ctx.fillStyle = '#0f172a';
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(tx, -10, 6.8, 0, TAU);
      ctx.fill();
      ctx.stroke();

      drawRadialGlow(ctx, tx, -10, 6, '#fef08a', 'rgba(251, 146, 60, 0.75)', 'rgba(251, 146, 60, 0)');
      // Spinning turbine blades
      ctx.save();
      ctx.translate(tx, -10);
      ctx.rotate(time * 12 * Math.sign(tx));
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(-5, 0); ctx.lineTo(5, 0);
      ctx.moveTo(0, -5); ctx.lineTo(0, 5);
      ctx.stroke();
      ctx.restore();
    }

    // Central armored cockpit visor
    const visG = ctx.createLinearGradient(0, -4, 0, 14);
    visG.addColorStop(0, '#7c2d12');
    visG.addColorStop(0.6, '#fb923c');
    visG.addColorStop(1, '#fef08a');
    ctx.fillStyle = visG;
    ctx.strokeStyle = '#090d16';
    ctx.lineWidth = 1.5;
    polyPath(ctx, [0, 16, 8, 4, 6, -6, -6, -6, -8, 4]);
    ctx.fill();
    ctx.stroke();

    if (flashAlpha > 0) {
      ctx.fillStyle = `rgba(224, 247, 255, ${flashAlpha.toFixed(2)})`;
      polyPath(ctx, [0, 26, 12, 22, 36, 0, 38, -14, 24, -25, -24, -25, -38, -14, -36, 0, -12, 22]);
      ctx.fill();
    }
  }

  function drawLancer(ctx, e, time, flashAlpha) {
    // Crimson Assault Lancer: elongated spear nose, swept-in wings, roaring crimson plume & Mach shock arcs when dashing!
    const dashing = Boolean(e.dashed);
    const charging = Number(e.chargeWarn) > 0;
    const wingSweep = dashing ? 13 : 18.5;

    // Explosive long crimson afterburner when dashing
    drawEnemyThruster(
      ctx, 0, -17,
      dashing ? 6.5 : 3.6,
      dashing ? 42 : 13,
      dashing ? 'rgba(239, 68, 68, 0.95)' : 'rgba(248, 113, 113, 0.7)',
      time
    );

    // Hull
    const g = ctx.createLinearGradient(-wingSweep, -18, wingSweep, 28);
    g.addColorStop(0, '#450a0a');
    g.addColorStop(0.45, '#b91c1c');
    g.addColorStop(0.85, '#ef4444');
    g.addColorStop(1, '#fecaca');
    ctx.fillStyle = g;
    ctx.strokeStyle = '#090d16';
    ctx.lineWidth = 2.2;
    ctx.lineJoin = 'round';
    polyPath(ctx, [
      0, 31,
      5.5, 8,
      wingSweep, -12,
      wingSweep - 3, -21,
      5, -15,
      0, -19,
      -5, -15,
      -(wingSweep - 3), -21,
      -wingSweep, -12,
      -5.5, 8
    ]);
    ctx.fill();
    ctx.stroke();

    // Ivory-gold spear spine & slit sensor
    ctx.fillStyle = '#fef2f2';
    polyPath(ctx, [0, 30, 3.2, 4, 0, -10, -3.2, 4]);
    ctx.fill();

    ctx.fillStyle = charging ? '#fde047' : '#38bdf8';
    polyPath(ctx, [0, 8, 2.5, -1, 0, -6, -2.5, -1]);
    ctx.fill();

    if (charging) {
      const pulse = 0.5 + Math.sin(time * 30) * 0.35;
      drawRadialGlow(ctx, 0, 28, 11, '#ffffff', `rgba(248, 113, 113, ${pulse.toFixed(2)})`, 'rgba(239, 68, 68, 0)');
    }

    // Supersonic bow shockwave arcs during high-speed dash!
    if (dashing) {
      ctx.strokeStyle = 'rgba(254, 202, 202, 0.85)';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(-18, 10);
      ctx.quadraticCurveTo(0, 36, 18, 10);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(248, 113, 113, 0.52)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(-25, 2);
      ctx.quadraticCurveTo(0, 42, 25, 2);
      ctx.stroke();
    }

    if (flashAlpha > 0) {
      ctx.fillStyle = `rgba(224, 247, 255, ${flashAlpha.toFixed(2)})`;
      polyPath(ctx, [0, 31, wingSweep, -12, wingSweep - 3, -21, 0, -19, -(wingSweep - 3), -21, -wingSweep, -12]);
      ctx.fill();
    }
  }

  function drawWeaver(ctx, e, time, flashAlpha) {
    // Emerald Cloud-Weaver: graceful manta-ray curved flying wing + glowing cyan-emerald energy veins
    const bankRot = Math.sin((e.age || 0) * 3.2 + (e.phase || 0)) * 0.34;
    ctx.save();
    ctx.rotate(bankRot);

    drawEnemyThruster(ctx, -7, -10, 2.8, 10, 'rgba(45, 212, 191, 0.75)', time);
    drawEnemyThruster(ctx, 7, -10, 2.8, 10, 'rgba(45, 212, 191, 0.75)', time + 0.5);

    const g = ctx.createLinearGradient(-24, -12, 24, 16);
    g.addColorStop(0, '#042f2e');
    g.addColorStop(0.45, '#0f766e');
    g.addColorStop(0.85, '#14b8a6');
    g.addColorStop(1, '#5eead4');
    ctx.fillStyle = g;
    ctx.strokeStyle = '#090d16';
    ctx.lineWidth = 2.1;

    ctx.beginPath();
    ctx.moveTo(0, 17);
    ctx.bezierCurveTo(8, 14, 20, 8, 26, -3);
    ctx.quadraticCurveTo(20, -13, 9, -10);
    ctx.lineTo(4, -15);
    ctx.lineTo(0, -11);
    ctx.lineTo(-4, -15);
    ctx.lineTo(-9, -10);
    ctx.quadraticCurveTo(-20, -13, -26, -3);
    ctx.bezierCurveTo(-20, 8, -8, 14, 0, 17);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Bioluminescent cyan energy veins across manta wings
    const veinA = 0.58 + Math.sin(time * 9 + (e.phase || 0)) * 0.32;
    ctx.strokeStyle = `rgba(165, 243, 252, ${veinA.toFixed(2)})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 11);
    ctx.quadraticCurveTo(10, 5, 21, -3);
    ctx.moveTo(0, 11);
    ctx.quadraticCurveTo(-10, 5, -21, -3);
    ctx.moveTo(-12, 1);
    ctx.quadraticCurveTo(0, -5, 12, 1);
    ctx.stroke();

    // Luminous crystal canopy node
    drawRadialGlow(ctx, 0, 2, 7, '#ffffff', 'rgba(103, 232, 249, 0.85)', 'rgba(20, 184, 166, 0)');
    ctx.fillStyle = '#ecfeff';
    ctx.beginPath();
    ctx.ellipse(0, 2, 3.2, 5.2, 0, 0, TAU);
    ctx.fill();

    if (flashAlpha > 0) {
      ctx.fillStyle = `rgba(224, 247, 255, ${flashAlpha.toFixed(2)})`;
      ctx.beginPath();
      ctx.ellipse(0, 1, 24, 13, 0, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawBomber(ctx, e, time, flashAlpha) {
    // Bulwark Heavy Bomber: twin-boom heavy armor, visible ventral bomb-bay rails, quad engine plumes
    for (const ex of [-28, -11, 11, 28]) {
      drawEnemyThruster(ctx, ex, -22, 4.4, 16, 'rgba(245, 158, 11, 0.85)', time + ex * 0.1);
    }

    const hullG = ctx.createLinearGradient(-50, -22, 50, 32);
    hullG.addColorStop(0, '#57534e');
    hullG.addColorStop(0.5, '#292524');
    hullG.addColorStop(1, '#44403c');
    ctx.fillStyle = hullG;
    ctx.strokeStyle = '#090d16';
    ctx.lineWidth = 2.6;
    ctx.lineJoin = 'round';

    // Twin-boom flying fortress silhouette
    polyPath(ctx, [
      0, 34,
      9, 28,
      14, 16,
      24, 19,
      30, 12,
      52, 4,
      48, -13,
      30, -21,
      16, -21,
      12, -16,
      -12, -16,
      -16, -21,
      -30, -21,
      -48, -13,
      -52, 4,
      -30, 12,
      -24, 19,
      -14, 16,
      -9, 28
    ]);
    ctx.fill();
    ctx.stroke();

    // Twin boom structural pods
    ctx.fillStyle = '#1c1917';
    ctx.strokeStyle = '#78716c';
    ctx.lineWidth = 1.2;
    for (const bx of [-21, 21]) {
      roundRectPath(ctx, bx - 5.5, -19, 11, 35, 3);
      ctx.fill();
      ctx.stroke();
    }

    // Amber hazard stripes on outer wings
    ctx.fillStyle = '#fbbf24';
    polyPath(ctx, [-47, -2, -32, 4, -31, -2, -46, -8]);
    ctx.fill();
    polyPath(ctx, [47, -2, 32, 4, 31, -2, 46, -8]);
    ctx.fill();

    // Central ventral Bomb/Mine Bay with guide rails & armed mini-ordnance!
    ctx.fillStyle = '#0c0a09';
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 1.4;
    roundRectPath(ctx, -9.5, -12, 19, 26, 3);
    ctx.fill();
    ctx.stroke();

    // Bomb bay guide rails & glowing ordnance pips
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-4.5, -10); ctx.lineTo(-4.5, 12);
    ctx.moveTo(4.5, -10); ctx.lineTo(4.5, 12);
    ctx.stroke();

    for (const my of [-5, 3]) {
      ctx.fillStyle = '#dc2626';
      ctx.beginPath();
      ctx.arc(-4.5, my, 2.3, 0, TAU);
      ctx.arc(4.5, my, 2.3, 0, TAU);
      ctx.fill();
    }

    // Armored nose greenhouse bombardier canopy
    ctx.fillStyle = '#fde68a';
    ctx.strokeStyle = '#090d16';
    ctx.lineWidth = 1.4;
    polyPath(ctx, [0, 30, 6, 20, -6, 20]);
    ctx.fill();
    ctx.stroke();

    if (flashAlpha > 0) {
      ctx.fillStyle = `rgba(224, 247, 255, ${flashAlpha.toFixed(2)})`;
      polyPath(ctx, [0, 34, 30, 12, 52, 4, 48, -13, 30, -21, -30, -21, -48, -13, -52, 4, -30, 12]);
      ctx.fill();
    }
  }

  function drawMine(ctx, e, time, flashAlpha) {
    // Deep-Space Spiked Mine: octagonal 3D metallic shell, rivets, warning spikes & red-yellow pulse rings when armed
    const armed = Boolean(e.armed) || (typeof e.armTimer === 'number' && e.armTimer >= 0);
    const armLeft = typeof e.armTimer === 'number' && e.armTimer >= 0 ? e.armTimer : 0.35;
    const bob = Math.sin((e.phase || 0) * 0.9) * 3;

    ctx.save();
    ctx.translate(0, bob);

    // High-frequency red & amber danger sonar rings when armed!
    if (armed) {
      const pulse = Math.abs(Math.sin(time * 26));
      const r1 = 20 + (0.7 - clamp(armLeft, 0, 0.7)) * 32;
      ctx.strokeStyle = `rgba(244, 63, 94, ${(0.42 + pulse * 0.48).toFixed(2)})`;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(0, 0, r1, 0, TAU);
      ctx.stroke();

      ctx.strokeStyle = `rgba(250, 204, 21, ${(0.3 + (1 - pulse) * 0.5).toFixed(2)})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(0, 0, r1 * 0.76, 0, TAU);
      ctx.stroke();
    }

    const rot = (e.phase || 0) * 0.18;
    ctx.save();
    ctx.rotate(rot);

    // 8 protruding tapered warning spikes
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU;
      ctx.save();
      ctx.rotate(a);
      ctx.fillStyle = '#64748b';
      ctx.strokeStyle = '#090d16';
      ctx.lineWidth = 1.5;
      polyPath(ctx, [11, -2.6, 20, 0, 11, 2.6]);
      ctx.fill();
      ctx.stroke();

      // Tiny tip warning LED
      ctx.fillStyle = armed ? '#fde047' : '#f43f5e';
      ctx.beginPath();
      ctx.arc(19.2, 0, 1.4, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    // Octagonal armored casing with 3D metallic shading
    const shellG = ctx.createRadialGradient(-4, -4, 2, 0, 0, 14);
    shellG.addColorStop(0, '#64748b');
    shellG.addColorStop(0.55, '#1e293b');
    shellG.addColorStop(1, '#090d16');
    ctx.fillStyle = shellG;
    ctx.strokeStyle = '#090d16';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU + Math.PI / 8;
      const px = Math.cos(a) * 13.5;
      const py = Math.sin(a) * 13.5;
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Mechanical flange ring & 8 rivets
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, 0, 9.2, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = '#cbd5e1';
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * 9.2, Math.sin(a) * 9.2, 1.05, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    // Central proximity core lamp
    const blinkOn = armed ? Math.sin(time * 34) > 0 : Math.sin(time * 5.5 + (e.phase || 0)) > 0.25;
    if (blinkOn) {
      drawRadialGlow(ctx, 0, 0, armed ? 12 : 8, '#ffffff', armed ? 'rgba(250, 204, 21, 0.85)' : 'rgba(244, 63, 94, 0.75)', 'rgba(244, 63, 94, 0)');
    }
    ctx.fillStyle = blinkOn ? (armed ? '#fde047' : '#fb7185') : '#7f1d1d';
    ctx.beginPath();
    ctx.arc(0, 0, 4.6, 0, TAU);
    ctx.fill();

    if (flashAlpha > 0) {
      ctx.fillStyle = `rgba(224, 247, 255, ${flashAlpha.toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(0, 0, 14, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawSentinel(ctx, e, time, flashAlpha) {
    // Astral Prism Sentinel: counter-rotating armor rings + 4 crystalline prism blades + violet-crimson core
    const spin = Number(e.spin) || time * 1.4;

    // 1. Outer counter-rotating octagonal obsidian-gold ring
    ctx.save();
    ctx.rotate(-spin * 0.55);
    ctx.fillStyle = '#1e1b4b';
    ctx.strokeStyle = '#090d16';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU;
      const px = Math.cos(a) * 28;
      const py = Math.sin(a) * 28;
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = '#a78bfa';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(0, 0, 22, 0, TAU);
    ctx.stroke();
    ctx.restore();

    // 2. Four Crystalline Energy Prism Blades rotating with firing spin
    ctx.save();
    ctx.rotate(spin);
    for (let k = 0; k < 4; k++) {
      ctx.save();
      ctx.rotate((k / 4) * TAU);
      const cg = ctx.createLinearGradient(10, 0, 38, 0);
      cg.addColorStop(0, '#581c87');
      cg.addColorStop(0.5, '#a855f7');
      cg.addColorStop(1, '#f0abfc');
      ctx.fillStyle = cg;
      ctx.strokeStyle = '#090d16';
      ctx.lineWidth = 2;
      polyPath(ctx, [11, -7, 38, 0, 11, 7, 15, 0]);
      ctx.fill();
      ctx.stroke();

      // Crystal facet highlight line
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.78)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(15, 0);
      ctx.lineTo(35, 0);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();

    // 3. Inner golden astrolabe lock ring
    ctx.save();
    ctx.rotate(-spin * 1.2);
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 1.8;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.arc(0, 0, 14, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // 4. Central violet-crimson singularity core
    const pulse = 1 + Math.sin(time * 9) * 0.12;
    drawRadialGlow(ctx, 0, 0, 17 * pulse, '#ffffff', 'rgba(217, 70, 239, 0.85)', 'rgba(139, 92, 246, 0)');
    ctx.fillStyle = '#f43f5e';
    ctx.beginPath();
    ctx.arc(0, 0, 6.2 * pulse, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, 0, 2.8, 0, TAU);
    ctx.fill();

    if (flashAlpha > 0) {
      ctx.fillStyle = `rgba(224, 247, 255, ${flashAlpha.toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(0, 0, 32, 0, TAU);
      ctx.fill();
    }
  }

  function drawEnemy(ctx, enemy, opts) {
    if (!ctx || !enemy) return;
    if (enemy.isBoss || enemy.type === 'boss') {
      drawBoss(ctx, enemy, opts);
      return;
    }

    const o = opts || {};
    const time = o.time !== undefined ? Number(o.time) : (Number(enemy.age) || 0);
    const hpRatio = enemy.maxHp > 0 && enemy.hp !== undefined ? clamp(enemy.hp / enemy.maxHp, 0, 1) : 1;
    const hitFlash = Number(enemy.hitFlash) || 0;
    const flashAlpha = hitFlash > 0 ? clamp(0.45 + hitFlash * 3.5, 0.45, 0.78) : 0;
    const radius = Number(enemy.radius) || 20;
    const type = enemy.type || 'scout';

    ctx.save();

    // Soft dark ambient silhouette cushion for instant readability against bright clouds
    drawRadialGlow(ctx, 0, 0, radius * 1.25, 'rgba(2, 8, 23, 0.28)', 'rgba(2, 8, 23, 0.1)', 'rgba(2, 8, 23, 0)');

    if (type === 'gunship') {
      drawGunship(ctx, enemy, time, flashAlpha);
    } else if (type === 'lancer') {
      drawLancer(ctx, enemy, time, flashAlpha);
    } else if (type === 'weaver') {
      drawWeaver(ctx, enemy, time, flashAlpha);
    } else if (type === 'bomber') {
      drawBomber(ctx, enemy, time, flashAlpha);
    } else if (type === 'mine') {
      drawMine(ctx, enemy, time, flashAlpha);
    } else if (type === 'sentinel') {
      drawSentinel(ctx, enemy, time, flashAlpha);
    } else {
      drawScout(ctx, enemy, time, flashAlpha);
    }

    // Sub-50% HP battle smoke & electrical sparks (skip tiny mines)
    if (type !== 'mine' && hpRatio < 0.5) {
      drawBattleDamage(ctx, radius, hpRatio, time, enemy.phase || 0);
    }

    ctx.restore();
  }

  // ============================================================================
  // 5. THREE EPIC BLOCKADE BOSSES ('fog' | 'storm' | 'mother') — Origin (0,0)
  // ============================================================================

  function drawBossFog(ctx, b, time, enraged, flashAlpha) {
    // Support both b.fogArmor > 0 and engine's !(b.unveiled > 0)
    const hasFogArmor = b.fogArmor !== undefined ? Number(b.fogArmor) > 0 : !(Number(b.unveiled) > 0);

    // 1. Quad heavy carrier thrusters at rear (-Y)
    for (const ex of [-56, -24, 24, 56]) {
      drawEnemyThruster(ctx, ex, -48, 6.8, enraged ? 30 : 22, enraged ? 'rgba(239, 68, 68, 0.85)' : 'rgba(148, 163, 184, 0.8)', time + ex);
    }

    // Drifting ambient vapour puffs behind hull
    ctx.fillStyle = hasFogArmor ? 'rgba(226, 232, 240, 0.34)' : 'rgba(203, 213, 225, 0.12)';
    for (let k = 0; k < 6; k++) {
      const a = time * 0.65 + (k / 6) * TAU;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * 76, Math.sin(a) * 30 - 6, 22 + Math.sin(time * 2.2 + k) * 5, 0, TAU);
      ctx.fill();
    }

    // 2. Twin-Hull Catamaran Armored Sky-Carrier Main Deck
    const hullG = ctx.createLinearGradient(-90, -52, 90, 56);
    hullG.addColorStop(0, '#64748b');
    hullG.addColorStop(0.45, '#334155');
    hullG.addColorStop(1, '#1e293b');
    ctx.fillStyle = hullG;
    ctx.strokeStyle = '#090d16';
    ctx.lineWidth = 3.2;
    ctx.lineJoin = 'round';

    polyPath(ctx, [
      // Twin-prow catamaran carrier silhouette
      -18, 44, -28, 58, -50, 56, -78, 28, -90, -4, -76, -44, -36, -52,
      -16, -46, 16, -46,
      36, -52, 76, -44, 90, -4, 78, 28, 50, 56, 28, 58, 18, 44
    ]);
    ctx.fill();
    ctx.stroke();

    // Port & Starboard flight-deck runway markings!
    for (const side of [-1, 1]) {
      const rx = side * 42;
      ctx.fillStyle = '#0f172a';
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1.4;
      polyPath(ctx, [
        rx - 14, -40,
        rx + 14, -40,
        rx + 12, 48,
        rx - 12, 48
      ]);
      ctx.fill();
      ctx.stroke();

      // Dashed white runway centerline & amber threshold bars
      ctx.strokeStyle = 'rgba(248, 250, 252, 0.78)';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([7, 6]);
      ctx.lineDashOffset = -time * 24;
      ctx.beginPath();
      ctx.moveTo(rx, -34);
      ctx.lineTo(rx, 42);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;

      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(rx - 9, 41); ctx.lineTo(rx + 9, 41);
      ctx.stroke();
    }

    // 3. Central Fission Core & Sliding Blast Doors (opens wide when ENRAGED!)
    const doorSlide = enraged ? 15 : 0;

    // Exposed crimson fission core trench underneath central doors
    ctx.fillStyle = '#180409';
    roundRectPath(ctx, -22, -26, 44, 62, 6);
    ctx.fill();

    if (enraged) {
      // Glowing superheated crimson fission core + erupting steam jets!
      for (let g = -18; g <= 26; g += 8) {
        ctx.strokeStyle = 'rgba(248, 113, 113, 0.55)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-18, g); ctx.lineTo(18, g);
        ctx.stroke();
      }
      const coreR = 20 + Math.sin(time * 12) * 2.5;
      drawRadialGlow(ctx, 0, 4, coreR * 2.2, '#ffffff', 'rgba(239, 68, 68, 0.88)', 'rgba(239, 68, 68, 0)');
      ctx.fillStyle = '#fecaca';
      ctx.beginPath();
      ctx.arc(0, 4, coreR * 0.55, 0, TAU);
      ctx.fill();

      // Pressurized hot steam plumes venting out from opened doors
      for (let s = 0; s < 5; s++) {
        const cyc = (time * 2.4 + s * 0.2) % 1;
        const sx = (s - 2) * 8 + Math.sin(time * 9 + s) * 4;
        const sy = 10 + cyc * 46;
        ctx.fillStyle = `rgba(254, 226, 226, ${((1 - cyc) * 0.48).toFixed(2)})`;
        ctx.beginPath();
        ctx.arc(sx, sy, 6 + cyc * 14, 0, TAU);
        ctx.fill();
      }
    } else {
      // Calm slate-cyan core glow peeking through central seam
      drawRadialGlow(ctx, 0, 4, 24, '#ffffff', 'rgba(148, 163, 184, 0.72)', 'rgba(148, 163, 184, 0)');
    }

    // Left & Right sliding armored blast doors
    for (const side of [-1, 1]) {
      const dx = side * (11 + doorSlide);
      ctx.fillStyle = '#475569';
      ctx.strokeStyle = enraged ? '#f87171' : '#cbd5e1';
      ctx.lineWidth = 1.8;
      roundRectPath(ctx, dx - 10.5, -26, 21, 62, 3);
      ctx.fill();
      ctx.stroke();

      // Hazard chevrons on blast doors
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(dx - 6, -12); ctx.lineTo(dx + 6, -4);
      ctx.moveTo(dx - 6, 4); ctx.lineTo(dx + 6, 12);
      ctx.stroke();
    }

    // 4. Twin Rotating Fog-Turbine Towers on outer hulls
    for (const tx of [-64, 64]) {
      ctx.save();
      ctx.translate(tx, -4);
      ctx.fillStyle = '#1e293b';
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(0, 0, 15, 0, TAU);
      ctx.fill();
      ctx.stroke();

      // Spinning 8-blade fog generator rotor
      ctx.save();
      ctx.rotate(time * (enraged ? 9 : 4.5) * Math.sign(tx));
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 2.2;
      for (let bIdx = 0; bIdx < 8; bIdx++) {
        const ba = (bIdx / 8) * TAU;
        ctx.beginPath();
        ctx.moveTo(Math.cos(ba) * 3, Math.sin(ba) * 3);
        ctx.lineTo(Math.cos(ba + 0.35) * 12.5, Math.sin(ba + 0.35) * 12.5);
        ctx.stroke();
      }
      ctx.restore();

      drawRadialGlow(ctx, 0, 0, 7, '#ffffff', hasFogArmor ? 'rgba(186, 230, 253, 0.85)' : 'rgba(248, 113, 113, 0.75)', 'rgba(0,0,0,0)');
      ctx.restore();
    }

    // 5. Flowing Translucent Fog-Armor Shield Veil (when fogArmor active!)
    if (hasFogArmor) {
      const veilG = ctx.createRadialGradient(0, 2, 36, 0, 2, 122);
      veilG.addColorStop(0, 'rgba(241, 245, 249, 0.14)');
      veilG.addColorStop(0.68, `rgba(226, 232, 240, ${(0.36 + Math.sin(time * 2.5) * 0.06).toFixed(3)})`);
      veilG.addColorStop(1, 'rgba(241, 245, 249, 0)');
      ctx.fillStyle = veilG;
      ctx.beginPath();
      ctx.ellipse(0, 2, 122, 78, 0, 0, TAU);
      ctx.fill();

      // Swirling vapour stream arcs around the shield perimeter
      ctx.strokeStyle = 'rgba(241, 245, 249, 0.52)';
      ctx.lineWidth = 2.2;
      ctx.setLineDash([26, 18]);
      ctx.lineDashOffset = -time * 42;
      ctx.beginPath();
      ctx.ellipse(0, 2, 108, 68, 0, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
    }

    if (flashAlpha > 0) {
      ctx.fillStyle = `rgba(224, 247, 255, ${(flashAlpha * 0.55).toFixed(2)})`;
      polyPath(ctx, [-28, 58, -78, 28, -90, -4, -76, -44, 0, -50, 76, -44, 90, -4, 78, 28, 28, 58]);
      ctx.fill();
    }
  }

  function drawBossStorm(ctx, b, time, enraged, flashAlpha) {
    // Storm Iron-Curtain Dreadnought: dark-purple & royal-gold flying fortress, sub-turrets,
    // wingtip giant Tesla coils with live arcs, central giant thunder railgun bore!
    for (const ex of [-62, -24, 24, 62]) {
      drawEnemyThruster(ctx, ex, -44, 6.5, enraged ? 32 : 22, 'rgba(251, 146, 60, 0.88)', time + ex);
    }

    // 1. Dark-Violet & Gilded Heavy Flying-Wing Fortress Hull
    const hullG = ctx.createLinearGradient(-104, -48, 104, 58);
    hullG.addColorStop(0, '#4c1d95');
    hullG.addColorStop(0.5, '#2e1065');
    hullG.addColorStop(1, '#1e1b4b');
    ctx.fillStyle = hullG;
    ctx.strokeStyle = '#090d16';
    ctx.lineWidth = 3.2;
    ctx.lineJoin = 'round';

    polyPath(ctx, [
      -12, 64,
      -18, 32,
      -52, 26,
      -104, 12,
      -96, -18,
      -54, -26,
      -36, -48,
      36, -48,
      54, -26,
      96, -18,
      104, 12,
      52, 26,
      18, 32,
      12, 64,
      5, 42,
      -5, 42
    ]);
    ctx.fill();
    ctx.stroke();

    // Royal gilded armor trim & lightning chevron plates
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 2.4;
    polyPath(ctx, [-98, 8, -50, 21, -20, 26, -24, -38, 24, -38, 20, 26, 50, 21, 98, 8], false);
    ctx.stroke();

    ctx.fillStyle = '#d97706';
    polyPath(ctx, [-84, -10, -48, -18, -44, -8, -80, 0]);
    ctx.fill();
    polyPath(ctx, [84, -10, 48, -18, 44, -8, 80, 0]);
    ctx.fill();

    // 2. Four Wing-Mounted Twin Sub-Turrets
    for (const [tx, ty] of [[-62, 6], [-34, 12], [34, 12], [62, 6]]) {
      ctx.save();
      ctx.translate(tx, ty);
      ctx.rotate(Math.sin(time * 2.2 + tx) * 0.18);
      ctx.fillStyle = '#3b0764';
      ctx.strokeStyle = '#fde047';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, 7.5, 0, TAU);
      ctx.fill();
      ctx.stroke();
      // Twin gun barrels
      ctx.fillStyle = '#fde68a';
      ctx.fillRect(-3.2, 5, 2, 8);
      ctx.fillRect(1.2, 5, 2, 8);
      ctx.restore();
    }

    // 3. Central Giant Thunder Railgun Bore & Reactor Core
    ctx.fillStyle = '#090d16';
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 2;
    roundRectPath(ctx, -9, -12, 18, 72, 3);
    ctx.fill();
    ctx.stroke();

    // Glowing plasma accelerator rungs along central railgun bore
    for (let ry = 8; ry <= 54; ry += 9) {
      const rungPulse = 0.55 + Math.sin(time * 16 - ry * 0.2) * 0.4;
      ctx.strokeStyle = enraged
        ? `rgba(250, 204, 21, ${rungPulse.toFixed(2)})`
        : `rgba(192, 132, 252, ${rungPulse.toFixed(2)})`;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(-6, ry);
      ctx.lineTo(6, ry);
      ctx.stroke();
    }

    const coreR = 17 + Math.sin(time * 10) * 2;
    drawRadialGlow(ctx, 0, -2, coreR * 2.1, '#ffffff', enraged ? 'rgba(239, 68, 68, 0.88)' : 'rgba(250, 204, 21, 0.85)', 'rgba(251, 146, 60, 0)');
    ctx.fillStyle = '#fef9c3';
    ctx.beginPath();
    ctx.arc(0, -2, coreR * 0.45, 0, TAU);
    ctx.fill();

    // 4. Giant Wingtip Tesla Electromagnetic Coil Rings + Live Jumping Arcs!
    const arcSeed = Math.floor(time * 26);
    for (const side of [-1, 1]) {
      const cx = side * 94;
      const cy = 2;
      // Copper-gold concentric Tesla torus rings
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.arc(cx, cy, 14, 0, TAU);
      ctx.stroke();

      ctx.strokeStyle = '#fef08a';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(cx, cy, 9, 0, TAU);
      ctx.stroke();

      drawRadialGlow(ctx, cx, cy, 13, '#ffffff', 'rgba(168, 85, 247, 0.85)', 'rgba(250, 204, 21, 0)');

      // Live electric arc jumping from wingtip Tesla coil to central railgun muzzle!
      drawElectricArc(
        ctx, cx, cy, side * 10, 56,
        7, enraged ? 12 : 7,
        'rgba(192, 132, 252, 0.82)', '#fef08a',
        enraged ? 2.0 : 1.4, arcSeed + (side > 0 ? 41 : 7)
      );
    }

    // 5. Enraged Full-Hull Golden-Violet Lightning Surge!
    if (enraged) {
      drawElectricArc(ctx, -94, 2, 94, 2, 10, 15, 'rgba(250, 204, 21, 0.88)', '#ffffff', 2.2, arcSeed + 99);
      drawElectricArc(ctx, -64, -26, 64, -26, 8, 10, 'rgba(168, 85, 247, 0.85)', '#fde047', 1.7, arcSeed + 131);
    }

    if (flashAlpha > 0) {
      ctx.fillStyle = `rgba(224, 247, 255, ${(flashAlpha * 0.55).toFixed(2)})`;
      polyPath(ctx, [-12, 64, -104, 12, -96, -18, -36, -48, 36, -48, 96, -18, 104, 12, 12, 64]);
      ctx.fill();
    }
  }

  function drawBossMother(ctx, b, time, enraged, flashAlpha) {
    // Deep-Space Mothership: majestic crescent command dreadnought, glowing blue hangar catapult bays,
    // symmetrical energy crystal pylons, multi-layered rotating arcane star-core;
    // ENRAGED unfolds 6 radiant light-wings & overload plasma rings!

    // 1. Enraged Six Radiant Astral Light-Wings & Overload Plasma Rings (behind hull)
    if (enraged) {
      ctx.save();
      for (const side of [-1, 1]) {
        for (let w = 0; w < 3; w++) {
          ctx.save();
          ctx.scale(side, 1);
          const ang = -0.52 + w * 0.32 + Math.sin(time * 4 + w) * 0.05;
          ctx.rotate(ang);
          const wg = ctx.createLinearGradient(45, -10, 148, -34);
          wg.addColorStop(0, 'rgba(240, 171, 252, 0.88)');
          wg.addColorStop(0.45, 'rgba(56, 189, 248, 0.62)');
          wg.addColorStop(0.82, 'rgba(250, 204, 21, 0.38)');
          wg.addColorStop(1, 'rgba(56, 189, 248, 0)');
          ctx.fillStyle = wg;
          polyPath(ctx, [40, -14, 126, -42, 152, -22, 114, -4, 46, 4]);
          ctx.fill();

          ctx.strokeStyle = 'rgba(254, 249, 195, 0.85)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(46, -12);
          ctx.lineTo(146, -24);
          ctx.stroke();
          ctx.restore();
        }
      }

      // Twin intersecting overload plasma rings
      ctx.strokeStyle = `rgba(103, 232, 249, ${(0.55 + Math.sin(time * 8) * 0.25).toFixed(2)})`;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.ellipse(0, 0, 128, 56, Math.sin(time * 1.5) * 0.18, 0, TAU);
      ctx.stroke();

      ctx.strokeStyle = `rgba(244, 114, 182, ${(0.5 + Math.cos(time * 8) * 0.25).toFixed(2)})`;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.ellipse(0, 0, 122, 52, -Math.sin(time * 1.5) * 0.18, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }

    // 2. Triple Astral Main Thruster Arrays (-Y)
    for (const ex of [-64, 0, 64]) {
      drawEnemyThruster(ctx, ex, -42, 7.5, enraged ? 32 : 22, 'rgba(167, 139, 250, 0.85)', time + ex);
    }

    // 3. Majestic Crescent Command Dreadnought Hull
    const hullG = ctx.createLinearGradient(-108, -48, 108, 52);
    hullG.addColorStop(0, '#312e81');
    hullG.addColorStop(0.45, '#0f172a');
    hullG.addColorStop(0.8, '#1e1b4b');
    hullG.addColorStop(1, '#3b0764');
    ctx.fillStyle = hullG;
    ctx.strokeStyle = '#090d16';
    ctx.lineWidth = 3.2;

    ctx.beginPath();
    ctx.moveTo(0, -48);
    ctx.bezierCurveTo(64, -48, 112, -16, 108, 34);
    ctx.quadraticCurveTo(96, 54, 76, 46);
    ctx.quadraticCurveTo(54, 18, 28, 26);
    ctx.lineTo(16, 38);
    ctx.lineTo(-16, 38);
    ctx.lineTo(-28, 26);
    ctx.quadraticCurveTo(-54, 18, -76, 46);
    ctx.quadraticCurveTo(-96, 54, -108, 34);
    ctx.bezierCurveTo(-112, -16, -64, -48, 0, -48);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Mithril-violet inner crescent trim & panel lines
    ctx.strokeStyle = '#a78bfa';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-96, 28);
    ctx.bezierCurveTo(-92, -12, -52, -38, 0, -38);
    ctx.bezierCurveTo(52, -38, 92, -12, 96, 28);
    ctx.stroke();

    // 4. Glowing Cyan Hangar Catapult Channels (Port & Starboard launch bays!)
    for (const side of [-1, 1]) {
      const hx = side * 52;
      ctx.save();
      ctx.translate(hx, 2);
      ctx.rotate(side * 0.16);

      const bayG = ctx.createLinearGradient(0, -24, 0, 26);
      bayG.addColorStop(0, '#083344');
      bayG.addColorStop(0.6, '#0891b2');
      bayG.addColorStop(1, '#67e8f9');
      ctx.fillStyle = bayG;
      ctx.strokeStyle = '#a5f3fc';
      ctx.lineWidth = 1.6;
      roundRectPath(ctx, -9, -22, 18, 46, 4);
      ctx.fill();
      ctx.stroke();

      // Animated catapult launch chevrons scrolling toward +Y
      for (let c = 0; c < 4; c++) {
        const cy = -18 + (((time * 28 + c * 11) % 40));
        ctx.strokeStyle = 'rgba(236, 254, 255, 0.9)';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(-5, cy - 3);
        ctx.lineTo(0, cy + 2);
        ctx.lineTo(5, cy - 3);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 5. Symmetrical Faceted Energy Crystal Pylons (3 per wing)
    for (const side of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const px = side * (32 + k * 27);
        const py = -22 + k * 14;
        drawRadialGlow(ctx, px, py, 10, '#ffffff', 'rgba(103, 232, 249, 0.65)', 'rgba(167, 139, 250, 0)');
        ctx.fillStyle = k % 2 === 0 ? '#67e8f9' : '#e879f9';
        ctx.strokeStyle = '#090d16';
        ctx.lineWidth = 1.3;
        polyPath(ctx, [px, py - 7, px + 4.5, py, px, py + 7, px - 4.5, py]);
        ctx.fill();
        ctx.stroke();
      }
    }

    // 6. Central Multi-Layered Rotating Arcane Star-Core
    const coreY = -2;
    // Outer rotating arcane hexagram ring
    ctx.save();
    ctx.translate(0, coreY);
    ctx.rotate(time * 0.9);
    ctx.strokeStyle = '#c4b5fd';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 26, 0, TAU);
    ctx.stroke();
    for (let t = 0; t < 2; t++) {
      ctx.beginPath();
      for (let k = 0; k < 3; k++) {
        const a = t * (Math.PI / 3) + (k / 3) * TAU;
        const rx = Math.cos(a) * 25;
        const ry = Math.sin(a) * 25;
        if (k === 0) ctx.moveTo(rx, ry);
        else ctx.lineTo(rx, ry);
      }
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();

    // Inner counter-rotating golden astrolabe ring
    ctx.save();
    ctx.translate(0, coreY);
    ctx.rotate(-time * 1.7);
    ctx.strokeStyle = '#fde047';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.arc(0, 0, 17, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    const starR = 14 + Math.sin(time * 9) * 2;
    drawRadialGlow(
      ctx, 0, coreY, starR * 2.2,
      '#ffffff',
      enraged ? 'rgba(244, 63, 94, 0.9)' : 'rgba(34, 211, 238, 0.88)',
      'rgba(168, 85, 247, 0)'
    );
    ctx.fillStyle = enraged ? '#fecdd3' : '#ecfeff';
    ctx.beginPath();
    ctx.arc(0, coreY, starR * 0.5, 0, TAU);
    ctx.fill();

    if (flashAlpha > 0) {
      ctx.fillStyle = `rgba(224, 247, 255, ${(flashAlpha * 0.55).toFixed(2)})`;
      ctx.beginPath();
      ctx.ellipse(0, 0, 104, 46, 0, 0, TAU);
      ctx.fill();
    }
  }

  function drawBoss(ctx, boss, opts) {
    if (!ctx || !boss) return;
    const o = opts || {};
    const time = o.time !== undefined ? Number(o.time) : (Number(boss.age) || 0);
    const kind = boss.bossKind || o.bossKind || 'fog';
    const enraged = Boolean(boss.enraged);
    const hpRatio = boss.maxHp > 0 && boss.hp !== undefined ? clamp(boss.hp / boss.maxHp, 0, 1) : 1;
    const hitFlash = Number(boss.hitFlash) || 0;
    const flashAlpha = hitFlash > 0 ? clamp(0.45 + hitFlash * 3.5, 0.45, 0.75) : 0;

    ctx.save();

    // Enraged crimson-violet aura beneath boss hull
    if (enraged) {
      const pulse = 0.82 + Math.sin(time * 8) * 0.18;
      drawRadialGlow(
        ctx, 0, 0, 138,
        `rgba(239, 68, 68, ${(0.34 * pulse).toFixed(3)})`,
        `rgba(168, 85, 247, ${(0.18 * pulse).toFixed(3)})`,
        'rgba(239, 68, 68, 0)'
      );
    } else {
      drawRadialGlow(ctx, 0, 0, 118, 'rgba(2, 8, 23, 0.34)', 'rgba(2, 8, 23, 0.14)', 'rgba(2, 8, 23, 0)');
    }

    if (kind === 'storm') {
      drawBossStorm(ctx, boss, time, enraged, flashAlpha);
    } else if (kind === 'mother') {
      drawBossMother(ctx, boss, time, enraged, flashAlpha);
    } else {
      drawBossFog(ctx, boss, time, enraged, flashAlpha);
    }

    if (hpRatio < 0.5) {
      drawBattleDamage(ctx, Number(boss.radius) || 68, hpRatio, time, boss.phase || 2.3);
    }

    ctx.restore();
  }

  global.SkyAircraftRenderer = {
    drawVirtualPlayer,
    drawTabletopRig,
    drawDrone,
    drawEnemy,
    drawBoss
  };
})(typeof window !== 'undefined' ? window : globalThis);
