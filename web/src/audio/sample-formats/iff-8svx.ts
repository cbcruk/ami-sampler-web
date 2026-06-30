import type { SampleData } from '../ami-node'

// IFF / 8SVX (Amiga) parser — port of astro_IffAudioFormat.cpp.
// Big-endian chunked format: FORM <size> 8SVX { VHDR, BODY, ... }.
// BODY is raw signed 8-bit PCM (no Fibonacci-delta decode in the original).

const DEFAULT_RATE = 8363

function fourcc(u8: Uint8Array, pos: number): string {
  return String.fromCharCode(u8[pos], u8[pos + 1], u8[pos + 2], u8[pos + 3])
}

export function isIff8svx(u8: Uint8Array): boolean {
  return u8.length >= 12 && fourcc(u8, 0) === 'FORM' && fourcc(u8, 8) === '8SVX'
}

export function parseIff8svx(bytes: ArrayBuffer): SampleData {
  const dv = new DataView(bytes)
  const u8 = new Uint8Array(bytes)
  const end = bytes.byteLength

  let sampleRate = DEFAULT_RATE
  let bodyStart = -1
  let bodyLen = 0
  let loopStart = 0
  let loopLen = 0

  let pos = 12 // skip FORM(4) + size(4) + 8SVX(4)
  while (pos + 8 <= end) {
    const id = fourcc(u8, pos)
    const len = dv.getUint32(pos + 4, false)
    const dataStart = pos + 8
    if (id === 'VHDR') {
      loopStart = dv.getUint32(dataStart, false)
      loopLen = dv.getUint32(dataStart + 4, false)
      sampleRate = dv.getUint16(dataStart + 12, false) || DEFAULT_RATE
    } else if (id === 'BODY') {
      bodyStart = dataStart
      bodyLen = len
    }
    pos = dataStart + len + (len & 1) // chunks pad to even length
  }

  if (bodyStart < 0) {
    return {
      left: new Float32Array(0),
      right: null,
      channels: 1,
      sourceRate: sampleRate,
      frames: 0,
    }
  }

  const frames = Math.min(bodyLen, end - bodyStart)
  const left = new Float32Array(frames)
  for (let i = 0; i < frames; i++) left[i] = dv.getInt8(bodyStart + i) / 128

  const result: SampleData = { left, right: null, channels: 1, sourceRate: sampleRate, frames }
  if (loopLen > 0) {
    result.loopStart = loopStart
    result.loopEnd = loopStart + loopLen - 1
  }
  return result
}
