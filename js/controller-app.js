/**
 * Mobile Cockpit MFD Controller Application -《借风计划》v2
 * Features:
 *  - Multi-touch damped virtual joystick (Pointer Capture)
 *  - DeviceOrientation gyro flight stick with one-tap zeroing & pull-up Cobra Barrel Roll
 *  - Spring-loaded pull-down Railgun lever with haptic & synth feedback
 *  - 4-State Smart Primary Button: Launch Mission / Resume / EMP Nuke / Relaunch
 *  - Dedicated Pause & Stop-to-Title controls + Automatic Host Pause while calibrating
 *  - Web Audio microphone blow-detection for 8-Gale Wind Gust screen clear (with tap fallback)
 *  - Live 20Hz tactical radar sweep canvas
 */
(function () {
  'use strict';

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  const params = new URLSearchParams(location.search);
  const roomId = (params.get('room') || 'SKY1').toUpperCase();
  const sfx = new window.SoundFX();

  const state = {
    controlMode: 'touch', // 'touch' | 'gyro'
    stickVx: 0,
    stickVy: 0,
    touchOverride: false,
    gyroVx: 0,
    gyroVy: 0,
    gyroBaseBeta: null,
    gyroBaseGamma: null,
    lastBeta: null,
    lastRollAt: 0,
    railCharge: 0,
    micActive: false,
    micLevel: 0,
    blowFrames: 0,
    lastGustAt: 0,
    mfdMode: 'fusion', // 'fusion' (Attitude HUD + Radar) | 'horizon' (Pure Attitude HUD) | 'radar' (Tactical Radar)
    hudRoll: 0,
    hudPitch: 0,
    hudRollAnim: 0,
    skillDraft: null,
    telemetry: {
      phase: 'title',
      paused: false,
      manualPaused: false,
      setupPaused: false,
      score: 0,
      distanceKm: 0,
      wave: 1,
      chapterTitle: '第一航段 · 晴空借风',
      sky: 'day',
      bank: 0,
      speedRatio: 0,
      rollActive: false,
      hp: 100,
      weaponLv: 1,
      nukes: 2,
      gustReady: 1,
      mode: 'tabletop',
      pureCamera: false,
      godMode: false,
      gameOver: false,
      blips: []
    }
  };

  function vibrate(pattern) {
    if (navigator.vibrate) {
      try { navigator.vibrate(pattern); } catch (_) {}
    }
  }

  // Hoist all DOM bindings at top to eliminate any TDZ risk
  const calibDialog = document.getElementById('calib-dialog');
  const btnCPause = document.getElementById('btn-c-pause');
  const btnCStop = document.getElementById('btn-c-stop');
  const btnModeSwitch = document.getElementById('btn-mode-switch');
  const btnPureCam = document.getElementById('btn-pure-cam');
  const btnCalib = document.getElementById('btn-calib');
  const chapterLabel = document.getElementById('chapter-label');
  const scoreText = document.getElementById('score-text');
  const lvText = document.getElementById('lv-text');
  const waveLabel = document.getElementById('wave-label');
  const hpFill = document.getElementById('hp-fill');
  const hpMeter = document.getElementById('cockpit-hp');
  const xpMeter = document.getElementById('cockpit-xp');
  const xpFill = document.getElementById('xp-fill');
  const skillDraftDialog = document.getElementById('skill-draft-dialog');
  const cDraftTitle = document.getElementById('c-draft-title');
  const cDraftList = document.getElementById('c-draft-list');
  const cDraftReroll = document.getElementById('c-draft-reroll');
  const joyZone = document.getElementById('joystick-zone');
  const stickKnob = document.getElementById('stick-knob');
  const btnTouch = document.getElementById('btn-touch-mode');
  const btnGyro = document.getElementById('btn-gyro-mode');
  const btnZero = document.getElementById('btn-gyro-zero');
  const sensorMsg = document.getElementById('sensor-msg');
  const railTrack = document.getElementById('railgun-track');
  const railHandle = document.getElementById('railgun-handle');
  const railFill = document.getElementById('railgun-fill');
  const nukeBtn = document.getElementById('nuke-btn');
  const nukeTitle = document.getElementById('nuke-title');
  const nukeCount = document.getElementById('nuke-count');
  const btnWind = document.getElementById('btn-wind');
  const micBar = document.getElementById('mic-bar');
  const btnMfdMode = document.getElementById('btn-mfd-mode');
  const cWidth = document.getElementById('c-width');
  const cLength = document.getElementById('c-length');
  const cAnchor = document.getElementById('c-anchor');
  const cGod = document.getElementById('c-god');

  let bridge = null;
  let hostConnected = false;
  let stickPointerId = null;
  let railPointerId = null;

  // Calibration Dialog light-dismiss fallback per modern-web-guidance
  if (!('closedBy' in HTMLDialogElement.prototype)) {
    calibDialog.addEventListener('click', (event) => {
      if (event.target !== calibDialog) return;
      const r = calibDialog.getBoundingClientRect();
      const inside = r.top <= event.clientY && event.clientY <= r.top + r.height && r.left <= event.clientX && event.clientX <= r.left + r.width;
      if (!inside) calibDialog.close();
    });
  }
  calibDialog.addEventListener('close', () => {
    calibDialog.returnValue = '';
    if (bridge) bridge.send('calibFocus', { open: false });
  });

  // LinkBridge Setup
  bridge = new window.LinkBridge({
    role: 'controller',
    roomId,
    onMessage(type, payload) {
      if (type === 'telemetry' && payload) {
        if (payload.hitVibrate) {
          vibrate([55, 35, 90]);
          sfx.enemyBoom(false);
          return;
        }
        if (payload.warn) {
          // Haptic telegraphs: the tablet warning may be hidden under the real toy
          if (payload.warn === 'lane') vibrate([20, 40, 20, 40, 20]);
          else if (payload.warn === 'mine') vibrate([12, 30, 12]);
          else if (payload.warn === 'enrage') vibrate([120, 50, 120]);
          else if (payload.warn === 'perfect') vibrate(60);
          else if (payload.warn === 'blow') vibrate([30, 30, 30, 30, 90]);
          return;
        }
        const prevBoss = state.telemetry.bossHp > 0;
        Object.assign(state.telemetry, payload);
        if (!prevBoss && payload.bossHp > 0) {
          vibrate([90, 60, 90, 60, 140]);
          sfx.bossAlarm();
        }
        if (payload.skillDraftOpen === false && state.skillDraft !== null) {
          state.skillDraft = null;
          renderSkillDraftModal(null);
        }
        if (!(skillDraftDialog && skillDraftDialog.open)) {
          renderTelemetryUI();
        }
      } else if (type === 'hostState' && payload) {
        Object.assign(state.telemetry, payload);
        state.skillDraft = payload.skillDraft || null;
        renderSkillDraftModal(state.skillDraft);
        syncCalibSliders(payload);
        if (!(skillDraftDialog && skillDraftDialog.open)) {
          renderTelemetryUI();
        }
      }
    },
    onStatus(info) {
      const wasConnected = hostConnected;
      hostConnected = info.connected;
      const dot = document.getElementById('c-dot');
      const txt = document.getElementById('c-status');
      nukeBtn.disabled = !info.connected;
      renderPrimaryControl(state.telemetry);
      if (info.connected) {
        if (!wasConnected) bridge.send('requestState');
        dot.classList.add('ok');
        txt.textContent = `${info.roomId} · ${info.transport}${info.rttMs ? ' ' + info.rttMs + 'ms' : ''}`;
        if (sensorMsg.dataset && sensorMsg.dataset.netHint === '1') {
          sensorMsg.dataset.netHint = '';
          sensorMsg.textContent = '';
        }
      } else {
        if (wasConnected) resetControls();
        dot.classList.remove('ok');
        txt.textContent = `待连主机 (${info.roomId})`;
        if (info.isWeChat && !sensorMsg.textContent) {
          if (sensorMsg.dataset) sensorMsg.dataset.netHint = '1';
          sensorMsg.textContent = '提示：若微信内一直未连上或无法开启体感/吹气，请点右上角 ⋯ 选择「在默认浏览器打开」。';
        } else if (info.signalError && !sensorMsg.textContent) {
          if (sensorMsg.dataset) sensorMsg.dataset.netHint = '1';
          sensorMsg.textContent = '提示：公网信令连接受阻，请确认网络畅通或与大屏连接同一 Wi-Fi 后重新扫码。';
        }
      }
    }
  });

  // 1. Virtual Joystick with Pointer Capture
  let joyRadius = 64;

  function updateKnobVisual(vx, vy) {
    const px = vx * joyRadius;
    const py = vy * joyRadius;
    stickKnob.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px)`;
  }

  function applyPointerToStick(ev) {
    const rect = joyZone.getBoundingClientRect();
    joyRadius = Math.max(36, rect.width * 0.33);
    const cx = rect.left + rect.width * 0.5;
    const cy = rect.top + rect.height * 0.5;
    let dx = (ev.clientX - cx) / joyRadius;
    let dy = (ev.clientY - cy) / joyRadius;
    const mag = Math.hypot(dx, dy);
    if (mag > 1) {
      dx /= mag;
      dy /= mag;
    }
    state.stickVx = dx;
    state.stickVy = dy;
    updateKnobVisual(dx, dy);
  }

  joyZone.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0 || stickPointerId !== null) return;
    sfx.unlock();
    stickPointerId = ev.pointerId;
    state.touchOverride = true;
    joyZone.setPointerCapture(ev.pointerId);
    applyPointerToStick(ev);
    sendControls(!document.hidden);
  });

  joyZone.addEventListener('pointermove', (ev) => {
    if (ev.pointerId !== stickPointerId) return;
    applyPointerToStick(ev);
  });

  function centerStick() {
    const pointerId = stickPointerId;
    stickPointerId = null;
    state.touchOverride = false;
    state.stickVx = 0;
    state.stickVy = 0;
    if (state.controlMode === 'touch') updateKnobVisual(0, 0);
    if (pointerId !== null && joyZone.hasPointerCapture(pointerId)) joyZone.releasePointerCapture(pointerId);
  }

  for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    joyZone.addEventListener(eventName, (ev) => {
      if (ev.pointerId !== stickPointerId) return;
      centerStick();
      sendControls(!document.hidden);
    });
  }

  // 2. Gyroscope Flight Stick + Pull-back Cobra Roll
  let gyroListenerBound = false;
  function onDeviceOrientation(ev) {
    if (document.hidden || ev.beta === null || ev.gamma === null) return;
    if (state.gyroBaseBeta === null) {
      state.gyroBaseBeta = ev.beta;
      state.gyroBaseGamma = ev.gamma;
    }
    const dGamma = ev.gamma - state.gyroBaseGamma;
    const dBeta = ev.beta - state.gyroBaseBeta;

    const deltaBetaStep = state.lastBeta === null ? 0 : ev.beta - state.lastBeta;
    state.lastBeta = ev.beta;
    const now = performance.now();
    if (state.controlMode === 'gyro' && state.telemetry.phase === 'playing' && !state.telemetry.paused && deltaBetaStep > 16 && dBeta > 24 && now - state.lastRollAt > 2000) {
      state.lastRollAt = now;
      triggerRoll();
    }

    const dead = 2.5;
    const normAxis = (deg, maxDeg) => {
      if (Math.abs(deg) < dead) return 0;
      return clamp((deg - Math.sign(deg) * dead) / (maxDeg - dead), -1, 1);
    };
    state.gyroVx = normAxis(dGamma, 26);
    state.gyroVy = normAxis(dBeta, 24);

    if (state.controlMode === 'gyro' && !state.touchOverride && !(skillDraftDialog && skillDraftDialog.open)) {
      updateKnobVisual(state.gyroVx, state.gyroVy);
    }
  }

  async function enableGyroMode() {
    sfx.unlock();
    sfx.uiClick();
    if (typeof DeviceOrientationEvent === 'undefined') {
      alert('当前设备或浏览器不支持陀螺仪姿态传感器，请继续使用触屏摇杆。');
      return;
    }
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const perm = await DeviceOrientationEvent.requestPermission();
        if (perm !== 'granted') {
          alert('未获得动作与方向权限，请在系统浏览器设置中允许访问。');
          return;
        }
      } catch (err) {
        const inWeChat = typeof navigator !== 'undefined' && /MicroMessenger/i.test(navigator.userAgent || '');
        alert(inWeChat
          ? '微信内置浏览器可能限制陀螺仪授权，请点右上角 ⋯ 选择「在默认浏览器打开」后再开启体感！'
          : 'iOS 陀螺仪授权需要 HTTPS 安全连接。请在大屏扫码弹窗中切换为 HTTPS 地址后再试！');
        return;
      }
    }
    state.gyroBaseBeta = null;
    state.gyroBaseGamma = null;
    if (!gyroListenerBound) {
      window.addEventListener('deviceorientation', onDeviceOrientation);
      gyroListenerBound = true;
    }
    state.controlMode = 'gyro';
    btnGyro.classList.add('active');
    btnTouch.classList.remove('active');
    btnGyro.setAttribute('aria-pressed', 'true');
    btnTouch.setAttribute('aria-pressed', 'false');
    btnZero.hidden = false;
    vibrate(25);
  }

  btnTouch.addEventListener('click', () => {
    sfx.unlock();
    sfx.uiClick();
    state.controlMode = 'touch';
    btnTouch.classList.add('active');
    btnGyro.classList.remove('active');
    btnTouch.setAttribute('aria-pressed', 'true');
    btnGyro.setAttribute('aria-pressed', 'false');
    btnZero.hidden = true;
    updateKnobVisual(0, 0);
  });

  btnGyro.addEventListener('click', enableGyroMode);

  btnZero.addEventListener('click', () => {
    sfx.uiClick();
    state.gyroBaseBeta = null;
    state.gyroBaseGamma = null;
    vibrate(20);
  });

  // 3. Barrel Roll Button
  function triggerRoll() {
    if (state.telemetry.phase !== 'playing' || state.telemetry.paused) return;
    sfx.unlock();
    sfx.barrelRoll();
    vibrate([25, 20, 35]);
    state.hudRollAnim = 1;
    bridge.send('barrelRoll');
  }
  document.getElementById('btn-roll').addEventListener('click', triggerRoll);

  // 4. Spring-loaded Pull-down Railgun Lever (Pointer Capture)
  let railStartY = 0;

  function setRailVisual(ratio) {
    state.railCharge = clamp(ratio, 0, 1);
    const trackRect = railTrack.getBoundingClientRect();
    const maxTravel = Math.max(36, trackRect.height - 56);
    railHandle.style.transform = `translateY(${(state.railCharge * maxTravel).toFixed(1)}px)`;
    railFill.style.blockSize = `${(state.railCharge * 100).toFixed(1)}%`;
    railTrack.setAttribute('aria-valuenow', String(Math.round(state.railCharge * 100)));
    railHandle.textContent = state.railCharge >= 0.38 ? '松手轰击' : '拉栓';
  }

  railTrack.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0 || railPointerId !== null) return;
    sfx.unlock();
    railStartY = ev.clientY;
    railPointerId = ev.pointerId;
    railTrack.setPointerCapture(ev.pointerId);
    setRailVisual(0.08);
  });

  railTrack.addEventListener('pointermove', (ev) => {
    if (ev.pointerId !== railPointerId) return;
    const trackRect = railTrack.getBoundingClientRect();
    const maxTravel = Math.max(44, trackRect.height - 56);
    const ratio = clamp((ev.clientY - railStartY) / maxTravel, 0, 1);
    if (Math.floor(ratio * 5) > Math.floor(state.railCharge * 5)) {
      vibrate(14);
      sfx.chargeTick(ratio);
    }
    setRailVisual(ratio);
  });

  function cancelRailCharge() {
    const pointerId = railPointerId;
    railPointerId = null;
    if (state.railCharge > 0) setRailVisual(0);
    if (pointerId !== null && railTrack.hasPointerCapture(pointerId)) railTrack.releasePointerCapture(pointerId);
  }

  railTrack.addEventListener('pointerup', (ev) => {
    if (ev.pointerId !== railPointerId) return;
    const power = state.railCharge;
    cancelRailCharge();
    if (power >= 0.38 && hostConnected && !document.hidden && state.telemetry.phase === 'playing' && !state.telemetry.paused) {
      vibrate([45, 25, 110]);
      sfx.railgunFire();
      bridge.send('railgunFire', { power });
    }
  });

  for (const eventName of ['pointercancel', 'lostpointercapture']) {
    railTrack.addEventListener(eventName, (ev) => {
      if (ev.pointerId === railPointerId) cancelRailCharge();
    });
  }

  function resetControls() {
    centerStick();
    cancelRailCharge();
    state.gyroVx = 0;
    state.gyroVy = 0;
    state.lastBeta = null;
    state.micLevel = 0;
    state.blowFrames = 0;
    if (state.controlMode === 'gyro') updateKnobVisual(0, 0);
  }

  // 5. Smart 4-State Primary Action Button (Launch / Resume / Nuke / Relaunch)
  nukeBtn.addEventListener('click', () => {
    sfx.unlock();
    const t = state.telemetry;
    if (t.phase === 'title' || t.phase === 'gameover' || t.gameOver) {
      vibrate([35, 30, 65]);
      sfx.powerup();
      bridge.send('startMission');
      return;
    }
    if (t.paused) {
      vibrate(25);
      sfx.uiClick();
      if (calibDialog.open) calibDialog.close();
      bridge.send('setPause', { paused: false }); // on the victory card this continues the endless route
      return;
    }
    if (t.nukes > 0) {
      vibrate([80, 40, 160]);
      sfx.nukeExplosion();
      bridge.send('nuke');
    } else {
      vibrate(20);
      sfx.uiClick();
    }
  });

  // 6. Microphone Blow-to-Clear Wind Gust + Tap Fallback
  async function setupMicOrFireGust() {
    sfx.unlock();
    const now = performance.now();

    if (state.telemetry.phase === 'playing' && !state.telemetry.paused && state.telemetry.gustReady >= 1 && now - state.lastGustAt > 800) {
      state.lastGustAt = now;
      vibrate([30, 20, 65]);
      sfx.windGust();
      bridge.send('windGust');
    }

    if (state.micActive) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      sensorMsg.textContent = '提示：当前为 HTTP 快捷连接，点按顺风键可直接释放；若想开启麦克风“真吹气感应”，请在大屏扫码窗切换 HTTPS 地址。';
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      });
      const AC = window.AudioContext || window.webkitAudioContext;
      const actx = new AC();
      const src = actx.createMediaStreamSource(stream);
      const analyser = actx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);

      state.micActive = true;
      btnWind.classList.add('mic-live');
      btnWind.textContent = '💨 对麦吹气借顺风！';

      const pollMic = () => {
        requestAnimationFrame(pollMic);
        if (document.hidden) return;
        analyser.getByteTimeDomainData(buf);
        let sumSq = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sumSq += v * v;
        }
        const rms = Math.sqrt(sumSq / buf.length);
        const lv = clamp(rms * 3.4, 0, 1);
        state.micLevel = lv;
        if (!(skillDraftDialog && skillDraftDialog.open)) {
          micBar.style.inlineSize = `${Math.round(lv * 100)}%`;
        }

        if (lv > 0.42 && state.telemetry.phase === 'playing' && !state.telemetry.paused) {
          state.blowFrames++;
          if (state.blowFrames >= 5 && performance.now() - state.lastGustAt > 2500) {
            state.lastGustAt = performance.now();
            state.blowFrames = 0;
            vibrate([40, 25, 90]);
            sfx.windGust();
            bridge.send('windGust');
          }
        } else {
          state.blowFrames = Math.max(0, state.blowFrames - 1);
        }
      };
      requestAnimationFrame(pollMic);
    } catch (_) {
      // Permission declined or blocked by in-app WebView; tap-to-gust still works seamlessly
      if (typeof navigator !== 'undefined' && /MicroMessenger/i.test(navigator.userAgent || '')) {
        sensorMsg.textContent = '提示：微信内置浏览器可能拦截麦克风吹气，点按顺风键仍可释放；或点右上角 ⋯ 用系统浏览器打开。';
      }
    }
  }

  btnWind.addEventListener('click', setupMicOrFireGust);

  // 7. Pause, Stop-to-Title, Mode & Calibration Controls
  btnCPause.addEventListener('click', () => {
    sfx.unlock();
    sfx.uiClick();
    vibrate(20);
    if (calibDialog.open) calibDialog.close();
    bridge.send('setPause', { paused: !state.telemetry.paused });
  });

  btnCStop.addEventListener('click', () => {
    sfx.unlock();
    sfx.uiClick();
    vibrate([25, 25]);
    if (calibDialog.open) calibDialog.close();
    // On the victory card, "land" means: end the voyage and show the flight-log summary
    bridge.send(state.telemetry.victoryHold ? 'finishVoyage' : 'stopToTitle');
  });

  btnModeSwitch.addEventListener('click', () => {
    sfx.unlock();
    sfx.uiClick();
    const next = state.telemetry.mode === 'tabletop' ? 'arcade' : 'tabletop';
    bridge.send('updateRig', { mode: next });
  });

  btnPureCam.addEventListener('click', () => {
    sfx.unlock();
    sfx.uiClick();
    bridge.send('updateRig', { pureCamera: !state.telemetry.pureCamera });
  });

  btnCalib.addEventListener('click', () => {
    sfx.unlock();
    sfx.uiClick();
    if (!calibDialog.open) calibDialog.showModal();
    bridge.send('calibFocus', { open: true });
  });

  cWidth.addEventListener('input', () => {
    document.getElementById('c-width-val').textContent = `${cWidth.value} px`;
    bridge.send('updateRig', { mode: 'tabletop', width: Number(cWidth.value) });
  });
  cLength.addEventListener('input', () => {
    document.getElementById('c-length-val').textContent = `${cLength.value} px`;
    bridge.send('updateRig', { mode: 'tabletop', length: Number(cLength.value) });
  });
  cAnchor.addEventListener('input', () => {
    document.getElementById('c-anchor-val').textContent = `${cAnchor.value}%`;
    bridge.send('updateRig', { mode: 'tabletop', anchorY: Number(cAnchor.value) / 100 });
  });
  cGod.addEventListener('change', () => {
    bridge.send('updateRig', { godMode: cGod.checked });
  });

  document.querySelectorAll('.c-preset').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.c-preset').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      bridge.send('updateRig', {
        mode: 'tabletop',
        shape: btn.dataset.shape,
        width: Number(btn.dataset.w),
        length: Number(btn.dataset.l)
      });
    });
  });

  document.querySelectorAll('.c-bullet').forEach((btn) => {
    btn.addEventListener('click', () => {
      sfx.unlock();
      sfx.uiClick();
      document.querySelectorAll('.c-bullet').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      bridge.send('updateRig', { bulletStyle: btn.dataset.bullet });
    });
  });

  function syncCalibSliders(st) {
    if (typeof st.width === 'number') {
      cWidth.value = Math.round(st.width);
      document.getElementById('c-width-val').textContent = `${Math.round(st.width)} px`;
    }
    if (typeof st.length === 'number') {
      cLength.value = Math.round(st.length);
      document.getElementById('c-length-val').textContent = `${Math.round(st.length)} px`;
    }
    if (typeof st.anchorY === 'number') {
      const pct = Math.round(st.anchorY * 100);
      cAnchor.value = pct;
      document.getElementById('c-anchor-val').textContent = `${pct}%`;
    }
    if (typeof st.godMode === 'boolean') cGod.checked = st.godMode;
    if (typeof st.bulletStyle === 'string') {
      document.querySelectorAll('.c-bullet').forEach((b) => {
        b.classList.toggle('active', b.dataset.bullet === st.bulletStyle);
      });
    }
  }

  // Tutorial hints from the big screen: show the phone wording and light up the control to use
  const coachBox = document.getElementById('c-coach');
  const COACH_TARGETS = { stick: '.stick-panel', wind: '#btn-wind', rail: '.railgun-bay', nuke: '#nuke-btn' };
  let lastCoachKey = '';
  function renderCoach(t) {
    const c = t.phase === 'playing' && !t.paused ? t.coach : null;
    const key = c ? `${c.kind}|${c.title}|${c.text}|${c.target}` : '';
    if (key === lastCoachKey || !coachBox) return;
    lastCoachKey = key;
    coachBox.hidden = !c;
    document.querySelectorAll('.coach-target').forEach((el) => el.classList.remove('coach-target'));
    if (!c) return;
    coachBox.classList.toggle('tip', c.kind !== 'tutorial');
    document.getElementById('c-coach-title').textContent = c.kind === 'tutorial' ? `🎓 新手引导 ${c.title}` : `💡 ${c.title}`;
    document.getElementById('c-coach-text').textContent = c.text || '';
    const sel = c.kind === 'tutorial' && COACH_TARGETS[c.target];
    const target = sel && document.querySelector(sel);
    if (target) target.classList.add('coach-target');
  }

  function renderPrimaryControl(t) {
    if (nukeBtn.disabled) {
      nukeTitle.textContent = '等待大屏';
      nukeCount.textContent = '从大屏的扫码入口连接';
      return;
    }
    const phase = t.phase || (t.gameOver ? 'gameover' : 'playing');
    nukeBtn.classList.remove('empty', 'launch-mode', 'resume-mode');
    if (phase === 'title') {
      nukeBtn.classList.add('launch-mode');
      nukeTitle.textContent = '点火起飞';
      nukeCount.textContent = '启动大屏航程';
    } else if (phase === 'gameover') {
      nukeBtn.classList.add('launch-mode');
      nukeTitle.textContent = '↻ 再次升空';
      nukeCount.textContent = '开启新一轮借风航程';
    } else if (t.paused && t.victoryHold) {
      nukeBtn.classList.add('resume-mode');
      nukeTitle.textContent = '♾ 继续无尽航线';
      nukeCount.textContent = '三幕通关！或点右上「降落结算」';
    } else if (t.paused) {
      nukeBtn.classList.add('resume-mode');
      nukeTitle.textContent = '▶ 继续航程';
      nukeCount.textContent = '战局已悬停 · 点击恢复';
    } else {
      nukeBtn.classList.toggle('empty', (t.nukes || 0) <= 0);
      nukeTitle.textContent = '☢ 战术核弹';
      nukeCount.textContent = `剩余 ×${t.nukes ?? 0}`;
    }
  }

  function renderTelemetryUI() {
    const t = state.telemetry;
    renderCoach(t);
    const phase = t.phase || (t.gameOver ? 'gameover' : 'playing');
    const onTitle = phase === 'title';
    const isPlaying = phase === 'playing';

    scoreText.textContent = String(t.score || 0).padStart(7, '0');
    lvText.textContent = `Lv.${t.level || 1} · 火力${t.weaponLv || 1}`;
    const hp = Math.round(clamp(t.hp ?? 100, 0, 100));
    const xp = Math.round(clamp((t.xpRatio || 0) * 100, 0, 100));
    hpFill.style.inlineSize = `${hp}%`;
    hpMeter.setAttribute('aria-valuenow', String(hp));
    hpFill.classList.toggle('low', hp <= 30);
    if (xpFill) xpFill.style.inlineSize = `${xp}%`;
    xpMeter.setAttribute('aria-valuenow', String(xp));

    if (onTitle) {
      waveLabel.textContent = '停机坪待命';
      chapterLabel.textContent = '借风计划 · 放好玩具即可起飞';
    } else {
      waveLabel.textContent = `第${t.wave || 1}幕 · ${(t.distanceKm || 0).toFixed(1)}km`;
      chapterLabel.textContent = t.paused
        ? `⏸ 已悬停 · ${t.chapterTitle || '航行中'}`
        : (t.chapterTitle || '第一航段 · 晴空借风');
    }

    // Header Pause & Stop visibility
    btnCPause.hidden = !isPlaying;
    btnCStop.hidden = onTitle;
    btnCStop.textContent = t.victoryHold && t.paused ? '🛬 降落结算' : '⏹ 返航';
    if (isPlaying) {
      btnCPause.textContent = t.paused ? '▶ 继续' : '⏸ 暂停';
      btnCPause.classList.toggle('warn', Boolean(t.paused));
    }

    btnModeSwitch.textContent = t.mode === 'tabletop' ? '实体压屏' : '虚拟战机';
    btnPureCam.classList.toggle('active', Boolean(t.pureCamera));

    renderPrimaryControl(t);

    if (!state.micActive) {
      const pct = Math.round((t.gustReady ?? 1) * 100);
      btnWind.textContent = pct >= 100 ? '💨 吹气 / 点按顺风' : `💨 顺风充能 ${pct}%`;
    }
  }

  let lastDraftKey = '';
  let pickLockUntil = 0;
  if (skillDraftDialog) {
    skillDraftDialog.addEventListener('cancel', (ev) => ev.preventDefault());
  }
  if (cDraftReroll) {
    cDraftReroll.addEventListener('click', () => {
      const draft = state.skillDraft;
      if (!draft?.version) return;
      const now = performance.now();
      if (now < pickLockUntil) return;
      pickLockUntil = now + 350;
      sfx.unlock();
      sfx.skillReroll && sfx.skillReroll();
      vibrate(25);
      bridge.send('rerollSkills', { version: draft.version });
    });
  }

  function renderSkillDraftModal(draft) {
    if (!skillDraftDialog || !cDraftList) return;
    if (!draft || !Array.isArray(draft.choices) || draft.choices.length === 0) {
      lastDraftKey = '';
      if (skillDraftDialog.open) {
        try { skillDraftDialog.close(); } catch (_) { skillDraftDialog.removeAttribute('open'); }
      }
      return;
    }
    const key = draft.version || `${draft.level}|${draft.rerollsLeft}|${draft.choices.map((c) => `${c.id}:${c.stars}`).join(',')}`;
    if (key === lastDraftKey && skillDraftDialog.open) return;
    const isNewOpen = !skillDraftDialog.open;
    lastDraftKey = key;

    if (isNewOpen) {
      if (calibDialog && calibDialog.open) {
        try { calibDialog.close(); } catch (_) {}
      }
      resetControls();
      sendControls(false);
    }

    if (cDraftTitle) cDraftTitle.textContent = `⚡ 核心升级 · Lv.${draft.level}`;
    if (cDraftReroll) {
      cDraftReroll.disabled = !draft.version || (draft.rerollsLeft || 0) <= 0;
      cDraftReroll.textContent = `🎲 换一批 (剩余 ${draft.rerollsLeft || 0})`;
    }
    const rarityColors = { common: '#38bdf8', rare: '#c084fc', epic: '#fbbf24' };
    cDraftList.innerHTML = '';
    draft.choices.forEach((c) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.disabled = !draft.version;
      btn.className = 'c-draft-card';
      btn.style.setProperty('--c-accent', rarityColors[c.rarity] || '#38bdf8');
      let stars;
      if (c.maxStars === 1) {
        stars = '★觉醒';
      } else if (c.prevStars > 0) {
        stars = '★'.repeat(c.prevStars) + '→' + '★'.repeat(c.stars);
      } else {
        stars = '★'.repeat(c.stars) + '☆'.repeat(Math.max(0, c.maxStars - c.stars));
      }
      const hintHtml = c.synergyHint
        ? `<div class="c-draft-synergy${c.epicReady ? ' epic-ready' : ''}">${c.synergyHint}</div>`
        : '';
      btn.innerHTML = `
        <div class="c-draft-row">
          <span class="c-draft-name">${c.iconEmoji || '⚡'} ${c.name}</span>
          <span class="c-draft-badge">${c.category || '核心'} · ${stars}</span>
        </div>
        <div class="c-draft-desc">${c.desc || ''}</div>
        ${hintHtml}
      `;
      btn.addEventListener('click', () => {
        if (state.skillDraft?.version !== draft.version) return;
        const now = performance.now();
        if (now < pickLockUntil) return;
        pickLockUntil = now + 350;
        sfx.unlock();
        sfx.skillPick && sfx.skillPick(c.rarity);
        vibrate(40);
        bridge.send('pickSkill', { version: draft.version, cardId: c.id });
      });
      cDraftList.appendChild(btn);
    });

    if (!skillDraftDialog.open) {
      try { skillDraftDialog.showModal(); } catch (_) { skillDraftDialog.setAttribute('open', ''); }
    }
    if (isNewOpen) vibrate([30, 40, 65]);
  }

  // 8. 45Hz Control Stream + Aviation Attitude HUD & Tactical Radar MFD
  const radarCanvas = document.getElementById('radar-canvas');
  const rctx = radarCanvas.getContext('2d');
  const MFD_MODES = ['fusion', 'horizon', 'radar'];
  const MFD_LABELS = { fusion: '融合HUD', horizon: '地平仪', radar: '战术雷达' };
  let sweepAngle = 0;

  try {
    const savedMfd = typeof localStorage !== 'undefined' && localStorage.getItem('skyStriker.mfdMode');
    if (savedMfd && MFD_LABELS[savedMfd]) state.mfdMode = savedMfd;
  } catch (_) {}

  function syncMfdButton() {
    if (!btnMfdMode) return;
    btnMfdMode.textContent = MFD_LABELS[state.mfdMode] || '融合HUD';
    btnMfdMode.setAttribute('aria-label', `座舱仪表模式：${MFD_LABELS[state.mfdMode] || '融合HUD'}，点击切换`);
  }

  function cycleMfdMode() {
    sfx.unlock();
    sfx.uiClick();
    vibrate(14);
    const idx = MFD_MODES.indexOf(state.mfdMode);
    state.mfdMode = MFD_MODES[(idx + 1) % MFD_MODES.length];
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem('skyStriker.mfdMode', state.mfdMode);
    } catch (_) {}
    syncMfdButton();
  }

  if (btnMfdMode) btnMfdMode.addEventListener('click', cycleMfdMode);
  if (radarCanvas) radarCanvas.addEventListener('click', cycleMfdMode);
  syncMfdButton();

  function drawHorizonHUD(W, H, overlayRadar) {
    const cx = W * 0.5;
    const cy = H * 0.5;
    const R = Math.min(W, H) * 0.48;
    const t = state.telemetry;
    const useStick = state.touchOverride || state.controlMode === 'touch';
    const inputVx = useStick ? state.stickVx : state.gyroVx;
    const inputVy = useStick ? state.stickVy : state.gyroVy;

    // Responsive local control feel blended with live host bank telemetry
    const targetRoll = (Math.abs(inputVx) > 0.01 ? inputVx : (t.bank || 0)) * 0.62;
    const targetPitch = (Math.abs(inputVy) > 0.01 ? -inputVy : (t.speedRatio || 0) * 0.25) * 0.42;
    state.hudRoll += (targetRoll - state.hudRoll) * 0.2;
    state.hudPitch += (targetPitch - state.hudPitch) * 0.18;

    if (t.rollActive && state.hudRollAnim <= 0.01) state.hudRollAnim = 1;
    if (state.hudRollAnim > 0) {
      state.hudRollAnim = Math.max(0, state.hudRollAnim - 0.036);
    }
    const spinAngle = state.hudRollAnim > 0 ? Math.sin(state.hudRollAnim * Math.PI) * Math.PI * 2 : 0;
    const rollAngle = -state.hudRoll + spinAngle;
    const pitchPx = state.hudPitch * R * 0.62;

    const skyKey = t.sky === 'sunset' ? 'sunset' : (t.sky === 'night' ? 'night' : 'day');
    const skyPalettes = {
      day:    { top: '#1a4f66', horizon: '#5aa6a7', ground: '#0a2530', deep: '#05141b', line: '#faf3e1' },
      sunset: { top: '#2b1d3d', horizon: '#c96b45', ground: '#1c1224', deep: '#0d0914', line: '#ffbe69' },
      night:  { top: '#061529', horizon: '#1e5058', ground: '#05101b', deep: '#02070d', line: '#93ded0' }
    };
    const pal = skyPalettes[skyKey];

    rctx.clearRect(0, 0, W, H);

    // Clip to circular aircraft instrument glass
    rctx.save();
    rctx.beginPath();
    rctx.arc(cx, cy, R, 0, Math.PI * 2);
    rctx.clip();

    // 1. Rotating Sky / Sea Artificial Horizon Sphere
    rctx.save();
    rctx.translate(cx, cy);
    rctx.rotate(rollAngle);

    const skyGrad = rctx.createLinearGradient(0, -R * 1.4, 0, pitchPx);
    skyGrad.addColorStop(0, pal.top);
    skyGrad.addColorStop(1, pal.horizon);
    rctx.fillStyle = skyGrad;
    rctx.fillRect(-R * 1.6, -R * 1.8, R * 3.2, R * 1.8 + pitchPx + 1);

    const gndGrad = rctx.createLinearGradient(0, pitchPx, 0, R * 1.5);
    gndGrad.addColorStop(0, pal.ground);
    gndGrad.addColorStop(1, pal.deep);
    rctx.fillStyle = gndGrad;
    rctx.fillRect(-R * 1.6, pitchPx, R * 3.2, R * 2.0);

    // Crisp horizon line
    rctx.strokeStyle = pal.line;
    rctx.lineWidth = 1.4;
    rctx.beginPath();
    rctx.moveTo(-R * 1.3, pitchPx);
    rctx.lineTo(R * 1.3, pitchPx);
    rctx.stroke();

    // 2. Green / Sea-Glass Fighter Pitch Ladder (+20 / +10 / -10 / -20)
    const step = R * 0.25;
    rctx.strokeStyle = 'rgba(147, 222, 208, 0.85)';
    rctx.fillStyle = 'rgba(218, 252, 240, 0.88)';
    rctx.font = '700 8px "IBM Plex Mono", ui-monospace, monospace';
    rctx.lineWidth = 1.1;
    for (const deg of [-20, -10, 10, 20]) {
      const py = pitchPx - (deg / 10) * step;
      if (Math.abs(py) > R * 0.86) continue;
      const half = Math.abs(deg) === 20 ? R * 0.22 : R * 0.30;
      const gap = R * 0.11;
      const tick = deg > 0 ? 4 : -4;
      if (deg < 0 && rctx.setLineDash) rctx.setLineDash([4, 3]);
      rctx.beginPath();
      rctx.moveTo(-half, py + tick); rctx.lineTo(-half, py); rctx.lineTo(-gap, py);
      rctx.moveTo(gap, py); rctx.lineTo(half, py); rctx.lineTo(half, py + tick);
      rctx.stroke();
      if (rctx.setLineDash) rctx.setLineDash([]);
      rctx.textAlign = 'right';
      rctx.fillText(String(Math.abs(deg)), -half - 3, py + 3);
      rctx.textAlign = 'left';
      rctx.fillText(String(Math.abs(deg)), half + 3, py + 3);
    }
    rctx.restore();

    // 3. Optional Tactical Radar Overlay (Fusion mode: attitude + live enemy threats!)
    if (overlayRadar) {
      if (!t.paused) sweepAngle = (sweepAngle + 0.05) % (Math.PI * 2);
      rctx.save();
      rctx.translate(cx, cy);
      rctx.strokeStyle = 'rgba(147, 222, 208, 0.22)';
      rctx.lineWidth = 1;
      rctx.beginPath();
      rctx.arc(0, 0, R * 0.64, 0, Math.PI * 2);
      rctx.stroke();

      rctx.rotate(sweepAngle);
      const swGrad = rctx.createLinearGradient(0, 0, R, 0);
      swGrad.addColorStop(0, 'rgba(147, 222, 208, 0.26)');
      swGrad.addColorStop(1, 'rgba(147, 222, 208, 0)');
      rctx.fillStyle = swGrad;
      rctx.beginPath();
      rctx.moveTo(0, 0);
      rctx.arc(0, 0, R, -0.32, 0.04);
      rctx.closePath();
      rctx.fill();
      rctx.restore();

      const blips = t.blips || [];
      for (const b of blips) {
        const bx = cx + b.nx * (R * 0.78);
        const by = cy + b.ny * (R * 0.78);
        rctx.fillStyle = b.b ? '#ffbe69' : '#ff6b57';
        if (b.b) {
          rctx.strokeStyle = '#faf3e1';
          rctx.lineWidth = 1.2;
          rctx.strokeRect(bx - 5, by - 5, 10, 10);
          rctx.fillRect(bx - 2.5, by - 2.5, 5, 5);
        } else {
          rctx.beginPath();
          rctx.moveTo(bx, by - 3.6);
          rctx.lineTo(bx + 3.2, by);
          rctx.lineTo(bx, by + 3.6);
          rctx.lineTo(bx - 3.2, by);
          rctx.closePath();
          rctx.fill();
        }
      }
    }

    // 4. Upper Bank Angle Arc & Heading Indicator
    rctx.strokeStyle = 'rgba(250, 243, 225, 0.42)';
    rctx.lineWidth = 1;
    rctx.beginPath();
    rctx.arc(cx, cy, R - 8, -Math.PI * 0.82, -Math.PI * 0.18);
    rctx.stroke();
    for (const deg of [-45, -30, -15, 0, 15, 30, 45]) {
      const a = (-90 + deg) * (Math.PI / 180);
      const inner = deg === 0 ? R - 15 : (Math.abs(deg) === 30 ? R - 13 : R - 11);
      rctx.beginPath();
      rctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
      rctx.lineTo(cx + Math.cos(a) * (R - 7), cy + Math.sin(a) * (R - 7));
      rctx.stroke();
    }

    // Moving bank pointer triangle
    const ptrA = -Math.PI * 0.5 + clamp(-state.hudRoll, -0.78, 0.78);
    const pxTip = cx + Math.cos(ptrA) * (R - 14);
    const pyTip = cy + Math.sin(ptrA) * (R - 14);
    rctx.fillStyle = '#ffbe69';
    rctx.beginPath();
    rctx.arc(pxTip, pyTip, 2.5, 0, Math.PI * 2);
    rctx.fill();

    // 5. Fixed Center Aircraft Boresight Reticle (—v—)
    rctx.strokeStyle = '#ffbe69';
    rctx.lineWidth = 2;
    rctx.beginPath();
    rctx.moveTo(cx - 22, cy); rctx.lineTo(cx - 8, cy); rctx.lineTo(cx - 4, cy + 5);
    rctx.moveTo(cx + 22, cy); rctx.lineTo(cx + 8, cy); rctx.lineTo(cx + 4, cy + 5);
    rctx.stroke();
    rctx.fillStyle = '#faf3e1';
    rctx.beginPath();
    rctx.arc(cx, cy, 2, 0, Math.PI * 2);
    rctx.fill();

    // 6. Compact Aviation Digital Readouts (HDG / SPD / ALT)
    const hdg = ((Math.round(state.hudRoll * 28) % 360) + 360) % 360;
    const spd = Math.round(310 + (t.speedRatio || 0) * 560 + Math.abs(inputVy) * 120);
    const alt = Math.round(520 + (t.distanceKm || 0) * 24 + state.hudPitch * 80);
    rctx.font = '700 8.5px "IBM Plex Mono", ui-monospace, monospace';
    rctx.fillStyle = 'rgba(7, 25, 31, 0.66)';
    rctx.fillRect(cx - 20, 12, 40, 12);
    rctx.fillStyle = '#faf3e1';
    rctx.textAlign = 'center';
    rctx.fillText(`${String(hdg).padStart(3, '0')}°`, cx, 21);

    rctx.fillStyle = 'rgba(147, 222, 208, 0.92)';
    rctx.textAlign = 'left';
    rctx.fillText(`S${spd}`, 12, cy + 3);
    rctx.textAlign = 'right';
    rctx.fillText(`A${alt}`, W - 12, cy + 3);

    rctx.restore();

    // Crisp outer bezel rim
    rctx.strokeStyle = 'rgba(147, 222, 208, 0.45)';
    rctx.lineWidth = 1.5;
    rctx.beginPath();
    rctx.arc(cx, cy, R, 0, Math.PI * 2);
    rctx.stroke();
  }

  function drawPureRadar(W, H) {
    const cx = W * 0.5;
    const cy = H * 0.72;

    rctx.clearRect(0, 0, W, H);
    rctx.fillStyle = '#06181e';
    rctx.fillRect(0, 0, W, H);

    rctx.strokeStyle = 'rgba(147, 222, 208, 0.24)';
    rctx.lineWidth = 1;
    for (const r of [W * 0.2, W * 0.4, W * 0.6]) {
      rctx.beginPath();
      rctx.arc(cx, cy, r, 0, Math.PI * 2);
      rctx.stroke();
    }

    if (!state.telemetry.paused) {
      sweepAngle = (sweepAngle + 0.055) % (Math.PI * 2);
    }
    rctx.save();
    rctx.translate(cx, cy);
    rctx.rotate(sweepAngle);
    const grad = rctx.createLinearGradient(0, 0, W * 0.56, 0);
    grad.addColorStop(0, 'rgba(147, 222, 208, 0.45)');
    grad.addColorStop(1, 'rgba(147, 222, 208, 0)');
    rctx.fillStyle = grad;
    rctx.beginPath();
    rctx.moveTo(0, 0);
    rctx.arc(0, 0, W * 0.68, -0.35, 0.05);
    rctx.closePath();
    rctx.fill();
    rctx.restore();

    rctx.fillStyle = '#ffbe69';
    rctx.beginPath();
    rctx.moveTo(cx, cy - 7);
    rctx.lineTo(cx + 5.5, cy + 5.5);
    rctx.lineTo(cx - 5.5, cy + 5.5);
    rctx.closePath();
    rctx.fill();

    const blips = state.telemetry.blips || [];
    for (const b of blips) {
      const bx = cx + b.nx * (W * 0.44);
      const by = cy + b.ny * (H * 0.68);
      rctx.fillStyle = b.b ? '#ffbe69' : '#ff6b57';
      rctx.beginPath();
      rctx.arc(bx, by, b.b ? 6.5 : 3.6, 0, Math.PI * 2);
      rctx.fill();
    }
  }

  function drawRadar() {
    const W = radarCanvas.width || 180;
    const H = radarCanvas.height || 180;
    if (state.mfdMode === 'radar') {
      drawPureRadar(W, H);
    } else {
      drawHorizonHUD(W, H, state.mfdMode === 'fusion');
    }
  }

  function sendControls(visible) {
    if (!hostConnected) return;
    const controlsActive = visible && !calibDialog.open && !skillDraftDialog?.open;
    const useStick = state.touchOverride || state.controlMode === 'touch';
    const vx = useStick ? state.stickVx : state.gyroVx;
    const vy = useStick ? state.stickVy : state.gyroVy;
    bridge.send('input', {
      vx: controlsActive ? Number(vx.toFixed(3)) : 0,
      vy: controlsActive ? Number(vy.toFixed(3)) : 0,
      firing: controlsActive,
      railCharge: controlsActive ? Number(state.railCharge.toFixed(3)) : 0,
      micLevel: controlsActive ? Number(state.micLevel.toFixed(2)) : 0,
      calibOpen: visible && calibDialog.open
    });
  }

  function suspendControls() {
    resetControls();
    if (calibDialog.open) bridge.send('calibFocus', { open: false });
    sendControls(false);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) suspendControls();
    else if (calibDialog.open) bridge.send('calibFocus', { open: true });
  });
  window.addEventListener('pagehide', suspendControls);

  const controlIntervalMs = 1000 / 45;
  let nextSendAt = performance.now();
  function tick(now) {
    if (!document.hidden && !skillDraftDialog?.open) {
      drawRadar();
      if (now >= nextSendAt) {
        // Skip missed packets, keeping the 45 Hz schedule aligned across display refresh rates.
        const intervals = Math.floor((now - nextSendAt) / controlIntervalMs) + 1;
        nextSendAt += intervals * controlIntervalMs;
        sendControls(true);
      }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  bridge.start();
  renderTelemetryUI();
  window.__skyController = { state, bridge };
})();
