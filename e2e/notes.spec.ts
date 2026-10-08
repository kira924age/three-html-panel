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
  // Scroll back by part of a line (past the bottom padding): the line with the
  // caret (the last) is cut by the bottom.
  await panel.frame.evaluate(field => {
    const textarea = document.querySelector<HTMLTextAreaElement>(field)!
    const padding = parseFloat(getComputedStyle(textarea).paddingBottom)
    textarea.scrollTop = textarea.scrollHeight - textarea.clientHeight - padding - 9
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
