/*
 * 借风计划 · 航程纪念卡 (Flight keepsake card)
 * Zero-dependency module. Exposes window.FlightCard:
 *   FlightCard.render(data)                     -> HTMLCanvasElement (1080x1440 portrait card)
 *   FlightCard.openPreview(canvas, {fileName})  -> { close(), element }  (self-contained modal)
 *   FlightCard.snapshot(sourceCanvas, maxW=960) -> HTMLCanvasElement (downscaled copy)
 *   FlightCard.isOpen()                         -> boolean
 *   FlightCard.close()                          -> closes the preview if open
 */
(function () {
  'use strict';

  const W = 1080;
  const H = 1440;
  const FONT_STACK = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC","Source Han Sans SC","WenQuanYi Zen Hei",system-ui,-apple-system,sans-serif';
  const NUM_STACK = '"SF Pro Rounded","Avenir Next","Segoe UI","Helvetica Neue",Arial,' + FONT_STACK;

  const INK = '#22304d';
  const MUTED = '#77829a';
  const PAPER = '#fffaf0';
  const LINE = '#e6dcc6';

  const SKIES = [
    { name: '晴空借风', ord: '第一航段', a: '#2f9bf0', b: '#8fd8ff' },
    { name: '暮色穿云', ord: '第二航段', a: '#ff7a3d', b: '#ffc65c' },
    { name: '星海灯塔', ord: '第三航段', a: '#2a2f7e', b: '#6a55c9' }
  ];
  const RANKS = {
    S: { hi: '#ffd3e6', mid: '#ff5fa2', lo: '#c81e6b', ring: '#ffe9f2', ribbon: '#ff8fbd', ribbon2: '#e0407f' },
    A: { hi: '#fff3bf', mid: '#ffc02e', lo: '#c77a00', ring: '#fff6d6', ribbon: '#ff8a4c', ribbon2: '#e2572b' },
    B: { hi: '#d6ecff', mid: '#4aa3ff', lo: '#1f5fc4', ring: '#e6f3ff', ribbon: '#6cc0ff', ribbon2: '#2f7fe0' },
    C: { hi: '#f1f4f8', mid: '#a9b3c2', lo: '#667284', ring: '#f2f4f7', ribbon: '#b9c2cf', ribbon2: '#8792a3' }
  };
  const DIFF_LABEL = { easy: '轻松', normal: '标准', ace: '王牌' };
  const DIFF_COLOR = { easy: '#2fae6b', normal: '#2f7fe0', ace: '#d9483b' };
  const TOY_DEFAULT_NAME = { jet: '桌面小飞机', car: '合金小车', orb: '旧橡皮' };

  /* ------------------------------------------------------------------ utils */

  function font(weight, size, numeric) {
    return weight + ' ' + size + 'px ' + (numeric ? NUM_STACK : FONT_STACK);
  }

  function num(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? n : (fallback === undefined ? 0 : fallback);
  }

  function int(v) {
    return Math.max(0, Math.round(num(v, 0)));
  }

  function fmtInt(v) {
    const n = Math.round(num(v, 0));
    const s = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (n < 0 ? '-' : '') + s;
  }

  function fmtKm(v) {
    const n = Math.max(0, num(v, 0));
    if (n >= 100) return fmtInt(n);
    return (Math.round(n * 10) / 10).toFixed(1);
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function todayText() {
    const d = new Date();
    return d.getFullYear() + '.' + pad2(d.getMonth() + 1) + '.' + pad2(d.getDate());
  }

  function defaultFileName() {
    const d = new Date();
    return '借风航程-' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '-' +
      pad2(d.getHours()) + pad2(d.getMinutes()) + '.png';
  }

  function rr(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  function lin(ctx, x0, y0, x1, y1, stops) {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    for (let i = 0; i < stops.length; i++) g.addColorStop(stops.length === 1 ? 0 : i / (stops.length - 1), stops[i]);
    return g;
  }

  // Shrinks the font until `text` fits maxW; returns the size used (ctx.font is left set).
  function fitFont(ctx, text, maxW, size, minSize, weight, numeric) {
    let s = size;
    for (;;) {
      ctx.font = font(weight, s, numeric);
      if (s <= minSize || ctx.measureText(text).width <= maxW) return s;
      s = Math.max(minSize, s - Math.max(1, Math.round(s * 0.05)));
    }
  }

  function ellipsize(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    const chars = Array.from(text);
    while (chars.length > 1 && ctx.measureText(chars.join('') + '…').width > maxW) chars.pop();
    return chars.join('') + '…';
  }

  // Draw text shrunk (then ellipsized) to fit. Returns the drawn width.
  function fitText(ctx, text, x, y, maxW, size, minSize, weight, numeric) {
    text = String(text);
    fitFont(ctx, text, maxW, size, minSize, weight, numeric);
    const t = ellipsize(ctx, text, maxW);
    ctx.fillText(t, x, y);
    return ctx.measureText(t).width;
  }

  function wrapLines(ctx, text, maxW, maxLines) {
    const chars = Array.from(String(text).replace(/\s+/g, ' ').trim());
    const lines = [];
    let cur = '';
    const noHead = '，。！？、；：,.!?;:)）」』”’…—';
    for (let i = 0; i < chars.length; i++) {
      const next = cur + chars[i];
      if (cur && ctx.measureText(next).width > maxW && noHead.indexOf(chars[i]) < 0) {
        lines.push(cur);
        cur = chars[i];
        if (lines.length === maxLines) break;
      } else {
        cur = next;
      }
    }
    if (lines.length < maxLines) {
      if (cur) lines.push(cur);
    } else if (cur) {
      // overflow: fold the remainder into the last line with an ellipsis
      lines[maxLines - 1] = ellipsize(ctx, lines[maxLines - 1] + chars.slice(chars.indexOf(cur)).join(''), maxW);
    }
    for (let i = 0; i < lines.length; i++) lines[i] = ellipsize(ctx, lines[i], maxW);
    return lines;
  }

  function rng(seed) {
    let s = (seed >>> 0) || 1;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function star(ctx, cx, cy, rOuter, rInner, points) {
    points = points || 5;
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const r = i % 2 ? rInner : rOuter;
      const a = -Math.PI / 2 + (i * Math.PI) / points;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.closePath();
  }

  function sparkle(ctx, cx, cy, r) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.quadraticCurveTo(cx, cy, cx + r, cy);
    ctx.quadraticCurveTo(cx, cy, cx, cy + r);
    ctx.quadraticCurveTo(cx, cy, cx - r, cy);
    ctx.quadraticCurveTo(cx, cy, cx, cy - r);
    ctx.closePath();
    ctx.fill();
  }

  function cloud(ctx, cx, cy, s, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx - s * 0.55, cy + s * 0.1, s * 0.34, 0, Math.PI * 2);
    ctx.arc(cx - s * 0.15, cy - s * 0.12, s * 0.46, 0, Math.PI * 2);
    ctx.arc(cx + s * 0.35, cy, s * 0.38, 0, Math.PI * 2);
    ctx.arc(cx + s * 0.72, cy + s * 0.14, s * 0.26, 0, Math.PI * 2);
    ctx.rect(cx - s * 0.6, cy + s * 0.08, s * 1.35, s * 0.34);
    ctx.fill();
  }

  function infinity(ctx, cx, cy, w, h) {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.bezierCurveTo(cx + w * 0.25, cy - h, cx + w * 0.5, cy - h, cx + w * 0.5, cy);
    ctx.bezierCurveTo(cx + w * 0.5, cy + h, cx + w * 0.25, cy + h, cx, cy);
    ctx.bezierCurveTo(cx - w * 0.25, cy - h, cx - w * 0.5, cy - h, cx - w * 0.5, cy);
    ctx.bezierCurveTo(cx - w * 0.5, cy + h, cx - w * 0.25, cy + h, cx, cy);
    ctx.stroke();
  }

  /* ------------------------------------------------------------------- toys */

  // Draws the toy facing "up", centred on (cx, cy), fitting roughly in an s×s box.
  function drawToy(ctx, shape, cx, cy, s, rot) {
    ctx.save();
    ctx.translate(cx, cy);
    if (rot) ctx.rotate(rot);
    ctx.lineJoin = 'round';
    if (shape === 'car') {
      const w = s * 0.5, h = s * 0.86;
      ctx.fillStyle = '#27313f';
      const ww = s * 0.13, wh = s * 0.22;
      [[-1, -0.25], [1, -0.25], [-1, 0.27], [1, 0.27]].forEach(function (p) {
        rr(ctx, p[0] * (w / 2 + ww * 0.15) - ww / 2, p[1] * h - wh / 2, ww, wh, ww * 0.4);
        ctx.fill();
      });
      ctx.fillStyle = lin(ctx, -w / 2, 0, w / 2, 0, ['#ff6b5e', '#f0413a', '#c92a2e']);
      rr(ctx, -w / 2, -h / 2, w, h, s * 0.17);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.globalAlpha = 0.9;
      rr(ctx, -s * 0.045, -h / 2 + s * 0.03, s * 0.09, h - s * 0.06, s * 0.02);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = lin(ctx, 0, -h * 0.2, 0, h * 0.2, ['#bfe6ff', '#5f9fd6']);
      rr(ctx, -w * 0.36, -h * 0.2, w * 0.72, h * 0.36, s * 0.07);
      ctx.fill();
      ctx.fillStyle = '#ffe9a8';
      ctx.beginPath();
      ctx.arc(-w * 0.28, -h / 2 + s * 0.06, s * 0.035, 0, Math.PI * 2);
      ctx.arc(w * 0.28, -h / 2 + s * 0.06, s * 0.035, 0, Math.PI * 2);
      ctx.fill();
    } else if (shape === 'orb') {
      const r = s * 0.4;
      const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.08, 0, 0, r);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.35, '#ffc7dc');
      g.addColorStop(1, '#f06a9c');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = 'rgba(74,134,232,0.92)';
      ctx.fillRect(-r, r * 0.08, r * 2, r * 0.42);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillRect(-r, r * 0.02, r * 2, r * 0.07);
      ctx.fillRect(-r, r * 0.5, r * 2, r * 0.07);
      ctx.restore();
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.beginPath();
      ctx.ellipse(-r * 0.36, -r * 0.46, r * 0.26, r * 0.14, -0.6, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // paper-plane dart
      const k = s / 2;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(0, -k * 0.98);
      ctx.lineTo(-k * 0.86, k * 0.78);
      ctx.lineTo(-k * 0.16, k * 0.52);
      ctx.lineTo(0, k * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#dbe9fb';
      ctx.beginPath();
      ctx.moveTo(0, -k * 0.98);
      ctx.lineTo(k * 0.86, k * 0.78);
      ctx.lineTo(k * 0.16, k * 0.52);
      ctx.lineTo(0, k * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#9fbde6';
      ctx.beginPath();
      ctx.moveTo(0, -k * 0.98);
      ctx.lineTo(-k * 0.16, k * 0.52);
      ctx.lineTo(0, k * 0.95);
      ctx.lineTo(k * 0.16, k * 0.52);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#7fa3d6';
      ctx.beginPath();
      ctx.moveTo(0, -k * 0.98);
      ctx.lineTo(0, k * 0.95);
      ctx.lineTo(k * 0.16, k * 0.52);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#ff6b5e';
      ctx.lineWidth = Math.max(1, s * 0.035);
      ctx.beginPath();
      ctx.moveTo(-k * 0.6, k * 0.5);
      ctx.lineTo(-k * 0.36, k * 0.0);
      ctx.moveTo(k * 0.6, k * 0.5);
      ctx.lineTo(k * 0.36, k * 0.0);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ---------------------------------------------------------- scene pieces */

  function drawSkyScene(ctx, x, y, w, h, stage, shape, seedBase) {
    const r = rng(1234 + stage * 77 + (seedBase || 0));
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    if (stage === 1) {
      ctx.fillStyle = lin(ctx, 0, y, 0, y + h, ['#2c8be6', '#62bbf7', '#c9eeff']);
      ctx.fillRect(x, y, w, h);
      const sg = ctx.createRadialGradient(x + w * 0.82, y + h * 0.2, 10, x + w * 0.82, y + h * 0.2, h * 0.5);
      sg.addColorStop(0, 'rgba(255,250,210,0.95)');
      sg.addColorStop(0.18, 'rgba(255,240,170,0.7)');
      sg.addColorStop(1, 'rgba(255,240,170,0)');
      ctx.fillStyle = sg;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#fff6c9';
      ctx.beginPath();
      ctx.arc(x + w * 0.82, y + h * 0.2, h * 0.085, 0, Math.PI * 2);
      ctx.fill();
      // islands
      ctx.fillStyle = 'rgba(46,160,120,0.55)';
      ctx.beginPath();
      ctx.ellipse(x + w * 0.16, y + h * 1.0, w * 0.2, h * 0.09, 0, 0, Math.PI * 2);
      ctx.ellipse(x + w * 0.9, y + h * 1.02, w * 0.16, h * 0.08, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (stage === 2) {
      ctx.fillStyle = lin(ctx, 0, y, 0, y + h, ['#5b3a8c', '#e5566a', '#ff9a4d', '#ffd98a']);
      ctx.fillRect(x, y, w, h);
      const cx = x + w * 0.24, cy = y + h * 0.86;
      const sg = ctx.createRadialGradient(cx, cy, 10, cx, cy, h * 0.8);
      sg.addColorStop(0, 'rgba(255,244,190,0.95)');
      sg.addColorStop(0.2, 'rgba(255,200,110,0.6)');
      sg.addColorStop(1, 'rgba(255,170,90,0)');
      ctx.fillStyle = sg;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#fff1bd';
      ctx.beginPath();
      ctx.arc(cx, cy, h * 0.15, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = lin(ctx, 0, y, 0, y + h, ['#0d1238', '#232a72', '#4a3f9c']);
      ctx.fillRect(x, y, w, h);
      // aurora
      ctx.globalAlpha = 0.34;
      for (let i = 0; i < 3; i++) {
        ctx.strokeStyle = ['#5ff0c8', '#7ab8ff', '#c38bff'][i];
        ctx.lineWidth = h * (0.11 - i * 0.02);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x - 20, y + h * (0.3 + i * 0.1));
        ctx.bezierCurveTo(x + w * 0.3, y + h * (0.05 + i * 0.1), x + w * 0.6, y + h * (0.5 + i * 0.06), x + w + 20, y + h * (0.16 + i * 0.1));
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff';
      for (let i = 0; i < 70; i++) {
        const sx = x + r() * w, sy = y + r() * h * 0.85, sr = 0.8 + r() * 2.2;
        ctx.globalAlpha = 0.35 + r() * 0.65;
        if (sr > 2.4) sparkle(ctx, sx, sy, sr * 3.2);
        else { ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2); ctx.fill(); }
      }
      ctx.globalAlpha = 1;
      // moon
      ctx.fillStyle = '#fff4c7';
      ctx.beginPath();
      ctx.arc(x + w * 0.14, y + h * 0.22, h * 0.075, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1a2060';
      ctx.beginPath();
      ctx.arc(x + w * 0.14 + h * 0.035, y + h * 0.2, h * 0.066, 0, Math.PI * 2);
      ctx.fill();
      // lighthouse
      const lx = x + w * 0.85, ly = y + h;
      const beam = ctx.createLinearGradient(lx, ly - h * 0.47, lx - w * 0.5, ly - h * 0.62);
      beam.addColorStop(0, 'rgba(255,236,160,0.6)');
      beam.addColorStop(1, 'rgba(255,236,160,0)');
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.moveTo(lx, ly - h * 0.47);
      ctx.lineTo(lx - w * 0.6, ly - h * 0.78);
      ctx.lineTo(lx - w * 0.6, ly - h * 0.42);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#f4f1ff';
      ctx.beginPath();
      ctx.moveTo(lx - h * 0.05, ly);
      ctx.lineTo(lx - h * 0.032, ly - h * 0.42);
      ctx.lineTo(lx + h * 0.032, ly - h * 0.42);
      ctx.lineTo(lx + h * 0.05, ly);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#e8566c';
      ctx.fillRect(lx - h * 0.044, ly - h * 0.15, h * 0.088, h * 0.06);
      ctx.fillRect(lx - h * 0.037, ly - h * 0.33, h * 0.074, h * 0.06);
      ctx.fillStyle = '#ffe58a';
      rr(ctx, lx - h * 0.04, ly - h * 0.5, h * 0.08, h * 0.08, 4);
      ctx.fill();
      ctx.fillStyle = '#e8566c';
      ctx.beginPath();
      ctx.moveTo(lx - h * 0.055, ly - h * 0.5);
      ctx.lineTo(lx, ly - h * 0.57);
      ctx.lineTo(lx + h * 0.055, ly - h * 0.5);
      ctx.closePath();
      ctx.fill();
    }
    // clouds
    const cc = stage === 1 ? 'rgba(255,255,255,0.92)' : stage === 2 ? 'rgba(255,226,214,0.6)' : 'rgba(150,150,225,0.3)';
    const spots = [[0.14, 0.5, 0.2], [0.6, 0.17, 0.15], [0.9, 0.62, 0.19], [0.36, 0.83, 0.24], [0.72, 0.9, 0.16]];
    for (let i = 0; i < spots.length; i++) {
      cloud(ctx, x + w * spots[i][0], y + h * spots[i][1], h * spots[i][2] * (0.9 + r() * 0.3), cc);
    }
    // wind streaks
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineCap = 'round';
    for (let i = 0; i < 5; i++) {
      const wy = y + h * (0.22 + i * 0.14) + r() * 14;
      const wx = x + w * (0.08 + r() * 0.2);
      const len = w * (0.14 + r() * 0.12);
      ctx.lineWidth = 3 + r() * 3;
      ctx.globalAlpha = 0.35 + r() * 0.4;
      ctx.beginPath();
      ctx.moveTo(wx, wy);
      ctx.bezierCurveTo(wx + len * 0.4, wy - 16, wx + len * 0.7, wy + 12, wx + len, wy - 6);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // flight trail (a looping dashed path) and the toy
    const tx = x + w * 0.56, ty = y + h * 0.47;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 5;
    ctx.setLineDash([4, 16]);
    ctx.beginPath();
    ctx.moveTo(x + w * 0.1, y + h * 0.93);
    ctx.bezierCurveTo(x + w * 0.3, y + h * 0.9, x + w * 0.44, y + h * 0.5, x + w * 0.33, y + h * 0.44);
    ctx.bezierCurveTo(x + w * 0.24, y + h * 0.4, x + w * 0.22, y + h * 0.66, x + w * 0.36, y + h * 0.68);
    ctx.bezierCurveTo(x + w * 0.44, y + h * 0.69, x + w * 0.49, y + h * 0.62, tx - h * 0.12, ty + h * 0.12);
    ctx.stroke();
    ctx.setLineDash([]);
    const glow = ctx.createRadialGradient(tx, ty, 10, tx, ty, h * 0.42);
    glow.addColorStop(0, 'rgba(255,255,255,0.5)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(x, y, w, h);
    ctx.save();
    ctx.shadowColor = 'rgba(10,20,60,0.35)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 14;
    drawToy(ctx, shape, tx, ty, h * 0.5, Math.PI / 4);
    ctx.restore();
    ctx.restore();
  }

  function drawCover(ctx, img, x, y, w, h) {
    const iw = img.naturalWidth || img.videoWidth || img.width;
    const ih = img.naturalHeight || img.videoHeight || img.height;
    if (!iw || !ih) return false;
    const scale = Math.max(w / iw, h / ih);
    const sw = w / scale, sh = h / scale;
    try {
      ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
      return true;
    } catch (e) {
      return false;
    }
  }

  function drawMedal(ctx, cx, cy, r, rank) {
    const c = RANKS[rank] || RANKS.C;
    const known = !!RANKS[rank];
    // ribbon tails
    ctx.save();
    [-1, 1].forEach(function (dir) {
      ctx.fillStyle = dir < 0 ? c.ribbon : c.ribbon2;
      ctx.beginPath();
      ctx.moveTo(cx + dir * r * 0.12, cy + r * 0.5);
      ctx.lineTo(cx + dir * r * 0.78, cy + r * 0.62);
      ctx.lineTo(cx + dir * r * 0.86, cy + r * 1.46);
      ctx.lineTo(cx + dir * r * 0.5, cy + r * 1.26);
      ctx.lineTo(cx + dir * r * 0.2, cy + r * 1.5);
      ctx.closePath();
      ctx.fill();
    });
    ctx.restore();
    // scalloped edge
    ctx.save();
    ctx.shadowColor = 'rgba(40,30,10,0.28)';
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 10;
    ctx.fillStyle = c.lo;
    star(ctx, cx, cy, r * 1.07, r * 0.97, 18);
    ctx.fill();
    ctx.restore();
    const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.45, r * 0.05, cx, cy, r);
    g.addColorStop(0, c.hi);
    g.addColorStop(0.55, c.mid);
    g.addColorStop(1, c.lo);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.96, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = c.ring;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = r * 0.05;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.78, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    // letter
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    if (known) {
      ctx.font = '900 ' + Math.round(r * 1.12) + 'px ' + NUM_STACK;
      const m = ctx.measureText(rank);
      const asc = m.actualBoundingBoxAscent || r * 0.8;
      const desc = m.actualBoundingBoxDescent || 0;
      const by = cy + (asc - desc) / 2;
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillText(rank, cx + r * 0.03, by + r * 0.05);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(rank, cx, by);
    } else {
      ctx.fillStyle = '#ffffff';
      star(ctx, cx, cy, r * 0.46, r * 0.2, 5);
      ctx.fill();
    }
    ctx.restore();
    // gloss
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.96, 0, Math.PI * 2);
    ctx.clip();
    const gl = ctx.createLinearGradient(0, cy - r, 0, cy);
    gl.addColorStop(0, 'rgba(255,255,255,0.55)');
    gl.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gl;
    ctx.beginPath();
    ctx.ellipse(cx, cy - r * 0.62, r * 0.95, r * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function pill(ctx, text, x, y, h, opts) {
    // draws a pill whose left edge is x (or right edge if opts.right); returns its width
    const size = opts.size || Math.round(h * 0.56);
    ctx.font = font(opts.weight || 700, size);
    const padX = opts.padX || h * 0.5;
    const iconW = opts.icon ? h * 0.72 : 0;
    const w = Math.ceil(ctx.measureText(text).width + padX * 2 + iconW);
    const px = opts.right ? x - w : x;
    ctx.fillStyle = opts.bg;
    rr(ctx, px, y, w, h, h / 2);
    ctx.fill();
    if (opts.stroke) {
      ctx.strokeStyle = opts.stroke;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    if (opts.icon) opts.icon(px + padX + h * 0.22, y + h / 2, h * 0.3);
    ctx.fillStyle = opts.fg;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, px + padX + iconW, y + h / 2 + 1);
    ctx.textBaseline = 'alphabetic';
    return w;
  }

  /* ----------------------------------------------------------------- render */

  function defaultEpilogue(d) {
    if (d.endless) return '故事讲完了，风还没停——第 ' + d.lap + ' 圈的天空，也替它奔跑过了。';
    if (d.storyCleared) return '三片天空都替它奔跑过了。灯塔亮着，欢迎回家。';
    if (d.stage >= 3) return '灯塔的光已经看得见了。再借一口风，就到家。';
    if (d.stage === 2) return '晚霞很美，风暴也很凶。下一次，一起穿过它。';
    return '每一次起飞都算数。深吸一口气，再借一次风。';
  }

  function normalize(data) {
    const s = data || {};
    const d = {};
    d.toyShape = (s.toyShape === 'car' || s.toyShape === 'orb') ? s.toyShape : 'jet';
    d.toyName = (typeof s.toyName === 'string' && s.toyName.trim()) ? s.toyName.trim() : TOY_DEFAULT_NAME[d.toyShape];
    d.difficulty = DIFF_LABEL[s.difficulty] ? s.difficulty : null;
    d.godMode = !!s.godMode;
    d.hasScore = s.score !== undefined && s.score !== null && Number.isFinite(Number(s.score));
    d.score = Math.round(num(s.score, 0));
    d.rank = typeof s.rank === 'string' ? s.rank.trim().toUpperCase() : '';
    d.newRecord = !!s.newRecord;
    d.bestScore = (s.bestScore !== undefined && s.bestScore !== null && Number.isFinite(Number(s.bestScore))) ? Math.round(Number(s.bestScore)) : null;
    d.distanceKm = Math.max(0, num(s.distanceKm, 0));
    d.storyCleared = !!s.storyCleared;
    let wave = Math.floor(num(s.wave, 0));
    if (wave < 1) wave = d.storyCleared ? 3 : 1;
    d.wave = wave;
    d.endless = wave > 3;
    if (d.endless) d.storyCleared = true;
    // `loop` follows the engine's 0-based loopIndex (0 = story lap); lap is what we print.
    const loopIdx = (s.loop !== undefined && s.loop !== null && Number.isFinite(Number(s.loop)))
      ? Math.max(0, Math.floor(Number(s.loop))) : Math.floor((wave - 1) / 3);
    d.lap = Math.max(d.endless ? 2 : 1, loopIdx + 1);
    d.stage = ((wave - 1) % 3) + 1;               // which sky the flight ended in (1..3)
    d.kills = int(s.kills);
    d.maxCombo = int(s.maxCombo);
    d.medals = int(s.medals);
    d.gustUsedCount = int(s.gustUsedCount);
    d.hitsTaken = int(s.hitsTaken);
    d.bossKills = int(s.bossKills);
    d.crewAssists = int(s.crewAssists);
    d.dateText = (typeof s.dateText === 'string' && s.dateText.trim()) ? s.dateText.trim() : todayText();
    d.snapshot = s.snapshot || null;
    d.epilogue = (typeof s.epilogue === 'string' && s.epilogue.trim()) ? s.epilogue.trim() : defaultEpilogue(d);
    return d;
  }

  function cardPath(ctx, x0, y0, x1, y1, r, ny, nr) {
    ctx.beginPath();
    ctx.moveTo(x0 + r, y0);
    ctx.lineTo(x1 - r, y0);
    ctx.arcTo(x1, y0, x1, y0 + r, r);
    ctx.lineTo(x1, ny - nr);
    ctx.arc(x1, ny, nr, -Math.PI / 2, Math.PI / 2, true);
    ctx.lineTo(x1, y1 - r);
    ctx.arcTo(x1, y1, x1 - r, y1, r);
    ctx.lineTo(x0 + r, y1);
    ctx.arcTo(x0, y1, x0, y1 - r, r);
    ctx.lineTo(x0, ny + nr);
    ctx.arc(x0, ny, nr, Math.PI / 2, -Math.PI / 2, true);
    ctx.lineTo(x0, y0 + r);
    ctx.arcTo(x0, y0, x0 + r, y0, r);
    ctx.closePath();
  }

  function drawBackdrop(ctx) {
    ctx.fillStyle = lin(ctx, 0, 0, W * 0.4, H, ['#17285e', '#27418f', '#4b3f95']);
    ctx.fillRect(0, 0, W, H);
    const r = rng(99);
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 120; i++) {
      const edge = r() < 0.5;
      const x = edge ? (r() < 0.5 ? r() * 40 : W - r() * 40) : r() * W;
      const y = edge ? r() * H : (r() < 0.5 ? r() * 40 : H - r() * 40);
      ctx.globalAlpha = 0.25 + r() * 0.6;
      ctx.beginPath();
      ctx.arc(x, y, 0.8 + r() * 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawHeader(ctx, d, X0, X1, top, bottom) {
    ctx.fillStyle = lin(ctx, X0 - 56, top, X1 + 56, bottom, ['#2a86e8', '#49b2f5', '#7ad3ff']);
    ctx.fillRect(0, top, W, bottom - top);
    cloud(ctx, 560, bottom - 8, 110, 'rgba(255,255,255,0.2)');
    cloud(ctx, 150, bottom + 6, 90, 'rgba(255,255,255,0.16)');
    cloud(ctx, 940, bottom, 100, 'rgba(255,255,255,0.18)');
    // wind streaks
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineCap = 'round';
    ctx.lineWidth = 4;
    [[668, 74, 84], [700, 98, 56], [656, 120, 66]].forEach(function (s) {
      ctx.beginPath();
      ctx.moveTo(s[0], s[1]);
      ctx.bezierCurveTo(s[0] + s[2] * 0.4, s[1] - 10, s[0] + s[2] * 0.7, s[1] + 8, s[0] + s[2], s[1] - 3);
      ctx.stroke();
    });

    // stamp (right)
    const label = d.endless ? '无尽航程' : d.storyCleared ? '故事通关' : '航行记录';
    const sub = d.endless ? 'ENDLESS · LAP ' + d.lap : d.storyCleared ? 'STORY CLEARED' : 'FLIGHT LOG';
    const sw = 216, sh = 96, scx = X1 - sw / 2 - 2, scy = (top + bottom) / 2 + 2;
    ctx.save();
    ctx.translate(scx, scy);
    ctx.rotate(-0.07);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    rr(ctx, -sw / 2, -sh / 2, sw, sh, 18);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.lineWidth = 1.5;
    rr(ctx, -sw / 2 + 8, -sh / 2 + 8, sw - 16, sh - 16, 12);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    fitText(ctx, label, 0, 4, sw - 40, 38, 24, 800);
    ctx.globalAlpha = 0.9;
    fitText(ctx, sub, 0, 30, sw - 40, 16, 11, 700, true);
    ctx.restore();

    // title
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(15,50,110,0.25)';
    ctx.font = font(800, 54);
    const titleMax = X1 - X0 - sw - 30;
    const title = '借风计划 · 航程纪念卡';
    fitFont(ctx, title, titleMax, 54, 36, 800);
    ctx.fillText(title, X0 + 2, top + 82 + 3);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(title, X0, top + 82);
    ctx.globalAlpha = 0.92;
    ctx.font = font(700, 19, true);
    const subt = 'BORROWED WIND PROJECT  ·  BOARDING PASS';
    let sx = X0 + 2;
    // letter-spaced subtitle
    for (const ch of subt) {
      ctx.fillText(ch, sx, top + 120);
      sx += ctx.measureText(ch).width + 2.6;
    }
    ctx.globalAlpha = 1;
  }

  function drawPhoto(ctx, d, x, y, w, h) {
    const rad = 26;
    ctx.save();
    ctx.shadowColor = 'rgba(60,45,10,0.22)';
    ctx.shadowBlur = 26;
    ctx.shadowOffsetY = 10;
    ctx.fillStyle = '#ffffff';
    rr(ctx, x - 9, y - 9, w + 18, h + 18, rad + 8);
    ctx.fill();
    ctx.restore();
    ctx.save();
    rr(ctx, x, y, w, h, rad);
    ctx.clip();
    ctx.fillStyle = '#16204a';
    ctx.fillRect(x, y, w, h);
    let ok = false;
    if (d.snapshot) ok = drawCover(ctx, d.snapshot, x, y, w, h);
    if (!ok) drawSkyScene(ctx, x, y, w, h, d.stage, d.toyShape, d.wave);
    // legibility gradient for the nameplate
    ctx.fillStyle = lin(ctx, 0, y + h * 0.58, 0, y + h, ['rgba(8,14,40,0)', 'rgba(8,14,40,0.55)']);
    ctx.fillRect(x, y + h * 0.58, w, h * 0.42);
    // glass highlight
    ctx.fillStyle = lin(ctx, x, y, x + w * 0.5, y + h * 0.5, ['rgba(255,255,255,0.16)', 'rgba(255,255,255,0)']);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w * 0.42, y);
    ctx.lineTo(x + w * 0.18, y + h);
    ctx.lineTo(x, y + h);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(20,30,70,0.18)';
    ctx.lineWidth = 2;
    rr(ctx, x, y, w, h, rad);
    ctx.stroke();

    // nameplate: toy icon + name
    const ph = 76, py = y + h - ph - 20, px = x + 20;
    ctx.font = font(800, 36);
    const roleText = '本次机长';
    const nameMax = w * 0.6;
    const nameSize = fitFont(ctx, d.toyName, nameMax, 36, 24, 800);
    const name = ellipsize(ctx, d.toyName, nameMax);
    const nameW = ctx.measureText(name).width;
    ctx.font = font(600, 19);
    const roleW = ctx.measureText(roleText).width;
    const pw = ph + 10 + Math.max(nameW, roleW) + 30;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.25)';
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    rr(ctx, px, py, pw, ph, ph / 2);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = lin(ctx, 0, py, 0, py + ph, ['#58b7ff', '#2f7fe0']);
    ctx.beginPath();
    ctx.arc(px + ph / 2, py + ph / 2, ph / 2 - 6, 0, Math.PI * 2);
    ctx.fill();
    drawToy(ctx, d.toyShape, px + ph / 2, py + ph / 2, ph * 0.6, d.toyShape === 'jet' ? Math.PI / 4 : 0);
    ctx.textAlign = 'left';
    ctx.fillStyle = MUTED;
    ctx.font = font(600, 19);
    ctx.fillText(roleText, px + ph + 8, py + 27);
    ctx.fillStyle = INK;
    ctx.font = font(800, nameSize);
    ctx.fillText(name, px + ph + 8, py + 61);

    // corner caption on the photo (where the flight ended)
    const sky = SKIES[d.stage - 1];
    const cap = d.endless ? '无尽航线 · 第 ' + d.lap + ' 圈 · ' + sky.name : sky.ord + ' · ' + sky.name;
    ctx.font = font(700, 22);
    const capMax = w - pw - 70;
    if (capMax > 150) {
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(8,14,40,0.45)';
      fitFont(ctx, cap, capMax, 22, 16, 700);
      const ct = ellipsize(ctx, cap, capMax);
      ctx.fillText(ct, x + w - 23, py + ph - 13);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(ct, x + w - 24, py + ph - 14);
      ctx.textAlign = 'left';
    }
  }

  function segDecor(ctx, i, x, y, w, h) {
    ctx.save();
    rr(ctx, x, y, w, h, h / 2);
    ctx.clip();
    if (i === 0) {
      ctx.fillStyle = 'rgba(255,246,190,0.95)';
      ctx.beginPath();
      ctx.arc(x + w * 0.8, y + h * 0.36, h * 0.2, 0, Math.PI * 2);
      ctx.fill();
      cloud(ctx, x + w * 0.3, y + h * 0.62, h * 0.48, 'rgba(255,255,255,0.75)');
      cloud(ctx, x + w * 0.66, y + h * 0.9, h * 0.4, 'rgba(255,255,255,0.5)');
    } else if (i === 1) {
      ctx.fillStyle = 'rgba(255,244,200,0.9)';
      ctx.beginPath();
      ctx.arc(x + w * 0.74, y + h * 1.02, h * 0.42, 0, Math.PI * 2);
      ctx.fill();
      cloud(ctx, x + w * 0.26, y + h * 0.5, h * 0.44, 'rgba(255,255,255,0.4)');
      cloud(ctx, x + w * 0.52, y + h * 0.88, h * 0.36, 'rgba(120,60,90,0.25)');
    } else {
      const r = rng(7);
      ctx.fillStyle = '#ffffff';
      for (let k = 0; k < 16; k++) {
        ctx.globalAlpha = 0.5 + r() * 0.5;
        const sx = x + w * (0.08 + r() * 0.84), sy = y + h * (0.14 + r() * 0.7);
        if (k % 5 === 0) sparkle(ctx, sx, sy, 7);
        else { ctx.beginPath(); ctx.arc(sx, sy, 1.2 + r() * 1.6, 0, Math.PI * 2); ctx.fill(); }
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function drawRoute(ctx, d, x, y, w) {
    const segH = 64;
    const gap = 16;
    const badgeW = d.endless ? 168 : 0;
    const segW = (w - badgeW - gap * (d.endless ? 3 : 2)) / 3;
    const cleared = d.storyCleared ? 3 : d.stage - 1;        // story segments completed
    const capY = y + segH + 36;

    for (let i = 0; i < 3; i++) {
      const sx = x + i * (segW + gap);
      const sky = SKIES[i];
      const isCleared = i < cleared;
      const isCurrent = d.endless ? (i === d.stage - 1) : (!d.storyCleared && i === d.stage - 1);
      const lit = isCleared || d.endless;
      const grad = lin(ctx, sx, 0, sx + segW, 0, [sky.a, sky.b]);

      // base (dim) layer
      ctx.save();
      ctx.globalAlpha = lit ? 1 : 0.28;
      ctx.fillStyle = grad;
      rr(ctx, sx, y, segW, segH, segH / 2);
      ctx.fill();
      segDecor(ctx, i, sx, y, segW, segH);
      ctx.restore();

      if (!lit && isCurrent) {
        // lit up to the marker
        ctx.save();
        ctx.beginPath();
        ctx.rect(sx, y - 2, segW * 0.5, segH + 4);
        ctx.clip();
        ctx.fillStyle = grad;
        rr(ctx, sx, y, segW, segH, segH / 2);
        ctx.fill();
        segDecor(ctx, i, sx, y, segW, segH);
        ctx.restore();
      }
      if (lit) {
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 3;
        rr(ctx, sx + 4, y + 4, segW - 8, segH - 8, segH / 2 - 4);
        ctx.stroke();
      } else if (!isCurrent) {
        ctx.strokeStyle = 'rgba(120,130,150,0.55)';
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 8]);
        rr(ctx, sx + 1, y + 1, segW - 2, segH - 2, segH / 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // check badge for cleared segments
      if (isCleared && !(d.endless && isCurrent)) {
        const bx = sx + segW - segH / 2, by = y + segH / 2;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(bx, by, 17, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#27ae6a';
        ctx.lineWidth = 5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(bx - 8, by + 0.5);
        ctx.lineTo(bx - 2, by + 6.5);
        ctx.lineTo(bx + 8, by - 5.5);
        ctx.stroke();
      }

      // "you are here" marker
      if (isCurrent) {
        const mx = sx + segW * 0.5, my = y + segH / 2;
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.3)';
        ctx.shadowBlur = 12;
        ctx.shadowOffsetY = 4;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(mx, my, 32, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = lin(ctx, 0, my - 26, 0, my + 26, ['#ff9a5a', '#f2543d']);
        ctx.beginPath();
        ctx.arc(mx, my, 26, 0, Math.PI * 2);
        ctx.fill();
        drawToy(ctx, d.toyShape, mx, my, 34, d.toyShape === 'orb' ? 0 : Math.PI / 2);
      }

      // captions
      ctx.textAlign = 'center';
      ctx.fillStyle = (lit || isCurrent) ? INK : '#a3abb9';
      fitText(ctx, sky.name, sx + segW / 2, capY, segW - 8, 26, 18, 800);
      const status = isCurrent ? (d.endless ? '飞到这里' : '飞到这里') : isCleared ? '已通过' : '下次再来';
      ctx.fillStyle = isCurrent ? '#e2572b' : isCleared ? '#27965f' : '#a3abb9';
      fitText(ctx, sky.ord + ' · ' + status, sx + segW / 2, capY + 30, segW - 8, 20, 14, 600);
    }

    if (d.endless) {
      const bx = x + w - badgeW;
      ctx.save();
      ctx.shadowColor = 'rgba(90,60,200,0.35)';
      ctx.shadowBlur = 14;
      ctx.shadowOffsetY = 5;
      ctx.fillStyle = lin(ctx, bx, y, bx + badgeW, y + segH, ['#8a5cf6', '#e056b8']);
      rr(ctx, bx, y, badgeW, segH, segH / 2);
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      infinity(ctx, bx + 46, y + segH / 2, 50, 19);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      fitText(ctx, '×' + fmtInt(d.lap), bx + 82, y + segH / 2 + 2, badgeW - 82 - 16, 34, 16, 900, true);
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'center';
      ctx.fillStyle = INK;
      fitText(ctx, '无尽航线', bx + badgeW / 2, capY, badgeW - 4, 26, 18, 800);
      ctx.fillStyle = '#8a4fe0';
      fitText(ctx, '第 ' + fmtInt(d.lap) + ' 圈 · 第 ' + fmtInt(d.wave) + ' 波', bx + badgeW / 2, capY + 30, badgeW + 8, 20, 12, 600);
    }
    ctx.textAlign = 'left';
  }

  function drawScoreRow(ctx, d, X0, X1, y) {
    const r = 80;
    const mcx = X0 + r + 18, mcy = y + r + 12;
    drawMedal(ctx, mcx, mcy, r, d.rank);

    const tx = X0 + 230;
    const maxW = X1 - tx;
    ctx.textAlign = 'left';
    ctx.fillStyle = MUTED;
    ctx.font = font(700, 26);
    const rankLabel = RANKS[d.rank] ? '本次得分 · ' + d.rank + ' 级评价' : '本次得分';
    ctx.fillText(rankLabel, tx, y + 36);

    if (d.newRecord) {
      const ph = 46;
      ctx.save();
      ctx.shadowColor = 'rgba(230,80,40,0.35)';
      ctx.shadowBlur = 12;
      ctx.shadowOffsetY = 4;
      pill(ctx, '新纪录', X1, y + 2, ph, {
        right: true, size: 26, weight: 800,
        bg: lin(ctx, X1 - 170, 0, X1, 0, ['#ff9a3d', '#f0463f']),
        fg: '#ffffff',
        icon: function (ix, iy, ir) {
          ctx.shadowColor = 'transparent';
          ctx.fillStyle = '#fff3b0';
          star(ctx, ix, iy, ir * 1.15, ir * 0.5, 5);
          ctx.fill();
        }
      });
      ctx.restore();
    }

    ctx.fillStyle = INK;
    const scoreText = d.hasScore ? fmtInt(d.score) : '—';
    if (!d.hasScore) ctx.fillStyle = '#c3b99f';
    const size = fitFont(ctx, scoreText, maxW, 112, 40, 900, true);
    ctx.fillText(ellipsize(ctx, scoreText, maxW), tx - 3, y + 142 - (112 - size) * 0.25);

    ctx.fillStyle = MUTED;
    let sub;
    if (d.newRecord) sub = d.bestScore !== null && d.bestScore > d.score ? '历史最佳 ' + fmtInt(d.bestScore) : '刷新了历史最佳成绩';
    else if (d.bestScore !== null) sub = '历史最佳 ' + fmtInt(d.bestScore);
    else sub = '';
    if (d.bossKills > 0) sub += (sub ? '  ·  ' : '') + '击破封锁舰 ' + fmtInt(d.bossKills);
    if (sub) fitText(ctx, sub, tx, y + 196, maxW, 25, 16, 600);
  }

  function drawStats(ctx, d, x, y, w) {
    const items = [
      { label: '里程', value: fmtKm(d.distanceKm), unit: 'km', color: '#3aa0f0' },
      { label: '击落', value: fmtInt(d.kills), unit: '架', color: '#f0613f' },
      { label: '最高连击', value: fmtInt(d.maxCombo), unit: '连', color: '#a45cf0' },
      { label: '金星', value: fmtInt(d.medals), unit: '颗', color: '#f2b01e' },
      { label: '吹气顺风', value: fmtInt(d.gustUsedCount), unit: '次', color: '#2fb6a8' },
      { label: '受击', value: fmtInt(d.hitsTaken), unit: '次', color: '#8b97ab' }
    ];
    if (d.crewAssists > 0) items.push({ label: '地勤助攻', value: fmtInt(d.crewAssists), unit: '次', color: '#ef5b9c' });
    const rows = items.length > 6 ? [items.slice(0, 4), items.slice(4)] : [items.slice(0, 3), items.slice(3)];
    const gap = 14, ch = 88;
    for (let ri = 0; ri < rows.length; ri++) {
      const row = rows[ri];
      const cw = (w - gap * (row.length - 1)) / row.length;
      for (let ci = 0; ci < row.length; ci++) {
        const it = row[ci];
        const cx = x + ci * (cw + gap), cy = y + ri * (ch + gap);
        ctx.fillStyle = '#f6eeda';
        rr(ctx, cx, cy, cw, ch, 20);
        ctx.fill();
        ctx.fillStyle = it.color;
        rr(ctx, cx + 14, cy + 20, 7, ch - 40, 3.5);
        ctx.fill();
        const tx = cx + 34, maxW = cw - 34 - 16;
        ctx.textAlign = 'left';
        ctx.fillStyle = MUTED;
        fitText(ctx, it.label, tx, cy + 33, maxW, 22, 15, 700);
        ctx.font = font(700, 20);
        const unitW = ctx.measureText(it.unit).width + 7;
        ctx.fillStyle = INK;
        const vw = fitText(ctx, it.value, tx, cy + 73, maxW - unitW, 40, 18, 900, true);
        ctx.fillStyle = MUTED;
        ctx.font = font(700, 20);
        ctx.fillText(it.unit, tx + vw + 7, cy + 72);
      }
    }
    return rows.length * ch + (rows.length - 1) * gap;
  }

  function drawEpilogue(ctx, d, X0, X1, y, h) {
    const maxW = X1 - X0 - 90;
    ctx.textAlign = 'center';
    let size = 29;
    let lines;
    for (;;) {
      ctx.font = font(600, size);
      lines = wrapLines(ctx, d.epilogue, maxW, 2);
      const joined = lines.join('');
      const complete = joined.replace(/…$/, '').length >= Array.from(d.epilogue.replace(/\s+/g, ' ')).join('').length - 0;
      if ((lines.length === 1) || size <= 21 || (complete && lines.length <= 2 && size <= 26)) break;
      size -= 1;
    }
    const lh = Math.round(size * 1.4);
    const total = lines.length * lh;
    let by = y + (h - total) / 2 + size;
    ctx.fillStyle = '#5a4a2e';
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], (X0 + X1) / 2, by);
      by += lh;
    }
    // quote marks drawn as shapes-free text decorations
    ctx.fillStyle = '#e3c98f';
    ctx.font = '900 64px Georgia,"Times New Roman",serif';
    ctx.textAlign = 'left';
    ctx.fillText('“', X0 - 4, y + h / 2 + 30);
    ctx.textAlign = 'right';
    ctx.fillText('”', X1 + 4, y + h / 2 + 30);
    ctx.textAlign = 'left';
  }

  function drawFooter(ctx, d, X0, X1, y) {
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(X0, y);
    ctx.lineTo(X1, y);
    ctx.stroke();
    const mid = y + 32;
    // brand mark (right)
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#a79a7d';
    ctx.font = font(700, 17, true);
    const brand = 'TABLETOP SKY STRIKER';
    let bx = X1;
    const chars = Array.from(brand).reverse();
    for (const ch of chars) {
      ctx.fillText(ch, bx, mid + 1);
      bx -= ctx.measureText(ch).width + 2;
    }
    drawToy(ctx, 'jet', bx - 16, mid, 24, Math.PI / 4);
    const brandLeft = bx - 34;

    // date (left)
    ctx.textAlign = 'left';
    ctx.fillStyle = INK;
    ctx.font = font(800, 24, true);
    const dateMax = 230;
    fitFont(ctx, d.dateText, dateMax, 24, 16, 800, true);
    const dt = ellipsize(ctx, d.dateText, dateMax);
    ctx.fillText(dt, X0, mid + 1);
    let px = X0 + ctx.measureText(dt).width + 18;
    ctx.textBaseline = 'alphabetic';

    // tags
    const tags = [];
    if (d.difficulty) tags.push({ t: DIFF_LABEL[d.difficulty] + '难度', c: DIFF_COLOR[d.difficulty] });
    if (d.godMode) tags.push({ t: '亲子护航', c: '#e0688f' });
    const ph = 36;
    for (let i = 0; i < tags.length; i++) {
      ctx.font = font(700, 20);
      const need = ctx.measureText(tags[i].t).width + ph;
      if (px + need > brandLeft) break;
      const wUsed = pill(ctx, tags[i].t, px, mid - ph / 2, ph, { size: 20, bg: tags[i].c, fg: '#ffffff' });
      px += wUsed + 10;
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  function render(data) {
    const d = normalize(data);
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';

    drawBackdrop(ctx);

    const cx0 = 40, cy0 = 40, cx1 = W - 40, cy1 = H - 40;
    const X0 = 96, X1 = W - 96;
    const tearY = 824;

    // card body
    ctx.save();
    ctx.shadowColor = 'rgba(5,10,40,0.45)';
    ctx.shadowBlur = 40;
    ctx.shadowOffsetY = 16;
    ctx.fillStyle = PAPER;
    cardPath(ctx, cx0, cy0, cx1, cy1, 44, tearY, 22);
    ctx.fill();
    ctx.restore();

    ctx.save();
    cardPath(ctx, cx0, cy0, cx1, cy1, 44, tearY, 22);
    ctx.clip();
    // subtle paper tint on the lower stub
    ctx.fillStyle = lin(ctx, 0, tearY, 0, cy1, ['#fffaf0', '#fdf3df']);
    ctx.fillRect(cx0, tearY, cx1 - cx0, cy1 - tearY);
    drawHeader(ctx, d, X0, X1, cy0, 186);
    ctx.restore();

    drawPhoto(ctx, d, X0, 218, X1 - X0, 392);
    drawRoute(ctx, d, X0, 646, X1 - X0);

    // tear line
    ctx.strokeStyle = '#d9cdb2';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.setLineDash([2, 14]);
    ctx.beginPath();
    ctx.moveTo(cx0 + 36, tearY);
    ctx.lineTo(cx1 - 36, tearY);
    ctx.stroke();
    ctx.setLineDash([]);

    drawScoreRow(ctx, d, X0, X1, 846);
    const statsH = drawStats(ctx, d, X0, 1070, X1 - X0);
    drawEpilogue(ctx, d, X0, X1, 1070 + statsH + 6, 1338 - (1070 + statsH + 6));
    drawFooter(ctx, d, X0, X1, 1338);

    return canvas;
  }

  /* --------------------------------------------------------------- snapshot */

  function snapshot(source, maxW) {
    maxW = Math.max(1, Math.floor(num(maxW, 960)) || 960);
    const out = document.createElement('canvas');
    const sw = source ? (source.videoWidth || source.naturalWidth || source.width || 0) : 0;
    const sh = source ? (source.videoHeight || source.naturalHeight || source.height || 0) : 0;
    if (!sw || !sh) {
      out.width = 1;
      out.height = 1;
      return out;
    }
    const scale = Math.min(1, maxW / sw);
    out.width = Math.max(1, Math.round(sw * scale));
    out.height = Math.max(1, Math.round(sh * scale));
    try {
      const c = out.getContext('2d');
      c.imageSmoothingEnabled = true;
      c.imageSmoothingQuality = 'high';
      c.drawImage(source, 0, 0, sw, sh, 0, 0, out.width, out.height);
    } catch (e) { /* tainted or lost context: return the blank canvas */ }
    return out;
  }

  /* ---------------------------------------------------------------- preview */

  const STYLE_ID = 'fc-style';
  const CSS = [
    '.fc-overlay{position:fixed;inset:0;z-index:1000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;',
    'padding:16px;padding:max(16px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) max(16px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));',
    'box-sizing:border-box;background:rgba(8,12,32,.82);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);',
    'font-family:' + FONT_STACK.replace(/"/g, "'") + ';animation:fc-fade .18s ease-out;touch-action:manipulation;-webkit-tap-highlight-color:transparent}',
    '.fc-overlay *{box-sizing:border-box}',
    '.fc-stage{flex:1 1 auto;min-height:0;min-width:0;width:100%;display:flex;align-items:center;justify-content:center}',
    '.fc-img{display:block;max-width:100%;max-height:100%;width:auto;height:auto;aspect-ratio:3/4;object-fit:contain;border-radius:14px;',
    'box-shadow:0 18px 50px rgba(0,0,0,.55);animation:fc-pop .26s cubic-bezier(.2,.9,.3,1.2);-webkit-touch-callout:default;user-select:none;-webkit-user-select:none}',
    '.fc-side{flex:0 0 auto;display:flex;flex-direction:column;align-items:center;gap:8px;max-width:100%}',
    '.fc-actions{display:flex;flex-wrap:wrap;gap:10px;justify-content:center}',
    '.fc-btn{appearance:none;-webkit-appearance:none;border:0;margin:0;cursor:pointer;min-height:48px;padding:0 20px;border-radius:999px;',
    'font:700 16px/1 inherit;font-family:inherit;color:#fff;background:rgba(255,255,255,.16);box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.35);',
    'white-space:nowrap;transition:transform .08s ease,filter .12s ease}',
    '.fc-btn:hover{filter:brightness(1.12)}',
    '.fc-btn:active{transform:scale(.96)}',
    '.fc-btn:focus-visible{outline:3px solid #ffe27a;outline-offset:2px}',
    '.fc-btn[disabled]{opacity:.5;cursor:default}',
    '.fc-btn-primary{background:linear-gradient(180deg,#ffb23d,#f2643a);box-shadow:0 6px 16px rgba(242,100,58,.45)}',
    '.fc-btn-share{background:linear-gradient(180deg,#52b6ff,#2f7fe0);box-shadow:0 6px 16px rgba(47,127,224,.45)}',
    '.fc-hint{margin:0;font-size:13px;line-height:1.3;color:rgba(255,255,255,.72);text-align:center;min-height:17px}',
    '@media (orientation:landscape) and (max-height:560px){',
    '.fc-overlay{flex-direction:row;gap:20px}',
    '.fc-stage{flex:0 1 auto;width:auto;height:100%}',
    '.fc-actions{flex-direction:column;align-items:stretch}',
    '.fc-hint{max-width:180px}}',
    '@keyframes fc-fade{from{opacity:0}to{opacity:1}}',
    '@keyframes fc-pop{from{opacity:0;transform:translateY(12px) scale(.96)}to{opacity:1;transform:none}}',
    '@media (prefers-reduced-motion:reduce){.fc-overlay,.fc-img{animation:none}}'
  ].join('');

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  function canvasToBlob(canvas) {
    return new Promise(function (resolve) {
      try {
        if (canvas.toBlob) {
          canvas.toBlob(function (b) { resolve(b || null); }, 'image/png');
          return;
        }
      } catch (e) { /* fall through */ }
      resolve(null);
    });
  }

  let current = null; // the open preview's controller

  function openPreview(canvas, opts) {
    if (!canvas || typeof canvas.getContext !== 'function') throw new TypeError('FlightCard.openPreview: canvas required');
    if (current) current.close();
    opts = opts || {};
    let fileName = (typeof opts.fileName === 'string' && opts.fileName.trim()) ? opts.fileName.trim() : defaultFileName();
    if (!/\.png$/i.test(fileName)) fileName += '.png';
    ensureStyle();

    const prevFocus = document.activeElement;
    let closed = false;
    let blob = null;
    let blobUrl = null;
    let file = null;

    const overlay = document.createElement('div');
    overlay.className = 'fc-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '航程纪念卡预览');
    overlay.tabIndex = -1;

    const stage = document.createElement('div');
    stage.className = 'fc-stage';
    const img = document.createElement('img');
    img.className = 'fc-img';
    img.alt = '借风计划航程纪念卡';
    img.width = canvas.width;
    img.height = canvas.height;
    img.draggable = false;
    img.style.aspectRatio = canvas.width + ' / ' + canvas.height;
    stage.appendChild(img);

    const side = document.createElement('div');
    side.className = 'fc-side';
    const actions = document.createElement('div');
    actions.className = 'fc-actions';
    function mkBtn(text, cls) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'fc-btn' + (cls ? ' ' + cls : '');
      b.textContent = text;
      return b;
    }
    const saveBtn = mkBtn('💾 保存图片', 'fc-btn-primary');
    const shareBtn = mkBtn('📤 分享', 'fc-btn-share');
    shareBtn.hidden = true;
    shareBtn.style.display = 'none';
    const closeBtn = mkBtn('关闭', 'fc-btn-close');
    actions.appendChild(saveBtn);
    actions.appendChild(shareBtn);
    actions.appendChild(closeBtn);
    const hint = document.createElement('p');
    hint.className = 'fc-hint';
    hint.setAttribute('aria-live', 'polite');
    hint.textContent = '也可以长按图片保存到相册';
    side.appendChild(actions);
    side.appendChild(hint);
    overlay.appendChild(stage);
    overlay.appendChild(side);

    function setHint(t) { hint.textContent = t; }

    // image source: data URL right away (sync), swapped for nothing later — blob only used for save/share
    try {
      img.src = canvas.toDataURL('image/png');
    } catch (e) {
      setHint('图片生成失败，请截图保存');
    }

    const ready = canvasToBlob(canvas).then(function (b) {
      if (closed || !b) return b;
      blob = b;
      try {
        if (typeof File === 'function') {
          const f = new File([b], fileName, { type: 'image/png' });
          if (navigator.canShare && navigator.share && navigator.canShare({ files: [f] })) {
            file = f;
            shareBtn.hidden = false;
            shareBtn.style.display = '';
          }
        }
      } catch (e) { /* sharing unsupported */ }
      return b;
    });

    function triggerDownload(href) {
      const a = document.createElement('a');
      a.href = href;
      a.download = fileName;
      a.rel = 'noopener';
      a.style.display = 'none';
      overlay.appendChild(a);
      a.click();
      a.remove();
    }

    function save() {
      ready.then(function (b) {
        if (closed) return;
        try {
          if (b) {
            if (!blobUrl) blobUrl = URL.createObjectURL(b);
            triggerDownload(blobUrl);
          } else {
            triggerDownload(canvas.toDataURL('image/png'));
          }
          setHint('已保存：' + fileName);
        } catch (e) {
          setHint('保存失败，可以长按图片或截图保存');
        }
      });
    }

    function share() {
      if (!file) return;
      let p;
      try {
        p = navigator.share({ files: [file], title: '借风计划 · 航程纪念卡', text: '我的借风航程纪念卡' });
      } catch (e) {
        setHint('分享没有成功，可以先保存图片');
        return;
      }
      if (p && p.then) {
        p.then(function () { if (!closed) setHint('已分享'); }, function (err) {
          if (closed || (err && err.name === 'AbortError')) return;
          setHint('分享没有成功，可以先保存图片');
        });
      }
    }

    function focusables() {
      return [saveBtn, shareBtn, closeBtn].filter(function (b) { return !b.hidden && !b.disabled; });
    }

    // Keyboard: swallow everything in the capture phase on window so the game never sees it.
    function onKeyCapture(ev) {
      ev.stopPropagation();
      if (ev.type !== 'keydown') return;
      const key = ev.key;
      if (key === 'Escape' || key === 'Esc') {
        ev.preventDefault();
        close();
        return;
      }
      if (key === 'Tab') {
        const f = focusables();
        if (!f.length) { ev.preventDefault(); return; }
        const idx = f.indexOf(document.activeElement);
        ev.preventDefault();
        const next = ev.shiftKey ? (idx <= 0 ? f.length - 1 : idx - 1) : (idx === -1 || idx === f.length - 1 ? 0 : idx + 1);
        f[next].focus();
        return;
      }
      const inside = overlay.contains(ev.target);
      if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
        // native button activation needs the event to reach the focused button, but nothing
        // outside the modal may react; since we already stopped propagation, activate manually.
        ev.preventDefault();
        if (ev.repeat) return;
        const el = inside && document.activeElement && document.activeElement.classList &&
          document.activeElement.classList.contains('fc-btn') ? document.activeElement : null;
        if (el) el.click();
        return;
      }
      // block scrolling / game hotkeys behind the modal
      if (!inside || /^(Arrow|Page|Home|End)/.test(key)) ev.preventDefault();
    }
    function onModalKey(ev) { ev.stopPropagation(); }
    function onFocusIn(ev) {
      if (!overlay.contains(ev.target)) {
        const f = focusables();
        (f[0] || overlay).focus();
      }
    }

    function close() {
      if (closed) return;
      closed = true;
      window.removeEventListener('keydown', onKeyCapture, true);
      window.removeEventListener('keypress', onKeyCapture, true);
      document.removeEventListener('focusin', onFocusIn, true);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (blobUrl) {
        const u = blobUrl;
        blobUrl = null;
        setTimeout(function () { try { URL.revokeObjectURL(u); } catch (e) { /* ignore */ } }, 4000);
      }
      if (current === api) current = null;
      if (prevFocus && typeof prevFocus.focus === 'function' && document.contains(prevFocus)) {
        try { prevFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
      }
      if (typeof opts.onClose === 'function') {
        try { opts.onClose(); } catch (e) { /* ignore */ }
      }
    }

    saveBtn.addEventListener('click', save);
    shareBtn.addEventListener('click', share);
    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', function (ev) {
      if (ev.target === overlay || ev.target === stage || ev.target === side) close();
    });
    ['keydown', 'keyup', 'keypress'].forEach(function (t) { overlay.addEventListener(t, onModalKey); });
    // pointer/touch/wheel must not fall through to the game either
    ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'wheel', 'contextmenu'].forEach(function (t) {
      overlay.addEventListener(t, function (ev) { ev.stopPropagation(); }, { passive: true });
    });
    window.addEventListener('keydown', onKeyCapture, true);
    window.addEventListener('keypress', onKeyCapture, true);
    document.addEventListener('focusin', onFocusIn, true);

    document.body.appendChild(overlay);
    try { saveBtn.focus({ preventScroll: true }); } catch (e) { overlay.focus(); }

    const api = { close: close, element: overlay, ready: ready };
    current = api;
    return api;
  }

  window.FlightCard = {
    WIDTH: W,
    HEIGHT: H,
    render: render,
    openPreview: openPreview,
    snapshot: snapshot,
    isOpen: function () { return !!current; },
    close: function () { if (current) current.close(); }
  };
})();
