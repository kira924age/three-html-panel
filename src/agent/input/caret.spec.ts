// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { caretAt } from "./caret"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("the mirror a text field is measured with", () => {
  it("wraps a textarea's lines at its content width, without the room a classic scrollbar takes", () => {
    document.body.innerHTML = `<textarea id="text" style="width: 200px; padding-left: 10px; padding-right: 12px">hello</textarea>`
    const field = document.querySelector<HTMLTextAreaElement>("#text")!
    // 200 px wide, a 15 px scrollbar inside: 185 px of padding box.
    Object.defineProperty(field, "clientWidth", { value: 185 })
    const widths: string[] = []
    const append = document.body.appendChild.bind(document.body)
    vi.spyOn(document.body, "appendChild").mockImplementation(node => {
      if (node instanceof HTMLDivElement) widths.push(`${node.style.boxSizing} ${node.style.width}`)
      return append(node)
    })
    caretAt(field, 0)
    expect(widths).toEqual(["content-box 163px"])
  })
})
