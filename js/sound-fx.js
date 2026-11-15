/**
 * Pure Web Audio Synthesizer for Tabletop Sky Striker
 * Zero external audio assets required. Supports both Host (battlefield) and Controller (cockpit MFD).
 */
(function (global) {
  'use strict';

  class SoundFX {
    constructor() {
      this.ctx = null;
      this.muted = false;
      this.lastLaserAt = 0;
      this.lastHitAt = 0;
      this.lastChargeAt = 0;
      this.noiseBuffer = null;
    }

    unlock() {
      if (this.muted) return false;
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return false;
      if (!this.ctx) {
        this.ctx = new AC();
        this._buildNoiseBuffer();
      }
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      return this.ctx.state === 'running';
    }

    _buildNoiseBuffer() {
      if (!this.ctx) return;
      const sr = this.ctx.sampleRate;
      const len = sr * 1.5;
      const buf = this.ctx.createBuffer(1, len, sr);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      this.noiseBuffer = buf;
    }

    setMuted(flag) {
      this.muted = Boolean(flag);
    }

    toggleMute() {
      this.muted = !this.muted;
      if (!this.muted) this.unlock();
      return this.muted;
    }

    _ready() {
      if (this.muted) return false;
      if (!this.ctx) this.unlock();
      return Boolean(this.ctx && this.ctx.state === 'running');
    }

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

      osc.connect(gain).connect(this.ctx.destination);
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
      osc.connect(gain).connect(this.ctx.destination);
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
      osc.connect(gain).connect(this.ctx.destination);
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
        src.connect(bp).connect(ng).connect(this.ctx.destination);
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
      sub.connect(subGain).connect(this.ctx.destination);
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
        src.connect(lp).connect(ng).connect(this.ctx.destination);
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

      src.connect(bp).connect(gain).connect(this.ctx.destination);
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
      osc.connect(gain).connect(this.ctx.destination);
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
      osc.connect(gain).connect(this.ctx.destination);
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
        src.connect(lp).connect(gain).connect(this.ctx.destination);
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
        osc.connect(gain).connect(this.ctx.destination);
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
        osc.connect(gain).connect(this.ctx.destination);
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
      osc.connect(gain).connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.035);
    }
  }

  global.SoundFX = SoundFX;
})(typeof window !== 'undefined' ? window : globalThis);
