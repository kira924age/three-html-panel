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
  // Inside its right edge, clear of a scrollbar drawn over a box's.
  const pixel = await panel.pixel(box.left + box.width - 16, box.top + box.height / 2);
  return pixel.every((value, index) => Math.abs(value - color[index]!) < 30);
}

const BOXES = [
  "#toolbar-box",
  "#layer-box",
  "#badge-box",
  "#note-box",
  "#text-box",
  "#column-box",
  "#margin-box",
  "#generated-box",
  "#moved-box",
];

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
  // (Its own translate puts it 4px lower.)
  expect(Math.abs((await top("#moved-heading")) - (await top("#moved-box")) - 5)).toBeLessThan(2);
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
    // Its own translate kept: drawn from its top edge (4px into the box), not above it.
    const heading = await panel.box("#moved-heading");
    const blue = async (y: number) => {
      const [red, green, blue] = await panel.pixel(heading.left + heading.width - 16, y);
      return red < 90 && green < 90 && blue > 160;
    };
    await expect.poll(() => blue(heading.top + 2)).toBe(true);
    expect(await blue(heading.top - 2)).toBe(false);
    // Colored by a rule with a namespace prefix.
    await expect.poll(() => drawn("#mark", [255, 0, 255]), { message: "#mark" }).toBe(true);
    // The ::before of a box moved child by child: scrolled with them, its
    // 40px up out of view (not left below the stuck heading, where it was).
    const moved = await panel.box("#moved-box");
    const [orange, , notBlue] = await panel.pixel(moved.left + 20, moved.top + 38);
    expect(orange > 220 && notBlue < 60).toBe(false);
    // The generated box at the top of the box, scrolled with it: its lower part, bluer.
    const generated = await panel.box("#generated-box");
    const scrolled = await panel.frame.evaluate(
      () => document.querySelector("#generated-box")!.scrollTop,
    );
    const [, greenness, blueness] = await panel.pixel(generated.left + 20, generated.top + 3);
    // Along its 160px from green to blue: about this much blue at the scroll.
    expect(Math.abs(blueness - (200 * scrolled) / 160)).toBeLessThan(25);
    expect(greenness).toBeLessThan(200);
    // Moved by the scroll exactly: drawn from its top edge to its bottom one.
    const marker = await panel.box("#marker");
    const shade = async (y: number) => (await panel.pixel(marker.left + 20, y))[0];
    await expect.poll(() => shade(marker.top + 2)).toBeLessThan(120);
    await expect.poll(() => shade(marker.top + marker.height - 2)).toBeLessThan(120);
    expect(await shade(marker.top - 3)).toBeGreaterThan(200);
    expect(await shade(marker.top + marker.height + 3)).toBeGreaterThan(200);
  });
});
