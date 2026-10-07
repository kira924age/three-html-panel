// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { InputSynthesizer } from "./input"

let input: InputSynthesizer
const onChange = vi.fn()

beforeAll(() => {
  // jsdom has no PointerEvent.
  globalThis.PointerEvent ??= class extends MouseEvent {} as unknown as typeof PointerEvent
  input = new InputSynthesizer(document, { measure: run => run(), onChange })
})

afterEach(() => {
  vi.restoreAllMocks()
})

beforeEach(() => {
  document.body.innerHTML = `<input id="name" value="ab"><button id="go">Go</button>`
  input.handle({ type: "blur" })
})

const key = (key: string) =>
  input.handle({ type: "key", key, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false })

describe("virtual focus", () => {
  it("focus() from the page moves the virtual focus and dispatches focus events", () => {
    const field = document.querySelector<HTMLInputElement>("#name")!
    const events: string[] = []
    field.addEventListener("focus", () => events.push("focus"))
    document.addEventListener("focusin", () => events.push("focusin"))
    field.focus()
    expect(document.activeElement).toBe(field)
    expect(input.focused).toBe(field)
    expect(events).toEqual(["focus", "focusin"])
  })

  it("blur() and Escape release focus", () => {
    const field = document.querySelector<HTMLInputElement>("#name")!
    field.focus()
    field.blur()
    expect(document.activeElement).toBe(document.body)
    field.focus()
    key("Escape")
    expect(input.focused).toBeNull()
  })

  it("loses focus when the element is removed", () => {
    const field = document.querySelector<HTMLInputElement>("#name")!
    field.focus()
    field.remove()
    expect(input.focused).toBeNull()
  })
})

describe("text editing", () => {
  it("inserts text at the caret and fires input", () => {
    const field = document.querySelector<HTMLInputElement>("#name")!
    const onInput = vi.fn()
    field.addEventListener("input", onInput)
    field.focus()
    field.setSelectionRange(1, 1)
    input.handle({ type: "text", text: "X" })
    expect(field.value).toBe("aXb")
    expect(field.selectionStart).toBe(2)
    expect(onInput).toHaveBeenCalledOnce()
  })

  it("deletes with Backspace and Delete", () => {
    const field = document.querySelector<HTMLInputElement>("#name")!
    field.focus()
    field.setSelectionRange(1, 1)
    key("Backspace")
    expect(field.value).toBe("b")
    key("Delete")
    expect(field.value).toBe("")
  })

  it("does nothing when the page cancels beforeinput", () => {
    const field = document.querySelector<HTMLInputElement>("#name")!
    field.addEventListener("beforeinput", event => event.preventDefault())
    field.focus()
    input.handle({ type: "text", text: "X" })
    expect(field.value).toBe("ab")
  })

  it("selects all with Ctrl+A outside Apple platforms", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32")
    const field = document.querySelector<HTMLInputElement>("#name")!
    field.focus()
    field.setSelectionRange(1, 1)
    input.handle({ type: "key", key: "a", shiftKey: false, ctrlKey: true, altKey: false, metaKey: false })
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, 2])
  })

  it("moves to the line start and end with Ctrl+A and Ctrl+E on macOS, and selects all with Cmd+A", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel")
    document.body.innerHTML = "<textarea>ab\ncde\nf</textarea>"
    const textarea = document.querySelector("textarea")!
    textarea.focus()
    textarea.setSelectionRange(5, 5)
    const press = (key: string, modifiers: { ctrlKey?: boolean; metaKey?: boolean }) =>
      input.handle({ type: "key", key, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, ...modifiers })

    press("a", { ctrlKey: true })
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([3, 3])
    press("e", { ctrlKey: true })
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([6, 6])
    // Typing after Ctrl+A inserts at the line start instead of replacing everything.
    press("a", { ctrlKey: true })
    input.handle({ type: "text", text: "X" })
    expect(textarea.value).toBe("ab\nXcde\nf")
    press("a", { metaKey: true })
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([0, 9])
  })

  it("reports the cursor under the pointer", () => {
    document.body.innerHTML = `<button id="go" style="cursor: pointer">Go</button><p id="text">text</p>`
    const go = document.querySelector("#go")!
    const text = document.querySelector("#text")!
    // jsdom cannot build the pointer events that hovering dispatches, so the hover target is set directly.
    ;(input as unknown as { hoverTarget: Element | null }).hoverTarget = go
    expect(input.cursor).toBe("pointer")
    ;(input as unknown as { hoverTarget: Element | null }).hoverTarget = text
    expect(input.cursor).toBe("default")
    document.body.innerHTML = `<textarea></textarea>`
    ;(input as unknown as { hoverTarget: Element | null }).hoverTarget = document.querySelector("textarea")
    expect(input.cursor).toBe("text")
  })

  it("ignores text when no field has focus", () => {
    document.querySelector<HTMLButtonElement>("#go")!.focus()
    input.handle({ type: "text", text: "X" })
    expect(document.querySelector<HTMLInputElement>("#name")!.value).toBe("ab")
  })
})
