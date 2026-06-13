import type { SampleData } from "../ami-node";

// µ-law parser — port of astro_MuLawFormat.cpp.
// Headerless: one µ-law byte per sample. The original uses an exponential
// expansion (non-standard G.711) — replicated 1:1. Fixed 22050 Hz, mono.

const SAMPLE_RATE = 22050;
const INT8_MAX = 127;

export function parseMuLaw(bytes: ArrayBuffer): SampleData {
  const u8 = new Uint8Array(bytes);
  const frames = u8.length;
  const left = new Float32Array(frames);

  for (let i = 0; i < frames; i++) {
    const inSample = u8[i];
    let t = inSample & 0x80 ? 1.0 : -1.0;
    t *= Math.pow(256, (inSample & INT8_MAX) / INT8_MAX) - 1;
    t /= 255;
    left[i] = Math.round(t * 32767) / 32768;
  }

  return { left, right: null, channels: 1, sourceRate: SAMPLE_RATE, frames };
}
