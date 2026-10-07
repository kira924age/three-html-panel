// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest"
import { PanelConnection } from "./panel-connection"
import { PROTOCOL_VERSION } from "./protocol"

const ORIGIN = "https://panel.example"

let iframe: HTMLIFrameElement
let postToFrame: Mock
let connection: PanelConnection
let options: {
  onConnect: Mock
  onFrame: Mock
  onEditing: Mock
  onCursor: Mock
  onMessage: Mock
  onError: Mock
}

/** A message event as the browser would dispatch it on the host's window. */
function dispatchMessage(data: unknown, origin: string, source: unknown): void {
  const event = new MessageEvent("message", { data, origin })
  Object.defineProperty(event, "source", { value: source })
  window.dispatchEvent(event)
}

const ready = (origin = ORIGIN, source: unknown = iframe.contentWindow) =>
  dispatchMessage({ type: "ready", version: PROTOCOL_VERSION }, origin, source)

/** The port the host handed to the page in its last `connect`. */
function pagePort(call = -1): MessagePort {
  const transfer = postToFrame.mock.calls.at(call)?.[2] as MessagePort[] | undefined
  if (!transfer?.[0]) throw new Error("no port was sent")
  return transfer[0]
}

/** Lets messages sent through ports arrive. */
const delivered = () => new Promise(resolve => setTimeout(resolve, 10))

const frame = (seq: number, fields: Record<string, unknown> = {}) => ({
  type: "frame",
  seq,
  width: 800,
  height: 600,
  svg: "<svg/>",
  ...fields
})

beforeEach(() => {
  iframe = document.createElement("iframe")
  document.body.appendChild(iframe)
  postToFrame = vi.fn()
  iframe.contentWindow!.postMessage = postToFrame as typeof window.postMessage
  options = {
    onConnect: vi.fn(),
    onFrame: vi.fn(),
    onEditing: vi.fn(),
    onCursor: vi.fn(),
    onMessage: vi.fn(),
    onError: vi.fn()
  }
  connection = new PanelConnection({ iframe, origin: ORIGIN, width: 800, height: 600, readyTimeout: 1000, ...options })
})

afterEach(() => {
  connection.dispose()
  for (const call of postToFrame.mock.calls) (call[2] as MessagePort[] | undefined)?.[0]?.close()
  iframe.remove()
  vi.useRealTimers()
})

describe("ready", () => {
  it("answers ready from the iframe on the panel origin with a port, addressed to that origin", () => {
    ready()
    expect(postToFrame).toHaveBeenCalledTimes(1)
    const [message, targetOrigin, transfer] = postToFrame.mock.calls[0]!
    expect(message).toEqual({ type: "connect", version: PROTOCOL_VERSION })
    expect(targetOrigin).toBe(ORIGIN)
    expect(transfer).toHaveLength(1)
    expect(connection.connected).toBe(true)
    expect(options.onConnect).toHaveBeenCalledTimes(1)
  })

  it("ignores ready from another origin", () => {
    ready("https://evil.example")
    ready(location.origin)
    expect(postToFrame).not.toHaveBeenCalled()
    expect(connection.connected).toBe(false)
  })

  it("ignores ready from another window", () => {
    const other = document.createElement("iframe")
    document.body.appendChild(other)
    ready(ORIGIN, other.contentWindow)
    ready(ORIGIN, window)
    ready(ORIGIN, null)
    other.remove()
    expect(postToFrame).not.toHaveBeenCalled()
    expect(connection.connected).toBe(false)
    expect(options.onConnect).not.toHaveBeenCalled()
  })

  it("ignores messages that are not ready, and reports another protocol version", () => {
    dispatchMessage({ type: "frame", seq: 0 }, ORIGIN, iframe.contentWindow)
    dispatchMessage("ready", ORIGIN, iframe.contentWindow)
    expect(postToFrame).not.toHaveBeenCalled()
    dispatchMessage({ type: "ready", version: PROTOCOL_VERSION + 1 }, ORIGIN, iframe.contentWindow)
    expect(postToFrame).not.toHaveBeenCalled()
    expect(options.onError).toHaveBeenCalledTimes(1)
  })
})

describe("port messages", () => {
  it("passes on valid messages and drops invalid ones", async () => {
    ready()
    const port = pagePort()
    port.postMessage(frame(0))
    port.postMessage(frame(0)) // seq did not grow
    port.postMessage(frame(1, { width: 801 }))
    port.postMessage(frame(2, { svg: 1 }))
    port.postMessage({ type: "editing", editing: true, caret: { x: 1, y: 2, height: Number.NaN, color: "red" } })
    port.postMessage({ type: "editing", editing: true, caret: { x: 1, y: 2, height: 16, color: "red" } })
    port.postMessage({ type: "cursor", cursor: "pointer" })
    port.postMessage({ type: "cursor", cursor: "url(https://evil.example/c.png), auto" })
    port.postMessage({ type: "app", data: { hello: 1 } })
    port.postMessage({ type: "nonsense" })
    port.postMessage(frame(3))
    await delivered()

    expect(options.onFrame.mock.calls.map(([f]) => f)).toEqual([
      { svg: "<svg/>", width: 800, height: 600 },
      { svg: "<svg/>", width: 800, height: 600 }
    ])
    expect(options.onEditing.mock.calls).toEqual([[true, { x: 1, y: 2, height: 16, color: "red" }]])
    expect(options.onCursor.mock.calls).toEqual([["pointer"]])
    expect(options.onMessage.mock.calls).toEqual([[{ hello: 1 }]])
  })

  it("closes the previous port when a new document's agent says ready", async () => {
    ready()
    const first = pagePort()
    ready()
    const second = pagePort()
    first.postMessage({ type: "app", data: "stale" })
    second.postMessage({ type: "app", data: "fresh" })
    await delivered()
    expect(options.onMessage.mock.calls).toEqual([["fresh"]])
    expect(options.onConnect).toHaveBeenCalledTimes(2)
  })

  it("starts seq over with each connection", async () => {
    ready()
    pagePort().postMessage(frame(7))
    await delivered()
    ready()
    pagePort().postMessage(frame(0))
    await delivered()
    expect(options.onFrame).toHaveBeenCalledTimes(2)
  })

  it("sends host messages through the port only", async () => {
    connection.send({ type: "blur" })
    ready()
    const port = pagePort()
    const received: unknown[] = []
    port.onmessage = event => received.push(event.data)
    connection.send({ type: "blur" })
    await delivered()
    expect(received).toEqual([{ type: "blur" }])
    expect(postToFrame).toHaveBeenCalledTimes(1)
  })
})

describe("timeout", () => {
  it("reports an error if no agent says ready in time", () => {
    vi.useFakeTimers()
    connection.dispose()
    connection = new PanelConnection({ iframe, origin: ORIGIN, width: 800, height: 600, readyTimeout: 1000, ...options })
    vi.advanceTimersByTime(999)
    expect(options.onError).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(options.onError).toHaveBeenCalledTimes(1)
  })

  it("does not time out once connected, but does after a load without ready", () => {
    vi.useFakeTimers()
    connection.dispose()
    connection = new PanelConnection({ iframe, origin: ORIGIN, width: 800, height: 600, readyTimeout: 1000, ...options })
    ready()
    iframe.dispatchEvent(new Event("load"))
    vi.advanceTimersByTime(5000)
    expect(options.onError).not.toHaveBeenCalled()

    // The iframe navigated to a page without the agent.
    iframe.dispatchEvent(new Event("load"))
    vi.advanceTimersByTime(1000)
    expect(options.onError).toHaveBeenCalledTimes(1)
    expect(connection.connected).toBe(false)
  })
})
