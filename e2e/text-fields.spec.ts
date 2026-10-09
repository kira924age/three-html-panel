// Email and number fields, which have no selection API (setSelectionRange and
// setRangeText throw on them): typing and deleting in them. The fields are
// added to the controls page (examples/sites/controls), which has none.

import { expect, test } from "@playwright/test";
import { PanelPage } from "./panel";

let panel: PanelPage;

test.beforeEach(async ({ page }) => {
  panel = await PanelPage.open(page, "controls", 720, 720);
  await panel.frame.evaluate(() => {
    const box = document.createElement("div");
    box.style.cssText =
      "position: fixed; top: 10px; left: 10px; z-index: 10; display: grid; gap: 8px; background: white; padding: 8px";
    box.innerHTML = `<input id="e2e-email" type="email" style="width: 240px; font-size: 20px">
      <input id="e2e-number" type="number" style="width: 240px; font-size: 20px">`;
    document.body.appendChild(box);
  });
  // The fields reach the image with the next frame.
  await panel.page.waitForTimeout(300);
});

const valueOf = (id: string) =>
  panel.frame.evaluate((id) => document.querySelector<HTMLInputElement>(`#${id}`)!.value, id);

test("takes typing and Backspace in an email field, the caret drawn at the end", async ({
  page,
}) => {
  await panel.focus(await panel.at("#e2e-email", 0.5, 0.5));
  await page.keyboard.type("x@y.z");
  await expect.poll(() => valueOf("e2e-email")).toBe("x@y.z");
  // The caret is drawn after the text (the page reports it with a later frame).
  const box = await panel.box("#e2e-email");
  await expect.poll(async () => (await panel.caret())?.x ?? 0).toBeGreaterThan(box.left + 40);
  expect((await panel.caret())!.x).toBeLessThan(box.left + box.width / 2);
  await page.keyboard.press("Backspace");
  await expect.poll(() => valueOf("e2e-email")).toBe("x@y.");
});

test("takes a number typed through text that is not a number yet", async ({ page }) => {
  await panel.focus(await panel.at("#e2e-number", 0.3, 0.5));
  await page.keyboard.type("-1.5");
  await expect.poll(() => valueOf("e2e-number")).toBe("-1.5");
  await page.keyboard.press("Backspace");
  // "-1." is not a number: it reads as empty, as when typed in the browser.
  await expect.poll(() => valueOf("e2e-number")).toBe("");
  await page.keyboard.press("Backspace");
  await expect.poll(() => valueOf("e2e-number")).toBe("-1");
});
