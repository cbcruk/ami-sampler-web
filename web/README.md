# Ami Sampler — Web Port (WASM + AudioWorklet)

Browser port of the Ami Sampler. The Amiga/Paula DSP is compiled from C++ to
standalone WebAssembly and runs inside an `AudioWorklet`; the UI is rewritten in
plain TypeScript + Canvas (WAM-style split: **DSP in WASM, UI in web tech**).

## Architecture

```
engine/ami-engine.cpp        JUCE-free DSP (ported from Source/AmiSamplerSound.cpp
                             + RCFilters.cpp + PluginProcessor processBlock)
        │  emcc -sSTANDALONE_WASM  (zero imports, ~20 KB)
        ▼
web/public/wasm/ami-engine.wasm
        │  fetched on main thread, bytes handed to the worklet via processorOptions
        ▼
web/public/ami-processor.js   AudioWorkletProcessor: instantiates the wasm,
                              writes sample data into wasm memory, calls ami_process()
        ▲  postMessage (setSample / setParam / noteOn / noteOff)
        │
web/src/audio/ami-node.ts     main-thread controller (AudioWorkletNode wrapper)
web/src/audio/wav-loader.ts   decodeAudioData -> deinterleaved channels
web/src/ui/keyboard.ts        computer-keyboard -> MIDI notes
web/src/ui/waveform.ts        Canvas waveform + loop region + playhead
web/src/main.ts               wiring + control panel
```

The C ABI between JS and WASM is a flat set of `extern "C"` functions
(`ami_init`, `ami_set_sample`, `ami_set_param`, `ami_note_on`, `ami_process`, …).
Parameter ids live in `engine/ami-engine.cpp` (enum `ParamId`) and are mirrored in
`web/src/audio/param-ids.ts` and `web/public/ami-processor.js` — keep the three in sync.

## DSP ported in this PoC

8-bit signed quantization · sample-and-hold decimation · nearest-neighbor pitch ·
linear ADSR · forward / ping-pong looping · channel volume/pan · finetune ·
Amiga A500 (RC LP+HP) / A1200 (RC HP) filters · 2-pole LED filter · master volume.

## Build & run

```bash
# 1. one-time: install the Emscripten SDK (already cloned under ../web-build/emsdk)
#    (../engine/build.sh sources it automatically)

# 2. build the wasm engine
cd web && pnpm build:wasm      # -> public/wasm/ami-engine.wasm

# 3. run the dev server
pnpm install
pnpm dev                       # http://localhost:5173
```

Click once to unlock audio, drop a WAV/AIFF onto the waveform (or use the file
picker), then play with the computer keyboard (`Z S X D C …` lower row,
`Q 2 W …` upper octave).

## Not yet ported (next milestones)

- 12 sampler channels (mute/solo/Paula stereo per channel)
- IFF / BRR / µ-law custom format parsers (currently relies on the browser's
  `decodeAudioData`; the `Source/astro_formats` parsers can be compiled to wasm)
- Web MIDI input
- Full pixel-art UI (knobs, virtual keyboard, the AmiWindow editor)
- State save/load
