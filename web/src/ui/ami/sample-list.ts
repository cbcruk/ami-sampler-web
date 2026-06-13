import { NUM_CHANNELS } from "../../audio/param-ids";
import { AMI_BLK, AMI_YLW, AMI_GRY } from "./palette";
import { type Rect, inRect, bevel, text } from "./draw";
import type { Widget } from "./widgets";

interface SampleListOpts {
  rect: Rect;
  names: string[]; // length NUM_CHANNELS, "" if empty
  selected: () => number;
  onSelect: (ch: number) => void;
}

export class SampleList implements Widget {
  rect: Rect;
  private rowH: number;
  constructor(private o: SampleListOpts) {
    this.rect = o.rect;
    this.rowH = o.rect.h / NUM_CHANNELS;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const r = this.rect;
    ctx.fillStyle = AMI_BLK;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    const sel = this.o.selected();
    const size = Math.min(18, Math.round(this.rowH * 0.7));
    for (let i = 0; i < NUM_CHANNELS; i++) {
      const ry = r.y + i * this.rowH;
      if (i === sel) {
        ctx.fillStyle = AMI_YLW;
        ctx.fillRect(r.x, ry, r.w, this.rowH);
      }
      const label = `${String(i + 1).padStart(2, "0")}.${this.o.names[i] ?? ""}`;
      text(ctx, label, r.x + 6, ry + this.rowH / 2 - size / 2, size, i === sel ? AMI_BLK : AMI_YLW, "left");
      ctx.fillStyle = AMI_GRY;
      ctx.fillRect(r.x, ry + this.rowH - 1, r.w, 1);
    }
    bevel(ctx, r, AMI_GRY, "#5e5e5e", 2);
  }

  hit(x: number, y: number): boolean {
    return inRect(this.rect, x, y);
  }

  onDown(_x: number, y: number): void {
    const i = Math.floor((y - this.rect.y) / this.rowH);
    if (i >= 0 && i < NUM_CHANNELS) this.o.onSelect(i);
  }
}
