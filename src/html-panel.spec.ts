// @vitest-environment jsdom
import { PerspectiveCamera, Scene, Vector2, type WebGLRenderer } from "three"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { HtmlPanel, PANEL_SANDBOX, defaultPixelRatio, splitAlpha } from "./html-panel"
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

describe("defaultPixelRatio", () => {
  it("is 1 on phones (coarse pointer, small screen) and 2 elsewhere", () => {
    const set = (coarse: boolean, shortSide: number) => {
      vi.stubGlobal("matchMedia", (query: string) => ({ matches: coarse && query.includes("coarse") }))
      vi.stubGlobal("screen", { width: shortSide, height: shortSide * 2 })
    }
    set(true, 390)
    expect(defaultPixelRatio()).toBe(1)
    set(true, 1024)
    expect(defaultPixelRatio()).toBe(2)
    set(false, 390)
    expect(defaultPixelRatio()).toBe(2)
    vi.unstubAllGlobals()
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

  it("draws at 1x on phones, by default", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("coarse") }))
    vi.stubGlobal("screen", { width: 390, height: 844 })
    const panel = open()
    vi.unstubAllGlobals()
    // The default page is 800 CSS px wide.
    expect((panel.material.map!.image as HTMLCanvasElement).width).toBe(800)
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
    const editing = { type: "editing", editing: true, caret: { x: 1, y: 1, height: 16, color: "rgb(0, 0, 0)" }, selectedText: "", pointers: 0 }
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

    it("counts dragging in the panel as acting on it, however long the press, but not hovering", async () => {
      const keyboard = new PanelKeyboard()
      const focus = vi.spyOn(keyboard, "focus")
      const panel = open(true, keyboard)
      const port = connect(panel)
      const received: unknown[] = []
      port.onmessage = event => received.push(event.data)
      const now = vi.spyOn(performance, "now")
      const at = (time: number) => now.mockReturnValue(time)
      const selecting = { ...editing, caret: null, selectedText: "some text" }

      // Pressed, held still for a while, then dragged: selecting text only now.
      at(10_000)
      panel.pointer("down", new Vector2(0.2, 0.5))
      at(12_000)
      panel.pointer("move", new Vector2(0.4, 0.5))
      port.postMessage(selecting)
      await delivered()
      expect(focus).toHaveBeenCalledWith(panel)
      expect(received).not.toContainEqual({ type: "blur" })

      // Released: moving over the panel afterwards is hovering, not acting on it.
      panel.pointer("up", new Vector2(0.4, 0.5))
      panel.blur()
      focus.mockClear()
      received.length = 0
      at(20_000)
      panel.pointer("move", new Vector2(0.6, 0.5))
      port.postMessage(selecting)
      await delivered()
      expect(focus).not.toHaveBeenCalled()
      expect(received).toContainEqual({ type: "blur" })

      // A press that ended without an up (pressing another panel, the pointer leaving):
      // moving afterwards is hovering, not dragging.
      for (const end of [() => panel.blur(), () => panel.pointer("leave")]) {
        panel.pointer("down", new Vector2(0.2, 0.5))
        end()
        focus.mockClear()
        received.length = 0
        at(now() + 5000)
        panel.pointer("move", new Vector2(0.6, 0.5))
        port.postMessage(selecting)
        await delivered()
        expect(focus).not.toHaveBeenCalled()
        expect(received).toContainEqual({ type: "blur" })
      }

      // A new document (the press began in the one before).
      panel.pointer("down", new Vector2(0.2, 0.5))
      const next = connect(panel)
      const nextReceived: unknown[] = []
      next.onmessage = event => nextReceived.push(event.data)
      focus.mockClear()
      at(now() + 5000)
      panel.pointer("move", new Vector2(0.6, 0.5))
      next.postMessage(selecting)
      await delivered()
      expect(focus).not.toHaveBeenCalled()
      expect(nextReceived).toContainEqual({ type: "blur" })
      next.close()
      port.close()
    })

    it("keeps the page's selected text for copying while editing, and forgets it after", async () => {
      const panel = open(false, new PanelKeyboard())
      const port = connect(panel)
      port.postMessage({ ...editing, selectedText: "copy me" })
      await delivered()
      expect(panel.selectedText()).toBe("copy me")
      port.postMessage({ type: "editing", editing: false, caret: null, selectedText: "stale", pointers: 0 })
      await delivered()
      expect(panel.selectedText()).toBe("")
      port.close()
    })

    it("opens a link the page hands over only right after the user acted on the panel, and only http(s)", async () => {
      const onLink = vi.fn()
      sandboxAtSrc = []
      const panel = new HtmlPanel({ url: "https://panel.example/page/", sandbox: false, onLink, readyTimeout: 60_000 })
      panels.push(panel)
      const port = connect(panel)
      // On its own: ignored.
      port.postMessage({ type: "open", url: "https://example.com/" })
      await delivered()
      expect(onLink).not.toHaveBeenCalled()

      panel.pointer("down", new Vector2(0.5, 0.5))
      port.postMessage({ type: "open", url: "javascript:alert(1)" })
      port.postMessage({ type: "open", url: "https://example.com/" })
      await delivered()
      expect(onLink).toHaveBeenCalledTimes(1)
      expect((onLink.mock.calls[0]![0] as URL).href).toBe("https://example.com/")
      port.close()
    })

    it("counts a key the user pressed in the panel (Enter on a focused link) as acting on it", async () => {
      const onLink = vi.fn()
      const panel = new HtmlPanel({ url: "https://panel.example/page/", onLink, readyTimeout: 60_000 })
      panels.push(panel)
      const port = connect(panel)
      panel.sendKey(new KeyboardEvent("keydown", { key: "Enter" }))
      port.postMessage({ type: "open", url: "https://example.com/" })
      await delivered()
      expect(onLink).toHaveBeenCalledTimes(1)
      port.close()
    })

    it("opens links in a new tab, without a way back to the host, by default", async () => {
      const windowOpen = vi.spyOn(window, "open").mockReturnValue(null)
      const panel = open(false)
      const port = connect(panel)
      panel.pointer("up", new Vector2(0.5, 0.5))
      port.postMessage({ type: "open", url: "https://example.com/" })
      await delivered()
      expect(windowOpen).toHaveBeenCalledWith("https://example.com/", "_blank", "noopener,noreferrer")
      port.close()
    })

    describe("a tap on a text field", () => {
      afterEach(() => {
        vi.useRealTimers()
      })

      /** A sandboxed panel whose page has a 200x40 field at its top left, tapped there (down and up sent). */
      async function tapped() {
        const keyboard = new PanelKeyboard()
        const focus = vi.spyOn(keyboard, "focus")
        const release = vi.spyOn(keyboard, "release")
        const panel = open(true, keyboard)
        const port = connect(panel)
        const received: unknown[] = []
        port.onmessage = event => received.push(event.data)
        port.postMessage({ type: "editables", boxes: [{ left: 0, top: 0, width: 200, height: 40 }] })
        await delivered()
        const field = new Vector2(0.05, 0.98)
        panel.pointer("down", field, false, "touch")
        panel.pointer("up", field, false, "touch")
        return { panel, port, focus, release, received, field }
      }
      const answer = (editing: boolean, pointers: number) => ({
        type: "editing",
        editing,
        caret: editing ? { x: 5, y: 5, height: 16, color: "rgb(0, 0, 0)" } : null,
        selectedText: "",
        pointers
      })

      it("takes the keyboard only over a text field", async () => {
        const { panel, port, focus } = await tapped()
        expect(panel.focusForTyping(new Vector2(0.9, 0.1))).toBe(false)
        expect(focus).not.toHaveBeenCalled()
        expect(panel.focusForTyping(new Vector2(0.05, 0.98))).toBe(true)
        expect(focus).toHaveBeenCalledWith(panel)
        port.close()
      })

      it("lets it go when the page's answer to the tap shows no focus", async () => {
        const { panel, port, release, field } = await tapped()
        panel.focusForTyping(field)
        port.postMessage(answer(false, 2))
        await delivered()
        expect(release).toHaveBeenCalledWith(panel)
        port.close()
      })

      it("keeps it when the page answers late, even sandboxed (a slow page)", async () => {
        const { panel, port, release, received, field } = await tapped()
        panel.focusForTyping(field)
        // Past the second in which a sandboxed page may take the keyboard on its own.
        vi.spyOn(performance, "now").mockReturnValue(performance.now() + 3000)
        port.postMessage(answer(true, 2))
        await delivered()
        expect(release).not.toHaveBeenCalled()
        expect(received).not.toContainEqual({ type: "blur" })
        port.close()
      })

      it("takes the answer to the release, whatever moves and leaves came after it", async () => {
        const { panel, port, release, field } = await tapped()
        // PanelPointer ends a touch's hover right after its release.
        panel.pointer("leave")
        panel.pointer("move", field, false, "touch")
        panel.focusForTyping(field)
        port.postMessage(answer(false, 2))
        await delivered()
        expect(release).toHaveBeenCalledWith(panel)
        port.close()
      })

      it("does not take an earlier report for the answer", async () => {
        const { panel, port, release, field } = await tapped()
        panel.focusForTyping(field)
        // Sent before the page handled the tap's release.
        port.postMessage(answer(false, 1))
        await delivered()
        expect(release).not.toHaveBeenCalled()
        port.close()
      })

      it("lets it go if the page never answers", async () => {
        const { panel, port, release, field } = await tapped()
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
        panel.focusForTyping(field)
        vi.advanceTimersByTime(4999)
        expect(release).not.toHaveBeenCalled()
        vi.advanceTimersByTime(1)
        expect(release).toHaveBeenCalledWith(panel)
        port.close()
      })
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
    port.postMessage({ type: "editing", editing: true, caret: { x: 400, y: 290, height: 20, color: "rgb(0, 0, 0)" }, selectedText: "", pointers: 0 })
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

    // With a finger, the field stays in its corner (iOS would scroll to it).
    placeIme.mockClear()
    panel.pointer("down", new Vector2(0.5, 0.5), false, "touch")
    camera.position.x = 0.1
    camera.updateMatrixWorld()
    panel.onBeforeRender(renderer, new Scene(), camera)
    expect(placeIme).not.toHaveBeenCalled()
    panel.pointer("down", new Vector2(0.5, 0.5), false, "mouse")

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
