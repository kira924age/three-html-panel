// The editor's state, with undo and redo. Continuous changes (a slider being
// dragged, a crop being resized) change `state` live and are committed to the
// history once they end.

import {
  type Adjustments,
  type EditState,
  flipRectH,
  flipRectV,
  initialState,
  NEUTRAL,
  PRESETS,
  rotateRect,
  type Rect,
  type Rotation,
  type Stroke,
} from "../edit/model";

export type Tool = "adjust" | "crop" | "draw";

export const SWATCHES = [
  "#ffffff",
  "#111111",
  "#ff4d4f",
  "#ffb020",
  "#ffe14d",
  "#3ddc84",
  "#2bb5ff",
  "#7b61ff",
  "#ff5fc8",
];

const clone = (s: EditState): EditState => structuredClone($state.snapshot(s)) as EditState;

class Editor {
  state = $state<EditState>(initialState());
  tool = $state<Tool>("adjust");
  brushColor = $state(SWATCHES[2]);
  brushSize = $state(12);
  compare = $state(false);
  /** Where the before/after divider is, 0..1 from the left. */
  split = $state(0.5);
  preset = $state("Original");

  private committed: EditState = initialState();
  past = $state<EditState[]>([]);
  future = $state<EditState[]>([]);

  canUndo = $derived(this.past.length > 0);
  canRedo = $derived(this.future.length > 0);
  dirty = $derived(this.past.length > 0);

  reset() {
    this.state = initialState();
    this.committed = initialState();
    this.past = [];
    this.future = [];
    this.tool = "adjust";
    this.compare = false;
    this.preset = "Original";
  }

  /** Records the current state as one step in the history (if it changed). */
  commit() {
    const now = clone(this.state);
    if (JSON.stringify(now) === JSON.stringify(this.committed)) return;
    this.past = [...this.past.slice(-49), this.committed];
    this.future = [];
    this.committed = now;
  }

  undo() {
    const prev = this.past.at(-1);
    if (!prev) return;
    this.past = this.past.slice(0, -1);
    this.future = [...this.future, this.committed];
    this.committed = prev;
    this.state = clone(prev);
  }

  redo() {
    const next = this.future.at(-1);
    if (!next) return;
    this.future = this.future.slice(0, -1);
    this.past = [...this.past, this.committed];
    this.committed = next;
    this.state = clone(next);
  }

  setAdjust(key: keyof Adjustments, value: number) {
    this.state.adjust[key] = value;
    this.preset = "";
  }

  applyPreset(name: string) {
    const preset = PRESETS.find((p) => p.name === name);
    if (!preset) return;
    this.state.adjust = { ...NEUTRAL, ...preset.adjust };
    this.preset = name;
    this.commit();
  }

  rotate(clockwise = true) {
    const turns = clockwise ? 1 : 3;
    for (let i = 0; i < turns; i++) {
      this.state.rotation = ((this.state.rotation + 90) % 360) as Rotation;
      this.state.crop = rotateRect(this.state.crop);
    }
    this.commit();
  }

  /** Flips the image as shown (left-right or top-bottom), whatever its rotation. */
  flip(axis: "h" | "v") {
    const sideways = this.state.rotation % 180 !== 0;
    // Flips happen before rotation: flipping what is shown sideways is the other axis of the source.
    if ((axis === "h") !== sideways) this.state.flipH = !this.state.flipH;
    else this.state.flipV = !this.state.flipV;
    this.state.crop = axis === "h" ? flipRectH(this.state.crop) : flipRectV(this.state.crop);
    this.commit();
  }

  setCrop(rect: Rect) {
    this.state.crop = rect;
  }

  addStroke(stroke: Stroke) {
    this.state.strokes.push(stroke);
  }

  clearDrawing() {
    if (!this.state.strokes.length) return;
    this.state.strokes = [];
    this.commit();
  }
}

export const editor = new Editor();
