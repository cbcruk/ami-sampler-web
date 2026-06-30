import type { SampleData } from '../ami-node'

// BRR (SNES) parser — port of astro_BrrAudioFormat.cpp.
// 9-byte blocks: 1 header byte (shift/filter/loop/end) + 8 data bytes (16 nibbles).
// Decoded through the S-DSP 16.16 fixed-point filter. Fixed 16744 Hz, no magic
// number (detected by 9-byte block alignment + optional 2-byte loop header).

const SAMPLE_RATE = 16744
const BYTES2SAMPS = Math.floor((16 * 65536) / 9) // (16<<16)/9, integer

function i16(x: number): number {
  const v = x & 0xffff
  return v >= 0x8000 ? v - 0x10000 : v
}

function bytePos2sampPos(n: number): number {
  return Math.floor((n * BYTES2SAMPS + 0x8000) / 65536)
}

// (int16) round(numerator/denominator * in), via 16.16 fixed math, int16-wrapped
function fixedMath(inv: number, numerator: number, denominator: number): number {
  const dived = Math.trunc((inv * (numerator * 65536)) / denominator)
  return i16(Math.floor(dived / 65536))
}

export function isBrrBySize(len: number): boolean {
  return len > 0 && (len % 9 === 0 || (len - 2) % 9 === 0)
}

export function parseBrr(bytes: ArrayBuffer): SampleData {
  const dv = new DataView(bytes)
  const u8 = new Uint8Array(bytes)
  const fileLength = bytes.byteLength

  let dataStart = 0
  let hasLoop = false
  let loopStart = 0
  let loopEnd = 0
  let dataLength = 0

  if (fileLength % 9 === 0) {
    dataStart = 0
    loopStart = bytePos2sampPos(fileLength)
    loopEnd = loopStart
    dataLength = bytePos2sampPos(fileLength)
  } else if ((fileLength - 2) % 9 === 0) {
    dataStart = 2
    hasLoop = true
    loopStart = bytePos2sampPos(dv.getInt16(0, true))
    dataLength = bytePos2sampPos(fileLength - 2)
  }

  const out: number[] = []
  let shifter = 0
  let filterFlag = 0
  let endFlag = false
  let endFlagPos = 0
  const tmp = [0, 0]

  const coeff = (): { a: number; b: number } => {
    switch (filterFlag) {
      case 1:
        return { a: fixedMath(tmp[0], 15, 16), b: 0 }
      case 2:
        return { a: fixedMath(tmp[0], 61, 32), b: fixedMath(tmp[1], 15, 16) }
      case 3:
        return { a: fixedMath(tmp[0], 115, 64), b: fixedMath(tmp[1], 13, 16) }
      default:
        return { a: 0, b: 0 }
    }
  }

  const filter = (shifted: number): number => {
    const { a, b } = coeff()
    const o = i16(shifted + a - b)
    tmp[1] = tmp[0]
    tmp[0] = o
    return o
  }

  for (let i = dataStart; i < fileLength; i++) {
    const inSample = u8[i]
    if ((i - dataStart) % 9 === 0) {
      shifter = (inSample & 0xf0) >> 4
      if (shifter > 12) shifter = 12
      filterFlag = (inSample & 0x0c) >> 2
      if (filterFlag > 3) filterFlag = 3
      const loopFlag = (inSample & 0x02) !== 0
      if (inSample & 0x01) {
        endFlag = true
        endFlagPos = i
        if (loopFlag) {
          hasLoop = true
          loopEnd = bytePos2sampPos(i + 7)
        } else {
          hasLoop = false
          loopStart = 16
          loopEnd = dataLength
        }
      } else {
        endFlag = false
        endFlagPos = fileLength
      }
    } else if (shifter <= 12 && i - dataStart > 0) {
      let hi = (inSample & 0xf0) >> 4
      if (hi > 7) hi -= 16
      out.push(i <= endFlagPos + 8 ? filter(hi << shifter) : 0)

      let lo = inSample & 0x0f
      if (lo > 7) lo -= 16
      out.push(i <= endFlagPos + 8 ? filter(lo << shifter) : 0)
    }
  }

  void endFlag
  const frames = out.length
  const left = new Float32Array(frames)
  for (let i = 0; i < frames; i++) left[i] = out[i] / 32768

  const result: SampleData = { left, right: null, channels: 1, sourceRate: SAMPLE_RATE, frames }
  if (hasLoop && loopEnd > loopStart) {
    result.loopStart = loopStart
    result.loopEnd = loopEnd - 1
  }
  return result
}
