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
const MIN_THUMB = 14;

export class WaveformCanvas implements Widget {
  rect: Rect;
  private sample: SampleData | null = null;
  private peaks: Peak[] = [];
  private playhead = -1;
  private loop = { enabled: false, start: 0, end: 0 };
  private dragging: "start" | "end" | "scroll" | null = null;
  private scrollGrabDx = 0;
  // visible window over the sample, in frames
  private viewStart = 0;
  private viewLen = 0;

  constructor(private o: WaveOpts) {
    this.rect = o.rect;
  }

  private waveArea(): Rect {
    const r = this.rect;
    return { x: r.x + FE_W, y: r.y, w: r.w - FE_W, h: r.h - SCROLL_H };
  }

  private frames(): number {
    return this.sample ? this.sample.frames : 0;
  }

  setSample(s: SampleData | null): void {
    this.sample = s;
    this.playhead = -1;
    this.loop = { enabled: false, start: 0, end: s ? s.frames : 0 };
    this.viewStart = 0;
    this.viewLen = s ? s.frames : 0;
    this.computePeaks();
  }

  setLoop(enabled: boolean, start: number, end: number): void {
    this.loop = { enabled, start, end };
  }

  setPlayhead(pos: number): void {
    this.playhead = pos;
  }

  private clampView(): void {
    const total = this.frames();
    if (total <= 0) {
      this.viewStart = 0;
      this.viewLen = 0;
      return;
    }
    const minLen = Math.min(total, 32);
    this.viewLen = Math.max(minLen, Math.min(total, this.viewLen));
    this.viewStart = Math.max(0, Math.min(total - this.viewLen, this.viewStart));
  }

  private computePeaks(): void {
    this.peaks = [];
    if (!this.sample || this.viewLen <= 0) return;
    const w = Math.floor(this.waveArea().w);
    const data = this.sample.left;
    const perCol = this.viewLen / w;
    if (perCol < 1) return; // line mode (drawn directly), no envelope peaks
    for (let x = 0; x < w; x++) {
      let min = 1;
      let max = -1;
      const s = Math.floor(this.viewStart + x * perCol);
      const e = Math.min(data.length, Math.floor(this.viewStart + (x + 1) * perCol));
      for (let i = s; i < e; i++) {
        const v = data[i];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      if (min > max) { min = 0; max = 0; }
      this.peaks.push({ min, max });
    }
  }

  private sampToX(samp: number): number {
    const a = this.waveArea();
    return a.x + ((samp - this.viewStart) / (this.viewLen || 1)) * a.w;
  }

  private xToSamp(x: number): number {
    const a = this.waveArea();
    return Math.round(this.viewStart + ((x - a.x) / a.w) * (this.viewLen || 1));
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const r = this.rect;
    const a = this.waveArea();
    const mid = a.y + a.h / 2;

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

    const clipX = (x: number): number => Math.max(a.x, Math.min(a.x + a.w, x));

    // loop region
    if (this.loop.enabled && this.sample) {
      const x0 = clipX(this.sampToX(this.loop.start));
      const x1 = clipX(this.sampToX(this.loop.end));
      ctx.fillStyle = "rgba(252,138,0,0.18)";
      ctx.fillRect(x0, a.y, x1 - x0, a.h);
    }

    // waveform: envelope when zoomed out, connected line when zoomed in
    if (this.sample && this.viewLen > 0) {
      ctx.strokeStyle = AMI_WHT;
      ctx.beginPath();
      if (this.peaks.length > 0) {
        for (let x = 0; x < this.peaks.length; x++) {
          const p = this.peaks[x];
          ctx.moveTo(a.x + x + 0.5, mid - p.max * (a.h / 2));
          ctx.lineTo(a.x + x + 0.5, mid - p.min * (a.h / 2));
        }
      } else {
        const data = this.sample.left;
        const i0 = Math.max(0, Math.floor(this.viewStart));
        const i1 = Math.min(data.length - 1, Math.ceil(this.viewStart + this.viewLen));
        for (let i = i0; i <= i1; i++) {
          const x = this.sampToX(i);
          const y = mid - data[i] * (a.h / 2);
          if (i === i0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }

    // orange center line
    ctx.strokeStyle = AMI_ORG;
    ctx.beginPath();
    ctx.moveTo(a.x, mid + 0.5);
    ctx.lineTo(a.x + a.w, mid + 0.5);
    ctx.stroke();

    // loop flags (only when within the visible window)
    if (this.loop.enabled && this.sample) {
      const xs = this.sampToX(this.loop.start);
      const xe = this.sampToX(this.loop.end);
      ctx.fillStyle = AMI_ORG;
      if (xs >= a.x && xs <= a.x + a.w) {
        ctx.fillRect(xs, a.y, 2, a.h);
        ctx.fillRect(xs + 2, a.y + a.h - 14, 12, 12);
      }
      if (xe >= a.x && xe <= a.x + a.w) {
        ctx.fillRect(xe - 2, a.y, 2, a.h);
        ctx.fillRect(xe - 14, a.y, 12, 12);
      }
    }

    // playhead
    if (this.playhead >= 0 && this.sample) {
      const px = this.sampToX(this.playhead);
      if (px >= a.x && px <= a.x + a.w) {
        ctx.strokeStyle = AMI_WHT;
        ctx.beginPath();
        ctx.moveTo(px, a.y);
        ctx.lineTo(px, a.y + a.h);
        ctx.stroke();
      }
    } else if (!this.sample) {
      text(ctx, "DROP A WAV / IFF / BRR FILE", a.x + 16, mid - 8, 16, AMI_WHT, "left");
    }

    // scroll/zoom bar with a thumb sized to the view window
    const sb: Rect = { x: a.x, y: r.y + r.h - SCROLL_H, w: a.w, h: SCROLL_H };
    ctx.fillStyle = AMI_BLK;
    ctx.fillRect(sb.x, sb.y, sb.w, sb.h);
    const thumb = this.thumbRect();
    ctx.fillStyle = this.dragging === "scroll" ? AMI_ORG : AMI_WHT;
    ctx.fillRect(thumb.x, thumb.y, thumb.w, thumb.h);
    bevel(ctx, thumb, AMI_BLL, AMI_BLD, 1);
  }

  private thumbRect(): Rect {
    const a = this.waveArea();
    const sbY = this.rect.y + this.rect.h - SCROLL_H;
    const total = this.frames();
    if (total <= 0) return { x: a.x, y: sbY, w: a.w, h: SCROLL_H };
    const w = Math.max(MIN_THUMB, (this.viewLen / total) * a.w);
    const x = a.x + (this.viewStart / total) * a.w;
    return { x, y: sbY, w: Math.min(w, a.w), h: SCROLL_H };
  }

  hit(x: number, y: number): boolean {
    return inRect(this.rect, x, y);
  }

  onDown(x: number, y: number): void {
    if (!this.sample) return;
    const sbY = this.rect.y + this.rect.h - SCROLL_H;
    if (y >= sbY) {
      const thumb = this.thumbRect();
      if (x >= thumb.x && x <= thumb.x + thumb.w) {
        this.dragging = "scroll";
        this.scrollGrabDx = x - thumb.x;
      } else {
        // page: center the view on the clicked position
        const a = this.waveArea();
        const center = ((x - a.x) / a.w) * this.frames();
        this.viewStart = center - this.viewLen / 2;
        this.clampView();
        this.computePeaks();
      }
      return;
    }
    const a = this.waveArea();
    if (y < a.y || y > a.y + a.h) return;
    if (this.loop.enabled) {
      const xs = this.sampToX(this.loop.start);
      const xe = this.sampToX(this.loop.end);
      if (Math.abs(x - xs) <= 6) { this.dragging = "start"; return; }
      if (Math.abs(x - xe) <= 6) { this.dragging = "end"; return; }
    }
  }

  onDrag(x: number): void {
    if (!this.sample) return;
    if (this.dragging === "scroll") {
      const a = this.waveArea();
      this.viewStart = (((x - this.scrollGrabDx) - a.x) / a.w) * this.frames();
      this.clampView();
      this.computePeaks();
      return;
    }
    if (!this.dragging) return;
    const samp = Math.max(0, Math.min(this.sample.frames, this.xToSamp(x)));
    if (this.dragging === "start") this.loop.start = Math.min(samp, this.loop.end - 1);
    else this.loop.end = Math.max(samp, this.loop.start + 1);
    this.o.onLoopChange(this.loop.start, this.loop.end);
  }

  onUp(): void {
    this.dragging = null;
  }

  onWheel(x: number, _y: number, deltaY: number): void {
    if (!this.sample) return;
    const a = this.waveArea();
    const frac = Math.max(0, Math.min(1, (x - a.x) / a.w));
    const anchor = this.viewStart + frac * this.viewLen; // frame under cursor
    const factor = deltaY < 0 ? 0.8 : 1.25; // wheel up = zoom in
    this.viewLen *= factor;
    this.clampView();
    this.viewStart = anchor - frac * this.viewLen;
    this.clampView();
    this.computePeaks();
  }
}
