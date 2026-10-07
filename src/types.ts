/**
 * The window of the panel's iframe. It is a separate realm: its elements are
 * instances of its own HTMLElement, CSSStyleRule and so on, not the host's, so
 * type checks and constructors must come from this object.
 */
export type FrameWindow = Window & typeof globalThis

export type PointerKind = "down" | "move" | "up" | "leave"

/** Input for a panel, in CSS pixels of the panel page. */
export type PanelInput =
  | { type: "pointer"; kind: PointerKind; x: number; y: number }
  | { type: "wheel"; x: number; y: number; deltaX: number; deltaY: number }
  | {
      type: "key"
      key: string
      shiftKey: boolean
      ctrlKey: boolean
      altKey: boolean
      metaKey: boolean
    }
  | { type: "text"; text: string }
  /** Keyboard focus left the panel from the host side (the user pressed elsewhere). */
  | { type: "blur" }

/** A text caret in CSS pixels of the panel page. */
export interface Caret {
  x: number
  y: number
  height: number
  color: string
}
