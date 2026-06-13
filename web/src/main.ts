import { AmiNode, type SampleData } from "./audio/ami-node";
import { ParamId } from "./audio/param-ids";
import { decodeAudioFile } from "./audio/wav-loader";
import { ComputerKeyboard } from "./ui/keyboard";
import { WaveformView } from "./ui/waveform";

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing element: ${sel}`);
  return el;
};

let ami: AmiNode | null = null;
let sample: SampleData | null = null;
let waveform: WaveformView;
const keyboard = new ComputerKeyboard(
  (note) => ami?.noteOn(note, 1),
  (note) => ami?.noteOff(note),
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
  $("#status").textContent = `engine ready @ ${ctx.sampleRate} Hz`;

  (window as unknown as Record<string, unknown>).__ami = {
    node: ami,
    ctx,
    voices: () => lastVoices,
  };
  return ami;
}

async function loadFile(file: File): Promise<void> {
  const node = await ensureAudio();
  sample = await decodeAudioFile(file, node.ctx);
  waveform.setSample(sample);
  node.setParam(ParamId.LOOP_END, sample.frames);
  node.setSample(sample);
  $("#sample-name").textContent = `${file.name} — ${sample.frames} frames, ${sample.channels}ch @ ${sample.sourceRate} Hz`;
}

function bindControls(): void {
  // toggles + sliders declared in HTML with data-param attributes
  document.querySelectorAll<HTMLInputElement>("[data-param]").forEach((input) => {
    const id = Number(input.dataset.param) as ParamId;
    const apply = () => {
      const value = input.type === "checkbox" ? (input.checked ? 1 : 0) : Number(input.value);
      ami?.setParam(id, value);
      const label = input.parentElement?.querySelector(".val");
      if (label) label.textContent = input.type === "checkbox" ? "" : String(value);
      if (id === ParamId.LOOP_EN || id === ParamId.LOOP_START || id === ParamId.LOOP_END) syncLoopView();
    };
    input.addEventListener("input", apply);
  });

  $("#octave").addEventListener("change", (e) => {
    keyboard.setBaseOctave(Number((e.target as HTMLInputElement).value));
  });
}

function syncLoopView(): void {
  if (!sample) return;
  const en = ($("#p-loop-en") as HTMLInputElement).checked;
  const start = Number(($("#p-loop-start") as HTMLInputElement).value);
  const end = Number(($("#p-loop-end") as HTMLInputElement).value);
  waveform.setLoop(en, start, end || sample.frames);
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
