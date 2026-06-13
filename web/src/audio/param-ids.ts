// Parameter ids — MUST stay in sync with engine/ami-engine.cpp
// (enum ChanParamId / GlobalParamId) and public/ami-processor.js mirrors.

export const ChanParamId = {
  EIGHT_BIT: 0,
  SNH: 1,
  LOOP_EN: 2,
  LOOP_START: 3,
  LOOP_END: 4,
  PINGPONG: 5,
  ATTACK: 6,
  DECAY: 7,
  SUSTAIN: 8,
  RELEASE: 9,
  VOLUME: 10,
  PAN: 11,
  ROOT_NOTE: 12,
  FINETUNE: 13,
  MUTE: 14,
  SOLO: 15,
  PAULA_STEREO: 16,
  MIDI_CHAN: 17,
  LOW_NOTE: 18,
  HIGH_NOTE: 19,
  GLIDE: 20,
  WIDTH: 21,
  VOICE_MODE: 22,
} as const;

export type ChanParamId = (typeof ChanParamId)[keyof typeof ChanParamId];

export const GlobalParamId = {
  A500: 0,
  LED: 1,
  MASTER_VOL: 2,
  VIBE_SPEED: 3,
  MOD_INTENSITY: 4,
  MASTER_PAN: 5,
} as const;

export type GlobalParamId = (typeof GlobalParamId)[keyof typeof GlobalParamId];

export const NUM_CHANNELS = 12;
