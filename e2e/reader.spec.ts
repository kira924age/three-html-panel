// The reader page (panels/reader): selecting and copying the page's text, a
// <select>'s list, editing a contenteditable box, and a video.

import { expect, test } from "@playwright/test"
import { PanelPage } from "./panel"

let panel: PanelPage

test.beforeEach(async ({ page }) => {
  panel = await PanelPage.open(page, "reader", 720, 720)
})

/** The box of the first occurrence of `word` in an element's text (page CSS px). */
function wordBox(selector: string, word: string) {
  return panel.frame.evaluate(
    ([selector, word]) => {
      const root = document.querySelector(selector)!
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const index = (node as Text).data.indexOf(word)
        if (index < 0) continue
        const range = document.createRange()
        range.setStart(node, index)
        range.setEnd(node, index + word.length)
        const rect = range.getBoundingClientRect()
        return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
      }
      throw new Error(`no "${word}" in ${selector}`)
    },
    [selector, word] as const
  )
}

const middle = (box: { left: number; top: number; width: number; height: number }) => panel.screen(box.left + box.width / 2, box.top + box.height / 2)

test.describe("the page's text", () => {
  test("is selected by dragging, drawn highlighted, and offered for copying as it reads", async () => {
    const from = await wordBox(".lead", "ordinary")
    const to = await wordBox(".lead", "select")
    // A point in the first line, above the letters, to see the highlight.
    const probe = { x: from.left + from.width / 2, y: from.top + 1 }
    const before = await panel.pixel(probe.x, probe.y)
    await panel.drag(panel.screen(from.left + 1, from.top + from.height / 2), middle(to))

    // Up to the middle of "select" (where exactly depends on the fonts).
    await expect.poll(() => panel.selectedText()).toMatch(/^ordinary page\. Drag over this text to se/)
    const text = await panel.selectedText()
    // The page's own selection, white space and all, reads the same.
    const own = await panel.frame.evaluate(() => getSelection()!.toString())
    expect(own.replace(/\s+/g, " ")).toBe(text)

    expect(before[2] - before[0]).toBeLessThan(10)
    await expect.poll(async () => {
      const [red, , blue] = await panel.pixel(probe.x, probe.y)
      return blue - red
    }).toBeGreaterThan(40)
  })

  test("selects a word with a double click, and the paragraph with a triple click", async () => {
    await panel.click(middle(await wordBox(".lead", "ordinary")), 2)
    await expect.poll(() => panel.selectedText()).toBe("ordinary")
    await panel.click(middle(await wordBox(".lead", "ordinary")), 3)
    await expect.poll(() => panel.selectedText()).toMatch(/^An ordinary page\. .* テキストの選択とコピーもできます。$/)
  })

  test("is copied with the copy shortcut", async ({ page }) => {
    await panel.focus(middle(await wordBox(".lead", "ordinary")), 2)
    await expect.poll(() => panel.selectedText()).toBe("ordinary")
    // What the browser would copy, without touching the system clipboard.
    await page.evaluate(() => {
      document.addEventListener("copy", event => {
        event.preventDefault()
        const field = document.activeElement as HTMLTextAreaElement
        ;(window as unknown as { copied: string }).copied = field.value.slice(field.selectionStart, field.selectionEnd)
      })
    })
    await page.keyboard.press("ControlOrMeta+c")
    expect(await page.evaluate(() => (window as unknown as { copied: string }).copied)).toBe("ordinary")
  })
})

test.describe("a <select>", () => {
  /** Where the list draws item `row` (the agent's own list: select-popup.ts). */
  async function itemAt(selector: string, row: number) {
    const box = await panel.box(selector)
    const fontSize = await panel.frame.evaluate(selector => parseFloat(getComputedStyle(document.querySelector(selector)!).fontSize), selector)
    const itemHeight = Math.max(18, Math.round(fontSize * 1.5))
    return { left: box.left + 2, x: box.left + 40, y: box.top + box.height + 1 + row * itemHeight + itemHeight / 2 }
  }

  test("opens its list on a press, drawn over the page, and sets the option clicked", async () => {
    await panel.click(await panel.at("#font"))
    // "System" (row 1, under the "Sans" label) is selected: highlighted in the list.
    const system = await itemAt("#font", 1)
    await expect
      .poll(async () => {
        const [red, green, blue] = await panel.pixel(system.left, system.y)
        return red < 80 && green < 150 && blue > 180
      })
      .toBe(true)

    const georgia = await itemAt("#font", 4)
    await panel.click(panel.screen(georgia.x, georgia.y))
    await expect.poll(() => panel.frame.evaluate(() => document.querySelector<HTMLSelectElement>("#font")!.value)).toBe("Georgia")
    // The page heard of it (change), and set the editor's font.
    expect(await panel.frame.evaluate(() => document.querySelector<HTMLElement>("#editor")!.style.fontFamily)).toBe("Georgia")
  })

  test("changes its option with the arrow keys while focused", async ({ page }) => {
    await panel.focus(await panel.at("#size"))
    await page.keyboard.press("Escape")
    await page.keyboard.press("ArrowDown")
    await expect.poll(() => panel.frame.evaluate(() => document.querySelector<HTMLSelectElement>("#size")!.value)).toBe("21px")
  })
})

test.describe("a contenteditable box", () => {
  const editorText = () => panel.frame.evaluate(() => document.querySelector<HTMLElement>("#editor")!.innerText)

  test("takes typing, Enter and Backspace where it was clicked, with a caret there", async ({ page }) => {
    const word = await wordBox("#editor p", "Click")
    await panel.focus(panel.screen(word.left + 1, word.top + word.height / 2))
    await expect.poll(async () => Math.abs(((await panel.caret())?.x ?? Infinity) - word.left)).toBeLessThan(3)

    await page.keyboard.type("XYZ ")
    await page.keyboard.press("Backspace")
    await page.keyboard.press("Enter")
    // A new paragraph (innerText puts a blank line between paragraphs).
    await expect.poll(editorText).toMatch(/contenteditable\. XYZ\n+Click in it/)
    expect(await panel.frame.evaluate(() => document.querySelector("#editor")!.children.length)).toBe(3)
  })

  test("formats with the bold shortcut, and undoes it", async ({ page }) => {
    await panel.focus(middle(await wordBox("#editor p", "This")), 2)
    await expect.poll(() => panel.selectedText()).toBe("This")
    await page.keyboard.press("ControlOrMeta+b")
    const bold = () => panel.frame.evaluate(() => Array.from(document.querySelectorAll("#editor b, #editor strong"), b => b.textContent))
    await expect.poll(bold).toContain("This")
    await page.keyboard.press("ControlOrMeta+z")
    await expect.poll(bold).not.toContain("This")
  })

  test("shows text composed with an IME in place, and takes it when committed", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "IME input is emulated through Chromium's DevTools protocol")
    const word = await wordBox("#editor p", "Click")
    await panel.focus(panel.screen(word.left + 1, word.top + word.height / 2))
    const cdp = await page.context().newCDPSession(page)
    await cdp.send("Input.imeSetComposition", { text: "にほん", selectionStart: 3, selectionEnd: 3 })
    await page.waitForTimeout(400)
    // Only in the image while composing: the page's text has not changed.
    expect(await editorText()).not.toContain("にほん")
    await cdp.send("Input.insertText", { text: "日本" })
    await expect.poll(editorText).toContain("contenteditable. 日本Click in it")
  })
})

test("plays a video, drawing its frames as they come", async () => {
  const video = await panel.box("#video")
  const center = { x: video.left + video.width / 2, y: video.top + video.height / 2 }
  await panel.click(await panel.at("#play"))
  await expect.poll(() => panel.frame.evaluate(() => !document.querySelector<HTMLVideoElement>("#video")!.paused)).toBe(true)
  await panel.page.waitForTimeout(800)
  const first = await panel.pixel(center.x, center.y)
  await panel.page.waitForTimeout(800)
  const second = await panel.pixel(center.x, center.y)
  // Not the black of a video with no frame, and moving.
  expect(Math.max(...first)).toBeGreaterThan(40)
  expect(second).not.toEqual(first)
})
