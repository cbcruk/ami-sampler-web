import {
  AMI_BLL,
  AMI_BLD,
  AMI_BLK,
  AMI_GRY,
  AMI_RED,
  AMI_WHT,
  AMI_ORG,
  CHECKER_LIGHT,
  CHECKER_DARK,
  FONT_FAMILY,
} from './palette'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export function inRect(r: Rect, px: number, py: number): boolean {
  return px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h
}

export function text(
  ctx: CanvasRenderingContext2D,
  str: string,
  x: number,
  y: number,
  size: number,
  color: string,
  align: CanvasTextAlign = 'left',
): void {
  ctx.font = `${size}px ${FONT_FAMILY}`
  ctx.textAlign = align
  ctx.textBaseline = 'top'
  ctx.fillStyle = color
  ctx.fillText(str, Math.round(x), Math.round(y))
}

// Amiga 3D bevel: light top/left, dark bottom/right.
export function bevel(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  light: string,
  dark: string,
  w = 2,
): void {
  ctx.fillStyle = light
  ctx.fillRect(r.x, r.y, r.w, w) // top
  ctx.fillRect(r.x, r.y, w, r.h) // left
  ctx.fillStyle = dark
  ctx.fillRect(r.x, r.y + r.h - w, r.w, w) // bottom
  ctx.fillRect(r.x + r.w - w, r.y, w, r.h) // right
}

export function panel(ctx: CanvasRenderingContext2D, r: Rect, fill: string): void {
  ctx.fillStyle = fill
  ctx.fillRect(r.x, r.y, r.w, r.h)
  bevel(ctx, r, AMI_BLL, AMI_BLD, 2)
}

export function button(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  label: string,
  opts: { active?: boolean; disabled?: boolean } = {},
): void {
  const face = opts.active ? AMI_RED : AMI_GRY
  ctx.fillStyle = opts.disabled ? '#5a5a5a' : face
  ctx.fillRect(r.x, r.y, r.w, r.h)
  bevel(ctx, r, AMI_WHT, AMI_BLK, 2)
  const txtColor = opts.active ? AMI_WHT : AMI_BLK
  text(
    ctx,
    label,
    r.x + r.w / 2,
    r.y + r.h / 2 - r.h * 0.32,
    Math.round(r.h * 0.55),
    txtColor,
    'center',
  )
}

// crosshatch slider track (8x8 checker) with bevel; returns nothing
export function checkerTrack(ctx: CanvasRenderingContext2D, r: Rect): void {
  const cell = 8
  for (let yy = 0; yy < r.h; yy += cell) {
    for (let xx = 0; xx < r.w; xx += cell) {
      const dark = (xx / cell + yy / cell) % 2 === 0
      ctx.fillStyle = dark ? CHECKER_DARK : CHECKER_LIGHT
      const cw = Math.min(cell, r.w - xx)
      const ch = Math.min(cell, r.h - yy)
      ctx.fillRect(r.x + xx, r.y + yy, cw, ch)
    }
  }
  bevel(ctx, r, AMI_BLD, AMI_BLL, 1)
}

// horizontal slider: track + thumb at normalized t (0..1)
export function hSlider(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  t: number,
  dragging: boolean,
  disabled = false,
): void {
  checkerTrack(ctx, r)
  if (disabled) {
    ctx.fillStyle = 'rgba(40,40,40,0.5)'
    ctx.fillRect(r.x, r.y, r.w, r.h)
  }
  const thumbW = 10
  const clamped = Math.max(0, Math.min(1, t))
  const tx = r.x + 2 + clamped * (r.w - 4 - thumbW)
  ctx.fillStyle = dragging ? AMI_ORG : AMI_WHT
  ctx.fillRect(Math.round(tx), r.y + 1, thumbW, r.h - 2)
  bevel(ctx, { x: Math.round(tx), y: r.y + 1, w: thumbW, h: r.h - 2 }, AMI_WHT, AMI_BLD, 1)
}

export function checkbox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  checked: boolean,
): void {
  const r = { x, y, w: size, h: size }
  ctx.fillStyle = AMI_BLK
  ctx.fillRect(r.x, r.y, r.w, r.h)
  bevel(ctx, r, AMI_BLD, AMI_BLL, 1)
  if (checked) {
    ctx.fillStyle = AMI_ORG
    ctx.fillRect(r.x + 3, r.y + 3, r.w - 6, r.h - 6)
  }
}
