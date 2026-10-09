import { $, $$ } from "./common.js";

// --- Container queries: the grid's own width, chosen with the buttons.
for (const button of $$("[data-width]")) {
  button.addEventListener("click", () => {
    $("#card-grid").style.width = `${button.dataset.width}%`;
    for (const other of $$("[data-width]"))
      other.setAttribute("aria-pressed", String(other === button));
  });
}

// --- Logical properties: the direction of the box.
const directionButton = $('[data-action="direction"]');
directionButton.addEventListener("click", () => {
  const box = $("#logical-box");
  const rtl = box.dir !== "rtl";
  box.dir = rtl ? "rtl" : "ltr";
  directionButton.setAttribute("aria-pressed", String(rtl));
});

// --- OKLCH: twelve hues at the same lightness and chroma.
$("#oklch-swatches").replaceChildren(
  ...Array.from({ length: 12 }, (_, index) => {
    const hue = index * 30;
    const swatch = document.createElement("span");
    swatch.style.background = `oklch(65% 0.16 ${hue})`;
    swatch.textContent = String(hue);
    return swatch;
  }),
);
