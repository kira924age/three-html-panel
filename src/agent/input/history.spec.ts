import { describe, expect, it } from "vite-plus/test";
import { EditHistory } from "./history";

const field = {} as Element;
const state = (value: string, start = value.length, end = start) => ({ value, start, end });

describe("EditHistory", () => {
  it("undoes typing in a row as one step, and redoes it", () => {
    const history = new EditHistory();
    history.record(field, state(""), "insertText");
    history.edited(field, "a");
    history.record(field, state("a"), "insertText");
    history.edited(field, "ab");
    expect(history.undo(field, state("ab"))).toEqual(state(""));
    expect(history.redo(field, state(""))).toEqual(state("ab"));
  });

  it("starts a new step after the caret moves, or for another kind of edit", () => {
    const history = new EditHistory();
    history.record(field, state(""), "insertText");
    history.edited(field, "a");
    history.breakTyping(field);
    history.record(field, state("a"), "insertText");
    history.edited(field, "ab");
    history.record(field, state("ab"), "deleteContentBackward");
    history.edited(field, "a");
    expect(history.undo(field, state("a"))).toEqual(state("ab"));
    expect(history.undo(field, state("ab"))).toEqual(state("a"));
    expect(history.undo(field, state("a"))).toEqual(state(""));
    expect(history.undo(field, state(""))).toBeNull();
  });

  it("drops the history when the page changed the value itself", () => {
    const history = new EditHistory();
    history.record(field, state(""), "insertText");
    history.edited(field, "a");
    expect(history.undo(field, state("reset by the page"))).toBeNull();
    expect(history.undo(field, state("a"))).toBeNull();
  });

  it("forgets what was undone once something new is typed", () => {
    const history = new EditHistory();
    history.record(field, state(""), "insertText");
    history.edited(field, "a");
    history.undo(field, state("a"));
    history.edited(field, "");
    history.record(field, state(""), "insertText");
    history.edited(field, "b");
    expect(history.redo(field, state("b"))).toBeNull();
  });
});
