// Web MIDI input: parse incoming messages and dispatch to handler callbacks.
// The byte parser is a pure function so it can be unit-tested in isolation.

export type MidiEvent =
  | { type: 'noteOn'; note: number; channel: number; velocity: number }
  | { type: 'noteOff'; note: number; channel: number }
  | { type: 'pitchBend'; channel: number; value: number }
  | { type: 'modWheel'; value: number }

export function parseMidiMessage(data: Uint8Array | number[]): MidiEvent | null {
  if (data.length < 1) return null
  const status = data[0] & 0xf0
  const channel = (data[0] & 0x0f) + 1

  switch (status) {
    case 0x90: // note on (velocity 0 == note off)
      if (data.length < 3) return null
      return data[2] > 0
        ? { type: 'noteOn', note: data[1], channel, velocity: data[2] }
        : { type: 'noteOff', note: data[1], channel }
    case 0x80: // note off
      if (data.length < 2) return null
      return { type: 'noteOff', note: data[1], channel }
    case 0xe0: // pitch bend
      if (data.length < 3) return null
      return { type: 'pitchBend', channel, value: (data[2] << 7) | data[1] }
    case 0xb0: // control change — only CC#1 (mod wheel)
      if (data.length < 3 || data[1] !== 1) return null
      return { type: 'modWheel', value: data[2] }
    default:
      return null
  }
}

export interface MidiHandlers {
  onNoteOn: (note: number, channel: number, velocity: number) => void
  onNoteOff: (note: number, channel: number) => void
  onPitchBend: (channel: number, value14: number) => void
  onModWheel: (value: number) => void
}

export class MidiInput {
  private access: MIDIAccess | null = null

  constructor(
    private handlers: MidiHandlers,
    private onStatus?: (devices: string[]) => void,
  ) {}

  isSupported(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function'
  }

  async start(): Promise<boolean> {
    if (!this.isSupported()) {
      this.onStatus?.([])
      return false
    }
    try {
      this.access = await navigator.requestMIDIAccess()
    } catch {
      this.onStatus?.([])
      return false
    }
    this.bindInputs()
    this.access.onstatechange = () => this.bindInputs()
    return true
  }

  private bindInputs(): void {
    if (!this.access) return
    const names: string[] = []
    this.access.inputs.forEach((input) => {
      names.push(input.name ?? 'MIDI input')
      input.onmidimessage = (e) => {
        if (e.data) this.dispatch(e.data)
      }
    })
    this.onStatus?.(names)
  }

  private dispatch(data: Uint8Array): void {
    const ev = parseMidiMessage(data)
    if (!ev) return
    switch (ev.type) {
      case 'noteOn':
        this.handlers.onNoteOn(ev.note, ev.channel, ev.velocity)
        break
      case 'noteOff':
        this.handlers.onNoteOff(ev.note, ev.channel)
        break
      case 'pitchBend':
        this.handlers.onPitchBend(ev.channel, ev.value)
        break
      case 'modWheel':
        this.handlers.onModWheel(ev.value)
        break
    }
  }
}
