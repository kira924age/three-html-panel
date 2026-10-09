// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { measureCaret, measureSelection } from "./caret";
import { InputSynthesizer } from "./input";

let input: InputSynthesizer;
const onChange = vi.fn();

beforeAll(() => {
  // jsdom has no PointerEvent.
  globalThis.PointerEvent ??= class extends MouseEvent {} as unknown as typeof PointerEvent;
  input = new InputSynthesizer(document, { measure: (run) => run(), onChange });
});

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  document.body.innerHTML = `<input id="name" value="ab"><button id="go">Go</button>`;
  input.handle({ type: "blur" });
});

const key = (key: string) =>
  input.handle({
    type: "key",
    key,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
  });

describe("pointer capture of the synthetic pointer", () => {
  it("is held by the element that took it, until it lets it go", () => {
    const [field, button] = [document.querySelector("#name")!, document.querySelector("#go")!];
    expect(button.hasPointerCapture(1)).toBe(false);
    button.setPointerCapture(1);
    expect(button.hasPointerCapture(1)).toBe(true);
    expect(field.hasPointerCapture(1)).toBe(false);
    // Another element letting go does not release it.
    field.releasePointerCapture(1);
    expect(button.hasPointerCapture(1)).toBe(true);
    button.releasePointerCapture(1);
    expect(button.hasPointerCapture(1)).toBe(false);
  });
});

describe("virtual focus", () => {
  it("focus() from the page moves the virtual focus and dispatches focus events", () => {
    const field = document.querySelector<HTMLInputElement>("#name")!;
    const events: string[] = [];
    field.addEventListener("focus", () => events.push("focus"));
    document.addEventListener("focusin", () => events.push("focusin"));
    field.focus();
    expect(document.activeElement).toBe(field);
    expect(input.focused).toBe(field);
    expect(events).toEqual(["focus", "focusin"]);
  });

  it("blur() and Escape release focus", () => {
    const field = document.querySelector<HTMLInputElement>("#name")!;
    field.focus();
    field.blur();
    expect(document.activeElement).toBe(document.body);
    field.focus();
    key("Escape");
    expect(input.focused).toBeNull();
  });

  it("focus() on an element that cannot take focus leaves the focus where it is", () => {
    document.body.insertAdjacentHTML("beforeend", `<div id="plain">text</div>`);
    const field = document.querySelector<HTMLInputElement>("#name")!;
    field.focus();
    document.querySelector<HTMLElement>("#plain")!.focus();
    expect(input.focused).toBe(field);
  });

  it("loses focus when the element is removed", () => {
    const field = document.querySelector<HTMLInputElement>("#name")!;
    field.focus();
    field.remove();
    expect(input.focused).toBeNull();
  });
});

describe("text editing", () => {
  it("inserts text at the caret and fires input", () => {
    const field = document.querySelector<HTMLInputElement>("#name")!;
    const onInput = vi.fn();
    field.addEventListener("input", onInput);
    field.focus();
    field.setSelectionRange(1, 1);
    input.handle({ type: "text", text: "X" });
    expect(field.value).toBe("aXb");
    expect(field.selectionStart).toBe(2);
    expect(onInput).toHaveBeenCalledOnce();
  });

  it("deletes with Backspace and Delete", () => {
    const field = document.querySelector<HTMLInputElement>("#name")!;
    field.focus();
    field.setSelectionRange(1, 1);
    key("Backspace");
    expect(field.value).toBe("b");
    key("Delete");
    expect(field.value).toBe("");
  });

  it("does nothing when the page cancels beforeinput", () => {
    const field = document.querySelector<HTMLInputElement>("#name")!;
    field.addEventListener("beforeinput", (event) => event.preventDefault());
    field.focus();
    input.handle({ type: "text", text: "X" });
    expect(field.value).toBe("ab");
  });

  it("selects all with Ctrl+A outside Apple platforms", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
    const field = document.querySelector<HTMLInputElement>("#name")!;
    field.focus();
    field.setSelectionRange(1, 1);
    input.handle({
      type: "key",
      key: "a",
      shiftKey: false,
      ctrlKey: true,
      altKey: false,
      metaKey: false,
    });
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, 2]);
  });

  it("moves to the line start and end with Ctrl+A and Ctrl+E on macOS, and selects all with Cmd+A", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    document.body.innerHTML = "<textarea>ab\ncde\nf</textarea>";
    const textarea = document.querySelector("textarea")!;
    textarea.focus();
    textarea.setSelectionRange(5, 5);
    const press = (key: string, modifiers: { ctrlKey?: boolean; metaKey?: boolean }) =>
      input.handle({
        type: "key",
        key,
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
        metaKey: false,
        ...modifiers,
      });

    press("a", { ctrlKey: true });
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([3, 3]);
    press("e", { ctrlKey: true });
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([6, 6]);
    // Typing after Ctrl+A inserts at the line start instead of replacing everything.
    press("a", { ctrlKey: true });
    input.handle({ type: "text", text: "X" });
    expect(textarea.value).toBe("ab\nXcde\nf");
    press("a", { metaKey: true });
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([0, 9]);
  });

  it("reports the cursor under the pointer", () => {
    document.body.innerHTML = `<button id="go" style="cursor: pointer">Go</button><p id="text">text</p>`;
    const go = document.querySelector("#go")!;
    const text = document.querySelector("#text")!;
    // jsdom cannot build the pointer events that hovering dispatches, so the hover target is set directly.
    (input as unknown as { hoverTarget: Element | null }).hoverTarget = go;
    expect(input.cursor).toBe("pointer");
    (input as unknown as { hoverTarget: Element | null }).hoverTarget = text;
    expect(input.cursor).toBe("default");
    document.body.innerHTML = `<textarea></textarea>`;
    (input as unknown as { hoverTarget: Element | null }).hoverTarget =
      document.querySelector("textarea");
    expect(input.cursor).toBe("text");
  });

  it("keeps what is being composed for the focused field until it ends or focus moves", () => {
    const field = document.querySelector<HTMLInputElement>("#name")!;
    field.focus();
    input.handle({ type: "composition", text: "にほ", cursor: 2 });
    expect(input.composition).toEqual({ text: "にほ", cursor: 2 });
    // Composing does not touch the page's value.
    expect(field.value).toBe("ab");
    input.handle({ type: "composition", text: "", cursor: 0 });
    expect(input.composition).toBeNull();
    input.handle({ type: "composition", text: "に", cursor: 1 });
    document.querySelector<HTMLButtonElement>("#go")!.focus();
    expect(input.composition).toBeNull();
  });

  it("undoes and redoes the agent's own edits, typing in a row as one step", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    const field = document.querySelector<HTMLInputElement>("#name")!;
    field.focus();
    field.setSelectionRange(2, 2);
    const types: string[] = [];
    field.addEventListener("input", (event) => types.push((event as InputEvent).inputType));
    input.handle({ type: "text", text: "c" });
    input.handle({ type: "text", text: "d" });
    key("Backspace");
    expect(field.value).toBe("abc");
    const command = (k: string, shiftKey = false) =>
      input.handle({ type: "key", key: k, shiftKey, ctrlKey: false, altKey: false, metaKey: true });
    command("z");
    expect(field.value).toBe("abcd");
    command("z");
    expect(field.value).toBe("ab");
    expect(field.selectionStart).toBe(2);
    command("z", true);
    expect(field.value).toBe("abcd");
    expect(types.slice(-3)).toEqual(["historyUndo", "historyUndo", "historyRedo"]);
  });

  it("starts a new undo step when the caret moves between typing", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    const field = document.querySelector<HTMLInputElement>("#name")!;
    field.focus();
    field.setSelectionRange(2, 2);
    input.handle({ type: "text", text: "c" });
    key("ArrowLeft");
    input.handle({ type: "text", text: "d" });
    expect(field.value).toBe("abdc");
    input.handle({
      type: "key",
      key: "z",
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: true,
    });
    expect(field.value).toBe("abc");
  });

  it("cuts the selection when the host has cut it to the clipboard, and offers it for copying", () => {
    const field = document.querySelector<HTMLInputElement>("#name")!;
    field.focus();
    field.setSelectionRange(0, 1);
    expect(input.selectedText).toBe("a");
    input.handle({ type: "cut" });
    expect(field.value).toBe("b");
    document.body.innerHTML = `<input id="secret" type="password" value="hunter2">`;
    const secret = document.querySelector<HTMLInputElement>("#secret")!;
    secret.focus();
    secret.setSelectionRange(0, 7);
    // Never a password.
    expect(input.selectedText).toBe("");
  });

  it("moves focus with Tab and Shift+Tab in tab order, selecting a text field's text", () => {
    document.body.innerHTML = `
      <input id="a" value="one"><button id="b">B</button><input id="skip" tabindex="-1">
      <input id="c" disabled><input id="first" tabindex="1" value="x">
      <input type="radio" name="r" id="r1"><input type="radio" name="r" id="r2" checked>`;
    const byId = (id: string) => document.getElementById(id)!;
    const tab = (shiftKey = false) =>
      input.handle({
        type: "key",
        key: "Tab",
        shiftKey,
        ctrlKey: false,
        altKey: false,
        metaKey: false,
      });
    tab();
    expect(input.focused).toBe(byId("first"));
    tab();
    expect(input.focused).toBe(byId("a"));
    expect([
      (byId("a") as HTMLInputElement).selectionStart,
      (byId("a") as HTMLInputElement).selectionEnd,
    ]).toEqual([0, 3]);
    tab();
    expect(input.focused).toBe(byId("b"));
    // A radio group is one stop, at its checked radio.
    tab();
    expect(input.focused).toBe(byId("r2"));
    tab();
    expect(input.focused).toBe(byId("first"));
    tab(true);
    expect(input.focused).toBe(byId("r2"));
  });

  it("toggles checkboxes with Space, and moves through a radio group with the arrows", () => {
    document.body.innerHTML = `<input type="checkbox" id="c"><input type="radio" name="r" id="r1" checked><input type="radio" name="r" id="r2">`;
    const checkbox = document.getElementById("c") as HTMLInputElement;
    const changes: string[] = [];
    document.addEventListener("change", (event) => changes.push((event.target as Element).id));
    checkbox.focus();
    key(" ");
    expect(checkbox.checked).toBe(true);
    // The host sends a typed space as text.
    input.handle({ type: "text", text: " " });
    expect(checkbox.checked).toBe(false);
    const r1 = document.getElementById("r1") as HTMLInputElement;
    r1.focus();
    key("ArrowDown");
    expect((document.getElementById("r2") as HTMLInputElement).checked).toBe(true);
    expect(input.focused?.id).toBe("r2");
    expect(changes).toEqual(["c", "c", "r2"]);
  });

  it("ignores text when no field has focus", () => {
    document.querySelector<HTMLButtonElement>("#go")!.focus();
    input.handle({ type: "text", text: "X" });
    expect(document.querySelector<HTMLInputElement>("#name")!.value).toBe("ab");
  });
});

// Email and number fields have no selection API: selectionStart is null, and
// setSelectionRange and setRangeText throw (in jsdom as in browsers).
describe("email and number fields", () => {
  const field = () => document.querySelector<HTMLInputElement>("input")!;
  const type = (text: string) => {
    for (const character of text) input.handle({ type: "text", text: character });
  };
  const press = (key: string, modifiers: { ctrlKey?: boolean; metaKey?: boolean } = {}) =>
    input.handle({
      type: "key",
      key,
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      ...modifiers,
    });

  it("have no selection API here, as in browsers", () => {
    for (const kind of ["email", "number"]) {
      document.body.innerHTML = `<input type="${kind}">`;
      expect(field().selectionStart).toBeNull();
      expect(() => field().setSelectionRange(0, 0)).toThrow();
      expect(() => field().setRangeText("1", 0, 0)).toThrow();
    }
  });

  it("type into an email field, with beforeinput and input events", () => {
    document.body.innerHTML = `<input type="email">`;
    const events: string[] = [];
    for (const name of ["beforeinput", "input"]) {
      field().addEventListener(name, (event) =>
        events.push(`${name}:${(event as InputEvent).data}:${field().value}`),
      );
    }
    field().focus();
    type("x@y.z");
    expect(field().value).toBe("x@y.z");
    expect(events.slice(0, 4)).toEqual([
      "beforeinput:x:",
      "input:x:x",
      "beforeinput:@:x",
      "input:@:x@",
    ]);
  });

  it("delete from the end with Backspace, and do nothing on Delete at the end", () => {
    document.body.innerHTML = `<input type="email" value="ab@c">`;
    field().focus();
    press("Backspace");
    expect(field().value).toBe("ab@");
    press("Delete");
    expect(field().value).toBe("ab@");
  });

  it("keep their own caret: the arrows move it, and typing goes there", () => {
    document.body.innerHTML = `<input type="email" value="a@c">`;
    field().focus();
    press("ArrowLeft");
    type("b");
    expect(field().value).toBe("a@bc");
    press("Delete");
    expect(field().value).toBe("a@b");
  });

  it("select all, offer the selection for copying, and replace it when typing", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
    document.body.innerHTML = `<input type="email" value="old@example.com">`;
    field().focus();
    press("a", { ctrlKey: true });
    expect(input.selectedText).toBe("old@example.com");
    expect(() => measureSelection(field())).not.toThrow();
    // A caret is not drawn while text is selected.
    expect(measureCaret(field())).toBeNull();
    type("n@e.w");
    expect(field().value).toBe("n@e.w");
  });

  it("cut the selected text", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
    document.body.innerHTML = `<input type="number" value="42">`;
    field().focus();
    press("a", { ctrlKey: true });
    input.handle({ type: "cut" });
    expect(field().value).toBe("");
  });

  it("select their text when Tab focuses them", () => {
    document.body.innerHTML = `<input type="email" value="a@b">`;
    press("Tab");
    expect(input.focused).toBe(field());
    expect(input.selectedText).toBe("a@b");
  });

  it("undo and redo typing", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    document.body.innerHTML = `<input type="number" value="1">`;
    field().focus();
    type("23");
    press("Backspace");
    expect(field().value).toBe("12");
    press("z", { metaKey: true });
    expect(field().value).toBe("123");
    press("z", { metaKey: true });
    expect(field().value).toBe("1");
    press("z", { metaKey: true });
    expect(field().value).toBe("1");
    input.handle({
      type: "key",
      key: "z",
      shiftKey: true,
      ctrlKey: false,
      altKey: false,
      metaKey: true,
    });
    expect(field().value).toBe("123");
  });

  it("type a number through text that is not a number yet, which reads as empty meanwhile", () => {
    document.body.innerHTML = `<input type="number">`;
    const values: string[] = [];
    field().addEventListener("input", () => values.push(field().value));
    field().focus();
    type("-1.5e3");
    // The browser sanitizes "-", "-1." and "-1.5e" to "", as when typed in browsers.
    expect(values).toEqual(["", "-1", "", "-1.5", "", "-1.5e3"]);
    expect(field().value).toBe("-1.5e3");
    press("Backspace");
    expect(field().value).toBe("");
    press("Backspace");
    expect(field().value).toBe("-1.5");
  });

  it("start again from the value when the page sets it", () => {
    document.body.innerHTML = `<input type="number">`;
    field().focus();
    type("1e");
    field().value = "7";
    type("0");
    expect(field().value).toBe("70");
  });

  it("insert what an IME composed", () => {
    document.body.innerHTML = `<input type="email" value="a@">`;
    field().focus();
    input.handle({ type: "composition", text: "b", cursor: 1 });
    expect(() => measureCaret(field(), input.composition)).not.toThrow();
    input.handle({ type: "text", text: "b.c" });
    expect(field().value).toBe("a@b.c");
  });

  it("keep the value React tracks on the element unchanged until input, so React sees the change", () => {
    document.body.innerHTML = `<input type="email">`;
    const element = field();
    // React wraps `value` on the element to remember the value it set.
    let tracked = "";
    const native = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!;
    Object.defineProperty(element, "value", {
      configurable: true,
      get() {
        return native.get!.call(this);
      },
      set(value: string) {
        tracked = value;
        native.set!.call(this, value);
      },
    });
    element.focus();
    type("a");
    expect(element.value).toBe("a");
    expect(tracked).toBe("");
  });
});
