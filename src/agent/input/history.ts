// Undo and redo for <input> and <textarea>.
//
// The agent edits fields with setRangeText (input.ts), which the browser does
// not record: its own undo would do nothing. So the agent keeps the history.
// Typing in a row is one step, like in browsers; moving the caret, or any other
// kind of edit, starts a new one. If the page changes a field's value itself
// (a framework resetting it, say), the history no longer matches and is dropped.

export interface FieldState {
  value: string;
  start: number;
  end: number;
}

interface Entry {
  undo: FieldState[];
  redo: FieldState[];
  /** The value after the agent's last edit, to notice changes made by the page. */
  last: string;
  /** The last edit was typing, so more typing joins its step. */
  typing: boolean;
}

const MAX_STEPS = 100;

export class EditHistory {
  private readonly entries = new WeakMap<Element, Entry>();

  /** Records the state before an edit of `inputType`. */
  record(field: Element, before: FieldState, inputType: string): void {
    const entry = this.current(field, before.value);
    const typing = inputType === "insertText";
    if (!(typing && entry.typing)) {
      entry.undo.push(before);
      if (entry.undo.length > MAX_STEPS) entry.undo.shift();
    }
    entry.redo = [];
    entry.typing = typing;
  }

  /** The value an edit (or an undo, or a redo) left. */
  edited(field: Element, value: string): void {
    const entry = this.entries.get(field);
    if (entry) entry.last = value;
  }

  /** The caret moved: the next typing starts a new step. */
  breakTyping(field: Element): void {
    const entry = this.entries.get(field);
    if (entry) entry.typing = false;
  }

  /** The state to go back to, given the state now; null if there is none. */
  undo(field: Element, now: FieldState): FieldState | null {
    return this.step(field, now, "undo", "redo");
  }

  redo(field: Element, now: FieldState): FieldState | null {
    return this.step(field, now, "redo", "undo");
  }

  private step(
    field: Element,
    now: FieldState,
    from: "undo" | "redo",
    to: "undo" | "redo",
  ): FieldState | null {
    const entry = this.entries.get(field);
    if (!entry || entry.last !== now.value) {
      this.entries.delete(field);
      return null;
    }
    const state = entry[from].pop();
    if (!state) return null;
    entry[to].push(now);
    entry.typing = false;
    // The caller puts this state back; if the page cancels that, the values no
    // longer match and the history is dropped at the next step.
    entry.last = state.value;
    return state;
  }

  /** The field's entry, dropped first if the page changed the value since the agent's last edit. */
  private current(field: Element, value: string): Entry {
    let entry = this.entries.get(field);
    if (!entry || entry.last !== value) {
      entry = { undo: [], redo: [], last: value, typing: false };
      this.entries.set(field, entry);
    }
    return entry;
  }
}
