// Computer-keyboard -> MIDI note input (tracker / piano style two rows).

type NoteHandler = (note: number) => void;

// Lower row (Z..M) = base octave, upper row (Q..) = base octave + 1.
const LAYOUT: Record<string, number> = {
  KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6,
  KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11, Comma: 12, KeyL: 13, Period: 14,
  KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16, KeyR: 17, Digit5: 18,
  KeyT: 19, Digit6: 20, KeyY: 21, Digit7: 22, KeyU: 23, KeyI: 24,
};

export class ComputerKeyboard {
  private down = new Set<string>();
  private baseOctave = 4;

  constructor(
    private onNoteOn: NoteHandler,
    private onNoteOff: NoteHandler,
  ) {}

  attach(target: Window = window): () => void {
    const keyDown = (e: KeyboardEvent) => this.handleDown(e);
    const keyUp = (e: KeyboardEvent) => this.handleUp(e);
    target.addEventListener("keydown", keyDown);
    target.addEventListener("keyup", keyUp);
    return () => {
      target.removeEventListener("keydown", keyDown);
      target.removeEventListener("keyup", keyUp);
    };
  }

  setBaseOctave(o: number): void {
    this.baseOctave = Math.max(0, Math.min(8, o));
  }

  getBaseOctave(): number {
    return this.baseOctave;
  }

  private noteFor(code: string): number | null {
    const offset = LAYOUT[code];
    if (offset === undefined) return null;
    return this.baseOctave * 12 + offset;
  }

  private handleDown(e: KeyboardEvent): void {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === "KeyX" && false) return;
    const note = this.noteFor(e.code);
    if (note === null) return;
    if (this.down.has(e.code)) return;
    this.down.add(e.code);
    e.preventDefault();
    this.onNoteOn(note);
  }

  private handleUp(e: KeyboardEvent): void {
    const note = this.noteFor(e.code);
    if (note === null) return;
    this.down.delete(e.code);
    e.preventDefault();
    this.onNoteOff(note);
  }
}
