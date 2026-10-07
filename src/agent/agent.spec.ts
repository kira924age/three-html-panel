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

  it("does not send anything before it is connected", async () => {
    start()
    sendToHost({ shape: "box" })
    await delivered()
    expect(parent.postMessage).toHaveBeenCalledTimes(1)
  })
})
