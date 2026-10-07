// Events between the demo scene and the controls panel page.

/** Dispatched on the scene's window by the panel page. */
export const SCENE_CONTROL = "demo:scene-control"
/** Dispatched on the panel page's window by the scene. */
export const SCENE_CLICK = "demo:scene-click"

export interface SceneControl {
  shape?: "knot" | "ico" | "box"
  color?: string
  spin?: boolean
  caption?: string
}
