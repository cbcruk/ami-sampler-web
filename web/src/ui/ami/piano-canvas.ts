import { AMI_WHT, AMI_BLK } from './palette'
import { type Rect, inRect, text } from './draw'
import type { Widget } from './widgets'

const LOW = 36 // 0x24
const HIGH = 108 // 0x6C
const WHITE_SET = new Set([0, 2, 4, 5, 7, 9, 11])

interface PianoOpts {
  rect: Rect
  blackKey: HTMLImageElement
  range: () => { low: number; high: number }
  onNoteOn: (note: number) => void
  onNoteOff: (note: number) => void
}

function isWhite(note: number): boolean {
  return WHITE_SET.has(((note % 12) + 12) % 12)
}

export class PianoCanvas implements Widget {
  rect: Rect
  private whiteCount: number
  private whiteW: number
  private pressed: number | null = null

  constructor(private o: PianoOpts) {
    this.rect = o.rect
    this.whiteCount = 0
    for (let n = LOW; n <= HIGH; n++) if (isWhite(n)) this.whiteCount++
    this.whiteW = o.rect.w / this.whiteCount
  }

  private whiteX(note: number): number {
    let idx = 0
    for (let n = LOW; n < note; n++) if (isWhite(n)) idx++
    return this.rect.x + idx * this.whiteW
  }

  private blackRect(note: number): Rect {
    const bw = this.whiteW * 0.62
    const x = this.whiteX(note) - bw / 2
    return { x, y: this.rect.y, w: bw, h: this.rect.h * 0.62 }
  }

  private hex(n: number): string {
    return n.toString(16).toUpperCase().padStart(2, '0')
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const r = this.rect
    const lbl = 11
    // white keys
    for (let n = LOW; n <= HIGH; n++) {
      if (!isWhite(n)) continue
      const x = this.whiteX(n)
      ctx.fillStyle = AMI_WHT
      ctx.fillRect(x, r.y, this.whiteW - 1, r.h)
      ctx.strokeStyle = AMI_BLK
      ctx.strokeRect(x + 0.5, r.y + 0.5, this.whiteW - 1, r.h - 1)
      text(ctx, this.hex(n), x + this.whiteW / 2 - 0.5, r.y + r.h - 16, lbl, AMI_BLK, 'center')
    }
    // black keys (sprite) on top
    for (let n = LOW; n <= HIGH; n++) {
      if (isWhite(n)) continue
      const b = this.blackRect(n)
      ctx.drawImage(this.o.blackKey, b.x, b.y, b.w, b.h)
      text(ctx, this.hex(n), b.x + b.w / 2, b.y + b.h - 14, lbl, AMI_WHT, 'center')
    }
    // playable-range overlay (notes outside low..high darkened)
    const { low, high } = this.o.range()
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    for (let n = LOW; n <= HIGH; n++) {
      if (n >= low && n <= high) continue
      if (isWhite(n)) {
        const x = this.whiteX(n)
        ctx.fillRect(x, r.y, this.whiteW - 1, r.h)
      } else {
        const b = this.blackRect(n)
        ctx.fillRect(b.x, b.y, b.w, b.h)
      }
    }
    // pressed-key highlight
    if (this.pressed !== null) {
      ctx.fillStyle = 'rgba(252,138,0,0.55)'
      if (isWhite(this.pressed)) {
        const x = this.whiteX(this.pressed)
        ctx.fillRect(x, r.y, this.whiteW - 1, r.h)
      } else {
        const b = this.blackRect(this.pressed)
        ctx.fillRect(b.x, b.y, b.w, b.h)
      }
    }
  }

  private noteAt(x: number, y: number): number | null {
    // black keys take priority (upper portion)
    for (let n = LOW; n <= HIGH; n++) {
      if (isWhite(n)) continue
      if (inRect(this.blackRect(n), x, y)) return n
    }
    for (let n = LOW; n <= HIGH; n++) {
      if (!isWhite(n)) continue
      const wx = this.whiteX(n)
      if (x >= wx && x < wx + this.whiteW && y >= this.rect.y && y < this.rect.y + this.rect.h)
        return n
    }
    return null
  }

  hit(x: number, y: number): boolean {
    return inRect(this.rect, x, y)
  }

  onDown(x: number, y: number): void {
    const n = this.noteAt(x, y)
    if (n === null) return
    this.pressed = n
    this.o.onNoteOn(n)
  }

  // drag across keys: release the old note and trigger the one under the cursor
  onDrag(x: number, y: number): void {
    if (this.pressed === null) return
    const n = this.noteAt(x, y)
    if (n === this.pressed) return
    this.o.onNoteOff(this.pressed)
    if (n === null) {
      this.pressed = null
    } else {
      this.o.onNoteOn(n)
      this.pressed = n
    }
  }

  onUp(): void {
    if (this.pressed !== null) {
      this.o.onNoteOff(this.pressed)
      this.pressed = null
    }
  }
}
