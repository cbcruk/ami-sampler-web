// Parameter ids — MUST stay in sync with engine/ami-engine.cpp (enum ParamId)
// and public/ami-processor.js (PARAM mirror).

export const ParamId = {
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
  A500: 12,
  LED: 13,
  ROOT_NOTE: 14,
  FINETUNE: 15,
  MASTER_VOL: 16,
} as const;

export type ParamId = (typeof ParamId)[keyof typeof ParamId];
