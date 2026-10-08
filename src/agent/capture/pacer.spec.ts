import { describe, expect, it } from "vite-plus/test";
import { RenderPacer } from "./pacer";

describe("RenderPacer", () => {
  it("spaces frames so rendering takes the given share of time", () => {
    const pacer = new RenderPacer({ budget: 0.25, minIntervalMs: 10, maxIntervalMs: 1000 });
    expect(pacer.record(20)).toBe(80);
  });

  it("clamps to the minimum and maximum interval", () => {
    const pacer = new RenderPacer({ budget: 0.25, minIntervalMs: 33, maxIntervalMs: 500 });
    expect(pacer.record(1)).toBe(33);
    expect(pacer.record(400)).toBe(500);
  });
});
