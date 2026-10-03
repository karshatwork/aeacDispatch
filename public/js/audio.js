// public/js/audio.js - Web Audio API High-Precision Sound Synthesizer (100% Offline)
// Engineered for industrial ambient environments and laptop/panel-PC speakers
class SoundEffects {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.compressor = null;
    this.muted = localStorage.getItem('aeac_sound_muted') === 'true';
    this.volume = parseFloat(localStorage.getItem('aeac_sound_volume') || '0.9');

    // Auto-unlock AudioContext on first user interaction in modern browsers
    if (typeof window !== 'undefined') {
      const unlock = () => {
        this.init();
        window.removeEventListener('pointerdown', unlock);
        window.removeEventListener('keydown', unlock);
      };
      window.addEventListener('pointerdown', unlock, { once: true });
      window.addEventListener('keydown', unlock, { once: true });
    }
  }

  init() {
    try {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          this.ctx = new AudioCtx();
        }
      }

      if (this.ctx) {
        if (this.ctx.state === 'suspended') {
          this.ctx.resume();
        }

        // Build master dynamics compressor and output gain bus
        if (!this.masterGain) {
          this.compressor = this.ctx.createDynamicsCompressor();
          this.compressor.threshold.setValueAtTime(-14, this.ctx.currentTime);
          this.compressor.knee.setValueAtTime(8, this.ctx.currentTime);
          this.compressor.ratio.setValueAtTime(5, this.ctx.currentTime);
          this.compressor.attack.setValueAtTime(0.003, this.ctx.currentTime);
          this.compressor.release.setValueAtTime(0.12, this.ctx.currentTime);

          this.masterGain = this.ctx.createGain();
          this.masterGain.gain.setValueAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime);

          this.compressor.connect(this.masterGain);
          this.masterGain.connect(this.ctx.destination);
        }
      }
    } catch (e) {
      console.warn('[AUDIO] Context init warning:', e.message);
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    localStorage.setItem('aeac_sound_muted', this.muted);
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime);
    }
    return this.muted;
  }

  setVolume(level) {
    this.volume = Math.max(0, Math.min(1, level));
    localStorage.setItem('aeac_sound_volume', this.volume);
    if (this.masterGain && this.ctx && !this.muted) {
      this.masterGain.gain.setValueAtTime(this.volume, this.ctx.currentTime);
    }
  }

  // Helper to connect audio node to master compressor chain
  _connectToOutput(node) {
    if (this.compressor) {
      node.connect(this.compressor);
    } else if (this.masterGain) {
      node.connect(this.masterGain);
    } else if (this.ctx) {
      node.connect(this.ctx.destination);
    }
  }

  // Crisp, tactile mechanical switch click
  playClick() {
    if (this.muted) return;
    try {
      this.init();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;

      // Crisp high-frequency snap
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(2200, now);
      osc.frequency.exponentialRampToValueAtTime(500, now + 0.045);

      gain.gain.setValueAtTime(0.35, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);

      osc.connect(gain);
      this._connectToOutput(gain);

      osc.start(now);
      osc.stop(now + 0.045);
    } catch (e) {}
  }

  // Clear, bright industrial barcode scan verification chime (Dual-tone)
  playSuccess() {
    if (this.muted) return;
    try {
      this.init();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;

      // Tone 1: High crisp bell ping (880Hz / A5)
      const osc1 = this.ctx.createOscillator();
      const gain1 = this.ctx.createGain();
      osc1.type = 'triangle';
      osc1.frequency.setValueAtTime(880, now);
      gain1.gain.setValueAtTime(0.65, now);
      gain1.gain.exponentialRampToValueAtTime(0.005, now + 0.22);
      osc1.connect(gain1);
      this._connectToOutput(gain1);
      osc1.start(now);
      osc1.stop(now + 0.22);

      // Tone 2: Ascending bright chime (1318.5Hz / E6)
      const osc2 = this.ctx.createOscillator();
      const gain2 = this.ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(1318.5, now + 0.07);
      gain2.gain.setValueAtTime(0.001, now);
      gain2.gain.setValueAtTime(0.75, now + 0.07);
      gain2.gain.exponentialRampToValueAtTime(0.005, now + 0.32);
      osc2.connect(gain2);
      this._connectToOutput(gain2);
      osc2.start(now + 0.07);
      osc2.stop(now + 0.32);
    } catch (e) {}
  }

  // Loud, urgent industrial warning buzzer (Double-pulse Beep-Beep)
  // Tuned to 587Hz & 622Hz so it cuts through laptop speakers without getting lost in bass roll-off
  playViolation() {
    if (this.muted) return;
    try {
      this.init();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;

      const triggerPulse = (startTime, duration, vol) => {
        const oscA = this.ctx.createOscillator();
        const oscB = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        oscA.type = 'sawtooth';
        oscB.type = 'square';
        oscA.frequency.setValueAtTime(587.33, startTime); // D5
        oscB.frequency.setValueAtTime(622.25, startTime); // D#5 (grating industrial dissonance)

        gain.gain.setValueAtTime(vol, startTime);
        gain.gain.exponentialRampToValueAtTime(0.01, startTime + duration);

        oscA.connect(gain);
        oscB.connect(gain);
        this._connectToOutput(gain);

        oscA.start(startTime);
        oscB.start(startTime);
        oscA.stop(startTime + duration);
        oscB.stop(startTime + duration);
      };

      // Pulse 1
      triggerPulse(now, 0.13, 0.70);
      // Pulse 2 (urgent follow-up after brief 40ms silence)
      triggerPulse(now + 0.17, 0.20, 0.80);
    } catch (e) {}
  }

  // Rich, full ascending triumphant fanfare (C5 -> E5 -> G5 -> C6)
  playCompletion() {
    if (this.muted) return;
    try {
      this.init();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;

      const notes = [
        { freq: 523.25, dur: 0.25, gain: 0.55 }, // C5
        { freq: 659.25, dur: 0.25, gain: 0.60 }, // E5
        { freq: 783.99, dur: 0.28, gain: 0.65 }, // G5
        { freq: 1046.50, dur: 0.45, gain: 0.75 } // C6
      ];

      notes.forEach((n, i) => {
        const startTime = now + (i * 0.09);
        const oscMain = this.ctx.createOscillator();
        const oscHarm = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        oscMain.type = 'triangle';
        oscMain.frequency.setValueAtTime(n.freq, startTime);

        oscHarm.type = 'sine';
        oscHarm.frequency.setValueAtTime(n.freq * 2, startTime);

        gain.gain.setValueAtTime(n.gain, startTime);
        gain.gain.exponentialRampToValueAtTime(0.005, startTime + n.dur);

        oscMain.connect(gain);
        oscHarm.connect(gain);
        this._connectToOutput(gain);

        oscMain.start(startTime);
        oscHarm.start(startTime);
        oscMain.stop(startTime + n.dur);
        oscHarm.stop(startTime + n.dur);
      });
    } catch (e) {}
  }

  // Authoritative double-ping prompt/alert
  playAlert() {
    if (this.muted) return;
    try {
      this.init();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;

      const triggerPing = (startTime, freq) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, startTime);

        gain.gain.setValueAtTime(0.60, startTime);
        gain.gain.exponentialRampToValueAtTime(0.005, startTime + 0.18);

        osc.connect(gain);
        this._connectToOutput(gain);

        osc.start(startTime);
        osc.stop(startTime + 0.18);
      };

      triggerPing(now, 1046.50);        // C6
      triggerPing(now + 0.11, 1318.51); // E6
    } catch (e) {}
  }
}

const sounds = new SoundEffects();
if (typeof window !== 'undefined') {
  window.sounds = sounds;
}
