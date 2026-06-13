import type { SampleData } from "../audio/ami-node";

// Minimal Amiga-flavoured waveform display with loop region + playhead.
export class WaveformView {
  private ctx: CanvasRenderingContext2D;
  private sample: SampleData | null = null;
  private peaks: { min: number; max: number }[] = [];
  private playhead = -1;
  private loop: { enabled: boolean; start: number; end: number } = { enabled: false, start: 0, end: 0 };

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    this.ctx = ctx;
    this.resize();
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.computePeaks();
    this.draw();
  }

  setSample(s: SampleData): void {
    this.sample = s;
    this.loop = { enabled: false, start: 0, end: s.frames };
    this.computePeaks();
    this.draw();
  }

  setLoop(enabled: boolean, start: number, end: number): void {
    this.loop = { enabled, start, end };
    this.draw();
  }

  setPlayhead(pos: number): void {
    this.playhead = pos;
    this.draw();
  }

  private computePeaks(): void {
    this.peaks = [];
    if (!this.sample) return;
    const w = this.canvas.getBoundingClientRect().width || 1;
    const data = this.sample.left;
    const step = Math.max(1, Math.floor(data.length / w));
    for (let x = 0; x < w; x++) {
      let min = 1, max = -1;
      const start = x * step;
      const end = Math.min(data.length, start + step);
      for (let i = start; i < end; i++) {
        const v = data[i];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      this.peaks.push({ min, max });
    }
  }

  private draw(): void {
    const { ctx } = this;
    const rect = this.canvas.getBoundingClientRect();
    const w = rect.width, h = rect.height, mid = h / 2;

    ctx.fillStyle = "#0b0b3b";
    ctx.fillRect(0, 0, w, h);

    if (!this.sample) {
      ctx.fillStyle = "#6a6ad0";
      ctx.font = "14px monospace";
      ctx.fillText("Drop a WAV / AIFF file here", 16, mid);
      return;
    }

    const len = this.sample.frames;

    // loop region
    if (this.loop.enabled && len > 0) {
      const x0 = (this.loop.start / len) * w;
      const x1 = (this.loop.end / len) * w;
      ctx.fillStyle = "rgba(255, 200, 0, 0.15)";
      ctx.fillRect(x0, 0, x1 - x0, h);
    }

    // waveform
    ctx.strokeStyle = "#ff8800";
    ctx.beginPath();
    for (let x = 0; x < this.peaks.length; x++) {
      const p = this.peaks[x];
      ctx.moveTo(x + 0.5, mid - p.max * mid);
      ctx.lineTo(x + 0.5, mid - p.min * mid);
    }
    ctx.stroke();

    // center line
    ctx.strokeStyle = "rgba(255,255,255,0.2)";
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(w, mid);
    ctx.stroke();

    // playhead
    if (this.playhead >= 0 && len > 0) {
      const x = (this.playhead / len) * w;
      ctx.strokeStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
  }
}
