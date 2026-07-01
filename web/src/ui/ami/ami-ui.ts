import { AmiNode, type SampleData } from '../../audio/ami-node'
import { encodeWav } from '../../audio/wav-encoder'
import { ChanParamId, GlobalParamId, NUM_CHANNELS } from '../../audio/param-ids'
import type { AmiAssets } from './assets'
import { AMI_BLU, AMI_BLL, AMI_BLD, AMI_WHT, AMI_RED, AMI_GRN } from './palette'
import { type Rect, bevel, text, inRect } from './draw'
import { type Widget, Slider, Button, Checkbox, Stepper, ImageButton } from './widgets'
import { WaveformCanvas } from './waveform-canvas'
import { SampleList } from './sample-list'
import { PianoCanvas } from './piano-canvas'
import { SampleBrowser, type SampleBrowserDisk } from './sample-browser'

const W = 1080
const H = 640
const MORE_PANEL: Rect = { x: 340, y: 372, w: 400, h: 172 }
const CP = ChanParamId
const GP = GlobalParamId

const CHAN_DEFAULTS: Record<number, number> = {
  [CP.EIGHT_BIT]: 1,
  [CP.SNH]: 1,
  [CP.LOOP_EN]: 0,
  [CP.LOOP_START]: 0,
  [CP.LOOP_END]: 0,
  [CP.PINGPONG]: 0,
  [CP.ATTACK]: 0.001,
  [CP.DECAY]: 0.1,
  [CP.SUSTAIN]: 1,
  [CP.RELEASE]: 0.05,
  [CP.VOLUME]: 1,
  [CP.PAN]: 128,
  [CP.ROOT_NOTE]: 60,
  [CP.FINETUNE]: 0,
  [CP.MUTE]: 0,
  [CP.SOLO]: 0,
  [CP.PAULA_STEREO]: 0,
  [CP.MIDI_CHAN]: 0,
  [CP.LOW_NOTE]: 0,
  [CP.HIGH_NOTE]: 127,
  [CP.GLIDE]: 1,
  [CP.WIDTH]: 255,
  [CP.VOICE_MODE]: 8,
}
const GLOBAL_DEFAULTS: Record<number, number> = {
  [GP.A500]: 1,
  [GP.LED]: 0,
  [GP.MASTER_VOL]: 1,
  [GP.VIBE_SPEED]: 5,
  [GP.MOD_INTENSITY]: 0,
  [GP.MASTER_PAN]: 128,
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
function noteName(n: number): string {
  return `${NOTE_NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`
}

function rel(rx: number, ry: number, rw: number, rh: number): Rect {
  return {
    x: Math.round(rx * W),
    y: Math.round(ry * H),
    w: Math.round(rw * W),
    h: Math.round(rh * H),
  }
}

export interface AmiUIOpts {
  canvas: HTMLCanvasElement
  assets: AmiAssets
  onLoadClick: () => void
  bundledSamples?: SampleBrowserDisk[]
  onLoadBundled?: (file: string, name: string) => void
}

const BROWSER_PANEL: Rect = { x: 170, y: 56, w: 740, h: 528 }

export class AmiUI {
  private ctx: CanvasRenderingContext2D
  private node: AmiNode | null = null
  private widgets: Widget[] = []
  private overlayWidgets: Widget[] = []
  private moreOpen = false
  private browser: SampleBrowser | null = null
  private browseOpen = false
  private active: Widget | null = null
  private pointers = new Map<number, { x: number; y: number }>()
  private pinchDist: number | null = null

  private chanState: Map<number, number>[] = []
  private globalState = new Map<number, number>()
  private samples: (SampleData | null)[] = Array(NUM_CHANNELS).fill(null)
  private names: string[] = Array(NUM_CHANNELS).fill('')
  private activeCh = 0

  private waveform: WaveformCanvas
  private sampleList: SampleList
  private piano: PianoCanvas

  constructor(private o: AmiUIOpts) {
    const ctx = o.canvas.getContext('2d')
    if (!ctx) throw new Error('no 2d context')
    this.ctx = ctx
    o.canvas.width = W
    o.canvas.height = H

    for (let i = 0; i < NUM_CHANNELS; i++) {
      const m = new Map<number, number>()
      for (const k in CHAN_DEFAULTS) m.set(Number(k), CHAN_DEFAULTS[Number(k)])
      this.chanState.push(m)
    }
    for (const k in GLOBAL_DEFAULTS) this.globalState.set(Number(k), GLOBAL_DEFAULTS[Number(k)])

    this.waveform = new WaveformCanvas({
      rect: { x: 6, y: 32, w: 794, h: 268 },
      onLoopChange: (s, e) => {
        this.setChan(CP.LOOP_START, s)
        this.setChan(CP.LOOP_END, e)
      },
    })
    this.sampleList = new SampleList({
      rect: { x: 806, y: 32, w: 268, h: 268 },
      names: this.names,
      selected: () => this.activeCh,
      onSelect: (ch) => this.selectChannel(ch),
    })
    this.piano = new PianoCanvas({
      rect: rel(0.021, 0.86, 0.838, 0.13),
      blackKey: o.assets.pixelKeyBlack,
      range: () => ({ low: this.getChan(CP.LOW_NOTE), high: this.getChan(CP.HIGH_NOTE) }),
      onNoteOn: (n) => this.node?.noteOn(n, 1, 1),
      onNoteOff: (n) => this.node?.noteOff(n, 1),
    })

    if (o.bundledSamples && o.bundledSamples.length > 0) {
      this.browser = new SampleBrowser({
        rect: BROWSER_PANEL,
        disks: o.bundledSamples,
        onPick: (file, name) => {
          this.o.onLoadBundled?.(file, name)
          this.browseOpen = false
        },
        onFile: () => {
          this.browseOpen = false
          this.o.onLoadClick()
        },
        onClose: () => {
          this.browseOpen = false
        },
      })
    }

    this.buildWidgets()
    this.attachPointer()
    this.loop()
  }

  // ---- param mirror ----
  private setChan(id: number, v: number): void {
    this.chanState[this.activeCh].set(id, v)
    this.node?.setChanParam(this.activeCh, id as ChanParamId, v)
  }
  private getChan(id: number): number {
    return this.chanState[this.activeCh].get(id) ?? 0
  }
  private setGlobal(id: number, v: number): void {
    this.globalState.set(id, v)
    this.node?.setGlobalParam(id as GlobalParamId, v)
  }
  private getGlobal(id: number): number {
    return this.globalState.get(id) ?? 0
  }

  setNode(node: AmiNode): void {
    this.node = node
    for (let ch = 0; ch < NUM_CHANNELS; ch++) {
      for (const [id, v] of this.chanState[ch]) node.setChanParam(ch, id as ChanParamId, v)
      const s = this.samples[ch]
      if (s) node.setSample(ch, s)
    }
    for (const [id, v] of this.globalState) node.setGlobalParam(id as GlobalParamId, v)
    node.setMeterChannel(this.activeCh)
  }

  activeChannel(): number {
    return this.activeCh
  }

  loadSample(ch: number, sample: SampleData, name: string): void {
    this.samples[ch] = sample
    this.names[ch] = name
    const prev = this.activeCh
    this.activeCh = ch
    const hasLoop = sample.loopEnd !== undefined && sample.loopEnd > (sample.loopStart ?? 0)
    this.setChan(CP.LOOP_START, hasLoop ? (sample.loopStart ?? 0) : 0)
    this.setChan(CP.LOOP_END, hasLoop ? sample.loopEnd! : sample.frames)
    this.setChan(CP.LOOP_EN, hasLoop ? 1 : 0)
    this.activeCh = prev
    this.node?.setSample(ch, sample)
    if (ch === this.activeCh) this.refreshWaveform()
    else this.selectChannel(ch)
  }

  private clearActiveChannel(): void {
    const empty: SampleData = {
      left: new Float32Array(0),
      right: null,
      channels: 1,
      sourceRate: 44100,
      frames: 0,
    }
    this.samples[this.activeCh] = null
    this.names[this.activeCh] = ''
    this.node?.setSample(this.activeCh, empty)
    this.refreshWaveform()
  }

  private trimActiveToLoop(): void {
    const ch = this.activeCh
    const s = this.samples[ch]
    if (!s || s.frames <= 0) return
    let start = Math.max(0, Math.min(s.frames, Math.round(this.getChan(CP.LOOP_START))))
    let end = Math.round(this.getChan(CP.LOOP_END))
    if (end <= 0 || end > s.frames) end = s.frames
    if (end - start < 1) return
    const len = end - start
    const trimmed: SampleData = {
      left: s.left.slice(start, end),
      right: s.right ? s.right.slice(start, end) : null,
      channels: s.channels,
      sourceRate: s.sourceRate,
      frames: len,
    }
    this.samples[ch] = trimmed
    this.node?.setSample(ch, trimmed)
    this.setChan(CP.LOOP_START, 0)
    this.setChan(CP.LOOP_END, len)
    this.refreshWaveform()
  }

  private saveActive(): void {
    const s = this.samples[this.activeCh]
    if (!s || s.frames <= 0) return
    const url = URL.createObjectURL(encodeWav(s))
    const a = document.createElement('a')
    a.href = url
    a.download = `${this.names[this.activeCh] || `channel-${this.activeCh + 1}`}.wav`
    a.click()
    URL.revokeObjectURL(url)
  }

  private selectChannel(ch: number): void {
    this.activeCh = ch
    this.node?.setMeterChannel(ch)
    this.refreshWaveform()
  }

  private refreshWaveform(): void {
    const s = this.samples[this.activeCh]
    this.waveform.setSample(s)
    if (s) {
      this.waveform.setLoop(
        this.getChan(CP.LOOP_EN) !== 0,
        this.getChan(CP.LOOP_START),
        this.getChan(CP.LOOP_END) || s.frames,
      )
    }
  }

  setPlayhead(pos: number): void {
    this.waveform.setPlayhead(pos)
  }

  // ---- layout ----
  private buildWidgets(): void {
    const slider = (
      r: Rect,
      label: string,
      id: number,
      min: number,
      max: number,
      scope: 'chan' | 'global',
      integer = false,
      disabled = false,
    ): Slider =>
      new Slider({
        rect: r,
        label,
        min,
        max,
        integer,
        disabled,
        get: () => (scope === 'chan' ? this.getChan(id) : this.getGlobal(id)),
        set: (v) => (scope === 'chan' ? this.setChan(id, v) : this.setGlobal(id, v)),
      })

    const W_ = this.widgets
    const paulaOn = (): boolean => this.getChan(CP.PAULA_STEREO) !== 0
    // channel sliders
    W_.push(slider(rel(0.06, 0.513, 0.15, 0.05), 'Chan\nVolume', CP.VOLUME, 0, 1, 'chan'))
    // pan slider doubles as Paula stereo width when Paula is on (mirrors the original)
    W_.push(
      new Slider({
        rect: rel(0.06, 0.563, 0.15, 0.05),
        label: 'Chan\nPan/Wid',
        min: 0,
        max: 255,
        integer: true,
        get: () => (paulaOn() ? this.getChan(CP.WIDTH) : this.getChan(CP.PAN)),
        set: (v) => (paulaOn() ? this.setChan(CP.WIDTH, v) : this.setChan(CP.PAN, v)),
      }),
    )
    W_.push(slider(rel(0.3, 0.513, 0.15, 0.05), 'Attack', CP.ATTACK, 0, 2, 'chan'))
    W_.push(slider(rel(0.3, 0.563, 0.15, 0.05), 'Decay', CP.DECAY, 0, 4, 'chan'))
    W_.push(slider(rel(0.3, 0.613, 0.15, 0.05), 'Sustain', CP.SUSTAIN, 0, 1, 'chan'))
    W_.push(slider(rel(0.3, 0.663, 0.15, 0.05), 'Release', CP.RELEASE, 0, 3, 'chan'))
    W_.push(slider(rel(0.52, 0.513, 0.15, 0.05), 'Sample\n& Hold', CP.SNH, 1, 32, 'chan', true))
    W_.push(slider(rel(0.52, 0.563, 0.15, 0.05), 'Glide', CP.GLIDE, 1, 100, 'chan', true))
    W_.push(
      slider(rel(0.72, 0.632, 0.15, 0.05), 'Fine\nTune', CP.FINETUNE, -100, 100, 'chan', true),
    )
    // master / vibe
    W_.push(slider(rel(0.24, 0.735, 0.21, 0.05), 'Master\nVolume', GP.MASTER_VOL, 0, 1, 'global'))
    W_.push(
      slider(
        rel(0.24, 0.785, 0.21, 0.05),
        'Master\nPanning',
        GP.MASTER_PAN,
        0,
        255,
        'global',
        true,
      ),
    )
    W_.push(
      slider(rel(0.51, 0.735, 0.19, 0.05), 'Vibe\nSpeed', GP.VIBE_SPEED, 1, 10, 'global', true),
    )
    W_.push(
      slider(
        rel(0.51, 0.785, 0.19, 0.05),
        'Vibe\nAmount',
        GP.MOD_INTENSITY,
        0,
        127,
        'global',
        true,
      ),
    )

    // buttons / toggles
    W_.push(
      new Button({
        rect: rel(0.008, 0.617, 0.075, 0.051),
        label: 'PAULA',
        active: () => this.getChan(CP.PAULA_STEREO) !== 0,
        onClick: () => this.setChan(CP.PAULA_STEREO, this.getChan(CP.PAULA_STEREO) ? 0 : 1),
      }),
    )
    W_.push(
      new Button({
        rect: rel(0.008, 0.665, 0.075, 0.051),
        label: 'LOOP',
        active: () => this.getChan(CP.LOOP_EN) !== 0,
        onClick: () => {
          this.setChan(CP.LOOP_EN, this.getChan(CP.LOOP_EN) ? 0 : 1)
          this.refreshWaveform()
        },
      }),
    )
    const chk = (r: Rect, label: string, id: number, disabled = false): Checkbox =>
      new Checkbox({
        rect: r,
        boxSize: 16,
        label,
        disabled,
        get: () => this.getChan(id) !== 0,
        set: (v) => this.setChan(id, v ? 1 : 0),
      })
    W_.push(chk(rel(0.165, 0.625, 0.07, 0.035), 'Mute', CP.MUTE))
    W_.push(chk(rel(0.165, 0.67, 0.07, 0.035), 'Solo', CP.SOLO))
    // voice mode radio: Mono(1) / PT Poly(4) / Octa Poly(8) -> CP_VOICE_MODE
    const voiceMode = (rect: Rect, label: string, count: number): Checkbox =>
      new Checkbox({
        rect,
        boxSize: 14,
        label,
        get: () => this.getChan(CP.VOICE_MODE) === count,
        set: () => this.setChan(CP.VOICE_MODE, count),
      })
    W_.push(voiceMode(rel(0.085, 0.61, 0.07, 0.035), 'Mono', 1))
    W_.push(voiceMode(rel(0.085, 0.645, 0.08, 0.035), 'PT Poly', 4))
    W_.push(voiceMode(rel(0.085, 0.68, 0.09, 0.035), 'Octa Poly', 8))

    // MIDI steppers
    W_.push(
      new Stepper({
        rect: rel(0.515, 0.63, 0.035, 0.05),
        min: 0,
        max: 16,
        get: () => this.getChan(CP.MIDI_CHAN),
        set: (v) => this.setChan(CP.MIDI_CHAN, v),
        format: (v) => (v === 0 ? 'ALL' : String(v)),
      }),
    )
    W_.push(
      new Stepper({
        rect: rel(0.555, 0.63, 0.035, 0.05),
        min: 24,
        max: 96,
        get: () => this.getChan(CP.ROOT_NOTE),
        set: (v) => this.setChan(CP.ROOT_NOTE, v),
        format: noteName,
      }),
    )
    W_.push(
      new Stepper({
        rect: rel(0.595, 0.63, 0.035, 0.05),
        min: 0,
        max: 127,
        get: () => this.getChan(CP.LOW_NOTE),
        set: (v) => this.setChan(CP.LOW_NOTE, v),
        format: noteName,
      }),
    )
    W_.push(
      new Stepper({
        rect: rel(0.635, 0.63, 0.035, 0.05),
        min: 0,
        max: 127,
        get: () => this.getChan(CP.HIGH_NOTE),
        set: (v) => this.setChan(CP.HIGH_NOTE, v),
        format: noteName,
      }),
    )

    // filter toggles (global)
    W_.push(
      new Checkbox({
        rect: rel(0.775, 0.73, 0.06, 0.05),
        boxSize: 16,
        label: 'A500',
        get: () => this.getGlobal(GP.A500) !== 0,
        set: (v) => this.setGlobal(GP.A500, v ? 1 : 0),
      }),
    )
    W_.push(
      new Checkbox({
        rect: rel(0.83, 0.73, 0.06, 0.05),
        boxSize: 16,
        label: 'LED',
        get: () => this.getGlobal(GP.LED) !== 0,
        set: (v) => this.setGlobal(GP.LED, v ? 1 : 0),
      }),
    )

    // load / save / more / trash
    W_.push(
      new Button({
        rect: rel(0.89, 0.737, 0.1, 0.051),
        label: 'LOAD',
        onClick: () => {
          if (this.browser) this.browseOpen = true
          else this.o.onLoadClick()
        },
      }),
    )
    W_.push(
      new Button({
        rect: rel(0.89, 0.785, 0.1, 0.051),
        label: 'SAVE',
        onClick: () => this.saveActive(),
      }),
    )
    W_.push(
      new Button({
        rect: rel(0.72, 0.785, 0.15, 0.051),
        label: 'MORE',
        onClick: () => {
          this.moreOpen = true
        },
      }),
    )
    W_.push(
      new ImageButton({
        rect: rel(0.9, 0.85, 0.05, 0.095),
        up: this.o.assets.trashOff,
        down: this.o.assets.trashOn,
        onClick: () => this.clearActiveChannel(),
      }),
    )

    W_.push(this.waveform, this.sampleList, this.piano)

    // MORE settings overlay (engine params not on the main panel)
    const p = MORE_PANEL
    this.overlayWidgets.push(
      chk({ x: p.x + 30, y: p.y + 46, w: 200, h: 24 }, '8-bit', CP.EIGHT_BIT),
    )
    this.overlayWidgets.push(
      chk({ x: p.x + 30, y: p.y + 78, w: 200, h: 24 }, 'Ping-pong loop', CP.PINGPONG),
    )
    this.overlayWidgets.push(
      new Button({
        rect: { x: p.x + 30, y: p.y + 110, w: 160, h: 28 },
        label: 'TRIM TO LOOP',
        onClick: () => {
          this.trimActiveToLoop()
          this.moreOpen = false
        },
      }),
    )
    this.overlayWidgets.push(
      new Button({
        rect: { x: p.x + p.w - 110, y: p.y + p.h - 44, w: 90, h: 30 },
        label: 'CLOSE',
        onClick: () => {
          this.moreOpen = false
        },
      }),
    )
  }

  // ---- pointer ----
  private toLogical(e: MouseEvent): { x: number; y: number } {
    const r = this.o.canvas.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H }
  }
  private attachPointer(): void {
    this.o.canvas.addEventListener('pointerdown', (e) => {
      const { x, y } = this.toLogical(e)
      this.pointers.set(e.pointerId, { x, y })
      // two fingers on the waveform → pinch-zoom; ignore a 2nd finger elsewhere
      if (this.pointers.size === 2) {
        if (!this.browseOpen && !this.moreOpen) {
          const pts = [...this.pointers.values()]
          if (pts.every((p) => this.waveform.hit(p.x, p.y))) {
            this.active = null
            this.pinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
          }
        }
        return
      }
      // modal: sample browser overlay routes only to itself; click outside closes
      if (this.browseOpen && this.browser) {
        if (this.browser.hit(x, y)) {
          this.active = this.browser
          this.browser.onDown?.(x, y)
        } else {
          this.browseOpen = false
        }
        return
      }
      // modal: when the MORE overlay is open, route only to it; click outside closes
      if (this.moreOpen) {
        for (let i = this.overlayWidgets.length - 1; i >= 0; i--) {
          const w = this.overlayWidgets[i]
          if (w.hit(x, y)) {
            this.active = w
            w.onDown?.(x, y)
            return
          }
        }
        if (!inRect(MORE_PANEL, x, y)) this.moreOpen = false
        return
      }
      for (let i = this.widgets.length - 1; i >= 0; i--) {
        const w = this.widgets[i]
        if (w.hit(x, y)) {
          this.active = w
          w.onDown?.(x, y)
          break
        }
      }
    })
    window.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId)
      if (!p) return
      const { x, y } = this.toLogical(e)
      p.x = x
      p.y = y
      if (this.pinchDist !== null && this.pointers.size >= 2) {
        const pts = [...this.pointers.values()]
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
        const cx = (pts[0].x + pts[1].x) / 2
        if (dist > 0) this.waveform.zoomAt(cx, this.pinchDist / dist)
        this.pinchDist = dist
        return
      }
      this.active?.onDrag?.(x, y)
    })
    const endPointer = (e: PointerEvent): void => {
      this.pointers.delete(e.pointerId)
      if (this.pointers.size < 2) this.pinchDist = null
      if (this.pointers.size === 0) {
        this.active?.onUp?.()
        this.active = null
      }
    }
    window.addEventListener('pointerup', endPointer)
    window.addEventListener('pointercancel', endPointer)
    this.o.canvas.addEventListener(
      'wheel',
      (e) => {
        const { x, y } = this.toLogical(e)
        if (this.browseOpen && this.browser) {
          if (this.browser.hit(x, y)) {
            this.browser.onWheel?.(x, y, e.deltaY)
            e.preventDefault()
          }
          return
        }
        for (let i = this.widgets.length - 1; i >= 0; i--) {
          const w = this.widgets[i]
          if (w.onWheel && w.hit(x, y)) {
            w.onWheel(x, y, e.deltaY)
            e.preventDefault()
            break
          }
        }
      },
      { passive: false },
    )
  }

  // ---- render ----
  private loop = (): void => {
    this.draw()
    requestAnimationFrame(this.loop)
  }

  private draw(): void {
    const ctx = this.ctx
    ctx.imageSmoothingEnabled = false
    ctx.fillStyle = AMI_BLU
    ctx.fillRect(0, 0, W, H)

    // window chrome — title then double-line bar to its right
    text(ctx, 'AMI SAMPLER 1.3', 12, 6, 18, AMI_WHT, 'left')
    ctx.fillStyle = AMI_WHT
    ctx.fillRect(212, 6, W - 324, 4)
    ctx.fillRect(212, 16, W - 324, 4)

    // dividers
    ctx.fillStyle = AMI_BLD
    ctx.fillRect(0, Math.round(0.5 * H) + 2, W, 2)
    ctx.fillStyle = AMI_BLL
    ctx.fillRect(0, Math.round(0.72 * H), W, 2)

    // panel backgrounds for the two lower sections (subtle bevels)
    bevel(ctx, { x: 4, y: 4, w: W - 8, h: H - 8 }, AMI_BLL, AMI_BLD, 3)

    // ASTRIID logo
    const lg: Rect = rel(0.69, 0.515, 0.3, 0.085)
    ctx.drawImage(this.o.assets.astriid, lg.x, lg.y, lg.w, lg.h)

    // meters
    const lvl = this.node ? 1 : 0
    void lvl
    const redM = rel(0.905, 0.63, 0.07, 0.022)
    const grnM = rel(0.905, 0.665, 0.07, 0.022)
    ctx.fillStyle = AMI_RED
    ctx.fillRect(redM.x, redM.y, redM.w, redM.h)
    ctx.fillStyle = AMI_GRN
    ctx.fillRect(grnM.x, grnM.y, grnM.w, grnM.h)

    // MIDI / filter section labels
    text(ctx, 'MIDI', rel(0.46, 0.63, 0, 0).x, rel(0, 0.645, 0, 0).y, 16, AMI_WHT, 'left')
    text(ctx, 'Chan', rel(0.515, 0.685, 0, 0).x + 14, rel(0, 0.685, 0, 0).y, 12, AMI_WHT, 'center')
    text(ctx, 'Base', rel(0.555, 0.685, 0, 0).x + 14, rel(0, 0.685, 0, 0).y, 12, AMI_WHT, 'center')
    text(ctx, 'Low', rel(0.595, 0.685, 0, 0).x + 14, rel(0, 0.685, 0, 0).y, 12, AMI_WHT, 'center')
    text(ctx, 'High', rel(0.635, 0.685, 0, 0).x + 14, rel(0, 0.685, 0, 0).y, 12, AMI_WHT, 'center')
    text(ctx, 'Filter', rel(0.72, 0.73, 0, 0).x, rel(0, 0.74, 0, 0).y, 15, AMI_WHT, 'left')

    // LOOP readouts
    const s = this.samples[this.activeCh]
    const hex = (n: number): string => (n >>> 0).toString(16).toUpperCase().padStart(8, '0')
    const ls = this.getChan(CP.LOOP_START)
    const le = this.getChan(CP.LOOP_END) || (s ? s.frames : 0)
    text(ctx, `LOOP START:${hex(ls)}`, 12, rel(0, 0.735, 0, 0).y, 14, AMI_WHT, 'left')
    text(ctx, `LOOP END  :${hex(le)}`, 12, rel(0, 0.765, 0, 0).y, 14, AMI_WHT, 'left')
    text(
      ctx,
      `LOOP LEN  :${hex(Math.max(0, le - ls))}`,
      12,
      rel(0, 0.795, 0, 0).y,
      14,
      AMI_WHT,
      'left',
    )

    for (const w of this.widgets) w.draw(ctx)

    if (this.moreOpen) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)'
      ctx.fillRect(0, 0, W, H)
      const p = MORE_PANEL
      ctx.fillStyle = AMI_BLU
      ctx.fillRect(p.x, p.y, p.w, p.h)
      bevel(ctx, p, AMI_BLL, AMI_BLD, 3)
      text(ctx, 'MORE SETTINGS', p.x + p.w / 2, p.y + 14, 18, AMI_WHT, 'center')
      for (const w of this.overlayWidgets) w.draw(ctx)
    }

    if (this.browseOpen && this.browser) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)'
      ctx.fillRect(0, 0, W, H)
      this.browser.draw(ctx)
    }
  }
}
