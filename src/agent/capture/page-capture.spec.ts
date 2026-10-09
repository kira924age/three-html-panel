// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { PageCapture } from "./page-capture";
import { RenderPacer } from "./pacer";

let capture: PageCapture;
let hit: Element;
let frames: string[];
let cursors: string[];
let captures: ReturnType<typeof vi.spyOn>;
const move = () => capture.handle({ type: "pointer", kind: "move", x: 5, y: 5 });
const settle = () => vi.advanceTimersByTimeAsync(100);

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = "<button>One</button><button>Two</button>";
  hit = document.querySelector("button")!;
  vi.stubGlobal("PointerEvent", class extends MouseEvent {});
  const Mouse = window.MouseEvent;
  vi.spyOn(window, "MouseEvent").mockImplementation(function (type, init) {
    return new Mouse(type, { ...init, view: null });
  });
  vi.spyOn(window, "PointerEvent").mockImplementation(function (type, init) {
    return new Mouse(type, { ...init, view: null }) as PointerEvent;
  });
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => hit });
  frames = [];
  cursors = [];
  captures = vi.spyOn(RenderPacer.prototype, "record");
  capture = new PageCapture(document, {
    onFrame: (frame) => frames.push(frame.svg),
    onEditing() {},
    onEditables() {},
    onCursor: (cursor) => cursors.push(cursor),
  });
});

afterEach(() => {
  capture.dispose();
  document.head.innerHTML = "";
  delete (document as { elementFromPoint?: unknown }).elementFromPoint;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("skips unchanged hover by default, but dispatches events and captures entering and leaving", async () => {
  const listener = vi.fn();
  hit.addEventListener("pointermove", listener);
  capture.start();
  await settle();
  move();
  await settle();
  expect(frames.at(-1)).toContain("data-thp-hover");
  const count = captures.mock.calls.length;
  move();
  move();
  await settle();
  expect(listener).toHaveBeenCalledTimes(3);
  expect(captures).toHaveBeenCalledTimes(count);
  hit = document.querySelectorAll("button")[1]!;
  move();
  await settle();
  expect(captures).toHaveBeenCalledTimes(count + 1);
  capture.handle({ type: "pointer", kind: "leave", x: 0, y: 0 });
  await settle();
  expect(frames.at(-1)).not.toContain("data-thp-hover");
});

it("still captures DOM changes from same-target pointer handlers", async () => {
  capture.start();
  move();
  await settle();
  hit.addEventListener("pointermove", () => {
    hit.textContent = "Changed";
  });
  move();
  await settle();
  expect(frames.at(-1)).toContain("Changed");
});

it("captures unchanged moves when disabled and resets to the default on reconnect", async () => {
  capture.start(false);
  move();
  await settle();
  const count = captures.mock.calls.length;
  move();
  await settle();
  expect(captures).toHaveBeenCalledTimes(count + 1);
  capture.start();
  await settle();
  const reconnected = captures.mock.calls.length;
  move();
  await settle();
  expect(captures).toHaveBeenCalledTimes(reconnected);
});

it("keeps invalidating while a button is held for a drag", async () => {
  capture.start();
  capture.handle({ type: "pointer", kind: "down", x: 5, y: 5 });
  await settle();
  const count = captures.mock.calls.length;
  move();
  await settle();
  expect(captures).toHaveBeenCalledTimes(count + 1);
});

it("updates auto cursors over text within the same element without capturing", async () => {
  document.body.innerHTML = '<p style="cursor:auto">Text</p>';
  hit = document.querySelector("p")!;
  // jsdom has no text hit testing. Supply only the browser geometry APIs;
  // the real input cursor getter and PageCapture reporting stay in use.
  const doc = document as unknown as {
    caretPositionFromPoint?: (x: number) => { offsetNode: Node; offset: number } | null;
  };
  doc.caretPositionFromPoint = (x) => (x >= 10 ? { offsetNode: hit.firstChild!, offset: 0 } : null);
  const createRange = document.createRange.bind(document);
  vi.spyOn(document, "createRange").mockImplementation(() => {
    const range = createRange();
    range.getClientRects = () => [new DOMRect(10, 0, 20, 20)] as unknown as DOMRectList;
    return range;
  });
  try {
    capture.start();
    move();
    await settle();
    const count = captures.mock.calls.length;
    expect(cursors.at(-1)).toBe("default");
    cursors.length = 0;
    capture.handle({ type: "pointer", kind: "move", x: 15, y: 5 });
    await settle();
    expect(cursors).toEqual(["text"]);
    capture.handle({ type: "pointer", kind: "move", x: 16, y: 5 });
    await settle();
    expect(cursors).toEqual(["text"]);
    move();
    await settle();
    expect(cursors).toEqual(["text", "default"]);
    expect(captures).toHaveBeenCalledTimes(count);
  } finally {
    delete doc.caretPositionFromPoint;
  }
});

describe("interaction states in the live page", () => {
  const press = () => {
    capture.handle({ type: "pointer", kind: "down", x: 5, y: 5 });
    capture.handle({ type: "pointer", kind: "up", x: 5, y: 5 });
  };

  beforeEach(() => {
    document.head.innerHTML =
      "<style>.tools { display: none } .row:hover .tools { display: flex } .row:focus-within .tools { display: grid }</style>";
    document.body.innerHTML = `<div class="row"><span class="tools"><button>Act</button></span></div>`;
    const [row, tools, button] = ["div", ".tools", "button"].map((s) => document.querySelector(s)!);
    // As a browser hit tests: the button only where it is laid out.
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: () => (getComputedStyle(tools!).display === "none" ? row : button),
    });
  });

  it("shows a button that appears on its row's :hover, so that a press lands on it", async () => {
    const clicked = vi.fn();
    document.querySelector("button")!.addEventListener("click", clicked);
    capture.start();
    move();
    await settle();
    expect(getComputedStyle(document.querySelector(".tools")!).display).toBe("flex");
    // The image shows what the page lays out: the copy carries the mark.
    expect(frames.at(-1)).toMatch(/class="row" data-thp-hover=""/);
    press();
    expect(clicked).toHaveBeenCalledOnce();
    capture.handle({ type: "pointer", kind: "leave", x: 0, y: 0 });
    expect(document.querySelector("[data-thp-hover]")).toBeNull();
    // Pressed, the button has focus: :focus-within keeps it shown, until the host takes the keys back.
    expect(getComputedStyle(document.querySelector(".tools")!).display).toBe("grid");
    capture.handle({ type: "blur" });
    expect(getComputedStyle(document.querySelector(".tools")!).display).toBe("none");
  });

  it("follows the focus the page moves, with :focus-within", async () => {
    capture.start();
    document.querySelector("button")!.focus();
    expect(getComputedStyle(document.querySelector(".tools")!).display).toBe("grid");
    await settle();
    expect(frames.at(-1)).toMatch(/class="row" data-thp-focus-within=""/);
  });

  it("lets the page's click handler see the press ended, and its focus handler the new focus", () => {
    const button = document.querySelector("button")!;
    const seen: string[] = [];
    button.addEventListener("focus", () =>
      seen.push(`focus: ${getComputedStyle(document.querySelector(".tools")!).display}`),
    );
    button.addEventListener("click", () =>
      seen.push(`click: ${button.hasAttribute("data-thp-active")}`),
    );
    capture.start();
    move();
    press();
    expect(seen).toEqual(["focus: grid", "click: false"]);
  });

  it("follows the page moving the focused element elsewhere, on the next capture", async () => {
    capture.start();
    const button = document.querySelector("button")!;
    button.focus();
    const other = document.createElement("div");
    document.body.append(other);
    other.append(button);
    await settle();
    expect(other.hasAttribute("data-thp-focus-within")).toBe(true);
    expect(document.querySelector(".row")!.hasAttribute("data-thp-focus-within")).toBe(false);
  });

  it("captures a change the page makes through the CSSOM only", async () => {
    capture.start();
    await settle();
    const count = captures.mock.calls.length;
    document.styleSheets[0]!.insertRule(".row { color: red }", 0);
    await settle();
    expect(captures).toHaveBeenCalledTimes(count + 1);
    expect(frames.at(-1)).toContain(".row{color: red;}");
  });

  it("does not count its marks as changes of the page", async () => {
    capture.start();
    await settle();
    const count = captures.mock.calls.length;
    document.querySelector("button")!.setAttribute("data-thp-hover", "");
    await settle();
    expect(captures).toHaveBeenCalledTimes(count);
  });
});
