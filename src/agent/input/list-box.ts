// List boxes: a <select multiple>, or one with a size above 1, which shows its
// options in the page rather than in a list of its own (see select-popup.ts
// for the drop-down kind).
//
// The image shows the options and which are selected; a synthetic press does
// not select them. input.ts does, as browsers do: a press selects the option
// under it (and only it), Shift extends from the last one pressed, Ctrl (Cmd
// on macOS) adds or removes one, and a drag selects the options it goes over.

import type { FrameWindow } from "../../types";

export function isListBox(element: Element | null): element is HTMLSelectElement {
  if (!element) return false;
  const { HTMLSelectElement } = element.ownerDocument.defaultView as FrameWindow;
  return (
    element instanceof HTMLSelectElement &&
    (element.multiple || element.size > 1) &&
    !element.disabled
  );
}

/** Whether an option can be selected: not disabled, nor in a disabled group, nor hidden. */
export function isUsable(option: HTMLOptionElement): boolean {
  const group = option.parentElement;
  return (
    !option.disabled &&
    !option.hidden &&
    !(group?.tagName === "OPTGROUP" && (group as HTMLOptGroupElement).disabled)
  );
}

/**
 * The index of the option at a height of the list box (page CSS px). Past the
 * first or last option, the nearest one when `clamp` (dragging out of the box),
 * else none.
 */
export function optionAt(select: HTMLSelectElement, y: number, clamp = false): number | null {
  const options = Array.from(select.options);
  let nearest: number | null = null;
  let distance = Infinity;
  for (const [index, option] of options.entries()) {
    if (option.hidden) continue;
    const rect = option.getBoundingClientRect();
    if (rect.height === 0) continue;
    if (y >= rect.top && y < rect.bottom) return index;
    const away = y < rect.top ? rect.top - y : y - rect.bottom;
    if (away < distance) {
      distance = away;
      nearest = index;
    }
  }
  return clamp ? nearest : null;
}

/** Which options are selected, to tell whether a press or a key changed it. */
export const selectionOf = (select: HTMLSelectElement) =>
  Array.from(select.options, (option) => option.selected);

/**
 * Selects the options from `from` to `to` (either order) that can be, and,
 * unless `keep`, deselects the others.
 */
export function selectRange(
  select: HTMLSelectElement,
  from: number,
  to: number,
  keep = false,
): void {
  const [low, high] = from < to ? [from, to] : [to, from];
  for (const [index, option] of Array.from(select.options).entries()) {
    const inside = index >= low && index <= high;
    if (inside && isUsable(option)) option.selected = true;
    else if (!keep) option.selected = false;
  }
}

/**
 * How far the keys move in a list of options: Home and End go as far as there
 * are. A Map, so that no key name finds what an object inherits ("toString").
 */
export const OPTION_STEPS = new Map([
  ["ArrowDown", 1],
  ["ArrowUp", -1],
  ["PageDown", 10],
  ["PageUp", -10],
  ["End", Infinity],
  ["Home", -Infinity],
]);

/**
 * The item `steps` usable items on from `from` (back if negative), or the last
 * usable one before the end of the list; `from` if there is none.
 */
export function stepOption(
  count: number,
  from: number,
  steps: number,
  usable: (index: number) => boolean,
): number {
  const direction = Math.sign(steps);
  let result = from;
  let left = Math.abs(steps);
  for (let next = from + direction; next >= 0 && next < count && left > 0; next += direction) {
    if (!usable(next)) continue;
    result = next;
    left--;
  }
  return result;
}

/**
 * The first item after `from`, going around, whose label starts with typed
 * text, as typing on a list picks; null if none. `labelAt` is null for an item
 * that cannot be picked.
 */
export function nextMatch(
  count: number,
  from: number,
  text: string,
  labelAt: (index: number) => string | null,
): number | null {
  const prefix = text.toLowerCase();
  for (let offset = 1; offset <= count; offset++) {
    const index = (from + offset + count) % count;
    if (labelAt(index)?.trim().toLowerCase().startsWith(prefix)) return index;
  }
  return null;
}

/** Scrolls the list box so that an option shows. */
export function revealOption(select: HTMLSelectElement, index: number): void {
  const option = select.options[index];
  if (!option) return;
  const box = select.getBoundingClientRect();
  const top = box.top + select.clientTop;
  const bottom = top + select.clientHeight;
  const rect = option.getBoundingClientRect();
  if (rect.top < top) select.scrollTop -= top - rect.top;
  else if (rect.bottom > bottom) select.scrollTop += rect.bottom - bottom;
}

/** Tells the page the selection changed, as choosing options in a list box does. */
export function announceChange(select: HTMLSelectElement): void {
  const { Event } = select.ownerDocument.defaultView as FrameWindow;
  select.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  select.dispatchEvent(new Event("change", { bubbles: true }));
}
