/**
 * Ground Crew Console (地勤指挥台) -《借风计划》second-phone support role
 *
 * A parent opens crew.html?room=XXXX on a second phone while the kid flies with controller.html.
 * This page never steers the craft. It only:
 *  - mirrors the pilot's status from the host's 16Hz 'telemetry' stream
 *  - sends bridge.send('crew', { action, ... }) support requests:
 *      shield | heal | supply | mark { nx, ny } | cheer { emoji } | hello
 * Cooldowns are owned by the host (telemetry.crew.<action> = readiness 0..1); the UI only mirrors
 * them, plus a short optimistic lock so a double tap never fires twice.
 */
(function () {
  'use strict';

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const $ = (id) => document.getElementById(id);

  const params = new URLSearchParams(location.search);
  const roomId = (params.get('room') || 'SKY1').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'SKY1';
  const sfx = window.SoundFX ? new window.SoundFX() : null;

  const ACTIONS = ['shield', 'heal', 'supply', 'mark', 'cheer'];
  // Only used when the host does not report telemetry.crew (older host build): keeps taps sane.
  const FALLBACK_COOLDOWN_MS = { shield: 20000, heal: 15000, supply: 22000, mark: 8000, cheer: 1500 };
  const OPTIMISTIC_LOCK_MS = 700;
  const MARK_SECONDS = 6;
  const TELEMETRY_STALE_MS = 2500;

  const state = {
    connected: false,
    transport: '',
    rttMs: null,
    gotTelemetry: false,
    lastTelemetryAt: 0,
    hostHasCrew: false,
    telemetry: {
      phase: 'title',
      paused: false,
      score: 0,
      distanceKm: 0,
      wave: 0,
      chapterTitle: '',
      hp: 100,
      shield: 0,
      droneCount: 0,
      nukes: 0,
      weaponLv: 1,
      bossHp: 0,
      bossName: '',
      combo: 0,
      blips: [],
      crew: null
    },
    lockUntil: {}, // action -> performance.now() until which we assume "just used"
    localUsedAt: {}, // action -> time of last local use (fallback cooldown only)
    reticle: null, // { nx, ny, at }
    hitFlashAt: 0
  };

  function vibrate(pattern) {
    if (navigator.vibrate) {
      try { navigator.vibrate(pattern); } catch (_) {}
    }
  }

  function click() {
    if (!sfx) return;
    try {
      sfx.unlock();
      sfx.uiClick();
    } catch (_) {}
  }

  // ---------- Hint line ----------
  const hintEl = $('hint-line');
  const DEFAULT_HINT = '你是地勤：孩子负责飞，你负责补给和指挥';
  let hintTimer = 0;
  function flashHint(text, ms = 2200) {
    hintEl.textContent = text;
    hintEl.classList.add('flash');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => {
      hintEl.classList.remove('flash');
      hintEl.textContent = idleHint();
    }, ms);
  }

  // ---------- Availability ----------
  function telemetryFresh() {
    return state.gotTelemetry && performance.now() - state.lastTelemetryAt < TELEMETRY_STALE_MS;
  }

  const isWeChat = typeof navigator !== 'undefined' && /MicroMessenger/i.test(navigator.userAgent || '');

  /** null when crew actions are accepted, otherwise why not. */
  function blockReason() {
    const t = state.telemetry;
    if (!state.connected) {
      const sub = isWeChat
        ? `若微信内一直连不上，请点右上角 ⋯ 在系统浏览器打开（房间号 ${roomId}）`
        : (state.signalError
          ? `公网信令连接受阻，请检查网络或与平板连接同一 Wi-Fi（房间号 ${roomId}）`
          : `请确认平板已打开游戏，房间号 ${roomId}`);
      return { short: '未连接', text: '正在连接平板…', sub };
    }
    if (!state.gotTelemetry) return { short: '同步中', text: '已连上平板，正在同步…', sub: '' };
    if (t.phase === 'gameover') return { short: '等待起飞', text: '本局结束', sub: '等小飞行员再次起飞，地勤继续待命' };
    if (t.phase !== 'playing') return { short: '等待起飞', text: '等待起飞', sub: '孩子在手柄或平板上点「点火起飞」后，支援就会解锁' };
    if (t.paused) return { short: '已暂停', text: '飞行已暂停', sub: '恢复飞行后支援继续可用' };
    if (!telemetryFresh()) return { short: '信号弱', text: '平板信号中断…', sub: '正在自动重连' };
    return null;
  }

  function idleHint() {
    const r = blockReason();
    if (r) return r.sub ? `${r.text} · ${r.sub}` : r.text;
    const t = state.telemetry;
    if (t.hp <= 35 && readiness('heal') >= 1) return '⚠️ 机体告急！快按 🔧 远程维修';
    if (t.bossHp > 0 && readiness('mark') >= 1) return 'BOSS 来了！点雷达上的大红点 🎯 标记集火';
    if (t.shield <= 0 && readiness('shield') >= 1) return '护盾空了，可以 🛡 投放一层';
    return DEFAULT_HINT;
  }

  /** Host would refuse these without spending the cooldown, so say why instead of sending. */
  function pointless(action) {
    const t = state.telemetry;
    if (action === 'shield' && t.shield >= 2) return { short: '护盾已满', text: '护盾已经是满的 2 层，先留着' };
    if (action === 'heal' && t.hp >= 100) return { short: '机体完好', text: '机体完好，受伤了再修' };
    return null;
  }

  function readiness(action) {
    const now = performance.now();
    if ((state.lockUntil[action] || 0) > now) return 0;
    const crew = state.telemetry.crew;
    if (crew && typeof crew[action] === 'number') return clamp(crew[action], 0, 1);
    const usedAt = state.localUsedAt[action];
    if (!usedAt) return 1;
    return clamp((now - usedAt) / FALLBACK_COOLDOWN_MS[action], 0, 1);
  }

  // ---------- Bridge ----------
  let bridge = null;

  function sendCrew(action, extra) {
    if (!bridge) return;
    bridge.send('crew', Object.assign({ action }, extra || {}));
  }

  function useAction(action, extra) {
    const now = performance.now();
    state.lockUntil[action] = now + OPTIMISTIC_LOCK_MS;
    if (!state.hostHasCrew) state.localUsedAt[action] = now;
    sendCrew(action, extra);
  }

  /** Shared gate for every support tap. Returns true when the action was sent. */
  function tryAction(action, extra, okText) {
    const reason = blockReason();
    if (reason) {
      vibrate(10);
      flashHint(reason.sub ? `${reason.text} · ${reason.sub}` : reason.text);
      return false;
    }
    if (readiness(action) < 1) {
      vibrate(10);
      flashHint('还在冷却中，按钮充满就能再用');
      return false;
    }
    const full = pointless(action);
    if (full) {
      vibrate(10);
      flashHint(full.text);
      return false;
    }
    useAction(action, extra);
    click();
    if (okText) flashHint(okText);
    return true;
  }

  bridge = new window.LinkBridge({
    role: 'crew',
    roomId,
    onMessage(type, payload) {
      if (!payload) return;
      if (type === 'telemetry') {
        // One-off events, not state
        if (payload.hitVibrate) {
          state.hitFlashAt = performance.now();
          return;
        }
        if (payload.warn) return;
        const prevBoss = state.telemetry.bossHp > 0;
        Object.assign(state.telemetry, payload);
        state.hostHasCrew = Boolean(payload.crew);
        if (!payload.crew) state.telemetry.crew = null;
        state.gotTelemetry = true;
        state.lastTelemetryAt = performance.now();
        if (!prevBoss && payload.bossHp > 0) {
          vibrate([60, 40, 60]);
          flashHint(`⚠️ ${payload.bossName || 'BOSS'} 出现！点雷达大红点 🎯 标记集火`, 3200);
        }
      } else if (type === 'hostState') {
        // Public rig/state snapshot: only pick up the fields this page shows.
        if (typeof payload.phase === 'string') state.telemetry.phase = payload.phase;
        if (typeof payload.paused === 'boolean') state.telemetry.paused = payload.paused;
      }
    },
    onStatus(info) {
      const was = state.connected;
      state.connected = Boolean(info.connected);
      state.transport = info.transport || '';
      state.rttMs = info.rttMs;
      state.signalError = info.signalError || null;
      if (state.connected && !was) {
        sendCrew('hello');
        bridge.send('requestState');
        flashHint('✅ 已连上平板，地勤上线！');
      } else if (!state.connected && was) {
        state.gotTelemetry = false;
        vibrate([20, 60, 20]);
      }
      renderLink();
    }
  });
  bridge.start();

  // ---------- Header / pilot status rendering ----------
  const dotEl = $('crew-dot');
  const statusEl = $('crew-status');
  function renderLink() {
    if (state.connected) {
      dotEl.classList.add('ok');
      statusEl.textContent = `${roomId} · ${state.transport}${state.rttMs ? ' ' + state.rttMs + 'ms' : ''}`;
    } else {
      dotEl.classList.remove('ok');
      statusEl.textContent = `待连平板 (${roomId})`;
    }
  }

  const el = {
    chapter: $('chapter-label'),
    score: $('score-text'),
    hpFill: $('hp-fill'),
    hpTrack: $('hp-track'),
    pips: Array.from($('shield-pips').children),
    bossRow: $('boss-row'),
    bossName: $('boss-name'),
    bossFill: $('boss-fill'),
    bossPct: $('boss-pct'),
    wave: $('meta-wave'),
    dist: $('meta-dist'),
    weapon: $('meta-weapon'),
    drone: $('meta-drone'),
    nuke: $('meta-nuke'),
    combo: $('meta-combo'),
    overlay: $('radar-overlay'),
    overlayText: $('radar-overlay-text'),
    radarCard: $('radar-card'),
    markState: $('mark-state'),
    cheerRow: $('cheer-row')
  };
  const supportBtns = {};
  document.querySelectorAll('.support-btn').forEach((btn) => {
    supportBtns[btn.dataset.action] = {
      btn,
      fill: btn.querySelector('.cd-fill'),
      sub: btn.querySelector('.sub')
    };
  });

  function setText(node, text) {
    if (node.textContent !== text) node.textContent = text;
  }

  function renderStatus() {
    const t = state.telemetry;
    const reason = blockReason();
    const live = state.connected && state.gotTelemetry;

    let chapter;
    if (!state.connected) chapter = '等待连接平板…';
    else if (!state.gotTelemetry) chapter = '同步飞行数据…';
    else if (t.phase === 'title') chapter = '停机坪待命 · 等待小飞行员起飞';
    else if (t.phase === 'gameover') chapter = '本局结束 · 等待再次起飞';
    else chapter = (t.chapterTitle || '飞行中') + (t.paused ? ' · 已暂停' : '');
    setText(el.chapter, chapter);
    setText(el.score, String(Math.max(0, Math.floor(t.score || 0))).padStart(7, '0'));

    const hp = clamp(Number(t.hp) || 0, 0, 100);
    el.hpFill.style.transform = `scaleX(${live ? hp / 100 : 0})`;
    el.hpFill.classList.toggle('low', hp <= 35);
    el.hpFill.classList.toggle('mid', hp > 35 && hp <= 65);
    el.hpTrack.setAttribute('aria-valuenow', String(hp));
    const shield = live ? Number(t.shield) || 0 : 0;
    el.pips.forEach((pip, i) => pip.classList.toggle('on', i < shield));

    const bossOn = live && t.phase === 'playing' && t.bossHp > 0;
    el.bossRow.hidden = !bossOn;
    if (bossOn) {
      setText(el.bossName, '👾 ' + (t.bossName || 'BOSS'));
      el.bossFill.style.transform = `scaleX(${clamp(t.bossHp, 0, 1)})`;
      setText(el.bossPct, Math.round(clamp(t.bossHp, 0, 1) * 100) + '%');
    }

    setText(el.wave, `波次 ${t.wave || '–'}`);
    setText(el.dist, `航程 ${(Number(t.distanceKm) || 0).toFixed(1)} km`);
    setText(el.weapon, `火力 Lv.${t.weaponLv || 1}`);
    setText(el.drone, `僚机 ${t.droneCount || 0}`);
    setText(el.nuke, `核弹 ${t.nukes || 0}`);
    el.combo.hidden = !(t.combo > 1);
    if (t.combo > 1) setText(el.combo, `连击 ${t.combo}`);

    // Radar overlay
    el.overlay.hidden = !reason;
    if (reason) {
      const html = reason.sub ? `${reason.text}<small>${reason.sub}</small>` : reason.text;
      if (el.overlayText.dataset.key !== html) {
        el.overlayText.dataset.key = html;
        el.overlayText.innerHTML = html;
      }
    }

    // Support buttons
    for (const action of ['shield', 'heal', 'supply', 'mark']) {
      const ui = supportBtns[action];
      const r = readiness(action);
      const ready = r >= 1;
      ui.btn.classList.toggle('off', Boolean(reason));
      const full = !reason && ready ? pointless(action) : null;
      ui.btn.classList.toggle('cooling', !reason && (!ready || Boolean(full)));
      ui.btn.setAttribute('aria-disabled', reason || !ready || full ? 'true' : 'false');
      ui.fill.style.transform = `scaleY(${reason ? 1 : r})`;
      let sub;
      if (reason) sub = reason.short;
      else if (!ready) sub = `冷却 ${Math.round(r * 100)}%`;
      else if (full) sub = full.short;
      else sub = action === 'mark' ? '点雷达' : '就绪';
      setText(ui.sub, sub);
    }

    const markReady = !reason && readiness('mark') >= 1;
    el.radarCard.classList.toggle('ready', markReady);
    el.markState.classList.toggle('cooling', !markReady);
    setText(el.markState, reason ? '🎯 ' + reason.short : markReady ? '🎯 点敌机标记集火' : `🎯 冷却 ${Math.round(readiness('mark') * 100)}%`);

    el.cheerRow.classList.toggle('off', Boolean(reason));

    if (!hintEl.classList.contains('flash')) setText(hintEl, idleHint());
  }

  // ---------- Support buttons ----------
  const OK_TEXT = {
    shield: '🛡 护盾已投放！',
    heal: '🔧 维修完成，机体 +25',
    supply: '📦 补给箱已空投，提醒孩子去接！'
  };

  function pulse(node, cls) {
    node.classList.remove(cls);
    void node.offsetWidth;
    node.classList.add(cls);
  }

  for (const action of ['shield', 'heal', 'supply']) {
    supportBtns[action].btn.addEventListener('click', () => {
      if (tryAction(action, null, OK_TEXT[action])) {
        vibrate([30, 25, 60]);
        pulse(supportBtns[action].btn, 'fired');
      }
    });
  }

  supportBtns.mark.btn.addEventListener('click', () => {
    const reason = blockReason();
    if (reason) {
      vibrate(10);
      flashHint(reason.sub ? `${reason.text} · ${reason.sub}` : reason.text);
      return;
    }
    click();
    vibrate(12);
    // One-tap shortcut: a boss on the radar is the obvious target.
    const boss = (state.telemetry.blips || []).find((b) => b.b);
    if (boss) {
      markAt(boss.nx, boss.ny);
    } else {
      flashHint(readiness('mark') >= 1 ? '👆 在上面的雷达里点一个红点，就能标记它' : '标记冷却中，稍等一下');
      pulse(el.radarCard, 'fired');
    }
  });

  document.querySelectorAll('.cheer-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const emoji = btn.dataset.emoji;
      const reason = blockReason();
      if (reason) {
        vibrate(10);
        flashHint(reason.sub ? `${reason.text} · ${reason.sub}` : reason.text);
        return;
      }
      if (readiness('cheer') < 1) return; // quiet: rapid emoji taps are normal
      useAction('cheer', { emoji });
      click();
      vibrate(18);
      pulse(btn, 'pop');
      flashHint(`${emoji} 已发送到平板`, 1400);
    });
  });

  // ---------- Help dialog ----------
  const helpDialog = $('help-dialog');
  function openHelp() {
    if (helpDialog.open) return;
    if (typeof helpDialog.showModal === 'function') helpDialog.showModal();
    else helpDialog.setAttribute('open', '');
  }
  function closeHelp() {
    if (typeof helpDialog.close === 'function') helpDialog.close();
    else helpDialog.removeAttribute('open');
    try { localStorage.setItem('sky-crew-help-seen', '1'); } catch (_) {}
  }
  $('btn-help').addEventListener('click', () => { click(); openHelp(); });
  $('btn-help-close').addEventListener('click', () => { click(); closeHelp(); });
  helpDialog.addEventListener('click', (ev) => {
    if (ev.target === helpDialog) closeHelp(); // backdrop tap
  });
  let helpSeen = false;
  try { helpSeen = localStorage.getItem('sky-crew-help-seen') === '1'; } catch (_) {}
  if (!helpSeen && params.get('help') !== '0') openHelp();

  // ---------- Radar ----------
  // Same normalized space as telemetry blips: craft at (0,0), nx/ny in -1..1, ny<0 = ahead (up).
  // The craft sits below the middle because nearly all traffic is ahead of it.
  const radar = $('crew-radar');
  const rctx = radar.getContext('2d');
  let rw = 0;
  let rh = 0;
  let dpr = 1;

  function resizeRadar() {
    const rect = radar.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    rw = Math.max(1, rect.width);
    rh = Math.max(1, rect.height);
    radar.width = Math.round(rw * dpr);
    radar.height = Math.round(rh * dpr);
  }
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resizeRadar).observe(radar);
  window.addEventListener('resize', resizeRadar);
  resizeRadar();

  function geo() {
    const cx = rw * 0.5;
    const cy = rh * 0.66;
    return { cx, cy, sx: rw * 0.46, sy: rh * 0.6 };
  }
  function toPx(nx, ny) {
    const g = geo();
    return { x: g.cx + nx * g.sx, y: Math.min(rh - 6, g.cy + ny * g.sy) };
  }
  function toNorm(x, y) {
    const g = geo();
    return { nx: clamp((x - g.cx) / g.sx, -1, 1), ny: clamp((y - g.cy) / g.sy, -1, 1) };
  }
  function nearestBlip(nx, ny) {
    const g = geo();
    let best = null;
    let bestD = Infinity;
    for (const b of state.telemetry.blips || []) {
      const d = Math.hypot((b.nx - nx) * g.sx, (b.ny - ny) * g.sy);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  function markAt(nx, ny) {
    if (!tryAction('mark', { nx: Number(nx.toFixed(3)), ny: Number(ny.toFixed(3)) }, '🎯 目标已标记！僚机集火 6 秒')) return false;
    state.reticle = { nx, ny, at: performance.now() };
    vibrate([20, 30, 50]);
    pulse(supportBtns.mark.btn, 'fired');
    return true;
  }

  el.radarCard.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    const rect = radar.getBoundingClientRect();
    const p = toNorm(ev.clientX - rect.left, ev.clientY - rect.top);
    const reason = blockReason();
    if (reason) {
      vibrate(10);
      flashHint(reason.sub ? `${reason.text} · ${reason.sub}` : reason.text);
      return;
    }
    if (!(state.telemetry.blips || []).length) {
      vibrate(10);
      flashHint('雷达上暂时没有敌机，等红点出现再点');
      return;
    }
    markAt(p.nx, p.ny);
  });

  let sweep = 0;
  function drawRadar(now) {
    if (radar.width < 2) return;
    const t = state.telemetry;
    const g = geo();
    const live = !blockReason();
    rctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    rctx.clearRect(0, 0, rw, rh);
    rctx.fillStyle = '#030914';
    rctx.fillRect(0, 0, rw, rh);

    // Range rings + cross hair
    const ringStep = Math.max(34, Math.min(rw, rh) * 0.17);
    rctx.strokeStyle = 'rgba(56, 189, 248, 0.2)';
    rctx.lineWidth = 1;
    for (let i = 1; i <= 6; i++) {
      rctx.beginPath();
      rctx.arc(g.cx, g.cy, ringStep * i, 0, Math.PI * 2);
      rctx.stroke();
    }
    rctx.strokeStyle = 'rgba(56, 189, 248, 0.12)';
    rctx.beginPath();
    rctx.moveTo(g.cx, 0);
    rctx.lineTo(g.cx, rh);
    rctx.moveTo(0, g.cy);
    rctx.lineTo(rw, g.cy);
    rctx.stroke();

    // Sweep beam
    if (live) sweep = (sweep + 0.045) % (Math.PI * 2);
    const beamLen = Math.hypot(rw, rh);
    rctx.save();
    rctx.translate(g.cx, g.cy);
    rctx.rotate(sweep);
    const grad = rctx.createLinearGradient(0, 0, beamLen * 0.6, 0);
    grad.addColorStop(0, 'rgba(56, 189, 248, 0.32)');
    grad.addColorStop(1, 'rgba(56, 189, 248, 0)');
    rctx.fillStyle = grad;
    rctx.beginPath();
    rctx.moveTo(0, 0);
    rctx.arc(0, 0, beamLen, -0.3, 0.04);
    rctx.closePath();
    rctx.fill();
    rctx.restore();

    // Blips
    const blips = live ? t.blips || [] : [];
    for (const b of blips) {
      const p = toPx(b.nx, b.ny);
      if (b.b) {
        const pulseR = 15 + Math.sin(now / 160) * 2.5;
        rctx.fillStyle = 'rgba(239, 68, 68, 0.22)';
        rctx.beginPath();
        rctx.arc(p.x, p.y, pulseR + 7, 0, Math.PI * 2);
        rctx.fill();
        rctx.fillStyle = '#ef4444';
        rctx.beginPath();
        rctx.arc(p.x, p.y, pulseR, 0, Math.PI * 2);
        rctx.fill();
        rctx.strokeStyle = '#fecaca';
        rctx.lineWidth = 2;
        rctx.stroke();
      } else {
        rctx.fillStyle = '#fb923c';
        rctx.beginPath();
        rctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
        rctx.fill();
      }
    }

    // Craft (flashes when hit)
    const hit = now - state.hitFlashAt < 320;
    rctx.fillStyle = hit ? '#ef4444' : '#4ade80';
    rctx.shadowColor = hit ? '#ef4444' : '#4ade80';
    rctx.shadowBlur = 10;
    rctx.beginPath();
    rctx.moveTo(g.cx, g.cy - 11);
    rctx.lineTo(g.cx + 9, g.cy + 9);
    rctx.lineTo(g.cx, g.cy + 4);
    rctx.lineTo(g.cx - 9, g.cy + 9);
    rctx.closePath();
    rctx.fill();
    rctx.shadowBlur = 0;
    if (live && t.shield > 0) {
      rctx.strokeStyle = 'rgba(56, 189, 248, 0.85)';
      rctx.lineWidth = 2;
      rctx.beginPath();
      rctx.arc(g.cx, g.cy, 17, 0, Math.PI * 2);
      rctx.stroke();
    }

    // Target reticle: follows the nearest blip for the 6s the mark lasts
    const ret = state.reticle;
    if (ret) {
      const age = (now - ret.at) / 1000;
      if (age > MARK_SECONDS || !live) {
        state.reticle = null;
      } else {
        const near = nearestBlip(ret.nx, ret.ny);
        if (near) {
          // glide with the target, but never jump across the scope to a different enemy
          const d = Math.hypot((near.nx - ret.nx) * g.sx, (near.ny - ret.ny) * g.sy);
          if (d < 70 || age < 0.25) {
            ret.nx = near.nx;
            ret.ny = near.ny;
          }
        }
        const p = toPx(ret.nx, ret.ny);
        const intro = clamp(1 - age / 0.35, 0, 1);
        const r = 20 + intro * 26;
        const alpha = age > MARK_SECONDS - 1 ? MARK_SECONDS - age : 1;
        rctx.save();
        rctx.globalAlpha = clamp(alpha, 0, 1);
        rctx.strokeStyle = '#fbbf24';
        rctx.lineWidth = 2.5;
        rctx.translate(p.x, p.y);
        rctx.rotate(now / 500);
        for (let i = 0; i < 4; i++) {
          rctx.beginPath();
          rctx.arc(0, 0, r, i * (Math.PI / 2) + 0.25, (i + 1) * (Math.PI / 2) - 0.25);
          rctx.stroke();
          rctx.beginPath();
          rctx.moveTo(r - 6, 0);
          rctx.lineTo(r + 7, 0);
          rctx.stroke();
          rctx.rotate(Math.PI / 2);
        }
        rctx.restore();
        // remaining-time arc
        rctx.strokeStyle = 'rgba(251, 191, 36, 0.5)';
        rctx.lineWidth = 2;
        rctx.beginPath();
        rctx.arc(p.x, p.y, r + 11, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - age / MARK_SECONDS));
        rctx.stroke();
      }
    }
  }

  // ---------- Main loop ----------
  function frame(now) {
    renderStatus();
    drawRadar(now);
    requestAnimationFrame(frame);
  }
  renderLink();
  requestAnimationFrame(frame);

  window.__skyCrew = { state, bridge, readiness, blockReason };
})();
