// The text and the selection of an <input> or <textarea>, for every kind of
// text field alike.
//
// <input type=email> and <input type=number> have no selection API: their
// selectionStart is null, and setSelectionRange and setRangeText throw. The
// browser still keeps a caret and a selection in them, but a page (and so the
// agent) can neither read nor move it. For these fields the agent keeps its
// own: the selection, and the text as typed. The page does not see that
// selection; it sees the value, set as if typed (and the input events).
//
// The text as typed can differ from the value, which the browser sanitizes:
// an email field strips leading and trailing white space and line breaks, and
// a number field reads as "" while its text is not a valid number yet ("-",
// "1.", "1e"), as in browsers. Typing goes on from the text as typed, so "1.5"
// can be typed a character at a time. If the page sets the value itself, the
// field's text is its value again, with the caret at the end.

import type { TextField } from "./caret";

export type Direction = "forward" | "backward" | "none";

export interface FieldSelection {
  start: number;
  end: number;
  direction: Direction;
}

interface Kept extends FieldSelection {
  /** The text as typed. */
  text: string;
  /** The field's value when `text` was typed, to notice the page changing it. */
  value: string;
}

const kept = new WeakMap<TextField, Kept>();

/**
 * Whether the field has the selection API. Read from the type rather than
 * from selectionStart, which older browsers throw on for these types.
 */
export function hasSelectionApi(field: TextField): boolean {
  return field.tagName === "TEXTAREA" || !NO_SELECTION_TYPES.has((field as HTMLInputElement).type);
}

const NO_SELECTION_TYPES = new Set(["email", "number"]);

/** What the agent keeps for a field without a selection API; null once the page changed its value. */
function keptOf(field: TextField): Kept | null {
  const state = kept.get(field);
  return state && state.value === field.value ? state : null;
}

/** The field's text: its value, or for a field without a selection API the text as typed. */
export function fieldText(field: TextField): string {
  if (hasSelectionApi(field)) return field.value;
  return keptOf(field)?.text ?? field.value;
}

/**
 * The field's selection, in its text. A field without a selection API has the
 * one the agent keeps, or else a caret at the end.
 */
export function fieldSelection(field: TextField): FieldSelection {
  if (hasSelectionApi(field)) {
    const length = field.value.length;
    return {
      start: field.selectionStart ?? length,
      end: field.selectionEnd ?? length,
      direction: field.selectionDirection ?? "none",
    };
  }
  const state = keptOf(field);
  if (state) return { start: state.start, end: state.end, direction: state.direction };
  const length = field.value.length;
  return { start: length, end: length, direction: "none" };
}

/** Selects from `start` to `end` of the field's text, like setSelectionRange. */
export function setFieldSelection(
  field: TextField,
  start: number,
  end: number,
  direction: Direction = "none",
): void {
  if (hasSelectionApi(field)) {
    field.setSelectionRange(start, end, direction);
    return;
  }
  const text = fieldText(field);
  const to = clamp(end, text.length);
  kept.set(field, {
    text,
    value: field.value,
    start: Math.min(clamp(start, text.length), to),
    end: to,
    direction,
  });
}

/**
 * Replaces `start` to `end` of the field's text with `text`, and puts the caret
 * after it, like setRangeText(…, "end"). It does not dispatch events.
 */
export function replaceFieldText(field: TextField, text: string, start: number, end: number): void {
  if (hasSelectionApi(field)) {
    field.setRangeText(text, start, end, "end");
    return;
  }
  const before = fieldText(field);
  const next = before.slice(0, start) + text + before.slice(end);
  setValue(field as HTMLInputElement, next);
  const caret = start + text.length;
  kept.set(field, { text: next, value: field.value, start: caret, end: caret, direction: "none" });
}

/**
 * Sets the value with the element's own setter rather than the `value`
 * property, as setRangeText does: a framework that wraps the property on the
 * element to track the value (React) then sees the change on `input`.
 */
function setValue(field: HTMLInputElement, value: string): void {
  const { HTMLInputElement } = field.ownerDocument.defaultView as Window & typeof globalThis;
  Reflect.set(HTMLInputElement.prototype, "value", value, field);
}

const clamp = (index: number, length: number) => Math.max(0, Math.min(index, length));
