// Dragging a finger, or a VR controller, over the panel scrolls it, as touch
// does in browsers. Synthetic pointer events do not scroll anything by
// themselves, so the agent does it. A mouse drag does not scroll (it selects
// text, or drags what the page lets drag), as in browsers.
//
// Like a touch, the drag scrolls only in the directions the touch-action of the
// pressed element and its ancestors allows; where the page sets
// touch-action: none (a note's drag bar), the drag is the page's.
//
// While a drag may still scroll, the mouse events are held back, as browsers do
// for a touch: a tap gets mousedown, mouseup and click (and focus) when it is
// released; a drag gets none (input.ts).

export type { PointerInput } from "../../types"

export interface PanAxes {
  x: boolean
  y: boolean
}

/** How far (CSS px) a drag moves before it scrolls; until then it is the page's, as a touch slop. */
export const PAN_START_DISTANCE = 8

const PAN_X = new Set(["pan-x", "pan-left", "pan-right"])
const PAN_Y = new Set(["pan-y", "pan-up", "pan-down"])

/**
 * The directions a drag may scroll, from the touch-action values of the pressed
 * element and its ancestors, innermost first. Any of them can forbid a direction.
 */
export function panAxes(touchActions: readonly string[]): PanAxes {
  const axes = { x: true, y: true }
  for (const value of touchActions) {
    const tokens = value.trim().toLowerCase().split(/\s+/)
    if (tokens.includes("none")) return { x: false, y: false }
    if (tokens.some(token => token === "" || token === "auto" || token === "manipulation")) continue
    if (!tokens.some(token => PAN_X.has(token))) axes.x = false
    if (!tokens.some(token => PAN_Y.has(token))) axes.y = false
  }
  return axes
}
