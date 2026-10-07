import { describe, expect, it } from "vitest"
import { splitAlpha } from "./html-panel"

describe("splitAlpha", () => {
  it("splits the alpha off a CSS color", () => {
    expect(splitAlpha("rgb(1, 2, 3)")).toEqual({ rgb: "rgb(1, 2, 3)", alpha: 1 })
    expect(splitAlpha("rgba(0, 0, 0, 0)")).toEqual({ rgb: "rgb(0, 0, 0)", alpha: 0 })
    expect(splitAlpha("rgb(10 20 30 / 50%)")).toEqual({ rgb: "rgb(10, 20, 30)", alpha: 0.5 })
    expect(splitAlpha("transparent").alpha).toBe(0)
    expect(splitAlpha("#ff0000")).toEqual({ rgb: "#ff0000", alpha: 1 })
  })
})
