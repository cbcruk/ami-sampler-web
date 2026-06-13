import { AmiNode, type SampleData } from "./audio/ami-node";
import { ChanParamId, GlobalParamId, NUM_CHANNELS } from "./audio/param-ids";
import { decodeAudioFile } from "./audio/wav-loader";
import { ComputerKeyboard } from "./ui/keyboard";
import { WaveformView } from "./ui/waveform";

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing element: ${sel}`);
  return el;
};

const KEYBOARD_MIDI_CHANNEL = 1;

let ami: AmiNode | null = null;
let waveform: WaveformView;
let activeChannel = 0;

const samples: (SampleData | null)[] = Array(NUM_CHANNELS).fill(null);
// per-channel mirror of chan-param values (engine holds truth but is not readable)
const channelState: Map<number, number>[] = Array.from({ length: NUM_CHANNELS }, () => new Map());

const keyboard = new ComputerKeyboard(
  (note) => ami?.noteOn(note, KEYBOARD_MIDI_CHANNEL, 1),
  (note) => ami?.noteOff(note, KEYBOARD_MIDI_CHANNEL),
);

async function ensureAudio(): Promise<AmiNode> {
  if (ami) return ami;
  const ctx = new AudioContext();
  await ctx.resume();
  ami = new AmiNode(ctx);
  await ami.init();
  let lastVoices = 0;
  ami.setMeterCallback((m) => {
    waveform.setPlayhead(m.playhead);
    lastVoices = m.voices;
  });
  ami.setMeterChannel(activeChannel);

  // push every channel's mirrored state into the engine (defaults + any prior edits)
  for (let ch = 0; ch < NUM_CHANNELS; ch++) {
    for (const [id, value] of channelState[ch]) ami.setChanParam(ch, id as ChanParamId, value);
    const s = samples[ch];
    if (s) ami.setSample(ch, s);
  }
  syncGlobalParams();

  $("#status").textContent = `engine ready @ ${ctx.sampleRate} Hz`;

  (window as unknown as Record<string, unknown>).__ami = {
    node: ami,
    ctx,
    voices: () => lastVoices,
    activeChannel: () => activeChannel,
  };
  return ami;
}

async function loadFile(file: File): Promise<void> {
  const node = await ensureAudio();
  const sample = await decodeAudioFile(file, node.ctx);
  samples[activeChannel] = sample;
  waveform.setSample(sample);
  setChanParam(ChanParamId.LOOP_END, sample.frames, true);
  node.setSample(activeChannel, sample);
  $("#sample-name").textContent =
    `ch${activeChannel + 1}: ${file.name} — ${sample.frames} frames, ${sample.channels}ch @ ${sample.sourceRate} Hz`;
}

function setChanParam(id: number, value: number, syncControl = false): void {
  channelState[activeChannel].set(id, value);
  ami?.setChanParam(activeChannel, id as ChanParamId, value);
  if (syncControl) {
    const input = document.querySelector<HTMLInputElement>(`[data-chan-param="${id}"]`);
    if (input) {
      input.value = String(value);
      const label = input.parentElement?.querySelector(".val");
      if (label && input.type !== "checkbox") label.textContent = String(value);
    }
  }
}

function readControl(input: HTMLInputElement): number {
  return input.type === "checkbox" ? (input.checked ? 1 : 0) : Number(input.value);
}

function syncGlobalParams(): void {
  document.querySelectorAll<HTMLInputElement>("[data-global-param]").forEach((input) => {
    ami?.setGlobalParam(Number(input.dataset.globalParam) as GlobalParamId, readControl(input));
  });
}

function bindControls(): void {
  // per-channel controls — capture initial values as each channel's defaults
  document.querySelectorAll<HTMLInputElement>("[data-chan-param]").forEach((input) => {
    const id = Number(input.dataset.chanParam);
    const initial = readControl(input);
    for (let ch = 0; ch < NUM_CHANNELS; ch++) channelState[ch].set(id, initial);

    input.addEventListener("input", () => {
      const value = readControl(input);
      setChanParam(id, value);
      const label = input.parentElement?.querySelector(".val");
      if (label) label.textContent = input.type === "checkbox" ? "" : String(value);
      if (id === ChanParamId.LOOP_EN || id === ChanParamId.LOOP_START || id === ChanParamId.LOOP_END) {
        syncLoopView();
      }
    });
  });

  // global controls
  document.querySelectorAll<HTMLInputElement>("[data-global-param]").forEach((input) => {
    input.addEventListener("input", () => {
      const value = readControl(input);
      ami?.setGlobalParam(Number(input.dataset.globalParam) as GlobalParamId, value);
      const label = input.parentElement?.querySelector(".val");
      if (label) label.textContent = input.type === "checkbox" ? "" : String(value);
    });
  });

  $("#channel").addEventListener("change", (e) => {
    switchChannel(Number((e.target as HTMLSelectElement).value) - 1);
  });

  $("#octave").addEventListener("change", (e) => {
    keyboard.setBaseOctave(Number((e.target as HTMLInputElement).value));
  });
}

function switchChannel(ch: number): void {
  activeChannel = ch;
  $("#chan-label").textContent = String(ch + 1);
  ami?.setMeterChannel(ch);

  // restore panel controls from this channel's mirrored state
  document.querySelectorAll<HTMLInputElement>("[data-chan-param]").forEach((input) => {
    const id = Number(input.dataset.chanParam);
    const value = channelState[ch].get(id) ?? readControl(input);
    if (input.type === "checkbox") input.checked = value !== 0;
    else input.value = String(value);
    const label = input.parentElement?.querySelector(".val");
    if (label && input.type !== "checkbox") label.textContent = String(value);
  });

  const s = samples[ch];
  if (s) {
    waveform.setSample(s);
    $("#sample-name").textContent = `ch${ch + 1}: ${s.frames} frames, ${s.channels}ch @ ${s.sourceRate} Hz`;
  } else {
    waveform.setSample(null);
    $("#sample-name").textContent = `ch${ch + 1}: no sample loaded`;
  }
  syncLoopView();
}

function syncLoopView(): void {
  const s = samples[activeChannel];
  if (!s) return;
  const en = ($("#p-loop-en") as HTMLInputElement).checked;
  const start = Number(($("#p-loop-start") as HTMLInputElement).value);
  const end = Number(($("#p-loop-end") as HTMLInputElement).value);
  waveform.setLoop(en, start, end || s.frames);
}

function setupDropzone(): void {
  const dz = $("#waveform-wrap");
  const prevent = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  };
  ["dragenter", "dragover", "dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, prevent));
  dz.addEventListener("dragover", () => dz.classList.add("drag"));
  dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
  dz.addEventListener("drop", async (e) => {
    dz.classList.remove("drag");
    const file = (e as DragEvent).dataTransfer?.files?.[0];
    if (file) await loadFile(file);
  });

  $<HTMLInputElement>("#file-input").addEventListener("change", async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) await loadFile(file);
  });
}

function main(): void {
  waveform = new WaveformView($("#waveform"));
  window.addEventListener("resize", () => waveform.resize());
  bindControls();
  setupDropzone();
  keyboard.attach();

  // first user gesture unlocks the AudioContext
  document.body.addEventListener("pointerdown", () => void ensureAudio(), { once: true });
}

main();
