// @vitest-environment jsdom
import { PerspectiveCamera, Scene, Vector2, type WebGLRenderer } from "three"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { HtmlPanel, PANEL_SANDBOX, splitAlpha } from "./html-panel"
import { PanelKeyboard } from "./panel-keyboard"

describe("splitAlpha", () => {
  it("splits the alpha off a CSS color", () => {
    expect(splitAlpha("rgb(1, 2, 3)")).toEqual({ rgb: "rgb(1, 2, 3)", alpha: 1 })
    expect(splitAlpha("rgba(0, 0, 0, 0)")).toEqual({ rgb: "rgb(0, 0, 0)", alpha: 0 })
    expect(splitAlpha("rgb(10 20 30 / 50%)")).toEqual({ rgb: "rgb(10, 20, 30)", alpha: 0.5 })
    expect(splitAlpha("transparent").alpha).toBe(0)
    expect(splitAlpha("#ff0000")).toEqual({ rgb: "#ff0000", alpha: 1 })
  })
})

describe("the panel's iframe", () => {
  /** The iframe's sandbox attribute at the moment its src was set, for each iframe. */
  let sandboxAtSrc: (string | null)[]
  const panels: HtmlPanel[] = []

  beforeAll(() => {
    // jsdom has no canvas; the renderer only needs a context to paint into.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      fillRect: () => {},
      drawImage: () => {}
    } as unknown as CanvasRenderingContext2D)
    const src = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "src")!
    Object.defineProperty(HTMLIFrameElement.prototype, "src", {
      configurable: true,
      get: src.get,
      set(this: HTMLIFrameElement, value: string) {
        sandboxAtSrc.push(this.getAttribute("sandbox"))
        // jsdom would try to load the page; the attribute is what matters here.
        this.setAttribute("data-src", value)
      }
    })
  })

  afterEach(() => {
    for (const panel of panels.splice(0)) panel.dispose()
  })

  const open = (sandbox?: boolean, keyboard?: PanelKeyboard) => {
    sandboxAtSrc = []
    const panel = new HtmlPanel({ url: "https://panel.example/page/", sandbox, keyboard, readyTimeout: 60_000 })
    panels.push(panel)
    return panel
  }

  it("is sandboxed before its src is set, without allow-same-origin, when asked", () => {
    const panel = open(true)
    expect(sandboxAtSrc).toEqual([PANEL_SANDBOX])
    const tokens = panel.iframe.getAttribute("sandbox")!.split(/\s+/)
    expect(tokens).toEqual(["allow-scripts", "allow-forms", "allow-popups"])
    expect(tokens).not.toContain("allow-same-origin")
    expect(tokens).not.toContain("allow-popups-to-escape-sandbox")
  })

  it("is not sandboxed by default", () => {
    const panel = open()
    expect(sandboxAtSrc).toEqual([null])
    expect(panel.iframe.hasAttribute("sandbox")).toBe(false)
    open(false)
    expect(sandboxAtSrc).toEqual([null])
  })

  it("has the keyboard guard its focus as an untrusted panel's when sandboxed", () => {
    const keyboard = new PanelKeyboard()
    const register = vi.spyOn(keyboard, "register")
    const sandboxed = open(true, keyboard)
    const trusted = open(false, keyboard)
    expect(register).toHaveBeenCalledWith(sandboxed.iframe, { sandboxed: true })
    expect(register).toHaveBeenCalledWith(trusted.iframe, { sandboxed: false })
  })

  describe("a page that focuses a text field on its own", () => {
    /** Connects the panel as its agent would, and returns the agent's end of the port. */
    function connect(panel: HtmlPanel): MessagePort {
      const postMessage = vi.fn()
      panel.iframe.contentWindow!.postMessage = postMessage as typeof window.postMessage
      const event = new MessageEvent("message", { data: { type: "ready", version: 1 }, origin: panel.sandboxed ? "null" : "https://panel.example" })
      Object.defineProperty(event, "source", { value: panel.iframe.contentWindow })
      window.dispatchEvent(event)
      return (postMessage.mock.calls[0]![2] as MessagePort[])[0]!
    }
    const editing = { type: "editing", editing: true, caret: { x: 1, y: 1, height: 16, color: "rgb(0, 0, 0)" }, selectedText: "" }
    const delivered = () => new Promise(resolve => setTimeout(resolve, 20))

    it("does not take the keyboard when sandboxed and the user did not press the panel", async () => {
      const keyboard = new PanelKeyboard()
      const focus = vi.spyOn(keyboard, "focus")
      const panel = open(true, keyboard)
      const port = connect(panel)
      const received: unknown[] = []
      port.onmessage = event => received.push(event.data)

      port.postMessage(editing)
      await delivered()
      expect(focus).not.toHaveBeenCalled()
      // The page is told to let go of its focus.
      expect(received).toContainEqual({ type: "blur" })

      // Right after the user pressed the panel, it may.
      panel.pointer("down", new Vector2(0.5, 0.5))
      port.postMessage(editing)
      await delivered()
      expect(focus).toHaveBeenCalledWith(panel)
      port.close()
    })

    it("keeps the page's selected text for copying while editing, and forgets it after", async () => {
      const panel = open(false, new PanelKeyboard())
      const port = connect(panel)
      port.postMessage({ ...editing, selectedText: "copy me" })
      await delivered()
      expect(panel.selectedText()).toBe("copy me")
      port.postMessage({ type: "editing", editing: false, caret: null, selectedText: "stale" })
      await delivered()
      expect(panel.selectedText()).toBe("")
      port.close()
    })

    it("takes the keyboard when not sandboxed, as before", async () => {
      const keyboard = new PanelKeyboard()
      const focus = vi.spyOn(keyboard, "focus")
      const panel = open(false, keyboard)
      const port = connect(panel)
      port.postMessage(editing)
      await delivered()
      expect(focus).toHaveBeenCalledWith(panel)
      port.close()
    })
  })

  it("places the IME at the caret on screen while the keyboard types into the panel", async () => {
    const keyboard = new PanelKeyboard()
    const placeIme = vi.spyOn(keyboard, "placeIme")
    const panel = open(false, keyboard)
    // A 1x1 panel facing a camera 1 unit in front of it.
    panel.updateMatrixWorld()
    const camera = new PerspectiveCamera(90, 800 / 600, 0.01, 10)
    camera.position.set(0, 0, 1)
    camera.updateMatrixWorld()
    const canvas = document.createElement("canvas")
    canvas.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600)
    const renderer = { domElement: canvas } as unknown as WebGLRenderer

    const postMessage = vi.fn()
    panel.iframe.contentWindow!.postMessage = postMessage as typeof window.postMessage
    const ready = new MessageEvent("message", { data: { type: "ready", version: 1 }, origin: "https://panel.example" })
    Object.defineProperty(ready, "source", { value: panel.iframe.contentWindow })
    window.dispatchEvent(ready)
    const port = (postMessage.mock.calls[0]![2] as MessagePort[])[0]!
    // The page's default size is 800x600: a caret at its centre.
    port.postMessage({ type: "editing", editing: true, caret: { x: 400, y: 290, height: 20, color: "rgb(0, 0, 0)" }, selectedText: "" })
    await new Promise(resolve => setTimeout(resolve, 20))

    panel.onBeforeRender(renderer, new Scene(), camera)
    expect(placeIme).toHaveBeenCalledTimes(1)
    const placement = placeIme.mock.calls[0]![0]!
    expect(placement.x).toBe(400)
    expect(placement.y).toBeLessThan(300)
    expect(placement.y + placement.height).toBeGreaterThan(300)
    // Unchanged: not placed again.
    panel.onBeforeRender(renderer, new Scene(), camera)
    expect(placeIme).toHaveBeenCalledTimes(1)

    // Once keys no longer go to the panel, its caret does not move the IME.
    keyboard.release(panel)
    placeIme.mockClear()
    camera.position.x = 0.2
    camera.updateMatrixWorld()
    panel.onBeforeRender(renderer, new Scene(), camera)
    expect(placeIme).not.toHaveBeenCalled()
    port.close()
  })
})
