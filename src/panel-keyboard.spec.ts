// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PanelKeyboard, type KeyboardTarget } from "./panel-keyboard"

// One keyboard for the file: it listens on the window and the document for good.
const keyboard = new PanelKeyboard()
let frame: HTMLIFrameElement
let hostInput: HTMLInputElement

beforeEach(() => {
  frame = document.createElement("iframe")
  frame.tabIndex = -1
  hostInput = document.createElement("input")
  document.body.append(frame, hostInput)
  vi.useFakeTimers()
})

afterEach(() => {
  keyboard.unregister(frame)
  frame.remove()
  hostInput.remove()
  vi.useRealTimers()
})

/** The page focuses something: focus moves to the iframe, and the host's window gets blur. */
function pageTakesFocus(): void {
  frame.focus()
  window.dispatchEvent(new Event("blur"))
  vi.runAllTimers()
}

describe("a panel iframe that takes focus", () => {
  it("gives it back to where focus was in the host, when sandboxed", () => {
    keyboard.register(frame, { sandboxed: true })
    hostInput.focus()
    pageTakesFocus()
    expect(document.activeElement).toBe(hostInput)
  })

  it("gives it back at once when only focusout tells (Firefox does not blur the host's window)", async () => {
    keyboard.register(frame, { sandboxed: true })
    hostInput.focus()
    vi.useRealTimers()
    frame.focus()
    // No window blur, no timers: the microtask after focusout is enough.
    await Promise.resolve()
    expect(document.activeElement).toBe(hostInput)
  })

  it("loses it when sandboxed and there is nowhere to give it back to", () => {
    keyboard.register(frame, { sandboxed: true })
    hostInput.remove()
    const blur = vi.spyOn(frame, "blur")
    pageTakesFocus()
    // jsdom does not move focus off an iframe on blur(); browsers do.
    expect(blur).toHaveBeenCalled()
  })

  it("gives it to the hidden field while a panel is being typed into", () => {
    keyboard.register(frame, { sandboxed: true })
    const target: KeyboardTarget = { sendKey: () => {}, sendText: () => {}, blurFromHost: () => {} }
    keyboard.focus(target)
    pageTakesFocus()
    const active = document.activeElement
    expect(active).not.toBe(frame)
    expect(active?.tagName).toBe("TEXTAREA")
    keyboard.release(target)
  })
})
