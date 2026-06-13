# Reference — original JUCE source

Read-only copy of the original Ami Sampler `Source/` tree
(astriiddev/Ami-Sampler-VST), kept as a **porting reference** only. Nothing here
is compiled or shipped by the web project.

Use it to cross-check the web port against the original DSP and UI behaviour:

| Original | Ported to |
|----------|-----------|
| `Source/AmiSamplerSound.cpp` | `engine/ami-engine.cpp` (voice, 8-bit, S&H, loop, ADSR) |
| `Source/RCFilters.cpp` | `engine/ami-engine.cpp` (A500/A1200/LED filters) |
| `Source/PluginProcessor.cpp` | `engine/ami-engine.cpp` (master chain, params) — not yet: 12 channels |
| `Source/astro_formats/` | not yet ported (IFF / BRR / µ-law parsers) |
| `Source/PluginEditor.cpp`, `GuiComponent.cpp`, `AmiWindowEditor.cpp`, `PixelBuffer.cpp` | `web/src/ui/` (rewritten in TS/Canvas) — in progress |

When the port reaches parity, this folder can be dropped (the upstream repo
remains the source of truth).
