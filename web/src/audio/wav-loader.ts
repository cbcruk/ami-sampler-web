import type { SampleData } from "./ami-node";

// Decode an arbitrary audio file (WAV/AIFF/etc.) into deinterleaved channels.
// Uses the browser's decodeAudioData so we get broad format support for free;
// custom IFF/BRR parsers can be added later as a fallback path.
export async function decodeAudioFile(file: File, ctx: BaseAudioContext): Promise<SampleData> {
  const bytes = await file.arrayBuffer();
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
