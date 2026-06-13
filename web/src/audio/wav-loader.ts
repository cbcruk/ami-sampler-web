import type { SampleData } from "./ami-node";
import { isIff8svx, parseIff8svx } from "./sample-formats/iff-8svx";
import { isBrrBySize, parseBrr } from "./sample-formats/brr";
import { parseMuLaw } from "./sample-formats/mulaw";

const MULAW_EXTS = new Set(["ul", "ulaw", "mulaw", "mu"]);

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

// Decode an audio file into deinterleaved channels. Amiga/SNES formats with no
// browser support (IFF/8SVX, BRR, µ-law) are parsed in TS; everything else
// (WAV/AIFF/...) falls back to the browser's decodeAudioData.
export async function decodeAudioFile(file: File, ctx: BaseAudioContext): Promise<SampleData> {
  const bytes = await file.arrayBuffer();
  const u8 = new Uint8Array(bytes);
  const ext = extensionOf(file.name);

  if (isIff8svx(u8)) return parseIff8svx(bytes);
  if (ext === "brr") return parseBrr(bytes);
  if (MULAW_EXTS.has(ext)) return parseMuLaw(bytes);
  if (ext === "" && isBrrBySize(bytes.byteLength)) return parseBrr(bytes);

  const buf = await ctx.decodeAudioData(bytes);
  const channels = Math.min(buf.numberOfChannels, 2);
  const left = Float32Array.from(buf.getChannelData(0));
  const right = channels > 1 ? Float32Array.from(buf.getChannelData(1)) : null;

  return {
    left,
    right,
    channels,
    sourceRate: buf.sampleRate,
    frames: buf.length,
  };
}
