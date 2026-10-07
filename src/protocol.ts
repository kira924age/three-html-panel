// Messages between the host (HtmlPanel) and the agent running inside the panel
// page.
//
// 1. The agent starts and posts `ready` to the parent window, addressed to the
//    host's origin only.
// 2. The host checks the sender (the panel's iframe, on the panel URL's origin)
//    and answers with `connect`, transferring one end of a MessageChannel.
// 3. Everything else goes through that port: frames and the editing state from
//    the page, input and app messages from the host.
//
// Each side checks the shape of what it receives and drops anything else. The
// host checks more strictly: it shows whatever the page sends, so sizes are
// bounded.

import type { Caret, PanelInput, PointerKind } from "./types"

export const PROTOCOL_VERSION = 1

/** The longest page side the host accepts, in CSS pixels. */
export const MAX_PAGE_LENGTH = 4096
/** The longest SVG the host accepts, in UTF-16 code units. */
export const MAX_SVG_LENGTH = 16 * 1024 * 1024
const MAX_COLOR_LENGTH = 64
const MAX_KEY_LENGTH = 64
const MAX_TEXT_LENGTH = 64 * 1024

/** Posted by the agent to the parent window when it starts. */
export interface ReadyMessage {
  type: "ready"
  version: number
}

/** Posted by the host to the iframe's window, with a MessagePort, in answer to `ready`. */
export interface ConnectMessage {
  type: "connect"
  version: number
}

/** A snapshot of the page. `seq` grows with every frame of one connection. */
export interface FrameMessage {
  type: "frame"
  seq: number
  width: number
  height: number
  svg: string
}

/** Whether a text field in the page has focus, and where its caret is. */
export interface EditingMessage {
  type: "editing"
  editing: boolean
  caret: Caret | null
}

/** Data for the application on the other side; the panel does not look into it. */
export interface AppMessage {
  type: "app"
  data: unknown
}

/** From the page to the host, through the port. */
export type PageMessage = FrameMessage | EditingMessage | AppMessage

/** From the host to the page, through the port. */
export type HostMessage = PanelInput | AppMessage

type Fields = Record<string, unknown>

const isObject = (value: unknown): value is Fields => typeof value === "object" && value !== null
const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)
const isShortString = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max

export function parseReady(data: unknown): ReadyMessage | null {
  if (!isObject(data) || data.type !== "ready" || !Number.isSafeInteger(data.version)) return null
  return { type: "ready", version: data.version as number }
}

export function parseConnect(data: unknown): ConnectMessage | null {
  if (!isObject(data) || data.type !== "connect" || !Number.isSafeInteger(data.version)) return null
  return { type: "connect", version: data.version as number }
}

export function parseCaret(value: unknown): Caret | null | undefined {
  if (value === null) return null
  if (!isObject(value)) return undefined
  const { x, y, height, color } = value
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(height) || height < 0) return undefined
  if (!isShortString(color, MAX_COLOR_LENGTH)) return undefined
  return { x, y, height, color }
}

export interface PageMessageLimits {
  /** The page size the host laid the iframe out at. Frames must match it. */
  width: number
  height: number
  /** The `seq` of the last frame accepted; a frame must have a larger one. */
  lastSeq: number
}

/** Returns the message if it is well formed and within `limits`, or null. */
export function parsePageMessage(data: unknown, limits: PageMessageLimits): PageMessage | null {
  if (!isObject(data)) return null
  switch (data.type) {
    case "frame": {
      const { seq, width, height, svg } = data
      if (!Number.isSafeInteger(seq) || (seq as number) <= limits.lastSeq) return null
      if (width !== limits.width || height !== limits.height) return null
      if (!Number.isInteger(width) || !Number.isInteger(height)) return null
      if ((width as number) <= 0 || (height as number) <= 0) return null
      if ((width as number) > MAX_PAGE_LENGTH || (height as number) > MAX_PAGE_LENGTH) return null
      if (typeof svg !== "string" || svg.length > MAX_SVG_LENGTH) return null
      return { type: "frame", seq: seq as number, width: width as number, height: height as number, svg }
    }
    case "editing": {
      if (typeof data.editing !== "boolean") return null
      const caret = parseCaret(data.caret)
      if (caret === undefined) return null
      return { type: "editing", editing: data.editing, caret }
    }
    case "app":
      return { type: "app", data: data.data }
    default:
      return null
  }
}

const POINTER_KINDS = new Set<PointerKind>(["down", "move", "up", "leave"])

/** Returns the message if it is well formed, or null. */
export function parseHostMessage(data: unknown): HostMessage | null {
  if (!isObject(data)) return null
  switch (data.type) {
    case "pointer": {
      const { kind, x, y } = data
      if (!POINTER_KINDS.has(kind as PointerKind) || !isFiniteNumber(x) || !isFiniteNumber(y)) return null
      return { type: "pointer", kind: kind as PointerKind, x, y }
    }
    case "wheel": {
      const { x, y, deltaX, deltaY } = data
      if (![x, y, deltaX, deltaY].every(isFiniteNumber)) return null
      return { type: "wheel", x: x as number, y: y as number, deltaX: deltaX as number, deltaY: deltaY as number }
    }
    case "key": {
      const { key, shiftKey, ctrlKey, altKey, metaKey } = data
      if (!isShortString(key, MAX_KEY_LENGTH)) return null
      if (![shiftKey, ctrlKey, altKey, metaKey].every(flag => typeof flag === "boolean")) return null
      return {
        type: "key",
        key,
        shiftKey: shiftKey as boolean,
        ctrlKey: ctrlKey as boolean,
        altKey: altKey as boolean,
        metaKey: metaKey as boolean
      }
    }
    case "text":
      return isShortString(data.text, MAX_TEXT_LENGTH) ? { type: "text", text: data.text } : null
    case "blur":
      return { type: "blur" }
    case "app":
      return { type: "app", data: data.data }
    default:
      return null
  }
}
