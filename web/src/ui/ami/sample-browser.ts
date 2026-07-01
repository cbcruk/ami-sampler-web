import { AMI_BLU, AMI_BLL, AMI_BLD, AMI_WHT, AMI_YLW, AMI_BLK, AMI_GRY } from './palette'
import { type Rect, bevel, text, button, inRect } from './draw'
import type { Widget } from './widgets'

export interface SampleBrowserDisk {
  disk: string
  items: { name: string; file: string }[]
}

interface SampleBrowserOpts {
  rect: Rect
  disks: SampleBrowserDisk[]
  onPick: (file: string, name: string) => void
  onFile: () => void
  onClose: () => void
}

const ROW_H = 22
const TAB_H = 28
const FOOTER_H = 44

// Pixel-art overlay listing the bundled Amiga sample disks. Disk tabs + a
// scrollable list; picking a row loads it into the active channel.
export class SampleBrowser implements Widget {
  rect: Rect
  private activeDisk = 0
  private scroll = 0
  private pickedFile: string | null = null
  private draggingThumb = false
  private dragOffset = 0

  constructor(private o: SampleBrowserOpts) {
    this.rect = o.rect
  }

  private items(): { name: string; file: string }[] {
    return this.o.disks[this.activeDisk]?.items ?? []
  }

  private layout(): { p: Rect; list: Rect; scrollbar: Rect; footer: Rect } {
    const p = this.rect
    const listTop = p.y + 40 + TAB_H + 8
    const footer: Rect = { x: p.x, y: p.y + p.h - FOOTER_H, w: p.w, h: FOOTER_H }
    const listH = footer.y - 8 - listTop
    const scrollbar: Rect = { x: p.x + p.w - 20 - 16, y: listTop, w: 16, h: listH }
    const list: Rect = { x: p.x + 20, y: listTop, w: scrollbar.x - (p.x + 20) - 8, h: listH }
    return { p, list, scrollbar, footer }
  }

  private tabRects(): Rect[] {
    const p = this.rect
    const n = this.o.disks.length
    if (n === 0) return []
    const gap = 6
    const tw = Math.min(170, Math.floor((p.w - 40 - gap * (n - 1)) / n))
    return this.o.disks.map((_, i) => ({ x: p.x + 20 + i * (tw + gap), y: p.y + 40, w: tw, h: TAB_H }))
  }

  private fileBtn(footer: Rect): Rect {
    return { x: footer.x + 20, y: footer.y + 7, w: 150, h: 30 }
  }
  private closeBtn(footer: Rect): Rect {
    return { x: footer.x + footer.w - 20 - 100, y: footer.y + 7, w: 100, h: 30 }
  }

  private visibleRows(listH: number): number {
    return Math.max(1, Math.floor(listH / ROW_H))
  }
  private maxScroll(listH: number): number {
    return Math.max(0, this.items().length - this.visibleRows(listH))
  }
  private clampScroll(listH: number): void {
    this.scroll = Math.max(0, Math.min(this.maxScroll(listH), this.scroll))
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const { p, list, scrollbar, footer } = this.layout()
    ctx.fillStyle = AMI_BLU
    ctx.fillRect(p.x, p.y, p.w, p.h)
    bevel(ctx, p, AMI_BLL, AMI_BLD, 3)
    text(ctx, 'LOAD SAMPLE', p.x + p.w / 2, p.y + 12, 18, AMI_WHT, 'center')

    const tabs = this.tabRects()
    tabs.forEach((t, i) => button(ctx, t, this.o.disks[i].disk, { active: i === this.activeDisk }))

    ctx.fillStyle = AMI_BLK
    ctx.fillRect(list.x, list.y, list.w, list.h)
    bevel(ctx, list, AMI_BLD, AMI_BLL, 1)

    const items = this.items()
    if (items.length === 0) {
      text(ctx, 'no bundled samples', list.x + 8, list.y + 8, 14, AMI_GRY, 'left')
    } else {
      this.clampScroll(list.h)
      const rows = this.visibleRows(list.h)
      const maxChars = Math.max(4, Math.floor((list.w - 12) / 8))
      ctx.save()
      ctx.beginPath()
      ctx.rect(list.x, list.y, list.w, list.h)
      ctx.clip()
      for (let i = 0; i < rows; i++) {
        const idx = this.scroll + i
        if (idx >= items.length) break
        const it = items[idx]
        const ry = list.y + 2 + i * ROW_H
        const picked = it.file === this.pickedFile
        if (picked) {
          ctx.fillStyle = AMI_BLD
          ctx.fillRect(list.x + 1, ry, list.w - 2, ROW_H)
        }
        const label = it.name.length > maxChars ? `${it.name.slice(0, maxChars - 1)}…` : it.name
        text(ctx, label, list.x + 8, ry + 4, 14, picked ? AMI_YLW : AMI_WHT, 'left')
      }
      ctx.restore()
      this.drawScrollbar(ctx, scrollbar, items.length, rows)
    }

    button(ctx, this.fileBtn(footer), 'FILE…')
    button(ctx, this.closeBtn(footer), 'CLOSE')
  }

  private drawScrollbar(ctx: CanvasRenderingContext2D, sb: Rect, count: number, rows: number): void {
    ctx.fillStyle = AMI_BLK
    ctx.fillRect(sb.x, sb.y, sb.w, sb.h)
    bevel(ctx, sb, AMI_BLD, AMI_BLL, 1)
    const max = Math.max(0, count - rows)
    const thumbH = max <= 0 ? sb.h : Math.max(24, Math.round((sb.h * rows) / count))
    const ty = max <= 0 ? sb.y : sb.y + Math.round((this.scroll / max) * (sb.h - thumbH))
    ctx.fillStyle = AMI_GRY
    ctx.fillRect(sb.x + 2, ty + 2, sb.w - 4, thumbH - 4)
    bevel(ctx, { x: sb.x + 2, y: ty + 2, w: sb.w - 4, h: thumbH - 4 }, AMI_WHT, AMI_BLD, 1)
  }

  hit(x: number, y: number): boolean {
    return inRect(this.rect, x, y)
  }

  onDown(x: number, y: number): void {
    const { list, scrollbar, footer } = this.layout()
    const tabs = this.tabRects()
    for (let i = 0; i < tabs.length; i++) {
      if (inRect(tabs[i], x, y)) {
        this.activeDisk = i
        this.scroll = 0
        return
      }
    }
    if (inRect(this.fileBtn(footer), x, y)) return this.o.onFile()
    if (inRect(this.closeBtn(footer), x, y)) return this.o.onClose()
    if (inRect(scrollbar, x, y)) return this.scrollbarDown(y, scrollbar, list.h)
    if (inRect(list, x, y)) {
      const i = Math.floor((y - list.y - 2) / ROW_H)
      const idx = this.scroll + i
      const items = this.items()
      if (i >= 0 && i < this.visibleRows(list.h) && idx < items.length) {
        this.pickedFile = items[idx].file
        this.o.onPick(items[idx].file, items[idx].name)
      }
    }
  }

  private scrollbarDown(y: number, sb: Rect, listH: number): void {
    const count = this.items().length
    const rows = this.visibleRows(listH)
    const max = Math.max(0, count - rows)
    if (max <= 0) return
    const thumbH = Math.max(24, Math.round((sb.h * rows) / count))
    const ty = sb.y + Math.round((this.scroll / max) * (sb.h - thumbH))
    if (y >= ty && y < ty + thumbH) {
      this.draggingThumb = true
      this.dragOffset = y - ty
    } else {
      this.scroll += y < ty ? -rows : rows
      this.clampScroll(listH)
    }
  }

  onDrag(_x: number, y: number): void {
    if (!this.draggingThumb) return
    const { list, scrollbar } = this.layout()
    const rows = this.visibleRows(list.h)
    const max = Math.max(0, this.items().length - rows)
    if (max <= 0) return
    const thumbH = Math.max(24, Math.round((scrollbar.h * rows) / this.items().length))
    const t = (y - this.dragOffset - scrollbar.y) / (scrollbar.h - thumbH)
    this.scroll = Math.round(Math.max(0, Math.min(1, t)) * max)
  }

  onUp(): void {
    this.draggingThumb = false
  }

  onWheel(_x: number, _y: number, deltaY: number): void {
    const { list } = this.layout()
    this.scroll += deltaY > 0 ? 3 : -3
    this.clampScroll(list.h)
  }
}
