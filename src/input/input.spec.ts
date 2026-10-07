// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { InputSynthesizer } from "./input"

let input: InputSynthesizer
const onChange = vi.fn()

beforeAll(() => {
  // jsdom has no PointerEvent.
  globalThis.PointerEvent ??= class extends MouseEvent {} as unknown as typeof PointerEvent
  input = new InputSynthesizer(document, { measure: run => run(), onChange })
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

  it("ignores text when no field has focus", () => {
    document.querySelector<HTMLButtonElement>("#go")!.focus()
    input.handle({ type: "text", text: "X" })
    expect(document.querySelector<HTMLInputElement>("#name")!.value).toBe("ab")
  })
})
