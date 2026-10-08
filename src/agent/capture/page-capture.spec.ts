// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { PageCapture } from "./page-capture";
import { RenderPacer } from "./pacer";

let capture: PageCapture;
let hit: Element;
let frames: string[];
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
  captures = vi.spyOn(RenderPacer.prototype, "record");
  capture = new PageCapture(document, {
    onFrame: (frame) => frames.push(frame.svg),
    onEditing() {},
    onEditables() {},
    onCursor() {},
  });
});

afterEach(() => {
  capture.dispose();
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
