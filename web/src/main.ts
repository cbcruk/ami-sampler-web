import { AmiNode } from "./audio/ami-node";
import { GlobalParamId } from "./audio/param-ids";
import { decodeAudioFile } from "./audio/wav-loader";
import { MidiInput } from "./audio/midi-input";
import { ComputerKeyboard } from "./ui/keyboard";
import { loadAssets } from "./ui/ami/assets";
import { AmiUI } from "./ui/ami/ami-ui";

const LOGICAL_W = 1080;
const LOGICAL_H = 640;
const KEYBOARD_MIDI_CHANNEL = 1;

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing element: ${sel}`);
  return el;
};

let ami: AmiNode | null = null;
let ui: AmiUI;

const keyboard = new ComputerKeyboard(
  (note) => ami?.noteOn(note, KEYBOARD_MIDI_CHANNEL, 1),
  (note) => ami?.noteOff(note, KEYBOARD_MIDI_CHANNEL),
);

const midi = new MidiInput(
  {
    onNoteOn: (note, channel, velocity) => ami?.noteOn(note, channel, velocity / 127),
    onNoteOff: (note, channel) => ami?.noteOff(note, channel),
    onPitchBend: (channel, value14) => ami?.pitchBend(channel, value14),
    onModWheel: (value) => ami?.setGlobalParam(GlobalParamId.MOD_INTENSITY, value),
  },
  (devices) => {
    const el = document.querySelector("#status");
    if (el && ami) el.textContent = devices.length ? `MIDI: ${devices.join(", ")}` : "ready — no MIDI devices";
  },
);

async function ensureAudio(): Promise<AmiNode> {
  if (ami) return ami;
  const ctx = new AudioContext();
  await ctx.resume();
  ami = new AmiNode(ctx);
  await ami.init();
  ami.setMeterCallback((m) => ui.setPlayhead(m.playhead));
  ui.setNode(ami);
  $("#status").textContent = `engine ready @ ${ctx.sampleRate} Hz`;
  (window as unknown as Record<string, unknown>).__ami = {
    node: ami,
    ctx,
    ui,
    activeChannel: () => ui.activeChannel(),
  };
  return ami;
}

async function loadFile(file: File): Promise<void> {
  const node = await ensureAudio();
  const sample = await decodeAudioFile(file, node.ctx);
  ui.loadSample(ui.activeChannel(), sample, file.name.replace(/\.[^.]+$/, "").slice(0, 16));
}

function fitCanvas(canvas: HTMLCanvasElement): void {
  const margin = 24;
  const scale = Math.max(
    1,
    Math.floor(Math.min((window.innerWidth - margin) / LOGICAL_W, (window.innerHeight - margin) / LOGICAL_H)),
  );
  canvas.style.width = `${LOGICAL_W * scale}px`;
  canvas.style.height = `${LOGICAL_H * scale}px`;
}

async function main(): Promise<void> {
  const canvas = $<HTMLCanvasElement>("#ami");
  const fileInput = $<HTMLInputElement>("#file-input");

  const assets = await loadAssets();
  ui = new AmiUI({ canvas, assets, onLoadClick: () => fileInput.click() });

  fitCanvas(canvas);
  window.addEventListener("resize", () => fitCanvas(canvas));

  keyboard.attach();
  void midi.start();

  fileInput.addEventListener("change", async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) await loadFile(file);
    fileInput.value = "";
  });

  const prevent = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  };
  ["dragenter", "dragover", "dragleave", "drop"].forEach((ev) => canvas.addEventListener(ev, prevent));
  canvas.addEventListener("dragover", () => canvas.classList.add("drag"));
  canvas.addEventListener("dragleave", () => canvas.classList.remove("drag"));
  canvas.addEventListener("drop", async (e) => {
    canvas.classList.remove("drag");
    const file = (e as DragEvent).dataTransfer?.files?.[0];
    if (file) await loadFile(file);
  });

  document.body.addEventListener("pointerdown", () => void ensureAudio(), { once: true });
}

void main();
