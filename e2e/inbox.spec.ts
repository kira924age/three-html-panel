// The inbox (examples/sites/inbox): actions that show only while their message
// is hovered (CSS :hover), and a menu that opens while focus is in it (CSS
// :focus-within). The panel page never matches those for real; the agent makes
// them apply to the page, so a press lands on what the panel draws.

import { expect, test } from "@playwright/test";
import { PanelPage } from "./panel";

let panel: PanelPage;

test.beforeEach(async ({ page }) => {
  panel = await PanelPage.open(page, "inbox", 720, 480);
});

const MESSAGE = ".message:nth-child(2)";
const status = () => panel.frame.locator("#status").textContent();

test("archives a message with a button that shows only while it is hovered", async ({ page }) => {
  // Not laid out until the message is hovered.
  expect((await panel.box(`${MESSAGE} .archive`)).width).toBe(0);
  const message = await panel.box(MESSAGE);
  await page.mouse.move(...xy(panel.screen(message.left + 40, message.top + message.height / 2)));
  await expect.poll(async () => (await panel.box(`${MESSAGE} .archive`)).width).toBeGreaterThan(0);
  // The subject's hover transition ended at once, as the panel draws it: not still on its way.
  expect(
    await panel.frame.evaluate(
      (selector) =>
        document
          .querySelector(selector)!
          .getAnimations()
          .filter((animation) => animation.playState === "running").length,
      `${MESSAGE} .subject`,
    ),
  ).toBe(0);
  await panel.ifDrawn(async () => {
    // The panel draws the hover's background.
    await expect
      .poll(() => panel.pixel(message.left + 20, message.top + 4))
      .toEqual([0xee, 0xf3, 0xff]);
    // And the button, white inside its border (where the page lays it out).
    const archive = await panel.box(`${MESSAGE} .archive`);
    await expect
      .poll(() => panel.pixel(archive.left + 4, archive.top + archive.height / 2))
      .toEqual([0xff, 0xff, 0xff]);
  });
  await panel.click(await panel.at(`${MESSAGE} .archive`));
  await expect.poll(status).toBe("Archived: Quarterly report");
  await expect(panel.frame.locator(".message")).toHaveCount(2);
});

test("chooses from a menu that is open while focus is in it", async () => {
  const message = await panel.box(MESSAGE);
  await panel.page.mouse.move(
    ...xy(panel.screen(message.left + 40, message.top + message.height / 2)),
  );
  await expect
    .poll(async () => (await panel.box(`${MESSAGE} .more-button`)).width)
    .toBeGreaterThan(0);
  await panel.click(await panel.at(`${MESSAGE} .more-button`));
  await expect
    .poll(async () => (await panel.box(`${MESSAGE} .mark-unread`)).width)
    .toBeGreaterThan(0);
  // The item hangs below the message, over the next one: the press reaches it, not the message under it.
  await panel.click(await panel.at(`${MESSAGE} .mark-unread`));
  await expect.poll(status).toBe("Marked as unread: Quarterly report");
});

test("leaves the page's own transition running when pressed elsewhere", async () => {
  await panel.click(await panel.at("#compose"));
  const running = () =>
    panel.frame.evaluate(
      () =>
        document
          .querySelector("#draft")!
          .getAnimations()
          .filter((animation) => animation.playState === "running").length,
    );
  await expect.poll(running).toBe(1);
  // A press (every ancestor, <html> too, is :active meanwhile) and a hover elsewhere.
  await panel.click(await panel.at("h1"));
  expect(await running()).toBe(1);
});

const xy = ({ x, y }: { x: number; y: number }): [number, number] => [x, y];
