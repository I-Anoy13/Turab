/**
 * Audio Sound Effect Library for Turab's Elite Card Series
 * Pure Web Audio API synthesis: zero latency, zero remote dependencies, offline-first.
 * Provides organic, physical, subtle audio feedback for cards, shuffling, dealing, and winning tricks.
 */

class SoundEffectManager {
  private ctx: AudioContext | null = null;
  private isMuted: boolean = false;
  private masterGain: number = 0.8;

  constructor() {
    // Restore persistent muted preference
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('turab_sound_muted');
        if (stored !== null) {
          this.isMuted = stored === 'true';
        }
      } catch (e) {}
    }
  }

  private getAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('turab_sound_muted', String(muted));
      } catch (e) {}
    }
  }

  public toggleMute(): boolean {
    this.setMuted(!this.isMuted);
    return this.isMuted;
  }

  public getMuted(): boolean {
    return this.isMuted;
  }

  public setVolume(vol: number) {
    this.masterGain = Math.max(0, Math.min(1, vol));
  }

  /**
   * Helper: Generates a buffer of white/colored noise
   */
  private createNoiseBuffer(ctx: AudioContext, duration: number): AudioBuffer {
    const sampleRate = ctx.sampleRate;
    const bufferSize = Math.max(1, Math.floor(sampleRate * duration));
    const buffer = ctx.createBuffer(1, bufferSize, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      // White noise with subtle pinking roll-off
      data[i] = (Math.random() * 2 - 1) * 0.9;
    }
    return buffer;
  }

  /**
   * 1. Card Placement Sound
   * Crisp tactile snap of cardboard hitting green baize/felt table.
   * Supports variations for 'slow', 'spin', or 'slam' signals.
   */
  public playCard(signal?: 'slow' | 'spin' | 'slam' | null) {
    if (this.isMuted) return;
    const ctx = this.getAudioContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      // Randomize pitch slightly (±4%) for authentic non-repetitive physical feel
      const pitchOffset = (Math.random() - 0.5) * 80;

      // 1. Friction / snap noise
      const noiseDuration = signal === 'slam' ? 0.08 : signal === 'slow' ? 0.07 : 0.045;
      const noise = ctx.createBufferSource();
      noise.buffer = this.createNoiseBuffer(ctx, noiseDuration);

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      const centerFreq = signal === 'slam' ? 950 : signal === 'spin' ? 1450 : 1200 + pitchOffset;
      filter.frequency.setValueAtTime(centerFreq, now);
      filter.Q.setValueAtTime(signal === 'slam' ? 2.5 : 4, now);

      const noiseGain = ctx.createGain();
      const peakGain = (signal === 'slam' ? 0.08 : 0.04) * this.masterGain;
      noiseGain.gain.setValueAtTime(0.001, now);
      noiseGain.gain.linearRampToValueAtTime(peakGain, now + 0.003);
      noiseGain.gain.exponentialRampToValueAtTime(0.0005, now + noiseDuration);

      noise.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(ctx.destination);
      noise.start(now);

      // 2. Sub-bass felt thud (gives cardboard weight when hitting felt)
      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();
      osc.type = 'sine';
      const baseFreq = signal === 'slam' ? 68 : 88 + (Math.random() * 8);
      osc.frequency.setValueAtTime(baseFreq, now);
      osc.frequency.exponentialRampToValueAtTime(38, now + (signal === 'slam' ? 0.08 : 0.04));

      const oscPeak = (signal === 'slam' ? 0.09 : 0.025) * this.masterGain;
      oscGain.gain.setValueAtTime(oscPeak, now);
      oscGain.gain.exponentialRampToValueAtTime(0.0001, now + (signal === 'slam' ? 0.08 : 0.045));

      osc.connect(oscGain);
      oscGain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + (signal === 'slam' ? 0.09 : 0.05));
    } catch (e) {
      // Audio fallback fail-safe
    }
  }

  /**
   * 2. Single Card Deal Sound
   * Rapid paper whoosh/flick as a card slides out of the deck.
   */
  public playDeal(cardIndex: number = 0) {
    if (this.isMuted) return;
    const ctx = this.getAudioContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const duration = 0.055;
      const noise = ctx.createBufferSource();
      noise.buffer = this.createNoiseBuffer(ctx, duration);

      // Highpass to eliminate heavy mud, emphasize sliding paper
      const highpass = ctx.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.setValueAtTime(900, now);

      // Bandpass sweep to simulate card sliding off deck
      const bandpass = ctx.createBiquadFilter();
      bandpass.type = 'bandpass';
      const startFreq = 2400 + (cardIndex % 8) * 40;
      bandpass.frequency.setValueAtTime(startFreq, now);
      bandpass.frequency.exponentialRampToValueAtTime(1400, now + duration);
      bandpass.Q.setValueAtTime(3.5, now);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.035 * this.masterGain, now + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0002, now + duration);

      noise.connect(highpass);
      highpass.connect(bandpass);
      bandpass.connect(gain);
      gain.connect(ctx.destination);
      noise.start(now);
    } catch (e) {}
  }

  /**
   * 3. Dealing Sequence
   * Realistic multi-card dealing sequence with authentic casino rhythm.
   */
  public playDealingSequence(count: number = 6, intervalMs: number = 75) {
    if (this.isMuted) return;
    for (let i = 0; i < count; i++) {
      setTimeout(() => {
        this.playDeal(i);
      }, i * intervalMs);
    }
  }

  /**
   * 4. Card Shuffling Sound
   * Riffle shuffle simulation: rapid fluttering cascade of paper clicks followed by the bridge waterfall.
   */
  public playShuffle() {
    if (this.isMuted) return;
    const ctx = this.getAudioContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;

      // Phase A: The Riffle (14 quick intermeshing micro-flicks)
      const flickCount = 14;
      for (let i = 0; i < flickCount; i++) {
        // Accelerating and then decelerating timing
        const tOffset = (i * 0.022) + (Math.sin((i / flickCount) * Math.PI) * 0.008);
        const flickTime = now + tOffset;
        
        const flickNoise = ctx.createBufferSource();
        flickNoise.buffer = this.createNoiseBuffer(ctx, 0.02);

        const flickFilter = ctx.createBiquadFilter();
        flickFilter.type = 'bandpass';
        flickFilter.frequency.setValueAtTime(1600 + (Math.random() * 900), flickTime);
        flickFilter.Q.setValueAtTime(5, flickTime);

        const flickGain = ctx.createGain();
        const flickVol = (0.015 + (Math.random() * 0.015)) * this.masterGain;
        flickGain.gain.setValueAtTime(flickVol, flickTime);
        flickGain.gain.exponentialRampToValueAtTime(0.0005, flickTime + 0.018);

        flickNoise.connect(flickFilter);
        flickFilter.connect(flickGain);
        flickGain.connect(ctx.destination);
        flickNoise.start(flickTime);
        flickNoise.stop(flickTime + 0.02);
      }

      // Phase B: The Waterfall / Bridge Cascade
      const bridgeTime = now + 0.32;
      const bridgeDuration = 0.28;
      const bridgeNoise = ctx.createBufferSource();
      bridgeNoise.buffer = this.createNoiseBuffer(ctx, bridgeDuration);

      const bridgeFilter = ctx.createBiquadFilter();
      bridgeFilter.type = 'lowpass';
      bridgeFilter.frequency.setValueAtTime(2800, bridgeTime);
      bridgeFilter.frequency.exponentialRampToValueAtTime(800, bridgeTime + bridgeDuration);

      const bridgeGain = ctx.createGain();
      bridgeGain.gain.setValueAtTime(0.001, bridgeTime);
      bridgeGain.gain.linearRampToValueAtTime(0.035 * this.masterGain, bridgeTime + 0.04);
      bridgeGain.gain.exponentialRampToValueAtTime(0.0002, bridgeTime + bridgeDuration);

      bridgeNoise.connect(bridgeFilter);
      bridgeFilter.connect(bridgeGain);
      bridgeGain.connect(ctx.destination);
      bridgeNoise.start(bridgeTime);
    } catch (e) {}
  }

  /**
   * 5. Trick Win / Sweep Sound
   * Smooth, satisfying sweep of 4 cards dragged off the felt into the winner's stack,
   * coupled with a gentle harmonic chime celebrating the point collection.
   */
  public playTrickWin(isAce: boolean = false, isMyWin: boolean = true) {
    if (this.isMuted) return;
    const ctx = this.getAudioContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;

      // 1. Felt card sweep noise (the 4 cards being collected)
      const sweepDuration = 0.19;
      const noise = ctx.createBufferSource();
      noise.buffer = this.createNoiseBuffer(ctx, sweepDuration);

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(750, now);
      filter.frequency.exponentialRampToValueAtTime(1700, now + 0.09);
      filter.frequency.exponentialRampToValueAtTime(900, now + sweepDuration);
      filter.Q.setValueAtTime(3.2, now);

      const sweepGain = ctx.createGain();
      sweepGain.gain.setValueAtTime(0.001, now);
      sweepGain.gain.linearRampToValueAtTime(0.04 * this.masterGain, now + 0.04);
      sweepGain.gain.exponentialRampToValueAtTime(0.0004, now + sweepDuration);

      noise.connect(filter);
      filter.connect(sweepGain);
      sweepGain.connect(ctx.destination);
      noise.start(now);

      // 2. Subtle melodic win chime (softer, pleasant harmonic resonance)
      const chords = isMyWin 
        ? [isAce ? 659.25 : 523.25, isAce ? 830.61 : 659.25] // E5/G#5 for Ace, C5/E5 for standard win
        : [392.00, 493.88]; // G4/B4 for opponent win

      chords.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + 0.03 + (idx * 0.025));

        const chimeGain = (isMyWin ? 0.035 : 0.018) * this.masterGain;
        gain.gain.setValueAtTime(0.0001, now + 0.03 + (idx * 0.025));
        gain.gain.linearRampToValueAtTime(chimeGain, now + 0.05 + (idx * 0.025));
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + 0.03 + (idx * 0.025));
        osc.stop(now + 0.4);
      });
    } catch (e) {}
  }

  /**
   * 6. Trump Card Reveal Sound
   * Shimmering harmonic pluck when the hidden trump suit is revealed.
   */
  public playTrumpReveal() {
    if (this.isMuted) return;
    const ctx = this.getAudioContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const freqs = [440, 554.37, 659.25, 880]; // A major arpeggio
      freqs.forEach((f, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        const noteTime = now + (idx * 0.04);
        osc.frequency.setValueAtTime(f, noteTime);

        gain.gain.setValueAtTime(0.001, noteTime);
        gain.gain.linearRampToValueAtTime(0.03 * this.masterGain, noteTime + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, noteTime + 0.28);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(noteTime);
        osc.stop(noteTime + 0.3);
      });
    } catch (e) {}
  }

  /**
   * 7. Subtle Hover / Touch Sound
   * Barely audible soft brush when touching/hovering cards.
   */
  public playCardHover() {
    if (this.isMuted) return;
    const ctx = this.getAudioContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const noise = ctx.createBufferSource();
      noise.buffer = this.createNoiseBuffer(ctx, 0.018);

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(2600, now);
      filter.Q.setValueAtTime(5, now);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.008 * this.masterGain, now);
      gain.gain.exponentialRampToValueAtTime(0.0002, now + 0.018);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      noise.start(now);
    } catch (e) {}
  }

  /**
   * 8. Chips / Coins Clink Sound
   * Tactile ceramic casino chip clink for coin rewards.
   */
  public playCoinClink() {
    if (this.isMuted) return;
    const ctx = this.getAudioContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1750, now);
      osc.frequency.exponentialRampToValueAtTime(800, now + 0.08);

      gain.gain.setValueAtTime(0.05 * this.masterGain, now);
      gain.gain.exponentialRampToValueAtTime(0.0002, now + 0.08);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.09);
    } catch (e) {}
  }

  /**
   * 9. Match Victory Fanfare
   * Rich warm acoustic triumph arpeggio celebrating round victory.
   */
  public playVictoryFanfare() {
    if (this.isMuted) return;
    const ctx = this.getAudioContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const notes = [
        { f: 523.25, t: 0, d: 0.25 },     // C5
        { f: 659.25, t: 0.12, d: 0.25 },   // E5
        { f: 783.99, t: 0.24, d: 0.3 },    // G5
        { f: 1046.50, t: 0.38, d: 0.8 },  // C6 (sustained ringing peak)
        { f: 1318.51, t: 0.42, d: 0.75 }  // E6 (sparkle harmonic)
      ];

      notes.forEach(({ f, t, d }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        const start = now + t;
        osc.frequency.setValueAtTime(f, start);

        gain.gain.setValueAtTime(0.001, start);
        gain.gain.linearRampToValueAtTime(0.06 * this.masterGain, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + d);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + d + 0.05);
      });
    } catch (e) {}
  }
}

export const soundEffects = new SoundEffectManager();
