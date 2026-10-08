// The article page (examples/sites/article): what stays in view as a page
// scrolls, sticky and fixed elements, drawn where the browser shows them.

import { expect, test } from "@playwright/test";
import { PanelPage, type Box } from "./panel";

let panel: PanelPage;

test.beforeEach(async ({ page }) => {
  panel = await PanelPage.open(page, "article", 720, 720);
});

const HEADER = [16, 80, 160];
const PROGRESS = [220, 40, 40];
const TOC = [40, 160, 90];
const NOTICE = [250, 200, 40];
const TABLE_HEADER = [120, 60, 170];
const GLOSSARY_HEADING = [200, 90, 20];

/** Whether the panel draws about this color at a point of the page. */
async function drawsColor(x: number, y: number, color: number[]): Promise<boolean> {
  const drawn = await panel.pixel(x, y);
  return drawn.every((value, index) => Math.abs(value - color[index]!) < 24);
}

/** Scrolls what is under a point of the page with the wheel, until `scrolled` says it did. */
async function wheel(x: number, y: number, deltaY: number, scrolled: () => Promise<boolean>) {
  const point = panel.screen(x, y);
  await panel.page.mouse.move(point.x, point.y);
  await panel.page.mouse.wheel(0, deltaY);
  await expect.poll(scrolled).toBe(true);
}

const documentScroll = () => panel.frame.evaluate(() => document.documentElement.scrollTop);

test("keeps the sticky header and table of contents, and the fixed bars, where the page shows them as it scrolls", async () => {
  const text = await panel.box("#sections p");
  await wheel(text.left + 20, text.top + 10, 800, async () => (await documentScroll()) > 400);
  const header = await panel.box(".site-header");
  const toc = await panel.box(".toc");
  const notice = await panel.box(".notice");
  const progress = await panel.box(".reading-progress");
  // The browser shows them at the top (and the notice at the bottom), whatever the scroll.
  expect(header.top).toBe(0);
  expect(Math.round(toc.top)).toBe(72);
  expect(Math.round(notice.top + notice.height)).toBe(720);
  expect(progress.width).toBeGreaterThan(20);

  await panel.ifDrawn(async () => {
    const right = (box: Box) => box.left + box.width - 8;
    await expect.poll(() => drawsColor(500, header.top + header.height / 2, HEADER)).toBe(true);
    await expect.poll(() => drawsColor(10, 3, PROGRESS)).toBe(true);
    await expect.poll(() => drawsColor(right(toc), toc.top + 6, TOC)).toBe(true);
    await expect.poll(() => drawsColor(500, notice.top + notice.height / 2, NOTICE)).toBe(true);
  });
});

test("keeps a table's sticky header at the top of its scrolled box, in a scrolled page", async () => {
  const title = await panel.box("h1");
  await wheel(title.left + 20, title.top + 10, 100, async () => (await documentScroll()) > 0);
  const wrap = await panel.box("#table-wrap");
  await wheel(
    wrap.left + 100,
    wrap.top + wrap.height / 2,
    120,
    async () =>
      (await panel.frame.evaluate(() => document.querySelector("#table-wrap")!.scrollTop)) > 40,
  );
  const cell = await panel.box("th:last-child");
  // Stuck to the top of the box (inside its border).
  expect(Math.abs(cell.top - wrap.top)).toBeLessThan(2);

  await panel.ifDrawn(async () => {
    await expect
      .poll(() => drawsColor(cell.left + cell.width - 8, cell.top + 4, TABLE_HEADER))
      .toBe(true);
    const header = await panel.box(".site-header");
    await expect.poll(() => drawsColor(500, header.top + header.height / 2, HEADER)).toBe(true);
  });
});

test("keeps a sticky heading at the top of the box it scrolls in, as a child of it", async () => {
  const title = await panel.box("h1");
  await wheel(title.left + 20, title.top + 10, 200, async () => (await documentScroll()) > 100);
  const glossary = await panel.box("#glossary");
  await wheel(
    glossary.left + 100,
    glossary.top + glossary.height / 2,
    30,
    async () =>
      (await panel.frame.evaluate(() => document.querySelector("#glossary")!.scrollTop)) > 10,
  );
  const heading = await panel.box("#glossary h3");
  // The first heading, stuck to the top of the box (inside its border).
  expect(Math.abs(heading.top - glossary.top)).toBeLessThan(2);

  await panel.ifDrawn(() =>
    expect
      .poll(() => drawsColor(heading.left + heading.width - 30, heading.top + 3, GLOSSARY_HEADING))
      .toBe(true),
  );
});
