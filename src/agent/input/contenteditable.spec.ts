import { describe, expect, it } from "vite-plus/test";
import { contentAction } from "./contenteditable";

const press = (
  key: string,
  modifiers: Partial<{ shift: boolean; ctrl: boolean; alt: boolean; meta: boolean }> = {},
) => ({
  key,
  shiftKey: modifiers.shift ?? false,
  ctrlKey: modifiers.ctrl ?? false,
  altKey: modifiers.alt ?? false,
  metaKey: modifiers.meta ?? false,
});

describe("contentAction", () => {
  it("moves by character, and extends with Shift", () => {
    expect(contentAction(press("ArrowLeft"), false, true)).toEqual({
      type: "modify",
      alter: "move",
      direction: "backward",
      granularity: "character",
    });
    expect(contentAction(press("ArrowRight", { shift: true }), false, true)).toEqual({
      type: "modify",
      alter: "extend",
      direction: "forward",
      granularity: "character",
    });
  });

  it("goes to the end of the selected text with an arrow, rather than moving from it", () => {
    expect(contentAction(press("ArrowLeft"), false, false)).toEqual({
      type: "collapse",
      toStart: true,
    });
    expect(contentAction(press("ArrowRight"), false, false)).toEqual({
      type: "collapse",
      toStart: false,
    });
    // With Shift it extends, as usual.
    expect(contentAction(press("ArrowRight", { shift: true }), false, false)).toMatchObject({
      type: "modify",
      alter: "extend",
    });
  });

  it("moves by word and to line ends with the platform's modifiers", () => {
    expect(contentAction(press("ArrowLeft", { alt: true }), true, true)).toMatchObject({
      granularity: "word",
    });
    expect(contentAction(press("ArrowLeft", { ctrl: true }), false, true)).toMatchObject({
      granularity: "word",
    });
    expect(contentAction(press("ArrowRight", { meta: true }), true, true)).toMatchObject({
      granularity: "lineboundary",
    });
    expect(contentAction(press("ArrowUp", { meta: true }), true, true)).toMatchObject({
      granularity: "documentboundary",
    });
    expect(contentAction(press("ArrowDown"), false, true)).toMatchObject({
      direction: "forward",
      granularity: "line",
    });
    expect(contentAction(press("Home"), false, true)).toMatchObject({
      direction: "backward",
      granularity: "lineboundary",
    });
    expect(contentAction(press("End", { ctrl: true }), false, true)).toMatchObject({
      granularity: "documentboundary",
    });
  });

  it("deletes, by word or to the line's start with the modifiers", () => {
    expect(contentAction(press("Backspace"), false, true)).toEqual({
      type: "command",
      command: "delete",
      inputType: "deleteContentBackward",
    });
    expect(contentAction(press("Delete"), false, true)).toEqual({
      type: "command",
      command: "forwardDelete",
      inputType: "deleteContentForward",
    });
    expect(contentAction(press("Backspace", { alt: true }), true, true)).toEqual({
      type: "command",
      command: "delete",
      inputType: "deleteWordBackward",
      extend: { direction: "backward", granularity: "word" },
    });
    expect(contentAction(press("Backspace", { meta: true }), true, true)).toMatchObject({
      inputType: "deleteSoftLineBackward",
      extend: { granularity: "lineboundary" },
    });
    expect(contentAction(press("Delete", { ctrl: true }), false, true)).toMatchObject({
      inputType: "deleteWordForward",
    });
  });

  it("starts a paragraph with Enter, and breaks the line with Shift+Enter", () => {
    expect(contentAction(press("Enter"), false, true)).toMatchObject({
      command: "insertParagraph",
      inputType: "insertParagraph",
    });
    expect(contentAction(press("Enter", { shift: true }), false, true)).toMatchObject({
      command: "insertLineBreak",
      inputType: "insertLineBreak",
    });
  });

  it("selects all, undoes, redoes and formats with the platform's shortcut key", () => {
    expect(contentAction(press("a", { meta: true }), true, true)).toEqual({ type: "selectAll" });
    expect(contentAction(press("a", { ctrl: true }), false, true)).toEqual({ type: "selectAll" });
    expect(contentAction(press("z", { meta: true }), true, true)).toMatchObject({
      command: "undo",
      inputType: "historyUndo",
    });
    expect(contentAction(press("z", { meta: true, shift: true }), true, true)).toMatchObject({
      command: "redo",
    });
    expect(contentAction(press("y", { ctrl: true }), false, true)).toMatchObject({
      command: "redo",
    });
    expect(contentAction(press("b", { ctrl: true }), false, true)).toMatchObject({
      command: "bold",
      inputType: "formatBold",
    });
    expect(contentAction(press("i", { meta: true }), true, true)).toMatchObject({
      command: "italic",
    });
    expect(contentAction(press("u", { ctrl: true }), false, true)).toMatchObject({
      command: "underline",
    });
  });

  it("keeps the Emacs keys of macOS: Ctrl+A is the line's start there, not select all", () => {
    expect(contentAction(press("a", { ctrl: true }), true, true)).toMatchObject({
      type: "modify",
      granularity: "lineboundary",
    });
    expect(contentAction(press("e", { ctrl: true }), true, true)).toMatchObject({
      direction: "forward",
      granularity: "lineboundary",
    });
    expect(contentAction(press("b", { ctrl: true }), true, true)).toMatchObject({
      type: "modify",
      direction: "backward",
    });
    expect(contentAction(press("k", { ctrl: true }), true, true)).toMatchObject({
      command: "delete",
      extend: { direction: "forward", granularity: "lineboundary" },
    });
  });

  it("leaves other keys alone", () => {
    expect(contentAction(press("x"), false, true)).toBeNull();
    expect(contentAction(press("Tab"), false, true)).toBeNull();
    expect(contentAction(press("Enter", { meta: true }), true, true)).toBeNull();
    expect(contentAction(press("a", { meta: true }), false, true)).toBeNull();
  });
});
