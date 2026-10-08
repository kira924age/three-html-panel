import { describe, expect, it } from "vite-plus/test";
import {
  MAX_PAGE_LENGTH,
  MAX_SVG_LENGTH,
  parseHostMessage,
  parseConnect,
  parseOpenableUrl,
  parsePageMessage,
  parseReady,
} from "./protocol";

const limits = { width: 800, height: 600, lastSeq: 4 };
const frame = (fields: Record<string, unknown> = {}) => ({
  type: "frame",
  seq: 5,
  width: 800,
  height: 600,
  svg: "<svg/>",
  ...fields,
});
const caret = (fields: Record<string, unknown> = {}) => ({
  x: 10,
  y: 20,
  height: 16,
  color: "rgb(0, 0, 0)",
  ...fields,
});

describe("parsePageMessage", () => {
  it("accepts a well-formed frame", () => {
    expect(parsePageMessage(frame(), limits)).toEqual(frame());
  });

  it("drops frames whose seq does not grow", () => {
    expect(parsePageMessage(frame({ seq: 4 }), limits)).toBeNull();
    expect(parsePageMessage(frame({ seq: 3 }), limits)).toBeNull();
    expect(parsePageMessage(frame({ seq: 5.5 }), limits)).toBeNull();
    expect(parsePageMessage(frame({ seq: "6" }), limits)).toBeNull();
  });

  it("drops frames of another size than the iframe's, or too large", () => {
    expect(parsePageMessage(frame({ width: 801 }), limits)).toBeNull();
    expect(parsePageMessage(frame({ height: 599 }), limits)).toBeNull();
    const huge = { width: MAX_PAGE_LENGTH + 1, height: 600, lastSeq: -1 };
    expect(parsePageMessage(frame({ width: MAX_PAGE_LENGTH + 1 }), huge)).toBeNull();
  });

  it("drops frames whose svg is not a string or too long", () => {
    expect(parsePageMessage(frame({ svg: 42 }), limits)).toBeNull();
    expect(parsePageMessage(frame({ svg: undefined }), limits)).toBeNull();
    expect(parsePageMessage(frame({ svg: "x".repeat(MAX_SVG_LENGTH + 1) }), limits)).toBeNull();
    expect(parsePageMessage(frame({ svg: "x".repeat(MAX_SVG_LENGTH) }), limits)).not.toBeNull();
  });

  it("accepts the editing state with a valid caret or none", () => {
    expect(
      parsePageMessage(
        {
          type: "editing",
          editing: true,
          caret: caret(),
          selectedText: "abc",
          pointers: 3,
          typing: true,
        },
        limits,
      ),
    ).toEqual({
      type: "editing",
      editing: true,
      caret: caret(),
      selectedText: "abc",
      pointers: 3,
      typing: true,
    });
    expect(
      parsePageMessage(
        {
          type: "editing",
          editing: true,
          caret: null,
          selectedText: "",
          pointers: -1,
          typing: false,
        },
        limits,
      ),
    ).toBeNull();
    expect(
      parsePageMessage(
        { type: "editing", editing: true, caret: null, selectedText: "", pointers: 0 },
        limits,
      ),
    ).toBeNull();
    expect(
      parsePageMessage(
        {
          type: "editing",
          editing: true,
          caret: null,
          selectedText: "",
          pointers: 0,
          typing: "yes",
        },
        limits,
      ),
    ).toBeNull();
    expect(
      parsePageMessage({ type: "editing", editing: true, caret: null, selectedText: "" }, limits),
    ).toBeNull();
    // The selection to copy must be a string, and not too long.
    expect(
      parsePageMessage(
        {
          type: "editing",
          editing: true,
          caret: null,
          selectedText: 1,
          pointers: 0,
          typing: false,
        },
        limits,
      ),
    ).toBeNull();
    expect(parsePageMessage({ type: "editing", editing: true, caret: null }, limits)).toBeNull();
    expect(
      parsePageMessage(
        {
          type: "editing",
          editing: true,
          caret: null,
          selectedText: "x".repeat(64 * 1024 + 1),
          pointers: 0,
          typing: false,
        },
        limits,
      ),
    ).toBeNull();
    expect(
      parsePageMessage(
        {
          type: "editing",
          editing: false,
          caret: null,
          selectedText: "",
          pointers: 0,
          typing: false,
        },
        limits,
      ),
    ).not.toBeNull();
  });

  it("drops carets with numbers that are not finite or colors that are not short strings", () => {
    for (const bad of [
      caret({ x: Number.NaN }),
      caret({ y: Number.POSITIVE_INFINITY }),
      caret({ height: "16" }),
      caret({ height: -1 }),
      caret({ color: "" }),
      caret({ color: "x".repeat(65) }),
      caret({ color: 0 }),
      "caret",
    ]) {
      expect(
        parsePageMessage(
          {
            type: "editing",
            editing: true,
            caret: bad,
            selectedText: "",
            pointers: 0,
            typing: false,
          },
          limits,
        ),
      ).toBeNull();
    }
    expect(
      parsePageMessage(
        {
          type: "editing",
          editing: "yes",
          caret: null,
          selectedText: "",
          pointers: 0,
          typing: false,
        },
        limits,
      ),
    ).toBeNull();
    expect(
      parsePageMessage(
        { type: "editing", editing: true, selectedText: "", pointers: 0, typing: false },
        limits,
      ),
    ).toBeNull();
  });

  it("accepts cursor keywords only", () => {
    expect(parsePageMessage({ type: "cursor", cursor: "ew-resize" }, limits)).toEqual({
      type: "cursor",
      cursor: "ew-resize",
    });
    for (const bad of [
      "",
      "url(https://evil.example/c.png), auto",
      "Pointer",
      "a".repeat(33),
      1,
      null,
    ]) {
      expect(parsePageMessage({ type: "cursor", cursor: bad }, limits)).toBeNull();
    }
  });

  it("drops anything else", () => {
    for (const bad of [
      null,
      undefined,
      "frame",
      1,
      [],
      { type: "unknown" },
      { type: "ready", version: 1 },
    ]) {
      expect(parsePageMessage(bad, limits)).toBeNull();
    }
  });
});

describe("parseOpenableUrl", () => {
  it("accepts absolute http(s) URLs only", () => {
    expect(parseOpenableUrl("https://example.com/a?b#c")).toBe("https://example.com/a?b#c");
    expect(parseOpenableUrl("http://localhost:5174/")).toBe("http://localhost:5174/");
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,<p>",
      "file:///etc/passwd",
      "/relative",
      "",
      1,
      null,
    ]) {
      expect(parseOpenableUrl(bad)).toBeNull();
    }
    expect(parseOpenableUrl("https://example.com/" + "x".repeat(9000))).toBeNull();
  });
});

describe("editables", () => {
  it("accepts boxes of finite numbers, not too many", () => {
    const box = { left: 1, top: 2, width: 30, height: 20 };
    expect(parsePageMessage({ type: "editables", boxes: [box] }, limits)).toEqual({
      type: "editables",
      boxes: [box],
    });
    expect(
      parsePageMessage({ type: "editables", boxes: [{ ...box, width: Number.NaN }] }, limits),
    ).toBeNull();
    expect(
      parsePageMessage({ type: "editables", boxes: [{ ...box, height: -1 }] }, limits),
    ).toBeNull();
    expect(parsePageMessage({ type: "editables", boxes: Array(257).fill(box) }, limits)).toBeNull();
    expect(parsePageMessage({ type: "editables", boxes: "all" }, limits)).toBeNull();
  });
});

describe("parseReady", () => {
  it("needs the type and an integer version", () => {
    expect(parseReady({ type: "ready", version: 1 })).toEqual({ type: "ready", version: 1 });
    expect(parseReady({ type: "ready" })).toBeNull();
    expect(parseReady({ type: "ready", version: "1" })).toBeNull();
    expect(parseReady({ type: "connect", version: 1 })).toBeNull();
  });
});

describe("parseHostMessage", () => {
  it("accepts a pace from 0 to a second", () => {
    expect(parseHostMessage({ type: "pace", intervalMs: 200 })).toEqual({
      type: "pace",
      intervalMs: 200,
    });
    expect(parseHostMessage({ type: "pace", intervalMs: 0 })).toEqual({
      type: "pace",
      intervalMs: 0,
    });
    for (const intervalMs of [-1, 1001, Number.NaN, Infinity, "200", undefined]) {
      expect(parseHostMessage({ type: "pace", intervalMs })).toBeNull();
    }
  });

  it("accepts whether the host draws the panel, as a boolean only", () => {
    expect(parseHostMessage({ type: "visibility", visible: false })).toEqual({
      type: "visibility",
      visible: false,
    });
    expect(parseHostMessage({ type: "visibility", visible: true })).toEqual({
      type: "visibility",
      visible: true,
    });
    expect(parseHostMessage({ type: "visibility", visible: "false" })).toBeNull();
    expect(parseHostMessage({ type: "visibility" })).toBeNull();
  });

  it("accepts panel input and drops malformed input", () => {
    expect(parseHostMessage({ type: "pointer", kind: "down", x: 1, y: 2 })).toEqual({
      type: "pointer",
      kind: "down",
      x: 1,
      y: 2,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      input: "mouse",
    });
    expect(
      parseHostMessage({ type: "pointer", kind: "down", x: 1, y: 2, ctrlKey: true, metaKey: true }),
    ).toMatchObject({
      ctrlKey: true,
      metaKey: true,
    });
    expect(parseHostMessage({ type: "pointer", kind: "down", x: 1, y: 2, ctrlKey: 1 })).toBeNull();
    expect(
      parseHostMessage({ type: "pointer", kind: "down", x: 1, y: 2, metaKey: "yes" }),
    ).toBeNull();
    expect(
      parseHostMessage({ type: "pointer", kind: "down", x: 1, y: 2, input: "touch" }),
    ).toMatchObject({ input: "touch" });
    expect(
      parseHostMessage({ type: "pointer", kind: "down", x: 1, y: 2, input: "pen" }),
    ).toBeNull();
    expect(
      parseHostMessage({ type: "pointer", kind: "down", x: 1, y: 2, shiftKey: "yes" }),
    ).toBeNull();
    expect(parseHostMessage({ type: "pointer", kind: "press", x: 1, y: 2 })).toBeNull();
    expect(
      parseHostMessage({ type: "wheel", x: 1, y: 2, deltaX: Number.NaN, deltaY: 0 }),
    ).toBeNull();
    expect(
      parseHostMessage({ type: "key", key: "a", shiftKey: false, ctrlKey: false, altKey: false }),
    ).toBeNull();
    expect(parseHostMessage({ type: "text", text: "" })).toBeNull();
    expect(parseHostMessage({ type: "blur" })).toEqual({ type: "blur" });
    expect(parseHostMessage({ type: "composition", text: "にほ", cursor: 2 })).toEqual({
      type: "composition",
      text: "にほ",
      cursor: 2,
    });
    expect(parseHostMessage({ type: "composition", text: "", cursor: 0 })).not.toBeNull();
    expect(parseHostMessage({ type: "composition", text: "にほ", cursor: 3 })).toBeNull();
    expect(parseHostMessage({ type: "composition", text: "にほ", cursor: -1 })).toBeNull();
    expect(parseHostMessage({ type: "composition", text: 1, cursor: 0 })).toBeNull();
  });
});

it("validates the optional hover optimization in connect messages", () => {
  for (const optimizeHover of [true, false])
    expect(parseConnect({ type: "connect", version: 1, optimizeHover })).toEqual({
      type: "connect",
      version: 1,
      optimizeHover,
    });
  for (const optimizeHover of [null, 0, "false", {}])
    expect(parseConnect({ type: "connect", version: 1, optimizeHover })).toBeNull();
  expect(parseConnect({ type: "connect", version: 1 })).toEqual({ type: "connect", version: 1 });
});
