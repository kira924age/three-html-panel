// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest"
import { PROTOCOL_VERSION } from "../protocol"
import { parseOrigin, readHostOrigin, startAgent, type PanelAgent } from "./agent"
import { onHostMessage, sendToHost } from "./page"

const HOST = "https://host.example"

let parent: { postMessage: Mock }
let agent: PanelAgent | null = null
let channel: MessageChannel | null = null

beforeAll(() => {
  // jsdom has no PointerEvent.
  globalThis.PointerEvent ??= class extends MouseEvent {} as unknown as typeof PointerEvent
})

beforeEach(() => {
  parent = { postMessage: vi.fn() }
  document.body.innerHTML = `<p>hello</p>`
})

afterEach(() => {
  agent?.dispose()
  agent = null
  channel?.port1.close()
  channel?.port2.close()
  channel = null
})

const start = (hostOrigin: string | null = HOST) =>
  (agent = startAgent({ hostOrigin, parent: parent as unknown as Window }))

/** Delivers `connect` to the page's window, as if posted by `source` from `origin`. */
function connect(origin = HOST, source: unknown = parent): MessagePort {
  channel = new MessageChannel()
  const event = new MessageEvent("message", { data: { type: "connect", version: PROTOCOL_VERSION }, origin })
  Object.defineProperty(event, "source", { value: source })
  Object.defineProperty(event, "ports", { value: [channel.port2] })
  window.dispatchEvent(event)
  return channel.port1
}

const delivered = () => new Promise(resolve => setTimeout(resolve, 50))

describe("starting", () => {
  it("does not start without a valid host origin, and posts nothing", () => {
    for (const origin of [null, "", "*", "null", "https://host.example/", "https://host.example/path", "host.example"]) {
      expect(start(origin)).toBeNull()
    }
    expect(parent.postMessage).not.toHaveBeenCalled()
  })

  it("replaces requestAnimationFrame when it starts, so a held-back iframe does not stall the page", () => {
    const original = window.requestAnimationFrame
    start()
    expect(window.requestAnimationFrame).not.toBe(original)
    window.requestAnimationFrame = original
  })

  it("does not start outside a frame", () => {
    expect(startAgent({ hostOrigin: HOST, parent: window })).toBeNull()
  })

  it("posts ready to the host origin only", () => {
    start()
    expect(parent.postMessage).toHaveBeenCalledTimes(1)
    expect(parent.postMessage).toHaveBeenCalledWith({ type: "ready", version: PROTOCOL_VERSION }, HOST)
  })

  it("reads the host origin from its script tag", () => {
    document.head.innerHTML = `<script type="module" data-host-origin="${HOST}"></script>`
    expect(readHostOrigin(document)).toBe(HOST)
    document.head.innerHTML = `<script type="module" data-host-origin="*"></script>`
    expect(readHostOrigin(document)).toBeNull()
    document.head.innerHTML = ""
    expect(readHostOrigin(document)).toBeNull()
    expect(parseOrigin("http://localhost:5173")).toBe("http://localhost:5173")
  })
})

describe("connecting", () => {
  it("ignores connect from another origin or window", () => {
    start()
    connect("https://evil.example")
    expect(agent!.connected).toBe(false)
    connect(HOST, window)
    expect(agent!.connected).toBe(false)
    connect(HOST, null)
    expect(agent!.connected).toBe(false)
  })

  it("talks through the port once connected, and nowhere else", async () => {
    start()
    const host = connect()
    expect(agent!.connected).toBe(true)
    const received: { type: string }[] = []
    host.onmessage = event => received.push(event.data)

    sendToHost({ shape: "box" })
    const fromHost: unknown[] = []
    const stop = onHostMessage(data => fromHost.push(data))
    host.postMessage({ type: "app", data: "scene-click" })
    await delivered()
    stop()

    expect(received).toContainEqual({ type: "app", data: { shape: "box" } })
    expect(received.some(message => message.type === "frame")).toBe(true)
    expect(fromHost).toEqual(["scene-click"])
    // Only `ready` ever went through the parent window.
    expect(parent.postMessage).toHaveBeenCalledTimes(1)
  })

  it("answers the host's ping, so the host knows this document has an agent", async () => {
    start()
    const host = connect()
    const received: { type: string }[] = []
    host.onmessage = event => received.push(event.data)
    host.postMessage({ type: "ping" })
    await delivered()
    expect(received).toContainEqual({ type: "pong" })
  })

  it("asks for the keys while any element has focus, with a caret only for a text field", async () => {
    document.body.innerHTML = `<button id="go">Go</button>`
    start()
    const host = connect()
    const received: { type: string; editing?: boolean; caret?: unknown }[] = []
    host.onmessage = event => received.push(event.data)
    document.querySelector<HTMLButtonElement>("#go")!.focus()
    host.postMessage({ type: "key", key: "Shift", shiftKey: true, ctrlKey: false, altKey: false, metaKey: false })
    await vi.waitFor(() =>
      expect(received.filter(message => message.type === "editing").at(-1)).toMatchObject({ editing: true, caret: null })
    )
  })

  it("answers every tap: an editing report, counting the pointer inputs handled, follows each release", async () => {
    document.body.innerHTML = `<p>no field here</p>`
    // jsdom has no layout, and refuses the `view` the agent gives the events it makes.
    document.elementFromPoint = () => document.querySelector("p")
    const { MouseEvent: Mouse, PointerEvent: Pointer } = window
    window.MouseEvent = class extends Mouse {
      constructor(type: string, init?: MouseEventInit) {
        super(type, { ...init, view: null })
      }
    }
    window.PointerEvent = class extends Pointer {
      constructor(type: string, init?: PointerEventInit) {
        super(type, { ...init, view: null })
      }
    }
    start()
    const host = connect()
    const received: { type: string; editing?: boolean; pointers?: number }[] = []
    host.onmessage = event => received.push(event.data)
    const editing = () => received.filter(message => message.type === "editing")
    host.postMessage({ type: "pointer", kind: "down", x: 5, y: 5, input: "touch" })
    host.postMessage({ type: "pointer", kind: "up", x: 5, y: 5, input: "touch" })
    // Nothing is focused, so nothing changed for the host: it is still told.
    await vi.waitFor(() => expect(editing().at(-1)).toMatchObject({ editing: false, pointers: 2 }))
    const before = editing().length
    host.postMessage({ type: "pointer", kind: "down", x: 5, y: 5, input: "touch" })
    host.postMessage({ type: "pointer", kind: "move", x: 6, y: 6, input: "touch" })
    host.postMessage({ type: "pointer", kind: "up", x: 6, y: 6, input: "touch" })
    // Moves and leaves are not counted: only presses and releases.
    host.postMessage({ type: "pointer", kind: "leave", x: 0, y: 0 })
    await vi.waitFor(() => expect(editing().at(-1)).toMatchObject({ editing: false, pointers: 4 }))
    expect(editing().length).toBeGreaterThan(before)
    delete (document as { elementFromPoint?: unknown }).elementFromPoint
    window.MouseEvent = Mouse
    window.PointerEvent = Pointer
  })

  it("offers no selection for copying when it is too long to send, rather than a part of it", async () => {
    document.body.innerHTML = `<textarea id="long"></textarea>`
    const field = document.querySelector<HTMLTextAreaElement>("#long")!
    field.value = "x".repeat(64 * 1024 + 1)
    start()
    const host = connect()
    const received: { type: string; selectedText?: string }[] = []
    host.onmessage = event => received.push(event.data)
    field.focus()
    field.setSelectionRange(0, field.value.length)
    const lastEditing = () => received.filter(message => message.type === "editing").at(-1)
    // A frame of this much text is slow, so the agent spaces the next ones out: wait for them.
    host.postMessage({ type: "key", key: "Shift", shiftKey: true, ctrlKey: false, altKey: false, metaKey: false })
    await vi.waitFor(() => expect(lastEditing()).toMatchObject({ editing: true, selectedText: "" }), { timeout: 3000 })

    field.setSelectionRange(0, 3)
    host.postMessage({ type: "key", key: "Shift", shiftKey: true, ctrlKey: false, altKey: false, metaKey: false })
    await vi.waitFor(() => expect(lastEditing()).toMatchObject({ selectedText: "xxx" }), { timeout: 3000 })
  })

  it("asks for the keys while the page's text is selected, offering it for copying", async () => {
    document.body.innerHTML = `<p id="text">some   words</p>`
    // jsdom has no layout.
    Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList
    start()
    const host = connect()
    const received: { type: string; editing?: boolean; selectedText?: string }[] = []
    host.onmessage = event => received.push(event.data)
    getSelection()!.selectAllChildren(document.querySelector("#text")!)
    host.postMessage({ type: "key", key: "Shift", shiftKey: true, ctrlKey: false, altKey: false, metaKey: false })
    await vi.waitFor(() =>
      expect(received.filter(message => message.type === "editing").at(-1)).toMatchObject({
        editing: true,
        selectedText: "some words"
      })
    )
    getSelection()!.removeAllRanges()
  })

  it("measures the page's selection again only when the page changes, not on every frame an animation asks for", async () => {
    document.body.innerHTML = `<p id="text">some words</p>`
    const rects = vi.fn(() => [] as unknown as DOMRectList)
    const original = Range.prototype.getClientRects
    Range.prototype.getClientRects = rects
    // An endless animation keeps frames coming.
    const animation = {
      effect: { target: document.body, pseudoElement: null, getKeyframes: () => [], getTiming: () => ({ iterations: Infinity }) },
      playState: "running"
    }
    document.getAnimations = () => [animation as unknown as Animation]
    try {
      start()
      const host = connect()
      const frames: unknown[] = []
      const editing: { selectedText: string }[] = []
      host.onmessage = event => {
        if (event.data.type === "frame") frames.push(event.data)
        if (event.data.type === "editing") editing.push(event.data)
      }
      // The user's selection (a key press after it makes it theirs).
      getSelection()!.selectAllChildren(document.querySelector("#text")!)
      host.postMessage({ type: "key", key: "Shift", shiftKey: true, ctrlKey: false, altKey: false, metaKey: false })
      await vi.waitFor(() => expect(rects).toHaveBeenCalled())
      const measured = rects.mock.calls.length
      const seen = frames.length
      await vi.waitFor(() => expect(frames.length).toBeGreaterThan(seen + 2), { timeout: 3000 })
      expect(rects.mock.calls.length).toBe(measured)
      // The selected text itself changes (the selection's ends stay): it is built again.
      ;(document.querySelector("#text")!.firstChild as Text).data = "other words"
      await vi.waitFor(() => expect(rects.mock.calls.length).toBeGreaterThan(measured))
      await vi.waitFor(() => expect(editing.at(-1)?.selectedText).toBe("other words"))
    } finally {
      delete (document as { getAnimations?: unknown }).getAnimations
      Range.prototype.getClientRects = original
      getSelection()!.removeAllRanges()
    }
  })

  it("reports a contenteditable element as a text field too", async () => {
    document.body.innerHTML = `<div id="editor" contenteditable="true"><p>text</p></div>`
    const editor = document.querySelector<HTMLElement>("#editor")!
    editor.getBoundingClientRect = () => new DOMRect(10, 20, 200, 80)
    // jsdom has no isContentEditable.
    Object.defineProperty(HTMLElement.prototype, "isContentEditable", {
      configurable: true,
      get(this: HTMLElement) {
        return this.closest("[contenteditable=true]") !== null
      }
    })
    try {
      start()
      const host = connect()
      const received: { type: string; boxes?: unknown }[] = []
      host.onmessage = event => received.push(event.data)
      await vi.waitFor(() =>
        expect(received.find(message => message.type === "editables")).toEqual({
          type: "editables",
          boxes: [{ left: 10, top: 20, width: 200, height: 80 }]
        })
      )
    } finally {
      delete (HTMLElement.prototype as { isContentEditable?: boolean }).isContentEditable
    }
  })

  it("hands a link the user follows to the host", async () => {
    document.body.innerHTML = `<a id="docs" href="https://example.com/docs">Docs</a>`
    start()
    const host = connect()
    const received: { type: string; url?: string }[] = []
    host.onmessage = event => received.push(event.data)
    document.getElementById("docs")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
    await delivered()
    expect(received).toContainEqual({ type: "open", url: "https://example.com/docs" })
  })

  it("reports where the text fields are, for the host to open a soft keyboard on a tap", async () => {
    document.body.innerHTML = `<input id="name"><input id="below"><button>Go</button>`
    document.querySelector("#name")!.getBoundingClientRect = () => new DOMRect(10, 20, 100, 30)
    // Scrolled out of view: not reported.
    document.querySelector("#below")!.getBoundingClientRect = () => new DOMRect(10, 5000, 100, 30)
    start()
    const host = connect()
    const received: { type: string; boxes?: unknown }[] = []
    host.onmessage = event => received.push(event.data)
    await vi.waitFor(() =>
      expect(received.find(message => message.type === "editables")).toEqual({
        type: "editables",
        boxes: [{ left: 10, top: 20, width: 100, height: 30 }]
      })
    )
  })

  it("does not send anything before it is connected", async () => {
    start()
    sendToHost({ shape: "box" })
    await delivered()
    expect(parent.postMessage).toHaveBeenCalledTimes(1)
  })
})
