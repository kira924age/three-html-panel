// The host's end of the conversation with the agent in a panel's iframe.
//
// The host never reads the iframe's document: the page may be on another
// origin. The agent in the page posts `ready`; the connection accepts it only
// from the iframe's window and the panel URL's origin, and hands the agent a
// MessagePort. From then on only that port is used, so other windows and
// frames cannot speak for the page.
//
// Each document the iframe loads (a reload, a navigation) runs its own agent,
// which posts `ready` again. The previous port is closed then. If no agent
// shows up, the connection reports a timeout.

import {
  PROTOCOL_VERSION,
  parsePageMessage,
  parseReady,
  type ConnectMessage,
  type HostMessage
} from "./protocol"
import type { Caret, Frame } from "./types"

export const READY_TIMEOUT_MS = 15_000

export interface PanelConnectionOptions {
  iframe: HTMLIFrameElement
  /** The origin of the panel URL. `ready` from any other origin is ignored. */
  origin: string
  /** The page size the iframe is laid out at; frames of another size are dropped. */
  width: number
  height: number
  readyTimeout?: number
  /** A new document's agent connected. Whatever the previous one reported is stale. */
  onConnect: () => void
  onFrame: (frame: Frame) => void
  onEditing: (editing: boolean, caret: Caret | null) => void
  onMessage: (data: unknown) => void
  /** No agent connected in time, or the agent speaks another protocol version. */
  onError: (error: Error) => void
}

export class PanelConnection {
  private port: MessagePort | null = null
  private lastSeq = -1
  private timer = 0
  /** Whether an agent said `ready` since the iframe's last `load`. */
  private readySinceLoad = false
  private disposed = false

  constructor(private readonly options: PanelConnectionOptions) {
    window.addEventListener("message", this.onWindowMessage)
    options.iframe.addEventListener("load", this.onLoad)
    this.startTimer()
  }

  get connected(): boolean {
    return this.port !== null
  }

  send(message: HostMessage): void {
    this.port?.postMessage(message)
  }

  dispose(): void {
    this.disposed = true
    window.removeEventListener("message", this.onWindowMessage)
    this.options.iframe.removeEventListener("load", this.onLoad)
    window.clearTimeout(this.timer)
    this.closePort()
  }

  private readonly onWindowMessage = (event: MessageEvent) => {
    const { iframe, origin } = this.options
    // Both checks matter: the source ties the message to this iframe (not
    // another panel or a popup), the origin to the page that was asked for
    // (not whatever the iframe navigated to since).
    if (event.source === null || event.source !== iframe.contentWindow || event.origin !== origin) return
    const ready = parseReady(event.data)
    if (!ready) return
    if (ready.version !== PROTOCOL_VERSION) {
      this.options.onError(new Error(`the panel agent speaks protocol ${ready.version}, not ${PROTOCOL_VERSION}`))
      return
    }
    this.connect(event.source as Window)
  }

  private connect(target: Window): void {
    this.closePort()
    window.clearTimeout(this.timer)
    this.timer = 0
    this.readySinceLoad = true
    this.lastSeq = -1

    const channel = new MessageChannel()
    this.port = channel.port1
    channel.port1.onmessage = this.onPortMessage
    const message: ConnectMessage = { type: "connect", version: PROTOCOL_VERSION }
    target.postMessage(message, this.options.origin, [channel.port2])
    this.options.onConnect()
  }

  private readonly onPortMessage = (event: MessageEvent) => {
    if (this.disposed) return
    const { width, height } = this.options
    const message = parsePageMessage(event.data, { width, height, lastSeq: this.lastSeq })
    if (!message) return
    switch (message.type) {
      case "frame":
        this.lastSeq = message.seq
        this.options.onFrame({ svg: message.svg, width: message.width, height: message.height })
        break
      case "editing":
        this.options.onEditing(message.editing, message.caret)
        break
      case "app":
        this.options.onMessage(message.data)
        break
    }
  }

  // A document without an agent never says `ready`. The agent runs before the
  // page finishes loading, so by `load` it normally has; if not, wait a while.
  private readonly onLoad = () => {
    if (!this.readySinceLoad) this.startTimer()
    this.readySinceLoad = false
  }

  private startTimer(): void {
    if (this.timer || this.disposed) return
    this.timer = window.setTimeout(() => {
      this.timer = 0
      this.closePort()
      this.options.onError(new Error("the panel page did not start the three-html-panel agent"))
    }, this.options.readyTimeout ?? READY_TIMEOUT_MS)
  }

  private closePort(): void {
    if (!this.port) return
    this.port.onmessage = null
    this.port.close()
    this.port = null
  }
}
