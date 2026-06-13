# Credits & License

## Original work

**Ami Sampler** by **astriiddev** (_astriid_)
https://github.com/astriiddev/Ami-Sampler-VST

An Amiga/Paula-inspired 8-bit sampler VST/AU plugin written in C++/JUCE.

## This project

A browser port of the Ami Sampler. The DSP in `engine/ami-engine.cpp` is derived
from the original plugin's `Source/AmiSamplerSound.cpp`, `Source/RCFilters.cpp`,
and `Source/PluginProcessor.cpp` (kept here under `reference/` for porting). The
Amiga RC/LED filter code in turn derives from **8bitbubsy's pt2-clone**
(https://github.com/8bitbubsy/pt2-clone).

Because the original is **GPL v3**, this port is also released under **GPL v3**
(see `LICENSE`). The pixel-art assets in `Res/` and the sample sets in `Samples/`
are taken from the original repository.

The web UI, WASM build pipeline, and AudioWorklet integration are new work for
this port.
