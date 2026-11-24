/**
 * Procedural chiptune SFX and a living crowd, synthesised with WebAudio (no sound files).
 * The context starts on the first user gesture (browser autoplay rules).
 */
import { prefs } from './prefs';

export type Sfx =
    | 'click'
    | 'kick'
    | 'pass'
    | 'trap'
    | 'tackle'
    | 'whistle'
    | 'whistleEnd'
    | 'save'
    | 'goal'
    | 'concede'
    | 'groan'
    | 'card'
    | 'ability'
    | 'tick'
    | 'yourTurn'
    | 'levelUp'
    | 'coin'
    | 'error';

class AudioEngine {
    private ctx: AudioContext | null = null;
    private master!: GainNode;
    private sfxBus!: GainNode;
    private crowdBus!: GainNode;
    private crowdGain!: GainNode;
    private noise!: AudioBuffer;
    private crowdOn = false;

    private ensure() {
        if (this.ctx) return this.ctx;
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AC) return null;
        const ctx = new AC();
        this.ctx = ctx;
        this.master = ctx.createGain();
        this.master.connect(ctx.destination);
        this.sfxBus = ctx.createGain();
        this.sfxBus.connect(this.master);
        this.crowdBus = ctx.createGain();
        this.crowdBus.connect(this.master);
        this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        this.applyVolumes();
        return ctx;
    }

    /** Call from any user gesture: unlocks audio. */
    unlock() {
        void import('./radio').then((r) => r.radio.start());
        const ctx = this.ensure();
        if (ctx && ctx.state === 'suspended') void ctx.resume();
    }

    applyVolumes() {
        if (!this.ctx) return;
        const p = prefs();
        const t = this.ctx.currentTime;
        this.master.gain.setTargetAtTime(p.muted ? 0 : 1, t, 0.02);
        this.sfxBus.gain.setTargetAtTime(p.sfxVolume * 0.9, t, 0.02);
        this.crowdBus.gain.setTargetAtTime(p.crowdVolume, t, 0.05);
    }

    // ------------------------------------------------------------ building blocks
    private tone(freq: number, dur: number, type: OscillatorType, gain: number, slideTo?: number, delay = 0) {
        const ctx = this.ctx!;
        const t = ctx.currentTime + delay;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = type;
        o.frequency.setValueAtTime(freq, t);
        if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(this.sfxBus);
        o.start(t);
        o.stop(t + dur + 0.02);
    }

    private hiss(
        dur: number,
        type: BiquadFilterType,
        freq: number,
        gain: number,
        sweepTo?: number,
        q = 1,
        delay = 0,
        attack = 0.01,
        bus?: GainNode,
    ) {
        const ctx = this.ctx!;
        const t = ctx.currentTime + delay;
        const src = ctx.createBufferSource();
        src.buffer = this.noise;
        const f = ctx.createBiquadFilter();
        f.type = type;
        f.frequency.setValueAtTime(freq, t);
        f.Q.value = q;
        if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(gain, t + attack);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        src.connect(f)
            .connect(g)
            .connect(bus ?? this.sfxBus);
        src.start(t, Math.random());
        src.stop(t + dur + 0.05);
    }

    private arp(notes: number[], step: number, type: OscillatorType, gain: number, len = step * 1.6) {
        notes.forEach((n, i) => this.tone(n, len, type, gain, undefined, i * step));
    }

    // ------------------------------------------------------------ the sounds
    play(s: Sfx) {
        const ctx = this.ensure();
        if (!ctx || ctx.state !== 'running') return;
        switch (s) {
            case 'click':
                this.tone(880, 0.04, 'square', 0.05);
                break;
            case 'error':
                this.tone(180, 0.12, 'square', 0.06, 120);
                break;
            case 'kick':
                this.hiss(0.08, 'lowpass', 1100, 0.5);
                this.tone(130, 0.12, 'sine', 0.7, 55);
                break;
            case 'pass':
                this.hiss(0.05, 'lowpass', 1400, 0.3);
                this.tone(190, 0.08, 'sine', 0.4, 90);
                break;
            case 'trap':
                this.tone(240, 0.05, 'triangle', 0.18, 170);
                break;
            case 'tackle':
                this.hiss(0.2, 'bandpass', 700, 0.7, 180, 1.2);
                this.tone(95, 0.16, 'sine', 0.5, 45);
                break;
            case 'whistle':
                this.whistle(0, 0.32);
                break;
            case 'whistleEnd':
                this.whistle(0, 0.25);
                this.whistle(0.35, 0.25);
                this.whistle(0.7, 0.7);
                break;
            case 'save':
                this.tone(150, 0.12, 'sine', 0.5, 70);
                this.hiss(0.12, 'lowpass', 800, 0.3);
                this.ooh(0.9, 0.35);
                break;
            case 'goal':
                this.roar(2.6, 0.9);
                this.arp([523, 659, 784, 1047, 1319], 0.085, 'square', 0.07, 0.2);
                break;
            case 'concede':
                this.roar(1.8, 0.35);
                this.arp([392, 330, 262], 0.12, 'triangle', 0.08, 0.25);
                break;
            case 'groan':
                this.hiss(1.1, 'bandpass', 720, 0.35, 320, 0.8, 0, 0.15, this.crowdBus);
                break;
            case 'card':
                this.tone(660, 0.1, 'square', 0.07);
                this.tone(440, 0.16, 'square', 0.07, undefined, 0.11);
                break;
            case 'ability':
                this.arp([660, 880, 1320], 0.045, 'sine', 0.12, 0.12);
                break;
            case 'tick':
                this.tone(1250, 0.03, 'square', 0.06);
                break;
            case 'yourTurn':
                this.tone(523, 0.09, 'triangle', 0.14);
                this.tone(784, 0.14, 'triangle', 0.14, undefined, 0.08);
                break;
            case 'levelUp':
                this.arp([523, 659, 784, 1047], 0.07, 'square', 0.06, 0.12);
                break;
            case 'coin':
                this.tone(988, 0.06, 'square', 0.06);
                this.tone(1319, 0.18, 'square', 0.06, undefined, 0.06);
                break;
        }
    }

    private whistle(delay: number, dur: number) {
        const ctx = this.ctx!;
        const t = ctx.currentTime + delay;
        const o = ctx.createOscillator();
        const lfo = ctx.createOscillator();
        const lg = ctx.createGain();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = 2900;
        lfo.frequency.value = 28;
        lg.gain.value = 160;
        lfo.connect(lg).connect(o.frequency);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
        g.gain.setValueAtTime(0.12, t + dur - 0.04);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(this.sfxBus);
        o.start(t);
        lfo.start(t);
        o.stop(t + dur + 0.02);
        lfo.stop(t + dur + 0.02);
    }

    private roar(dur: number, gain: number) {
        this.hiss(dur, 'bandpass', 900, gain, 600, 0.6, 0, 0.18, this.crowdBus);
        this.hiss(dur * 0.8, 'bandpass', 1800, gain * 0.4, 1200, 0.8, 0.05, 0.2, this.crowdBus);
    }
    private ooh(dur: number, gain: number) {
        this.hiss(dur, 'bandpass', 500, gain, 900, 2, 0.05, 0.2, this.crowdBus);
    }

    // ------------------------------------------------------------ crowd ambience
    startCrowd() {
        const ctx = this.ensure();
        if (!ctx || this.crowdOn) return;
        this.crowdOn = true;
        const src = ctx.createBufferSource();
        src.buffer = this.noise;
        src.loop = true;
        const f = ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = 520;
        f.Q.value = 0.5;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 1500;
        this.crowdGain = ctx.createGain();
        this.crowdGain.gain.value = 0.05;
        src.connect(f).connect(lp).connect(this.crowdGain).connect(this.crowdBus);
        src.start();
        (this as unknown as { crowdSrc: AudioBufferSourceNode }).crowdSrc = src;
    }

    stopCrowd() {
        if (!this.crowdOn || !this.ctx) return;
        const src = (this as unknown as { crowdSrc?: AudioBufferSourceNode }).crowdSrc;
        this.crowdGain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.3);
        setTimeout(() => src?.stop(), 1200);
        this.crowdOn = false;
    }

    /** 0 = midfield lull, 1 = goalmouth scramble. */
    setTension(x: number) {
        if (!this.crowdOn || !this.ctx) return;
        this.crowdGain.gain.setTargetAtTime(0.04 + 0.11 * Math.max(0, Math.min(1, x)), this.ctx.currentTime, 0.6);
    }
}

export const audio = new AudioEngine();
prefs.subscribe(() => audio.applyVolumes());
