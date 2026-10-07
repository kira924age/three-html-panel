import { describe, expect, it } from "vitest"
import { MAX_PAGE_LENGTH, MAX_SVG_LENGTH, parseHostMessage, parsePageMessage, parseReady } from "./protocol"

const limits = { width: 800, height: 600, lastSeq: 4 }
const frame = (fields: Record<string, unknown> = {}) => ({
  type: "frame",
  seq: 5,
  width: 800,
  height: 600,
  svg: "<svg/>",
  ...fields
})
const caret = (fields: Record<string, unknown> = {}) => ({ x: 10, y: 20, height: 16, color: "rgb(0, 0, 0)", ...fields })

describe("parsePageMessage", () => {
  it("accepts a well-formed frame", () => {
    expect(parsePageMessage(frame(), limits)).toEqual(frame())
  })

  it("drops frames whose seq does not grow", () => {
    expect(parsePageMessage(frame({ seq: 4 }), limits)).toBeNull()
    expect(parsePageMessage(frame({ seq: 3 }), limits)).toBeNull()
    expect(parsePageMessage(frame({ seq: 5.5 }), limits)).toBeNull()
    expect(parsePageMessage(frame({ seq: "6" }), limits)).toBeNull()
  })

  it("drops frames of another size than the iframe's, or too large", () => {
    expect(parsePageMessage(frame({ width: 801 }), limits)).toBeNull()
    expect(parsePageMessage(frame({ height: 599 }), limits)).toBeNull()
    const huge = { width: MAX_PAGE_LENGTH + 1, height: 600, lastSeq: -1 }
    expect(parsePageMessage(frame({ width: MAX_PAGE_LENGTH + 1 }), huge)).toBeNull()
  })

  it("drops frames whose svg is not a string or too long", () => {
    expect(parsePageMessage(frame({ svg: 42 }), limits)).toBeNull()
    expect(parsePageMessage(frame({ svg: undefined }), limits)).toBeNull()
    expect(parsePageMessage(frame({ svg: "x".repeat(MAX_SVG_LENGTH + 1) }), limits)).toBeNull()
    expect(parsePageMessage(frame({ svg: "x".repeat(MAX_SVG_LENGTH) }), limits)).not.toBeNull()
  })

  it("accepts the editing state with a valid caret or none", () => {
    expect(parsePageMessage({ type: "editing", editing: true, caret: caret() }, limits)).toEqual({
      type: "editing",
      editing: true,
      caret: caret()
    })
    expect(parsePageMessage({ type: "editing", editing: false, caret: null }, limits)).not.toBeNull()
  })

  it("drops carets with numbers that are not finite or colors that are not short strings", () => {
    for (const bad of [
      caret({ x: Number.NaN }),
      caret({ y: Number.POSITIVE_INFINITY }),
      caret({ height: "16" }),
      caret({ height: -1 }),
      caret({ color: "" }),
      caret({ color: "x".repeat(65) }),
      caret({ color: 0 }),
      "caret"
    ]) {
      expect(parsePageMessage({ type: "editing", editing: true, caret: bad }, limits)).toBeNull()
    }
    expect(parsePageMessage({ type: "editing", editing: "yes", caret: null }, limits)).toBeNull()
    expect(parsePageMessage({ type: "editing", editing: true }, limits)).toBeNull()
  })

  it("drops anything else", () => {
    for (const bad of [null, undefined, "frame", 1, [], { type: "unknown" }, { type: "ready", version: 1 }]) {
      expect(parsePageMessage(bad, limits)).toBeNull()
    }
  })
})

describe("parseReady", () => {
  it("needs the type and an integer version", () => {
    expect(parseReady({ type: "ready", version: 1 })).toEqual({ type: "ready", version: 1 })
    expect(parseReady({ type: "ready" })).toBeNull()
    expect(parseReady({ type: "ready", version: "1" })).toBeNull()
    expect(parseReady({ type: "connect", version: 1 })).toBeNull()
  })
})

describe("parseHostMessage", () => {
  it("accepts panel input and drops malformed input", () => {
    expect(parseHostMessage({ type: "pointer", kind: "down", x: 1, y: 2 })).toEqual({
      type: "pointer",
      kind: "down",
      x: 1,
      y: 2
    })
    expect(parseHostMessage({ type: "pointer", kind: "press", x: 1, y: 2 })).toBeNull()
    expect(parseHostMessage({ type: "wheel", x: 1, y: 2, deltaX: Number.NaN, deltaY: 0 })).toBeNull()
    expect(parseHostMessage({ type: "key", key: "a", shiftKey: false, ctrlKey: false, altKey: false })).toBeNull()
    expect(parseHostMessage({ type: "text", text: "" })).toBeNull()
    expect(parseHostMessage({ type: "blur" })).toEqual({ type: "blur" })
  })
})
