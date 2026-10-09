import { afterEach, describe, expect, it } from "vite-plus/test";
import type { FrameWindow } from "../../types";
import { OpenOrder } from "./top-layer";

/** A beforetoggle or toggle event (jsdom has no ToggleEvent). */
function toggle(target: Element, type: "beforetoggle" | "toggle", newState: "open" | "closed") {
  const event = new Event(type);
  Object.defineProperty(event, "newState", { value: newState });
  target.dispatchEvent(event);
}

describe("OpenOrder", () => {
  let order: OpenOrder;
  afterEach(() => order.dispose());

  it("counts openings as they start (beforetoggle), and forgets one closed", () => {
    document.body.innerHTML = `<div id="a" popover></div><div id="b" popover></div>`;
    order = new OpenOrder(window as unknown as FrameWindow);
    const [a, b] = ["a", "b"].map((id) => document.getElementById(id)!);
    toggle(b!, "beforetoggle", "open");
    toggle(a!, "beforetoggle", "open");
    // Its toggle comes later: b stays where it opened, under a.
    toggle(b!, "toggle", "open");
    expect(order.at(b!)).toBeLessThan(order.at(a!));
    toggle(a!, "beforetoggle", "closed");
    expect(order.at(a!)).toBe(0);
  });

  it("counts on toggle, or on a dialog's open attribute, only what no beforetoggle counted", () => {
    document.body.innerHTML = `<dialog id="ask"></dialog><div id="tip" popover></div><details id="more"></details>`;
    order = new OpenOrder(window as unknown as FrameWindow);
    const ask = document.getElementById("ask")!;
    const tip = document.getElementById("tip")!;
    ask.setAttribute("open", "");
    order.attributeChanged(ask, "open");
    const opened = order.at(ask);
    expect(opened).toBeGreaterThan(0);
    // Its toggle (or another change of the attribute) does not count it again.
    toggle(ask, "toggle", "open");
    order.attributeChanged(ask, "open");
    expect(order.at(ask)).toBe(opened);
    toggle(tip, "toggle", "open");
    expect(order.at(tip)).toBeGreaterThan(opened);
    ask.removeAttribute("open");
    order.attributeChanged(ask, "open");
    expect(order.at(ask)).toBe(0);
    // Another element's open attribute is no dialog's.
    const more = document.getElementById("more")!;
    more.setAttribute("open", "");
    order.attributeChanged(more, "open");
    expect(order.at(more)).toBe(0);
  });
});
