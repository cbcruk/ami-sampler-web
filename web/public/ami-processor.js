// AudioWorklet processor for the Ami Sampler WASM DSP engine.
// Plain JS, no imports — loaded via audioWorklet.addModule('/ami-processor.js').
// The compiled standalone WASM has zero imports, so it instantiates directly
// from bytes passed in processorOptions.

const NUM_CHANNELS = 12;

class AmiProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.ready = false;
    this.ex = null;
    this.meterChannel = 0; // which channel's playhead the UI is viewing

    const { wasmBytes } = options.processorOptions;

    this.port.onmessage = (e) => this.onMessage(e.data);

    WebAssembly.instantiate(wasmBytes, {})
      .then(({ instance }) => {
        this.ex = instance.exports;
        if (this.ex._initialize) this.ex._initialize();
        this.ex.ami_init(sampleRate);

        // per-channel views over fixed wasm memory (no growth -> stable buffers)
        const mem = this.ex.memory.buffer;
        this.sampleCap = this.ex.ami_sample_capacity();
        this.sampleL = [];
        this.sampleR = [];
        for (let ch = 0; ch < NUM_CHANNELS; ch++) {
          this.sampleL[ch] = new Float32Array(mem, this.ex.ami_sample_l(ch), this.sampleCap);
          this.sampleR[ch] = new Float32Array(mem, this.ex.ami_sample_r(ch), this.sampleCap);
        }

        this.ready = true;
        this.port.postMessage({ type: "ready" });
      })
      .catch((err) => this.port.postMessage({ type: "error", message: String(err) }));
  }

  onMessage(msg) {
    if (!this.ready) {
      // queue critical state until ready
      if (msg.type === "setSample" || msg.type === "setChanParam" || msg.type === "setGlobalParam") {
        (this.pending ||= []).push(msg);
      } else if (msg.type === "meterChannel") {
        this.meterChannel = msg.channel;
      }
      return;
    }
    this.handle(msg);
  }

  handle(msg) {
    switch (msg.type) {
      case "setSample": {
        const { channel, left, right, channels, sourceRate } = msg;
        const n = Math.min(left.length, this.sampleCap);
        this.sampleL[channel].set(left.subarray(0, n));
        if (channels > 1 && right && right.length) this.sampleR[channel].set(right.subarray(0, n));
        this.ex.ami_set_sample(channel, n, channels, sourceRate);
        break;
      }
      case "setChanParam":
        this.ex.ami_set_chan_param(msg.channel, msg.id, msg.value);
        break;
      case "setGlobalParam":
        this.ex.ami_set_global_param(msg.id, msg.value);
        break;
      case "meterChannel":
        this.meterChannel = msg.channel;
        break;
      case "noteOn":
        this.ex.ami_note_on(msg.note, msg.midiChannel, msg.velocity);
        break;
      case "noteOff":
        this.ex.ami_note_off(msg.note, msg.midiChannel);
        break;
      case "allNotesOff":
        this.ex.ami_all_notes_off();
        break;
    }
  }

  process(_inputs, outputs) {
    if (!this.ready) return true;

    if (this.pending) {
      for (const m of this.pending) this.handle(m);
      this.pending = null;
    }

    const out = outputs[0];
    const frames = out[0].length;

    this.ex.ami_process(frames);

    const mem = this.ex.memory.buffer;
    const l = new Float32Array(mem, this.ex.ami_out_l(), frames);
    const r = new Float32Array(mem, this.ex.ami_out_r(), frames);

    out[0].set(l);
    if (out.length > 1) out[1].set(r);

    // report playhead occasionally for UI (for the viewed channel)
    if ((this.tick = (this.tick || 0) + 1) % 8 === 0) {
      this.port.postMessage({
        type: "meter",
        playhead: this.ex.ami_playhead(this.meterChannel),
        voices: this.ex.ami_active_voices(),
      });
    }

    return true;
  }
}

registerProcessor("ami-processor", AmiProcessor);
