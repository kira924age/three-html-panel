// The top layer: open popovers and modal dialogs, which browsers draw over
// the whole page, where they are on screen, whatever their parents (none of
// which places or clips them).

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
