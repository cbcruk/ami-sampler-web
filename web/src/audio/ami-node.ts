import { ChanParamId, GlobalParamId } from "./param-ids";

export interface SampleData {
  left: Float32Array;
  right: Float32Array | null;
  channels: number;
  sourceRate: number;
  frames: number;
}

export interface MeterState {
  playhead: number;
  voices: number;
}

export class AmiNode {
  readonly ctx: AudioContext;
  private node: AudioWorkletNode | null = null;
  private onMeter?: (m: MeterState) => void;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
  }

  async init(wasmUrl = "/wasm/ami-engine.wasm", processorUrl = "/ami-processor.js"): Promise<void> {
    const wasmBytes = await (await fetch(wasmUrl)).arrayBuffer();
    await this.ctx.audioWorklet.addModule(processorUrl);

    this.node = new AudioWorkletNode(this.ctx, "ami-processor", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { wasmBytes },
    });

    const ready = new Promise<void>((resolve, reject) => {
      this.node!.port.onmessage = (e) => {
        const m = e.data;
        if (m.type === "ready") resolve();
        else if (m.type === "error") reject(new Error(m.message));
        else if (m.type === "meter") this.onMeter?.({ playhead: m.playhead, voices: m.voices });
      };
    });

    this.node.connect(this.ctx.destination);
    await ready;
  }

  get workletNode(): AudioWorkletNode {
    if (!this.node) throw new Error("node not initialized");
    return this.node;
  }

  setMeterCallback(cb: (m: MeterState) => void): void {
    this.onMeter = cb;
  }

  // The worklet reports playhead for whichever channel the UI is viewing.
  setMeterChannel(channel: number): void {
    this.node!.port.postMessage({ type: "meterChannel", channel });
  }

  setSample(channel: number, s: SampleData): void {
    const left = s.left;
    const right = s.right ?? new Float32Array(0);
    this.node!.port.postMessage(
      { type: "setSample", channel, left, right, channels: s.channels, sourceRate: s.sourceRate },
      [left.buffer, ...(s.right ? [right.buffer] : [])],
    );
  }

  setChanParam(channel: number, id: ChanParamId, value: number): void {
    this.node!.port.postMessage({ type: "setChanParam", channel, id, value });
  }

  setGlobalParam(id: GlobalParamId, value: number): void {
    this.node!.port.postMessage({ type: "setGlobalParam", id, value });
  }

  noteOn(note: number, midiChannel = 1, velocity = 1): void {
    this.node!.port.postMessage({ type: "noteOn", note, midiChannel, velocity });
  }

  noteOff(note: number, midiChannel = 1): void {
    this.node!.port.postMessage({ type: "noteOff", note, midiChannel });
  }

  allNotesOff(): void {
    this.node!.port.postMessage({ type: "allNotesOff" });
  }
}
