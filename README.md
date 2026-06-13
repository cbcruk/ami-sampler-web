# Ami Sampler — Web

Browser port of the [Ami Sampler](https://github.com/astriiddev/Ami-Sampler-VST)
(astriiddev), an Amiga/Paula-inspired 8-bit sampler. The DSP is compiled from C++
to standalone WebAssembly and runs in an `AudioWorklet`; the UI is written in
plain TypeScript + Canvas.

> **WAM-style split:** DSP in WASM, UI in web tech. The C++ engine stays close to
> the original plugin's DSP; everything around it is new web code.

## Layout

```
engine/          C++ DSP engine (JUCE-free) + build.sh -> WASM
web/             Vite + TypeScript app (UI, AudioWorklet glue)
reference/       read-only copy of the original JUCE source (porting reference)
Res/             original pixel-art assets (for the UI)
Samples/         original Amiga sample sets (test material)
web-build/       Emscripten SDK (gitignored local tool)
```

See [web/README.md](web/README.md) for the audio architecture and the C ABI
between JS and WASM, and [CREDITS.md](CREDITS.md) for attribution / license.

## Setup

```bash
# Emscripten SDK — installed locally under web-build/emsdk (engine/build.sh
# sources it automatically). To (re)install:
git clone https://github.com/emscripten-core/emsdk.git web-build/emsdk
cd web-build/emsdk && ./emsdk install latest && ./emsdk activate latest && cd ../..

# Build the WASM engine
cd web && pnpm install
pnpm build:wasm           # -> web/public/wasm/ami-engine.wasm

# Run
pnpm dev                  # http://localhost:5173
```

Click once to unlock audio, drop a WAV/AIFF onto the waveform, then play with the
computer keyboard (`Z S X D C …` lower row, `Q 2 W …` upper octave).

## Status

**Milestone 1 (PoC) — done & browser-verified.** Single sample → 8-bit / S&H /
ADSR / loop / RC+LED filters → polyphonic keyboard playback.

Next: 12 sampler channels (mute/solo/Paula stereo) · IFF/BRR/µ-law parsers to
WASM · Web MIDI · full pixel-art UI.

## License

GPL v3 (derived from the GPL-v3 original). See [LICENSE](LICENSE) and
[CREDITS.md](CREDITS.md).
