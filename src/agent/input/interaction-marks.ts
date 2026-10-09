// The agent's interaction states, as attributes on the page's own elements.
//
// Hover, press and focus are the agent's (see input.ts): the browser never
// matches :hover, :active, :focus, :focus-visible or :focus-within in the panel page. The
// agent marks the elements instead (data-thp-hover, ...), and the page's CSS
// is rewritten to match the marks as well (live-css.ts), so that the page lays
// out as the image shows it, and a press lands on what is drawn there. The
// snapshot copies the marks with the elements, for the image's CSS (css.ts).
//
// The marks are visible to the page: in its DOM, to its selectors, and to its
// MutationObservers (PageCapture's own ignores them, see INTERACTION_ATTRIBUTES).

import {
  ACTIVE_ATTRIBUTE,
  FOCUS_ATTRIBUTE,
  FOCUS_VISIBLE_ATTRIBUTE,
  FOCUS_WITHIN_ATTRIBUTE,
  HOVER_ATTRIBUTE,
} from "../capture/css";

export interface InteractionState {
  hovered: Iterable<Element>;
  active: Iterable<Element>;
  focused: Element | null;
  /** The focus is one the browser would show (:focus-visible). */
  focusVisible?: boolean;
}

export class InteractionMarks {
  /** The elements marked, per attribute. */
  private readonly marked = new Map<string, Set<Element>>(
    [
      HOVER_ATTRIBUTE,
      ACTIVE_ATTRIBUTE,
      FOCUS_ATTRIBUTE,
      FOCUS_VISIBLE_ATTRIBUTE,
      FOCUS_WITHIN_ATTRIBUTE,
    ].map((name) => [name, new Set()]),
  );

  /** Marks the elements in these states, and only those. Returns the elements whose marks changed. */
  update({ hovered, active, focused, focusVisible = false }: InteractionState): Element[] {
    const focusWithin: Element[] = [];
    for (let element = focused; element; element = element.parentElement) focusWithin.push(element);
    const changed = new Set<Element>();
    for (const [name, elements] of [
      [HOVER_ATTRIBUTE, hovered],
      [ACTIVE_ATTRIBUTE, active],
      [FOCUS_ATTRIBUTE, focused ? [focused] : []],
      [FOCUS_VISIBLE_ATTRIBUTE, focused && focusVisible ? [focused] : []],
      [FOCUS_WITHIN_ATTRIBUTE, focusWithin],
    ] as const)
      this.mark(name, elements, changed);
    return Array.from(changed);
  }

  /** Removes every mark. */
  dispose(): void {
    this.update({ hovered: [], active: [], focused: null });
  }

  private mark(name: string, elements: Iterable<Element>, changed: Set<Element>): void {
    const marked = this.marked.get(name)!;
    const next = new Set(elements);
    for (const element of marked) {
      if (next.has(element)) continue;
      element.removeAttribute(name);
      changed.add(element);
    }
    // Set again if the page took it off (re-rendering an element's attributes, say).
    for (const element of next) {
      if (element.hasAttribute(name)) continue;
      element.setAttribute(name, "");
      changed.add(element);
    }
    this.marked.set(name, next);
  }
}
