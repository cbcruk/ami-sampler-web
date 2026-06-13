import type { SampleData } from "./ami-node";

// Encode deinterleaved float samples into a 16-bit PCM WAV blob.
export function encodeWav(s: SampleData): Blob {
  const channels = s.right ? 2 : 1;
  const frames = s.frames;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataLen = frames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataLen);
  const dv = new DataView(buffer);

  const writeStr = (off: number, str: string): void => {
    for (let i = 0; i < str.length; i++) dv.setUint8(off + i, str.charCodeAt(i));
  };
  const clamp = (v: number): number => {
    const x = Math.max(-1, Math.min(1, v));
    return x < 0 ? x * 0x8000 : x * 0x7fff;
  };

  writeStr(0, "RIFF");
  dv.setUint32(4, 36 + dataLen, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  dv.setUint32(16, 16, true); // fmt chunk size
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, channels, true);
  dv.setUint32(24, s.sourceRate, true);
  dv.setUint32(28, s.sourceRate * blockAlign, true);
  dv.setUint16(32, blockAlign, true);
  dv.setUint16(34, 16, true); // bits per sample
  writeStr(36, "data");
  dv.setUint32(40, dataLen, true);

  let off = 44;
  const L = s.left;
  const R = s.right;
  for (let i = 0; i < frames; i++) {
    dv.setInt16(off, clamp(L[i] ?? 0), true);
    off += 2;
    if (R) {
      dv.setInt16(off, clamp(R[i] ?? 0), true);
      off += 2;
    }
  }

  return new Blob([buffer], { type: "audio/wav" });
}
