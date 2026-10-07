// A trusted page that controls the 3D scene around it. Because the page is on
// the scene's origin, it can reach the parent window directly; here it does so
// with events, so the page does not depend on the scene's code.
import { SCENE_CLICK, SCENE_CONTROL, type SceneControl } from "../../src/demo/scene-events"

const form = document.querySelector<HTMLFormElement>("#form")!
const clicks = document.querySelector<HTMLElement>("#clicks")!

const send = (control: SceneControl) => window.parent.dispatchEvent(new CustomEvent(SCENE_CONTROL, { detail: control }))

form.addEventListener("change", event => {
  const target = event.target as HTMLInputElement
  if (target.name === "shape") send({ shape: target.value as SceneControl["shape"] })
  if (target.name === "spin") send({ spin: target.checked })
})
form.querySelector<HTMLInputElement>("[name=caption]")!.addEventListener("input", event => {
  send({ caption: (event.target as HTMLInputElement).value })
})
for (const swatch of form.querySelectorAll<HTMLButtonElement>(".swatch")) {
  swatch.addEventListener("click", () => {
    form.querySelector(".swatch.selected")?.classList.remove("selected")
    swatch.classList.add("selected")
    send({ color: swatch.dataset.color })
  })
}
form.querySelector(".swatch")!.classList.add("selected")

// The other direction: the scene tells the page when the object is clicked.
let count = 0
window.addEventListener(SCENE_CLICK, () => {
  clicks.textContent = String(++count)
  clicks.classList.remove("bump")
  void clicks.offsetWidth
  clicks.classList.add("bump")
})
