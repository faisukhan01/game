/**
 * VOIDSTRIKE — synthesized SFX via WebAudio. No audio assets; every sound
 * is generated from oscillators / filtered noise. The AudioContext is
 * created lazily on the first user gesture and respects the SFX toggle.
 */

type SfxKind =
  | "shot"
  | "hit"
  | "kill"
  | "nova"
  | "dash"
  | "death"
  | "wave"
  | "ui";

export class SfxEngine {
  enabled = true;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;

  /** Call from a user gesture handler (click / keydown / pointerdown). */
  unlock(): void {
    try {
      if (!this.ctx) {
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.42;
        this.master.connect(this.ctx.destination);
        const len = Math.floor(this.ctx.sampleRate * 0.5);
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === "suspended") void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  private tone(
    type: OscillatorType,
    f0: number,
    f1: number,
    dur: number,
    peak: number,
    delay = 0,
  ): void {
    if (!this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    g.gain.setValueAtTime(peak, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  private noise(
    filterType: BiquadFilterType,
    f0: number,
    f1: number,
    dur: number,
    peak: number,
  ): void {
    if (!this.ctx || !this.master || !this.noiseBuf) return;
    const t0 = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = filterType;
    filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(f0, t0);
    filter.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(peak, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  play(kind: SfxKind): void {
    if (!this.enabled || !this.ctx || this.ctx.state !== "running") return;
    try {
      switch (kind) {
        case "shot":
          this.tone("square", 760, 180, 0.07, 0.10);
          break;
        case "hit":
          this.noise("bandpass", 2600, 1400, 0.05, 0.16);
          break;
        case "kill":
          this.tone("square", 330, 330, 0.06, 0.12);
          this.tone("square", 660, 660, 0.1, 0.12, 0.06);
          break;
        case "nova":
          this.tone("sine", 300, 46, 0.55, 0.3);
          this.noise("lowpass", 900, 120, 0.5, 0.22);
          break;
        case "dash":
          this.noise("bandpass", 420, 2600, 0.2, 0.14);
          break;
        case "death":
          this.tone("sawtooth", 240, 38, 0.75, 0.24);
          break;
        case "wave":
          this.tone("square", 523, 523, 0.07, 0.09);
          this.tone("square", 392, 392, 0.12, 0.09, 0.08);
          break;
        case "ui":
          this.tone("square", 880, 880, 0.04, 0.06);
          break;
      }
    } catch {
      // Audio failures must never break gameplay.
    }
  }
}

/** Shared singleton — unlock once on any user gesture, reuse everywhere. */
export const gameSfx = new SfxEngine();
