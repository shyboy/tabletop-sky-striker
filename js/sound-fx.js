/**
 * Pure Web Audio Synthesizer for Tabletop Sky Striker
 * Zero external audio assets required. Supports both Host (battlefield) and Controller (cockpit MFD).
 */
(function (global) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Music data (all procedural). Notes are MIDI numbers; 16 steps (16ths) per bar.
  // chords[].b = bass root, chords[].t = chord tones. Pattern entries index into
  // chord tones (n >= tones.length wraps up an octave); null/undefined = rest.
  // lead.bars[bar] = [[step, midi, lengthInSteps], ...]
  // ---------------------------------------------------------------------------
  const MUSIC_VOL = 0.065;      // master music bus gain (SFX stay on top)
  const MUSIC_FADE = 0.8;       // crossfade seconds
  const TICK_MS = 25;           // scheduler interval
  const LOOKAHEAD = 0.12;       // seconds scheduled ahead
  const _ = null;

  const THEMES = {
    // Calm, airy: D major pad + soft arpeggio
    title: {
      bpm: 90,
      chords: [
        { b: 38, t: [62, 66, 69, 73] }, // Dmaj7
        { b: 35, t: [59, 62, 66, 69] }, // Bm7
        { b: 43, t: [55, 59, 62, 66] }, // Gmaj7
        { b: 45, t: [57, 62, 64, 69] }  // Asus4
      ],
      pad: { type: 'sine', vol: 0.26, atk: 0.6 },
      bass: { type: 'sine', vol: 0.5, len: 7, pat: [0, _, _, _, _, _, _, _, _, _, 7, _, _, _, _, _] },
      arp: { type: 'triangle', vol: 0.3, oct: 1, dur: 0.5, echo: 0.35,
        pat: [0, _, 1, _, 2, _, 3, _, 2, _, 1, _, 2, _, 3, _] }
    },
    // Bright, upbeat: C major, driving bass + arpeggio + melody
    day: {
      bpm: 132,
      chords: [
        { b: 36, t: [60, 64, 67] }, { b: 43, t: [59, 62, 67] },
        { b: 45, t: [60, 64, 69] }, { b: 41, t: [60, 65, 69] },
        { b: 36, t: [60, 64, 67] }, { b: 43, t: [59, 62, 67] },
        { b: 41, t: [60, 65, 69] }, { b: 43, t: [59, 62, 67] }
      ],
      hat: 0.1,
      bass: { type: 'sawtooth', cut: 520, vol: 0.5, len: 1.7,
        pat: [0, _, 0, _, 12, _, 0, _, 0, _, 0, _, 12, _, 7, _] },
      arp: { type: 'square', vol: 0.11, oct: 0, dur: 0.11, cut: 2600,
        pat: [0, 1, 2, 3, 2, 1, 2, 3, 0, 1, 2, 3, 4, 3, 2, 1] },
      lead: { type: 'triangle', vol: 0.4, bars: [
        [[0, 76, 4], [4, 79, 2], [6, 84, 6], [12, 79, 4]],
        [[0, 83, 4], [4, 81, 2], [6, 79, 6], [12, 74, 4]],
        [[0, 84, 4], [4, 83, 2], [6, 81, 6], [12, 76, 4]],
        [[0, 81, 4], [4, 79, 2], [6, 77, 4], [10, 81, 2], [12, 84, 4]],
        [[0, 88, 4], [4, 86, 2], [6, 84, 6], [12, 79, 4]],
        [[0, 86, 4], [4, 84, 2], [6, 83, 6], [12, 79, 4]],
        [[0, 81, 3], [3, 84, 3], [6, 89, 6], [12, 88, 2], [14, 86, 2]],
        [[0, 86, 6], [6, 83, 2], [8, 79, 4], [12, 81, 2], [14, 83, 2]]
      ] }
    },
    // Warm, heroic: D minor gallop
    sunset: {
      bpm: 140,
      chords: [
        { b: 38, t: [62, 65, 69] }, { b: 46, t: [62, 65, 70] },
        { b: 36, t: [60, 64, 67] }, { b: 38, t: [62, 65, 69] },
        { b: 38, t: [62, 65, 69] }, { b: 46, t: [62, 65, 70] },
        { b: 36, t: [60, 64, 67] }, { b: 45, t: [61, 64, 69] }
      ],
      hat: 0.09,
      pad: { type: 'sawtooth', cut: 850, vol: 0.1, atk: 0.12 },
      bass: { type: 'sawtooth', cut: 640, vol: 0.48, len: 1.2,
        pat: [0, _, 0, 0, 0, _, 0, 0, 0, _, 0, 0, 0, _, 12, 0] },
      arp: { type: 'triangle', vol: 0.16, oct: 0, dur: 0.14,
        pat: [0, _, 2, _, 3, _, 2, _, 4, _, 2, _, 3, _, 2, _] },
      lead: { type: 'square', cut: 2400, vol: 0.2, bars: [
        [[0, 74, 6], [6, 77, 2], [8, 81, 8]],
        [[0, 82, 6], [6, 81, 2], [8, 77, 8]],
        [[0, 79, 6], [6, 76, 2], [8, 79, 4], [12, 84, 4]],
        [[0, 81, 12], [12, 77, 2], [14, 79, 2]],
        [[0, 81, 6], [6, 86, 2], [8, 89, 8]],
        [[0, 89, 4], [4, 86, 4], [8, 82, 8]],
        [[0, 84, 6], [6, 86, 2], [8, 88, 8]],
        [[0, 88, 4], [4, 85, 4], [8, 81, 4], [12, 85, 2], [14, 88, 2]]
      ] }
    },
    // Mysterious, spacey: E minor / phrygian colour with sparkle bells
    night: {
      bpm: 120,
      chords: [
        { b: 40, t: [64, 67, 71, 74] }, // Em7
        { b: 36, t: [64, 67, 71, 72] }, // Cmaj7
        { b: 45, t: [60, 64, 67, 71] }, // Am9
        { b: 41, t: [64, 65, 69, 71] }  // Fmaj7#11
      ],
      pad: { type: 'sine', vol: 0.24, atk: 0.5 },
      bass: { type: 'triangle', vol: 0.5, len: 6, pat: [0, _, _, _, _, _, _, _, _, _, 0, _, _, _, 7, _] },
      arp: { type: 'triangle', vol: 0.2, oct: 0, dur: 0.3, echo: 0.4,
        pat: [0, _, _, 2, _, _, 1, _, 3, _, _, 2, _, 1, _, _] },
      bells: [
        [[3, 2], [9, 5], [14, 3]],
        [[1, 4], [6, 6], [11, 3], [13, 5]]
      ]
    }
  };

  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  /**
   * SoundFX — zero-asset Web Audio synth (one-shot SFX + procedural music).
   *
   * Music API (all safe no-ops when AudioContext is unavailable; music never
   * starts unless startMusic() is called):
   *   startMusic(theme)        theme: 'title' | 'day' | 'sunset' | 'night'. Loops the
   *                            theme; same theme = no-op; a different theme crossfades
   *                            (~0.8s). The request is remembered while the context is
   *                            locked or muted and begins after unlock() / unmute.
   *   stopMusic()              Fade out, stop the scheduler, forget the theme.
   *   setMusicPaused(flag)     Duck to near-silence and halt scheduling / resume.
   *   setMusicIntensity(0..1)  >= 0.5 adds kick/snare/hat layer + louder bass (boss).
   *   setMuted(flag) / toggleMute()  Also silence / resume the music.
   *   unlock()                 Call from user gestures; creates/resumes the context
   *                            and starts any pending music request.
   */
  class SoundFX {
    constructor() {
      this.ctx = null;
      this.muted = false;
      this.lastLaserAt = 0;
      this.lastHitAt = 0;
      this.lastChargeAt = 0;
      this.noiseBuffer = null;

      this.out = null;        // SFX bus
      this.musicBus = null;   // master music gain
      this.musicTheme = null; // requested theme (kept while locked / muted / paused)
      this.musicPaused = false;
      this.musicIntensity = 0;
      this._themeGain = null; // per-theme gain (crossfades)
      this._musicTimer = null;
      this._step = 0;
      this._nextStepTime = 0;
      this._padPending = false;
      this._last = {};        // throttle timestamps
    }

    unlock() {
      if (this.muted) return false;
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return false;
      if (!this.ctx) {
        try {
          this.ctx = new AC();
        } catch (e) {
          this.ctx = null;
          return false;
        }
        this.out = this.ctx.createGain();
        this.out.gain.value = 1;
        this.out.connect(this.ctx.destination);
        this.musicBus = this.ctx.createGain();
        this.musicBus.gain.value = MUSIC_VOL;
        this.musicBus.connect(this.ctx.destination);
        this._buildNoiseBuffer();
        try {
          this.ctx.onstatechange = () => this._syncMusic();
        } catch (e) { /* ignore */ }
      }
      if (this.ctx.state === 'suspended') {
        const p = this.ctx.resume();
        if (p && p.then) p.then(() => this._syncMusic()).catch(() => {});
      }
      this._syncMusic();
      return this.ctx.state === 'running';
    }

    _buildNoiseBuffer() {
      if (!this.ctx) return;
      const sr = this.ctx.sampleRate;
      const len = Math.floor(sr * 1.5);
      const buf = this.ctx.createBuffer(1, len, sr);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      this.noiseBuffer = buf;
    }

    setMuted(flag) {
      this.muted = Boolean(flag);
      if (!this.muted && this.musicTheme) this.unlock();
      this._syncMusic();
    }

    toggleMute() {
      this.muted = !this.muted;
      if (!this.muted) this.unlock();
      this._syncMusic();
      return this.muted;
    }

    _ready() {
      if (this.muted) return false;
      if (!this.ctx) this.unlock();
      return Boolean(this.ctx && this.ctx.state === 'running');
    }

    /** True (and records the time) if `key` has not fired within `gap` seconds. */
    _throttle(key, gap) {
      const now = this.ctx.currentTime;
      const last = this._last[key];
      if (last !== undefined && now - last < gap) return false;
      this._last[key] = now;
      return true;
    }

    // ------------------------------------------------------------------ music

    startMusic(theme) {
      if (!THEMES[theme]) return;
      if (theme === this.musicTheme) return;
      this.musicTheme = theme;
      this._step = 0;
      this._dropThemeGain(MUSIC_FADE);
      if (this._musicTimer) {
        // already running: crossfade into the new theme
        this._newThemeGain();
        this._nextStepTime = this.ctx.currentTime + 0.06;
        this._padPending = true;
      }
      if (!this.ctx && !this.muted) this.unlock();
      this._syncMusic();
    }

    stopMusic() {
      this.musicTheme = null;
      this._step = 0;
      this._dropThemeGain(0.6);
      this._syncMusic();
    }

    setMusicPaused(flag) {
      this.musicPaused = Boolean(flag);
      this._syncMusic();
    }

    setMusicIntensity(level) {
      const v = Number(level);
      this.musicIntensity = clamp(isFinite(v) ? v : 0, 0, 1);
    }

    _newThemeGain() {
      const now = this.ctx.currentTime;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(1, now + MUSIC_FADE);
      g.connect(this.musicBus);
      this._themeGain = g;
    }

    _dropThemeGain(fade) {
      const g = this._themeGain;
      if (!g || !this.ctx) return;
      this._themeGain = null;
      const now = this.ctx.currentTime;
      try {
        const cur = g.gain.value;
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(cur, now);
        g.gain.linearRampToValueAtTime(0, now + fade);
      } catch (e) { /* ignore */ }
      setTimeout(() => {
        try { g.disconnect(); } catch (e) { /* ignore */ }
      }, fade * 1000 + 300);
    }

    /** Reconcile bus level + scheduler with (theme, muted, paused, ctx state). */
    _syncMusic() {
      const ctx = this.ctx;
      if (!ctx || !this.musicBus) return;
      const now = ctx.currentTime;
      const g = this.musicBus.gain;
      try {
        g.cancelScheduledValues(now);
        if (this.muted) g.setValueAtTime(0, now);
        else g.setTargetAtTime(this.musicPaused ? 0.0001 : MUSIC_VOL, now, 0.06);
      } catch (e) { /* ignore */ }

      const run = Boolean(this.musicTheme) && !this.muted && !this.musicPaused && ctx.state === 'running';
      if (run && !this._musicTimer) {
        // fresh theme gain so tails left over from before a pause/mute cannot double up
        this._dropThemeGain(0.05);
        this._newThemeGain();
        this._nextStepTime = now + 0.06;
        this._padPending = true;
        this._musicTimer = setInterval(() => this._musicTick(), TICK_MS);
        this._musicTick();
      } else if (!run && this._musicTimer) {
        clearInterval(this._musicTimer);
        this._musicTimer = null;
      }
    }

    _musicTick() {
      const ctx = this.ctx;
      const th = THEMES[this.musicTheme];
      if (!ctx || !th || !this._themeGain) return;
      const now = ctx.currentTime;
      const sd = 60 / th.bpm / 4;
      if (this._nextStepTime < now - 0.02) {
        // fell behind (throttled tab etc.): skip ahead instead of bursting
        this._nextStepTime = now + 0.03;
        this._padPending = true;
      }
      // background tabs throttle timers to ~1s, so look further ahead there
      const hidden = global.document && global.document.hidden;
      const horizon = now + (hidden ? 1.2 : LOOKAHEAD);
      const total = th.chords.length * 16;
      let guard = 0;
      while (this._nextStepTime < horizon && guard++ < 64) {
        this._scheduleStep(th, this._step, this._nextStepTime, sd);
        this._nextStepTime += sd;
        this._step = (this._step + 1) % total;
      }
    }

    _scheduleStep(th, pos, t, sd) {
      const bar = Math.floor(pos / 16);
      const s = pos % 16;
      const ch = th.chords[bar];
      const hot = this.musicIntensity >= 0.5;
      const tone = (n) => ch.t[n % ch.t.length] + 12 * Math.floor(n / ch.t.length);

      if (th.pad && (s === 0 || this._padPending)) {
        const dur = (16 - s) * sd;
        for (let i = 0; i < ch.t.length; i++) {
          this._mVoice(th.pad.type, mtof(ch.t[i]), t, dur, th.pad.vol, false, th.pad.cut, th.pad.atk);
        }
      }
      this._padPending = false;

      if (th.bass) {
        const o = th.bass.pat[s];
        if (o != null) {
          this._mVoice(th.bass.type, mtof(ch.b + o), t, sd * th.bass.len,
            th.bass.vol * (hot ? 1.3 : 1), true, th.bass.cut);
        }
      }

      if (th.arp) {
        const n = th.arp.pat[s];
        if (n != null) {
          const f = mtof(tone(n) + 12 * th.arp.oct);
          this._mVoice(th.arp.type, f, t, th.arp.dur, th.arp.vol, true, th.arp.cut);
          if (th.arp.echo) {
            this._mVoice(th.arp.type, f, t + sd * 3, th.arp.dur, th.arp.vol * th.arp.echo, true, th.arp.cut);
          }
        }
      }

      if (th.lead) {
        const notes = th.lead.bars[bar % th.lead.bars.length];
        for (let i = 0; i < notes.length; i++) {
          if (notes[i][0] === s) {
            this._mVoice(th.lead.type, mtof(notes[i][1]), t, notes[i][2] * sd * 0.94,
              th.lead.vol, false, th.lead.cut, 0.012);
          }
        }
      }

      if (th.bells) {
        const bl = th.bells[bar % th.bells.length];
        for (let i = 0; i < bl.length; i++) {
          if (bl[i][0] === s) this._mBell(mtof(tone(bl[i][1]) + 12), t);
        }
      }

      if (hot) {
        if (s === 0 || s === 8 || (s === 10 && bar % 2 === 1)) this._mKick(t);
        if (s === 4 || s === 12) this._mSnare(t);
        if (s % 2 === 0) this._mHat(t, s % 4 === 2 ? 0.3 : 0.16);
      } else if (th.hat && s % 4 === 2) {
        this._mHat(t, th.hat);
      }
    }

    /** One music note: osc -> gain [-> lowpass] -> theme gain. */
    _mVoice(type, freq, t, dur, vol, pluck, cutoff, attack) {
      const ctx = this.ctx;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      const a = Math.min(attack || 0.006, dur * 0.45);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol, t + a);
      if (pluck) {
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      } else {
        const rel = Math.min(0.5, dur * 0.3);
        g.gain.setValueAtTime(vol, Math.max(t + a, t + dur - rel));
        g.gain.linearRampToValueAtTime(0.0001, t + dur);
      }
      osc.connect(g);
      let lp = null;
      if (cutoff) {
        lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(cutoff, t);
        g.connect(lp);
        lp.connect(this._themeGain);
      } else {
        g.connect(this._themeGain);
      }
      osc.start(t);
      osc.stop(t + dur + 0.03);
      osc.onended = () => {
        try {
          osc.disconnect();
          g.disconnect();
          if (lp) lp.disconnect();
        } catch (e) { /* ignore */ }
      };
    }

    _mBell(freq, t) {
      this._mVoice('sine', freq, t, 0.9, 0.2, true);
      this._mVoice('sine', freq * 2.76, t, 0.35, 0.05, true);
    }

    _mKick(t) {
      const ctx = this.ctx;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(150, t);
      osc.frequency.exponentialRampToValueAtTime(44, t + 0.11);
      g.gain.setValueAtTime(1.5, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      osc.connect(g);
      g.connect(this._themeGain);
      osc.start(t);
      osc.stop(t + 0.22);
      osc.onended = () => {
        try { osc.disconnect(); g.disconnect(); } catch (e) { /* ignore */ }
      };
    }

    _mNoise(t, type, freq, dur, vol) {
      if (!this.noiseBuffer) return;
      const ctx = this.ctx;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.setValueAtTime(freq, t);
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(f);
      f.connect(g);
      g.connect(this._themeGain);
      src.start(t, Math.random());
      src.stop(t + dur + 0.02);
      src.onended = () => {
        try { src.disconnect(); f.disconnect(); g.disconnect(); } catch (e) { /* ignore */ }
      };
    }

    _mSnare(t) {
      this._mNoise(t, 'bandpass', 1900, 0.15, 0.9);
      this._mVoice('triangle', 190, t, 0.08, 0.5, true);
    }

    _mHat(t, vol) {
      this._mNoise(t, 'highpass', 7200, 0.04, vol);
    }

    // ------------------------------------------------------------ SFX helpers

    /** Simple swept tone on the SFX bus. */
    _tone(type, f0, f1, t, dur, vol, attack) {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(f0, t);
      if (f1 && f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
      if (attack) {
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(vol, t + attack);
      } else {
        g.gain.setValueAtTime(vol, t);
      }
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(g);
      g.connect(this.out);
      osc.start(t);
      osc.stop(t + dur + 0.02);
      osc.onended = () => {
        try { osc.disconnect(); g.disconnect(); } catch (e) { /* ignore */ }
      };
      return g;
    }

    /** Filtered noise burst on the SFX bus. */
    _noise(type, f0, f1, t, dur, vol, q, attack) {
      if (!this.noiseBuffer) return null;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.loop = true;
      const f = this.ctx.createBiquadFilter();
      f.type = type;
      if (q) f.Q.setValueAtTime(q, t);
      f.frequency.setValueAtTime(f0, t);
      if (f1 && f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const g = this.ctx.createGain();
      if (attack) {
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(vol, t + attack);
      } else {
        g.gain.setValueAtTime(vol, t);
      }
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(f);
      f.connect(g);
      g.connect(this.out);
      src.start(t, Math.random());
      src.stop(t + dur + 0.02);
      src.onended = () => {
        try { src.disconnect(); f.disconnect(); g.disconnect(); } catch (e) { /* ignore */ }
      };
      return g;
    }

    // ------------------------------------------------------------ one-shots

    laser(level = 1) {
      if (!this._ready()) return;
      const now = this.ctx.currentTime;
      if (now - this.lastLaserAt < 0.065) return;
      this.lastLaserAt = now;

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = level >= 3 ? 'sawtooth' : 'triangle';
      const base = 760 + Math.min(level, 4) * 55;
      osc.frequency.setValueAtTime(base, now);
      osc.frequency.exponentialRampToValueAtTime(190, now + 0.06);

      gain.gain.setValueAtTime(0.055, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.065);

      osc.connect(gain).connect(this.out);
      osc.start(now);
      osc.stop(now + 0.07);
    }

    chargeTick(progress) {
      if (!this._ready()) return;
      const now = this.ctx.currentTime;
      if (now - this.lastChargeAt < 0.075) return;
      this.lastChargeAt = now;

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      const freq = 240 + Math.max(0, Math.min(1, progress)) * 780;
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.12, now + 0.05);

      gain.gain.setValueAtTime(0.045, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.055);
      osc.connect(gain).connect(this.out);
      osc.start(now);
      osc.stop(now + 0.06);
    }

    railgunFire() {
      if (!this._ready()) return;
      const now = this.ctx.currentTime;

      // High-energy plasma beam sweep
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(1320, now);
      osc.frequency.exponentialRampToValueAtTime(68, now + 0.55);
      gain.gain.setValueAtTime(0.22, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.58);
      osc.connect(gain).connect(this.out);
      osc.start(now);
      osc.stop(now + 0.6);

      // Noise crackle
      if (this.noiseBuffer) {
        const src = this.ctx.createBufferSource();
        src.buffer = this.noiseBuffer;
        const bp = this.ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(1800, now);
        bp.frequency.exponentialRampToValueAtTime(300, now + 0.45);
        const ng = this.ctx.createGain();
        ng.gain.setValueAtTime(0.18, now);
        ng.gain.exponentialRampToValueAtTime(0.001, now + 0.48);
        src.connect(bp).connect(ng).connect(this.out);
        src.start(now);
        src.stop(now + 0.5);
      }
    }

    nukeExplosion() {
      if (!this._ready()) return;
      const now = this.ctx.currentTime;

      const sub = this.ctx.createOscillator();
      const subGain = this.ctx.createGain();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(150, now);
      sub.frequency.exponentialRampToValueAtTime(28, now + 0.9);
      subGain.gain.setValueAtTime(0.32, now);
      subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.95);
      sub.connect(subGain).connect(this.out);
      sub.start(now);
      sub.stop(now + 0.98);

      if (this.noiseBuffer) {
        const src = this.ctx.createBufferSource();
        src.buffer = this.noiseBuffer;
        const lp = this.ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(1400, now);
        lp.frequency.exponentialRampToValueAtTime(120, now + 0.85);
        const ng = this.ctx.createGain();
        ng.gain.setValueAtTime(0.26, now);
        ng.gain.exponentialRampToValueAtTime(0.001, now + 0.88);
        src.connect(lp).connect(ng).connect(this.out);
        src.start(now);
        src.stop(now + 0.9);
      }
    }

    windGust() {
      if (!this._ready() || !this.noiseBuffer) return;
      const now = this.ctx.currentTime;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;

      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.setValueAtTime(2.4, now);
      bp.frequency.setValueAtTime(260, now);
      bp.frequency.exponentialRampToValueAtTime(1450, now + 0.32);
      bp.frequency.exponentialRampToValueAtTime(380, now + 1.05);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.01, now);
      gain.gain.linearRampToValueAtTime(0.28, now + 0.18);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 1.1);

      src.connect(bp).connect(gain).connect(this.out);
      src.start(now);
      src.stop(now + 1.15);
    }

    barrelRoll() {
      if (!this._ready()) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(320, now);
      osc.frequency.exponentialRampToValueAtTime(860, now + 0.14);
      osc.frequency.exponentialRampToValueAtTime(260, now + 0.3);
      gain.gain.setValueAtTime(0.11, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
      osc.connect(gain).connect(this.out);
      osc.start(now);
      osc.stop(now + 0.34);
    }

    enemyHit() {
      if (!this._ready()) return;
      const now = this.ctx.currentTime;
      if (now - this.lastHitAt < 0.04) return;
      this.lastHitAt = now;

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(240, now);
      osc.frequency.exponentialRampToValueAtTime(95, now + 0.035);
      gain.gain.setValueAtTime(0.035, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
      osc.connect(gain).connect(this.out);
      osc.start(now);
      osc.stop(now + 0.045);
    }

    enemyBoom(isBoss = false) {
      if (!this._ready()) return;
      const now = this.ctx.currentTime;
      const dur = isBoss ? 0.85 : 0.24;

      if (this.noiseBuffer) {
        const src = this.ctx.createBufferSource();
        src.buffer = this.noiseBuffer;
        const lp = this.ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(isBoss ? 1100 : 750, now);
        lp.frequency.exponentialRampToValueAtTime(80, now + dur);
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(isBoss ? 0.28 : 0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
        src.connect(lp).connect(gain).connect(this.out);
        src.start(now);
        src.stop(now + dur + 0.02);
      }
    }

    powerup() {
      if (!this._ready()) return;
      const now = this.ctx.currentTime;
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((freq, i) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        const t = now + i * 0.055;
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.09, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
        osc.connect(gain).connect(this.out);
        osc.start(t);
        osc.stop(t + 0.15);
      });
    }

    bossAlarm() {
      if (!this._ready()) return;
      const now = this.ctx.currentTime;
      for (let i = 0; i < 3; i++) {
        const t = now + i * 0.26;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(620, t);
        osc.frequency.setValueAtTime(440, t + 0.11);
        gain.gain.setValueAtTime(0.085, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
        osc.connect(gain).connect(this.out);
        osc.start(t);
        osc.stop(t + 0.23);
      }
    }

    uiClick() {
      if (!this._ready()) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.exponentialRampToValueAtTime(520, now + 0.028);
      gain.gain.setValueAtTime(0.05, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
      osc.connect(gain).connect(this.out);
      osc.start(now);
      osc.stop(now + 0.035);
    }
    /** Medal / coin pickup; pitch climbs a major scale with chain step (0..10). */
    medal(step = 0) {
      if (!this._ready() || !this._throttle('medal', 0.05)) return;
      const now = this.ctx.currentTime;
      const scale = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17];
      const k = clamp(Math.round(Number(step) || 0), 0, 10);
      const f = 987.77 * Math.pow(2, scale[k] / 12);
      this._tone('square', f, f, now, 0.07, 0.03);
      this._tone('triangle', f, f, now, 0.09, 0.06);
      this._tone('square', f * 1.3348, f * 1.3348, now + 0.06, 0.2, 0.028);
      this._tone('triangle', f * 1.3348, f * 1.3348, now + 0.06, 0.26, 0.065);
    }

    /** Energy shield bubble forming. */
    shieldUp() {
      if (!this._ready() || !this._throttle('shieldUp', 0.2)) return;
      const now = this.ctx.currentTime;
      this._tone('sine', 220, 880, now, 0.42, 0.1, 0.12);
      this._tone('triangle', 330, 1320, now + 0.03, 0.4, 0.045, 0.14);
      this._tone('sine', 1760, 1760, now + 0.3, 0.3, 0.035, 0.02);
      this._noise('bandpass', 500, 3200, now, 0.4, 0.06, 3, 0.15);
    }

    /** Glassy shatter. */
    shieldBreak() {
      if (!this._ready() || !this._throttle('shieldBreak', 0.15)) return;
      const now = this.ctx.currentTime;
      this._noise('highpass', 3200, 5200, now, 0.28, 0.1);
      this._tone('triangle', 620, 110, now, 0.22, 0.09);
      const shards = [2093, 2794, 3520, 4435, 5274];
      for (let i = 0; i < shards.length; i++) {
        const f = shards[i] * (0.96 + Math.random() * 0.08);
        this._tone('sine', f, f * 0.985, now + i * 0.028 + Math.random() * 0.01, 0.22, 0.04);
      }
    }

    /** Boss enraged / phase 2: low growl + alarm. */
    bossPhase() {
      if (!this._ready() || !this._throttle('bossPhase', 0.8)) return;
      const now = this.ctx.currentTime;
      // growl: two detuned saws beating through a lowpass
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(260, now);
      lp.frequency.linearRampToValueAtTime(900, now + 0.5);
      lp.frequency.exponentialRampToValueAtTime(140, now + 1.2);
      const gg = this.ctx.createGain();
      gg.gain.setValueAtTime(0.0001, now);
      gg.gain.linearRampToValueAtTime(0.085, now + 0.12);
      gg.gain.setValueAtTime(0.085, now + 0.6);
      gg.gain.exponentialRampToValueAtTime(0.001, now + 1.25);
      lp.connect(gg);
      gg.connect(this.out);
      const oscs = [];
      [[82, 44], [87.5, 47.5], [41, 30]].forEach(([f0, f1]) => {
        const o = this.ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(f0, now);
        o.frequency.exponentialRampToValueAtTime(f1, now + 1.2);
        o.connect(lp);
        o.start(now);
        o.stop(now + 1.28);
        oscs.push(o);
      });
      oscs[0].onended = () => {
        try {
          oscs.forEach((o) => o.disconnect());
          lp.disconnect();
          gg.disconnect();
        } catch (e) { /* ignore */ }
      };
      this._noise('lowpass', 500, 90, now, 1.1, 0.13, 0, 0.08);
      // alarm
      for (let i = 0; i < 4; i++) {
        const t = now + 0.3 + i * 0.15;
        const f = i % 2 === 0 ? 932 : 698;
        this._tone('square', f, f, t, 0.12, 0.04);
      }
    }

    /** Short triumphant fanfare (~2s). */
    victory() {
      if (!this._ready() || !this._throttle('victory', 1.5)) return;
      const now = this.ctx.currentTime;
      const run = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98];
      run.forEach((f, i) => {
        const t = now + i * 0.1;
        this._tone('triangle', f, f, t, 0.22, 0.085);
        this._tone('square', f, f, t, 0.12, 0.022);
      });
      const t2 = now + 0.66;
      [1046.5, 1318.5, 1567.98, 2093].forEach((f) => {
        this._tone('triangle', f, f, t2, 1.25, 0.05, 0.02);
      });
      this._tone('sine', 261.63, 261.63, t2, 1.1, 0.08, 0.02);
      // shimmer
      for (let i = 0; i < 8; i++) {
        const f = [2093, 2637, 3136, 4186][i % 4] * (i >= 4 ? 1.5 : 1);
        this._tone('sine', f, f, t2 + 0.12 + i * 0.13, 0.3, 0.022);
      }
    }

    /** Distant rolling thunder. */
    thunder() {
      if (!this._ready() || !this.noiseBuffer || !this._throttle('thunder', 1.5)) return;
      const now = this.ctx.currentTime;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.loop = true;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(420, now);
      lp.frequency.exponentialRampToValueAtTime(70, now + 2.5);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(0.24, now + 0.07);
      g.gain.linearRampToValueAtTime(0.09, now + 0.38);
      g.gain.linearRampToValueAtTime(0.19, now + 0.62);
      g.gain.linearRampToValueAtTime(0.07, now + 1.0);
      g.gain.linearRampToValueAtTime(0.12, now + 1.25);
      g.gain.exponentialRampToValueAtTime(0.001, now + 2.6);
      src.connect(lp);
      lp.connect(g);
      g.connect(this.out);
      src.start(now, Math.random());
      src.stop(now + 2.65);
      src.onended = () => {
        try { src.disconnect(); lp.disconnect(); g.disconnect(); } catch (e) { /* ignore */ }
      };
      this._tone('sine', 62, 30, now, 1.6, 0.14, 0.05);
    }

    /** Subtle two-tone cockpit warning; at most once per ~1.2s. */
    lowHpWarn() {
      if (!this._ready() || !this._throttle('lowHp', 1.2)) return;
      const now = this.ctx.currentTime;
      this._tone('square', 740, 740, now, 0.09, 0.028);
      this._tone('square', 554.37, 554.37, now + 0.12, 0.11, 0.028);
    }

    /** Quick rising ding; pitch grows with the combo count n. */
    comboMilestone(n = 10) {
      if (!this._ready() || !this._throttle('combo', 0.1)) return;
      const now = this.ctx.currentTime;
      const k = clamp(Math.round(Math.log2(Math.max(1, Number(n) || 1))), 0, 9);
      const f = 587.33 * Math.pow(2, (k * 2) / 12);
      [1, 1.2599, 1.4983].forEach((r, i) => {
        const t = now + i * 0.045;
        this._tone('triangle', f * r, f * r, t, i === 2 ? 0.38 : 0.12, 0.075);
      });
      this._tone('sine', f * 2.9966, f * 2.9966, now + 0.09, 0.3, 0.025);
    }

    /** Tiny high blip for proximity mines arming. */
    mineBeep() {
      if (!this._ready() || !this._throttle('mine', 0.12)) return;
      const now = this.ctx.currentTime;
      this._tone('sine', 1960, 1960, now, 0.045, 0.035);
    }

    /** Sharp electric crack. */
    lightningZap() {
      if (!this._ready() || !this._throttle('zap', 0.08)) return;
      const now = this.ctx.currentTime;
      this._noise('highpass', 2400, 900, now, 0.13, 0.13);
      this._tone('sawtooth', 2600, 180, now, 0.09, 0.08);
      this._noise('bandpass', 3800, 1500, now + 0.05, 0.1, 0.09, 1.5);
      this._tone('square', 95, 60, now, 0.12, 0.05);
    }

    /** Crisp crystalline XP gem pickup rising along a pentatonic scale. */
    xpPickup(chain = 0) {
      if (!this._ready() || !this._throttle('xp', 0.036)) return;
      const now = this.ctx.currentTime;
      const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
      const idx = Math.max(0, Math.min(scale.length - 1, Math.round(Number(chain) || 0)));
      const f = 659.25 * Math.pow(2, scale[idx] / 12);
      this._tone('sine', f, f * 1.02, now, 0.085, 0.055);
      this._tone('triangle', f * 2, f * 2, now + 0.012, 0.07, 0.024);
    }

    /** Radiant ascending arpeggio when leveling up for a 3-card skill draft. */
    levelUp() {
      if (!this._ready() || !this._throttle('lvlup', 0.25)) return;
      const now = this.ctx.currentTime;
      const notes = [523.25, 659.25, 783.99, 1046.5, 1318.51];
      notes.forEach((f, i) => {
        const t = now + i * 0.055;
        this._tone('triangle', f, f, t, 0.34, 0.085);
        this._tone('sine', f * 2, f * 2, t + 0.01, 0.26, 0.03);
      });
    }

    /** Mechanical lock-in + rarity shimmer on picking a skill card. */
    skillPick(rarity = 'common') {
      if (!this._ready()) return;
      const now = this.ctx.currentTime;
      this._tone('triangle', 440, 880, now, 0.12, 0.08);
      this._tone('sine', 1174.66, 1174.66, now + 0.06, 0.22, 0.065);
      if (rarity === 'epic') {
        [587.33, 880, 1174.66, 1760].forEach((f, i) => {
          this._tone('sine', f, f, now + 0.05 + i * 0.045, 0.45, 0.06);
        });
      } else if (rarity === 'rare') {
        this._tone('sine', 1479.98, 1479.98, now + 0.11, 0.28, 0.05);
      }
    }

    /** Quick electronic shuffle sound when rerolling skill cards. */
    skillReroll() {
      if (!this._ready() || !this._throttle('reroll', 0.1)) return;
      const now = this.ctx.currentTime;
      [587.33, 698.46, 880].forEach((f, i) => {
        this._tone('sine', f, f * 1.08, now + i * 0.035, 0.07, 0.05);
      });
    }

    /** Soft pneumatic whoosh for micro-missiles. */
    missileLaunch() {
      if (!this._ready() || !this._throttle('msl', 0.16)) return;
      const now = this.ctx.currentTime;
      this._noise('bandpass', 1600, 720, now, 0.09, 0.055, 2.2);
      this._tone('triangle', 520, 260, now, 0.08, 0.035);
    }

    /** Snappy arc jump for chain lightning. */
    chainLightning() {
      if (!this._ready() || !this._throttle('chain', 0.12)) return;
      const now = this.ctx.currentTime;
      this._noise('highpass', 3000, 1400, now, 0.07, 0.065);
      this._tone('sawtooth', 1850, 420, now, 0.065, 0.045);
    }

    /** Crisp crescent wind-blade slash. */
    windBlade() {
      if (!this._ready() || !this._throttle('wblade', 0.14)) return;
      const now = this.ctx.currentTime;
      this._noise('bandpass', 1950, 980, now, 0.11, 0.06, 2.8);
      this._tone('sine', 920, 1480, now, 0.09, 0.035);
    }
  }

  global.SoundFX = SoundFX;
})(typeof window !== 'undefined' ? window : globalThis);
