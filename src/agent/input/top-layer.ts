// The top layer: open popovers and modal dialogs, which browsers draw over
// the whole page, where they are on screen, whatever their parents (none of
// which places or clips them).

import type { FrameWindow } from "../../types";

/** Whether an element matches a selector this browser may not know (it matches nothing then). */
function matches(element: Element, selector: string): boolean {
  try {
    return element.matches(selector);
  } catch {
    return false;
  }
}

/** Whether an element is an open popover or a modal dialog, or null if neither (most elements: checked cheaply first). */
export function topLayerStates(element: Element): { popover: boolean; modal: boolean } | null {
  if (!element.hasAttribute("popover") && element.localName !== "dialog") return null;
  const popover = matches(element, ":popover-open");
  const modal = matches(element, ":modal");
  return popover || modal ? { popover, modal } : null;
}

/**
 * When each popover and dialog was opened, counted: browsers stack the top
 * layer in that order. Recorded on `beforetoggle`, dispatched as it opens
 * (`toggle` comes after, when a frame may have been captured already); on
 * `toggle` and on a dialog's `open` attribute only if not recorded then, for
 * browsers that send dialogs no `beforetoggle`.
 */
export class OpenOrder {
  readonly #window: FrameWindow;
  readonly #at = new WeakMap<Element, number>();
  #count = 0;

  constructor(window: FrameWindow) {
    this.#window = window;
    window.addEventListener("beforetoggle", this.#toggled, true);
    window.addEventListener("toggle", this.#toggled, true);
  }

  /** When an element was opened (0 if not seen opening: opened before, say). */
  at(element: Element): number {
    return this.#at.get(element) ?? 0;
  }

  /** An attribute of an element changed (from the page's MutationObserver): a dialog's `open` opens or closes it. */
  attributeChanged(target: Node, name: string | null): void {
    if (name !== "open" || !(target instanceof this.#window.Element)) return;
    if (target.localName !== "dialog") return;
    if (!target.hasAttribute("open")) this.#at.delete(target);
    else if (!this.#at.has(target)) this.#at.set(target, ++this.#count);
  }

  dispose(): void {
    this.#window.removeEventListener("beforetoggle", this.#toggled, true);
    this.#window.removeEventListener("toggle", this.#toggled, true);
  }

  readonly #toggled = (event: Event) => {
    const { target, type } = event;
    const { newState } = event as Event & { newState?: string };
    if (!(target instanceof this.#window.Element)) return;
    if (newState === "closed") this.#at.delete(target);
    else if (newState === "open" && (type === "beforetoggle" || !this.#at.has(target)))
      this.#at.set(target, ++this.#count);
  };
}
