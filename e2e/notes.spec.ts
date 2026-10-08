// The sticky notes board (panels/notes): an ordinary page that knows nothing
// of the panel. Typing in a note, dragging a note by its bar, and the caret of
// a note scrolled by part of a line.

import { expect, test } from "@playwright/test"
import { PanelPage } from "./panel"

let panel: PanelPage

test.beforeEach(async ({ page }) => {
  panel = await PanelPage.open(page, "notes", 960, 640)
})

/** The notes come after the hint in the board: the second note is the board's third child. */
const NOTE = ".board-inner > .note:nth-child(3)"

test("takes typing in a note", async ({ page }) => {
  await panel.focus(await panel.at(`${NOTE} textarea`, 0.8, 0.8))
  await page.keyboard.type("typed here")
  await expect
    .poll(() => panel.frame.evaluate(note => document.querySelector<HTMLTextAreaElement>(`${note} textarea`)!.value, NOTE))
    .toContain("typed here")
})

test("moves a note dragged by its bar, which the page captures the pointer for", async () => {
  const before = await panel.box(NOTE)
  const bar = await panel.box(`${NOTE} .note-bar`)
  // Right of the color dots, left of the close button.
  const from = panel.screen(bar.left + bar.width - 40, bar.top + bar.height / 2)
  await panel.drag(from, { x: from.x + 100, y: from.y + 80 })
  // The moves reach the page through a port: wait for the last one.
  await expect
    .poll(async () => {
      const after = await panel.box(NOTE)
      return [Math.round(after.left - before.left), Math.round(after.top - before.top)]
    })
    .toEqual([Math.round(100 / panel.scale), Math.round(80 / panel.scale)])
})

test("cuts the caret to the note when its line is scrolled half out of view", async ({ page }) => {
  const field = `${NOTE} textarea`
  await panel.focus(await panel.at(field, 0.5, 0.3))
  await page.keyboard.press("ControlOrMeta+a")
  const text = "Sticky notes keep a few lines of text. ".repeat(6)
  await page.keyboard.type(text)
  // All typed (each key scrolls the field to its caret) before scrolling it back.
  await expect
    .poll(() => panel.frame.evaluate(field => document.querySelector<HTMLTextAreaElement>(field)!.value, field))
    .toBe(text)
  // Scroll back by half a line (past the bottom padding): the line with the
  // caret (the last) is cut by the bottom, whatever the fonts.
  await panel.frame.evaluate(field => {
    const textarea = document.querySelector<HTMLTextAreaElement>(field)!
    const style = getComputedStyle(textarea)
    const back = parseFloat(style.paddingBottom) + parseFloat(style.lineHeight) / 2
    textarea.scrollTop = textarea.scrollHeight - textarea.clientHeight - back
  }, field)
  const box = await panel.frame.evaluate(field => {
    const textarea = document.querySelector<HTMLTextAreaElement>(field)!
    const rect = textarea.getBoundingClientRect()
    return { top: rect.top + textarea.clientTop, bottom: rect.top + textarea.clientTop + textarea.clientHeight }
  }, field)
  await expect
    .poll(async () => {
      const caret = await panel.caret()
      return caret && caret.y + caret.height
    })
    .toBeCloseTo(box.bottom, 0)
  const caret = (await panel.caret())!
  expect(caret.y).toBeGreaterThanOrEqual(box.top)
  // Cut: shorter than a line.
  expect(caret.height).toBeLessThan(16)
})

test("keeps the caret after a space that ends a wrapped line on that line", async ({ page }) => {
  const field = `${NOTE} textarea`
  const text = "Sticky notes keep a few lines of text. ".repeat(3)
  // A width at which the last space ends a line, hanging past the edge: the
  // caret after it stays on that line (Chromium, WebKit), though a marker put
  // after it there wraps to the next. Found by trying, whatever the fonts.
  const found = await panel.frame.evaluate(
    ({ field, text }) => {
      const textarea = document.querySelector<HTMLTextAreaElement>(field)!
      textarea.value = text
      textarea.style.overflow = "hidden"
      textarea.style.boxSizing = "border-box"
      const style = getComputedStyle(textarea)
      const probe = document.createElement("div")
      for (const property of ["font", "letter-spacing", "word-spacing", "tab-size"]) {
        probe.style.setProperty(property, style.getPropertyValue(property))
      }
      Object.assign(probe.style, { position: "absolute", visibility: "hidden", whiteSpace: "pre-wrap" })
      probe.append(text.slice(0, -1))
      const space = probe.appendChild(document.createElement("span"))
      space.textContent = " "
      const end = probe.appendChild(document.createElement("span"))
      end.textContent = "\u200b"
      document.body.appendChild(probe)
      const sides = ["padding-left", "padding-right", "border-left-width", "border-right-width"]
      const frame = sides.reduce((sum, side) => sum + parseFloat(style.getPropertyValue(side)), 0)
      try {
        for (let width = 120; width <= 400; width++) {
          probe.style.width = `${width - frame}px`
          if (end.offsetTop !== space.offsetTop) {
            textarea.style.width = `${width}px`
            textarea.setSelectionRange(text.length - 1, text.length - 1)
            return true
          }
        }
        return false
      } finally {
        probe.remove()
      }
    },
    { field, text }
  )
  // Firefox puts a marker after a hanging space on its line too: nothing to check.
  test.skip(!found, "no width wraps after the last space here")
  await panel.focus(await panel.at(field, 0.5, 0.2))
  await panel.frame.evaluate(({ field, at }) => document.querySelector<HTMLTextAreaElement>(field)!.setSelectionRange(at, at), {
    field,
    at: text.length - 1
  })
  // Before the space, then after it: the same line.
  await page.keyboard.press("ArrowLeft")
  await page.keyboard.press("ArrowRight")
  await expect.poll(() => panel.frame.evaluate(field => document.querySelector<HTMLTextAreaElement>(field)!.selectionEnd, field)).toBe(text.length - 1)
  await expect.poll(async () => (await panel.caret()) !== null).toBe(true)
  const before = (await panel.caret())!
  await page.keyboard.press("ArrowRight")
  await expect.poll(() => panel.frame.evaluate(field => document.querySelector<HTMLTextAreaElement>(field)!.selectionEnd, field)).toBe(text.length)
  await expect.poll(async () => (await panel.caret())?.x ?? null).toBeGreaterThan(before.x)
  expect((await panel.caret())!.y).toBeCloseTo(before.y, 0)
})
