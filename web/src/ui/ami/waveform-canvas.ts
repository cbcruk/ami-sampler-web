import type { SampleData } from "../../audio/ami-node";
import { AMI_BLU, AMI_WHT, AMI_ORG, AMI_BLK, AMI_BLL, AMI_BLD } from "./palette";
import { type Rect, inRect, bevel, text } from "./draw";
import type { Widget } from "./widgets";

interface Peak {
  min: number;
  max: number;
}

interface WaveOpts {
  rect: Rect; // full waveform panel (incl. F/E strip + scrollbar)
  onLoopChange: (start: number, end: number) => void;
}

const FE_W = 14; // left full/empty scale strip width
const SCROLL_H = 12; // bottom scroll bar height

export class WaveformCanvas implements Widget {
  rect: Rect;
  private sample: SampleData | null = null;
  private peaks: Peak[] = [];
  private playhead = -1;
  private loop = { enabled: false, start: 0, end: 0 };
  private dragging: "start" | "end" | null = null;

  constructor(private o: WaveOpts) {
    this.rect = o.rect;
  }

  private waveArea(): Rect {
    const r = this.rect;
    return { x: r.x + FE_W, y: r.y, w: r.w - FE_W, h: r.h - SCROLL_H };
  }

  setSample(s: SampleData | null): void {
    this.sample = s;
    this.playhead = -1;
    this.loop = { enabled: false, start: 0, end: s ? s.frames : 0 };
    this.computePeaks();
  }

  setLoop(enabled: boolean, start: number, end: number): void {
    this.loop = { enabled, start, end };
  }

  setPlayhead(pos: number): void {
    this.playhead = pos;
  }

  private computePeaks(): void {
    this.peaks = [];
    if (!this.sample) return;
    const w = Math.floor(this.waveArea().w);
    const data = this.sample.left;
    const step = Math.max(1, Math.floor(data.length / w));
    for (let x = 0; x < w; x++) {
      let min = 1;
      let max = -1;
      const s = x * step;
      const e = Math.min(data.length, s + step);
      for (let i = s; i < e; i++) {
        const v = data[i];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      this.peaks.push({ min, max });
    }
  }

  private sampToX(samp: number): number {
    const a = this.waveArea();
    const len = this.sample?.frames || 1;
    return a.x + (samp / len) * a.w;
  }

  private xToSamp(x: number): number {
    const a = this.waveArea();
    const len = this.sample?.frames || 1;
    return Math.round(((x - a.x) / a.w) * len);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const r = this.rect;
    const a = this.waveArea();

    // F/E amplitude scale strip
    ctx.fillStyle = AMI_BLK;
    ctx.fillRect(r.x, r.y, FE_W, a.h);
    ctx.fillStyle = AMI_ORG;
    ctx.fillRect(r.x + 3, r.y, 5, a.h);
    text(ctx, "F", r.x + 1, r.y + 2, 13, AMI_WHT, "left");
    text(ctx, "E", r.x + 1, r.y + a.h - 14, 13, AMI_WHT, "left");

    // waveform background
    ctx.fillStyle = AMI_BLU;
    ctx.fillRect(a.x, a.y, a.w, a.h);

    const mid = a.y + a.h / 2;

    // loop region
    if (this.loop.enabled && this.sample) {
      const x0 = this.sampToX(this.loop.start);
      const x1 = this.sampToX(this.loop.end);
      ctx.fillStyle = "rgba(252,138,0,0.18)";
      ctx.fillRect(x0, a.y, x1 - x0, a.h);
    }

    // waveform peaks
    ctx.strokeStyle = AMI_WHT;
    ctx.beginPath();
    for (let x = 0; x < this.peaks.length; x++) {
      const p = this.peaks[x];
      ctx.moveTo(a.x + x + 0.5, mid - p.max * (a.h / 2));
      ctx.lineTo(a.x + x + 0.5, mid - p.min * (a.h / 2));
    }
    ctx.stroke();

    // orange center line
    ctx.strokeStyle = AMI_ORG;
    ctx.beginPath();
    ctx.moveTo(a.x, mid + 0.5);
    ctx.lineTo(a.x + a.w, mid + 0.5);
    ctx.stroke();

    // loop flags
    if (this.loop.enabled && this.sample) {
      const xs = this.sampToX(this.loop.start);
      const xe = this.sampToX(this.loop.end);
      ctx.fillStyle = AMI_ORG;
      ctx.fillRect(xs, a.y, 2, a.h);
      ctx.fillRect(xs + 2, a.y + a.h - 14, 12, 12); // start flag (bottom)
      ctx.fillRect(xe - 2, a.y, 2, a.h);
      ctx.fillRect(xe - 14, a.y, 12, 12); // end flag (top)
    }

    // playhead
    if (this.playhead >= 0 && this.sample) {
      const px = this.sampToX(this.playhead);
      ctx.strokeStyle = AMI_WHT;
      ctx.beginPath();
      ctx.moveTo(px, a.y);
      ctx.lineTo(px, a.y + a.h);
      ctx.stroke();
    } else if (!this.sample) {
      text(ctx, "DROP A WAV / IFF / BRR FILE", a.x + 16, mid - 8, 16, AMI_WHT, "left");
    }

    // scroll/zoom bar (full view)
    const sb: Rect = { x: a.x, y: r.y + r.h - SCROLL_H, w: a.w, h: SCROLL_H };
    ctx.fillStyle = AMI_WHT;
    ctx.fillRect(sb.x, sb.y, sb.w, sb.h);
    bevel(ctx, sb, AMI_BLD, AMI_BLL, 1);
  }

  hit(x: number, y: number): boolean {
    return inRect(this.rect, x, y) && y < this.rect.y + this.rect.h - SCROLL_H;
  }

  onDown(x: number, y: number): void {
    if (!this.sample) return;
    const a = this.waveArea();
    if (y < a.y || y > a.y + a.h) return;
    if (this.loop.enabled) {
      const xs = this.sampToX(this.loop.start);
      const xe = this.sampToX(this.loop.end);
      if (Math.abs(x - xs) <= 6) {
        this.dragging = "start";
        return;
      }
      if (Math.abs(x - xe) <= 6) {
        this.dragging = "end";
        return;
      }
    }
  }

  onDrag(x: number): void {
    if (!this.dragging || !this.sample) return;
    const samp = Math.max(0, Math.min(this.sample.frames, this.xToSamp(x)));
    if (this.dragging === "start") this.loop.start = Math.min(samp, this.loop.end - 1);
    else this.loop.end = Math.max(samp, this.loop.start + 1);
    this.o.onLoopChange(this.loop.start, this.loop.end);
  }

  onUp(): void {
    this.dragging = null;
  }
}
