import { AMI_WHT, AMI_BLD, AMI_BLL } from './palette'
import {
  type Rect,
  inRect,
  hSlider,
  button as drawButton,
  checkbox as drawCheckbox,
  text,
  bevel,
} from './draw'

export interface Widget {
  rect: Rect
  draw(ctx: CanvasRenderingContext2D): void
  hit(x: number, y: number): boolean
  onDown?(x: number, y: number): void
  onDrag?(x: number, y: number): void
  onUp?(): void
  onWheel?(x: number, y: number, deltaY: number): void
}

interface SliderOpts {
  rect: Rect
  label: string
  min: number
  max: number
  get: () => number
  set: (v: number) => void
  disabled?: boolean
  integer?: boolean
}

export class Slider implements Widget {
  rect: Rect
  private dragging = false
  constructor(private o: SliderOpts) {
    this.rect = o.rect
  }
  private norm(): number {
    return (this.o.get() - this.o.min) / (this.o.max - this.o.min)
  }
  draw(ctx: CanvasRenderingContext2D): void {
    const r = this.rect
    const lines = this.o.label.split('\n')
    const ls = 13
    const ly = r.y + r.h / 2 - (lines.length * ls) / 2
    lines.forEach((l, i) => text(ctx, l, r.x - 8, ly + i * ls, ls, AMI_WHT, 'right'))
    hSlider(ctx, r, this.norm(), this.dragging, this.o.disabled)
  }
  hit(x: number, y: number): boolean {
    return !this.o.disabled && inRect(this.rect, x, y)
  }
  private apply(x: number): void {
    const t = Math.max(0, Math.min(1, (x - this.rect.x - 2) / (this.rect.w - 4 - 10)))
    let v = this.o.min + t * (this.o.max - this.o.min)
    if (this.o.integer) v = Math.round(v)
    this.o.set(v)
  }
  onDown(x: number): void {
    this.dragging = true
    this.apply(x)
  }
  onDrag(x: number): void {
    if (this.dragging) this.apply(x)
  }
  onUp(): void {
    this.dragging = false
  }
}

interface ButtonOpts {
  rect: Rect
  label: string
  onClick: () => void
  active?: () => boolean
  disabled?: boolean
}

export class Button implements Widget {
  rect: Rect
  constructor(private o: ButtonOpts) {
    this.rect = o.rect
  }
  draw(ctx: CanvasRenderingContext2D): void {
    drawButton(ctx, this.rect, this.o.label, {
      active: this.o.active?.() ?? false,
      disabled: this.o.disabled,
    })
  }
  hit(x: number, y: number): boolean {
    return !this.o.disabled && inRect(this.rect, x, y)
  }
  onDown(): void {
    this.o.onClick()
  }
}

interface ImageButtonOpts {
  rect: Rect
  up: HTMLImageElement
  down: HTMLImageElement
  onClick: () => void
}

export class ImageButton implements Widget {
  rect: Rect
  private pressed = false
  constructor(private o: ImageButtonOpts) {
    this.rect = o.rect
  }
  draw(ctx: CanvasRenderingContext2D): void {
    const r = this.rect
    ctx.drawImage(this.pressed ? this.o.down : this.o.up, r.x, r.y, r.w, r.h)
  }
  hit(x: number, y: number): boolean {
    return inRect(this.rect, x, y)
  }
  onDown(): void {
    this.pressed = true
    this.o.onClick()
  }
  onUp(): void {
    this.pressed = false
  }
}

interface CheckOpts {
  rect: Rect // hit area including label
  boxSize: number
  label: string
  get: () => boolean
  set: (v: boolean) => void
  disabled?: boolean
}

export class Checkbox implements Widget {
  rect: Rect
  constructor(private o: CheckOpts) {
    this.rect = o.rect
  }
  draw(ctx: CanvasRenderingContext2D): void {
    const r = this.rect
    const s = this.o.boxSize
    const by = r.y + (r.h - s) / 2
    drawCheckbox(ctx, r.x, by, s, this.o.get())
    text(
      ctx,
      this.o.label,
      r.x + s + 6,
      r.y + r.h / 2 - 7,
      14,
      this.o.disabled ? '#7a7a90' : AMI_WHT,
      'left',
    )
  }
  hit(x: number, y: number): boolean {
    return !this.o.disabled && inRect(this.rect, x, y)
  }
  onDown(): void {
    this.o.set(!this.o.get())
  }
}

interface StepperOpts {
  rect: Rect
  min: number
  max: number
  get: () => number
  set: (v: number) => void
  format: (v: number) => string
}

// compact numeric field — vertical drag changes the value
export class Stepper implements Widget {
  rect: Rect
  private dragging = false
  private lastY = 0
  private acc = 0
  constructor(private o: StepperOpts) {
    this.rect = o.rect
  }
  draw(ctx: CanvasRenderingContext2D): void {
    const r = this.rect
    ctx.fillStyle = '#0a1c40'
    ctx.fillRect(r.x, r.y, r.w, r.h)
    bevel(ctx, r, AMI_BLD, AMI_BLL, 1)
    text(ctx, this.o.format(this.o.get()), r.x + r.w / 2, r.y + r.h / 2 - 8, 15, AMI_WHT, 'center')
  }
  hit(x: number, y: number): boolean {
    return inRect(this.rect, x, y)
  }
  onDown(_x: number, y: number): void {
    this.dragging = true
    this.lastY = y
    this.acc = 0
  }
  onDrag(_x: number, y: number): void {
    if (!this.dragging) return
    this.acc += this.lastY - y
    this.lastY = y
    while (Math.abs(this.acc) >= 4) {
      const dir = this.acc > 0 ? 1 : -1
      this.acc -= dir * 4
      const v = Math.max(this.o.min, Math.min(this.o.max, this.o.get() + dir))
      this.o.set(v)
    }
  }
  onUp(): void {
    this.dragging = false
  }
}
