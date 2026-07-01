import { AmiNode } from './audio/ami-node'
import { GlobalParamId } from './audio/param-ids'
import { decodeAudioFile, decodeAudioBytes } from './audio/wav-loader'
import { MidiInput } from './audio/midi-input'
import { ComputerKeyboard } from './ui/keyboard'
import { loadAssets } from './ui/ami/assets'
import { AmiUI } from './ui/ami/ami-ui'
import type { SampleBrowserDisk } from './ui/ami/sample-browser'

const LOGICAL_W = 1080
const LOGICAL_H = 640
const KEYBOARD_MIDI_CHANNEL = 1
const BASE = import.meta.env.BASE_URL // "/" locally, "/<repo>/" on GitHub Pages

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel)
  if (!el) throw new Error(`missing element: ${sel}`)
  return el
}

let ami: AmiNode | null = null
let ui: AmiUI

const keyboard = new ComputerKeyboard(
  (note) => ami?.noteOn(note, KEYBOARD_MIDI_CHANNEL, 1),
  (note) => ami?.noteOff(note, KEYBOARD_MIDI_CHANNEL),
)

const midi = new MidiInput(
  {
    onNoteOn: (note, channel, velocity) => ami?.noteOn(note, channel, velocity / 127),
    onNoteOff: (note, channel) => ami?.noteOff(note, channel),
    onPitchBend: (channel, value14) => ami?.pitchBend(channel, value14),
    onModWheel: (value) => ami?.setGlobalParam(GlobalParamId.MOD_INTENSITY, value),
  },
  (devices) => {
    const el = document.querySelector('#status')
    if (el && ami)
      el.textContent = devices.length ? `MIDI: ${devices.join(', ')}` : 'ready — no MIDI devices'
  },
)

async function ensureAudio(): Promise<AmiNode> {
  if (ami) return ami
  const ctx = new AudioContext()
  await ctx.resume()
  ami = new AmiNode(ctx)
  await ami.init(`${BASE}wasm/ami-engine.wasm`, `${BASE}ami-processor.js`)
  ami.setMeterCallback((m) => ui.setPlayhead(m.playhead))
  ui.setNode(ami)
  $('#status').textContent = `engine ready @ ${ctx.sampleRate} Hz`
  ;(window as unknown as Record<string, unknown>).__ami = {
    node: ami,
    ctx,
    ui,
    activeChannel: () => ui.activeChannel(),
  }
  return ami
}

async function loadFile(file: File): Promise<void> {
  const node = await ensureAudio()
  const sample = await decodeAudioFile(file, node.ctx)
  ui.loadSample(ui.activeChannel(), sample, file.name.replace(/\.[^.]+$/, '').slice(0, 16))
}

async function loadBundled(file: string, name: string): Promise<void> {
  const node = await ensureAudio()
  const res = await fetch(`${BASE}samples/${file}`)
  const sample = await decodeAudioBytes(await res.arrayBuffer(), file, node.ctx)
  ui.loadSample(ui.activeChannel(), sample, name.slice(0, 16))
}

async function loadSampleManifest(): Promise<SampleBrowserDisk[]> {
  try {
    const res = await fetch(`${BASE}samples/index.json`)
    if (res.ok) return (await res.json()) as SampleBrowserDisk[]
  } catch {
    // no bundled samples — the LOAD button falls back to the file picker
  }
  return []
}

function fitCanvas(canvas: HTMLCanvasElement): void {
  const margin = 24
  const scale = Math.max(
    1,
    Math.floor(
      Math.min((window.innerWidth - margin) / LOGICAL_W, (window.innerHeight - margin) / LOGICAL_H),
    ),
  )
  canvas.style.width = `${LOGICAL_W * scale}px`
  canvas.style.height = `${LOGICAL_H * scale}px`
}

async function main(): Promise<void> {
  const canvas = $<HTMLCanvasElement>('#ami')
  const fileInput = $<HTMLInputElement>('#file-input')

  const [assets, bundledSamples] = await Promise.all([loadAssets(`${BASE}res`), loadSampleManifest()])
  ui = new AmiUI({
    canvas,
    assets,
    onLoadClick: () => fileInput.click(),
    bundledSamples,
    onLoadBundled: (file, name) => void loadBundled(file, name),
  })

  fitCanvas(canvas)
  window.addEventListener('resize', () => fitCanvas(canvas))

  keyboard.attach()
  void midi.start()

  // computer-keyboard octave shift (− / =), restoring the old octave selector
  const showOctave = (): void => {
    $('#status').textContent = `octave ${keyboard.getBaseOctave()}  (− / = to shift)`
  }
  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (e.code === 'Minus' || e.code === 'NumpadSubtract') {
      keyboard.setBaseOctave(keyboard.getBaseOctave() - 1)
      showOctave()
      e.preventDefault()
    } else if (e.code === 'Equal' || e.code === 'NumpadAdd') {
      keyboard.setBaseOctave(keyboard.getBaseOctave() + 1)
      showOctave()
      e.preventDefault()
    }
  })

  fileInput.addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (file) await loadFile(file)
    fileInput.value = ''
  })

  const prevent = (e: Event) => {
    e.preventDefault()
    e.stopPropagation()
  }
  ;['dragenter', 'dragover', 'dragleave', 'drop'].forEach((ev) =>
    canvas.addEventListener(ev, prevent),
  )
  canvas.addEventListener('dragover', () => canvas.classList.add('drag'))
  canvas.addEventListener('dragleave', () => canvas.classList.remove('drag'))
  canvas.addEventListener('drop', async (e) => {
    canvas.classList.remove('drag')
    const file = (e as DragEvent).dataTransfer?.files?.[0]
    if (file) await loadFile(file)
  })

  document.body.addEventListener('pointerdown', () => void ensureAudio(), { once: true })
}

void main()
