#!/usr/bin/env bash
# Build the JUCE-free DSP engine to standalone WASM for the AudioWorklet.
set -euo pipefail

cd "$(dirname "$0")"
EMSDK="$(cd ../web-build/emsdk && pwd)"
source "$EMSDK/emsdk_env.sh" >/dev/null 2>&1

OUT_DIR="../web/public/wasm"
mkdir -p "$OUT_DIR"

EXPORTS='["_ami_init","_ami_sample_l","_ami_sample_r","_ami_sample_capacity","_ami_out_l","_ami_out_r","_ami_set_sample","_ami_set_chan_param","_ami_set_global_param","_ami_pitch_bend","_ami_note_on","_ami_note_off","_ami_all_notes_off","_ami_process","_ami_active_voices","_ami_playhead"]'

emcc ami-engine.cpp \
  -O3 \
  -std=c++17 \
  -sSTANDALONE_WASM=1 \
  -sEXPORTED_FUNCTIONS="$EXPORTS" \
  -sALLOW_MEMORY_GROWTH=0 \
  -sINITIAL_MEMORY=134217728 \
  -sTOTAL_STACK=1048576 \
  --no-entry \
  -o "$OUT_DIR/ami-engine.wasm"

echo "Built $OUT_DIR/ami-engine.wasm ($(du -h "$OUT_DIR/ami-engine.wasm" | cut -f1))"
