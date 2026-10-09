// The boxes page (examples/sites/boxes): boxes that scroll, and what is
// positioned in them (sticky, fixed, absolute), drawn where the browser shows it.

import { expect, test } from "@playwright/test";
import { PanelPage } from "./panel";

let panel: PanelPage;

test.beforeEach(async ({ page }) => {
  panel = await PanelPage.open(page, "boxes", 720, 720);
});

/** Whether the panel draws about this color in the middle of an element. */
async function drawn(selector: string, color: number[]): Promise<boolean> {
  const box = await panel.box(selector);
  const pixel = await panel.pixel(box.left + box.width - 6, box.top + box.height / 2);
  return pixel.every((value, index) => Math.abs(value - color[index]!) < 30);
}

const BOXES = ["#toolbar-box", "#layer-box", "#badge-box", "#note-box", "#text-box", "#column-box"];

test("draws what is positioned in scrolled boxes where the page shows it", async ({ page }) => {
  for (const selector of BOXES) {
    const box = await panel.box(selector);
    const point = panel.screen(box.left + 150, box.top + 100);
    await page.mouse.move(point.x, point.y);
    await page.mouse.wheel(0, 80);
    await expect
      .poll(() =>
        panel.frame.evaluate((selector) => document.querySelector(selector)!.scrollTop, selector),
      )
      .toBeGreaterThan(50);
  }
  // The page has them stuck, or in view, there.
  const top = async (selector: string) => (await panel.box(selector)).top;
  expect(Math.abs((await top("#toolbar")) - (await top("#toolbar-box")) - 1)).toBeLessThan(2);
  expect(Math.abs((await top("#text-heading")) - (await top("#text-box")) - 1)).toBeLessThan(2);
  expect(Math.abs((await top("#column-heading")) - (await top("#column-box")) - 1)).toBeLessThan(2);

  await panel.ifDrawn(async () => {
    const colors: [string, number[]][] = [
      // Sticky, over what follows it in the box.
      ["#toolbar", [250, 160, 0]],
      ["#text-heading", [0, 160, 160]],
      ["#column-heading", [120, 80, 0]],
      // Fixed to the viewport, in sticky elements.
      ["#menu", [220, 30, 30]],
      ["#popup", [250, 120, 200]],
      // Fixed, in a box that is their containing block: scrolled with it.
      ["#pinned", [30, 30, 220]],
      // Absolute, from the box; and from the page, outside the box that scrolls.
      ["#badge", [30, 180, 30]],
      ["#note", [200, 0, 200]],
    ];
    for (const [selector, color] of colors)
      await expect.poll(() => drawn(selector, color), { message: selector }).toBe(true);
  });
});
