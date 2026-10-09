import { describe, expect, it } from "vite-plus/test";
import { parseCssColor } from "./css-color";

/** The color as 0–255 channels (rounded) and its alpha, to compare with what a browser draws. */
const bytes = (css: string) => {
  const color = parseCssColor(css);
  if (!color) return null;
  const { r, g, b, alpha } = color;
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255), alpha];
};

describe("parseCssColor", () => {
  it("reads rgb() in the legacy and the modern syntax", () => {
    expect(bytes("rgb(1, 2, 3)")).toEqual([1, 2, 3, 1]);
    expect(bytes("rgba(0, 0, 0, 0)")).toEqual([0, 0, 0, 0]);
    expect(bytes("rgba(10, 20, 30, 0.25)")).toEqual([10, 20, 30, 0.25]);
    expect(bytes("rgb(10 20 30 / 50%)")).toEqual([10, 20, 30, 0.5]);
    expect(bytes("rgb(10.5 none 100% / .5)")).toEqual([11, 0, 255, 0.5]);
    expect(bytes("RGB(1 2 3)")).toEqual([1, 2, 3, 1]);
  });

  it("reads the color the page wrote in Vuetify's way: color(srgb) with an alpha", () => {
    expect(parseCssColor("color(srgb 0 0 0 / 0.87)")).toEqual({ r: 0, g: 0, b: 0, alpha: 0.87 });
    expect(bytes("color(srgb 1 0.5 50%)")).toEqual([255, 128, 128, 1]);
  });

  it("converts the other color() spaces to sRGB", () => {
    expect(bytes("color(srgb-linear 0.21586 0.21586 0.21586)")).toEqual([128, 128, 128, 1]);
    expect(bytes("color(display-p3 0.917488 0.200287 0.138561)")).toEqual([255, 0, 0, 1]);
    expect(bytes("color(a98-rgb 0.858605 0 0)")).toEqual([255, 0, 0, 1]);
    expect(bytes("color(prophoto-rgb 0.702342 0.275734 0.103539)")).toEqual([255, 0, 0, 1]);
    expect(bytes("color(rec2020 0.791977 0.230976 0.0739059)")).toEqual([255, 0, 0, 1]);
    expect(bytes("color(xyz 0.412391 0.212639 0.0193308)")).toEqual([255, 0, 0, 1]);
    expect(bytes("color(xyz-d65 0.95047 1 1.08883)")).toEqual([255, 255, 255, 1]);
    expect(bytes("color(xyz-d50 0.436066 0.222488 0.0139232)")).toEqual([255, 0, 0, 1]);
  });

  it("converts lab(), lch(), oklab() and oklch() to sRGB", () => {
    expect(bytes("lab(54.2905 80.8049 69.891)")).toEqual([255, 0, 0, 1]);
    expect(bytes("lch(54.2905 106.837 40.8526 / 0.5)")).toEqual([255, 0, 0, 0.5]);
    expect(bytes("lab(100% 0 0)")).toEqual([255, 255, 255, 1]);
    expect(bytes("oklab(0.627955 0.224863 0.125846)")).toEqual([255, 0, 0, 1]);
    expect(bytes("oklch(0.627955 0.257683 29.2339)")).toEqual([255, 0, 0, 1]);
    expect(bytes("oklch(62.7955% 64.4% 0.0812turn)")).toEqual([255, 0, 0, 1]);
    expect(bytes("oklch(0.5 0 none)")).toEqual([99, 99, 99, 1]);
  });

  it("clips colors outside sRGB to it", () => {
    expect(bytes("color(display-p3 0 1 0)")).toEqual([0, 255, 0, 1]);
    expect(bytes("oklch(0.9 0.4 145)")).toEqual([0, 255, 0, 1]);
    expect(bytes("color(srgb 2 -1 0.5 / 3)")).toEqual([255, 0, 128, 1]);
  });

  it("reads the sRGB syntaxes a page could send too", () => {
    expect(bytes("#ff0000")).toEqual([255, 0, 0, 1]);
    expect(bytes("#0f08")).toEqual([0, 255, 0, 0x88 / 255]);
    expect(bytes("red")).toEqual([255, 0, 0, 1]);
    expect(bytes("hsl(120, 100%, 25%)")).toEqual([0, 128, 0, 1]);
    expect(bytes("hsl(120deg 100 25 / 0.5)")).toEqual([0, 128, 0, 0.5]);
    expect(bytes("hsl(-240 100% 25%)")).toEqual([0, 128, 0, 1]);
    expect(bytes("hwb(0 0% 0%)")).toEqual([255, 0, 0, 1]);
    expect(bytes("hwb(0 60% 60%)")).toEqual([128, 128, 128, 1]);
  });

  it("reads transparent as a zero alpha", () => {
    expect(parseCssColor("transparent")?.alpha).toBe(0);
    expect(parseCssColor("oklch(0.5 0.1 200 / 0)")?.alpha).toBe(0);
  });

  it("gives null for what it cannot read", () => {
    for (const bad of [
      "",
      "currentcolor",
      "notacolor",
      "#ff00f",
      "rgb()",
      "rgb(1 2)",
      "rgb(1 2 3 4)",
      "rgb(1 2 3 / 0.5 / 1)",
      "rgb(1deg 2 3)",
      "hsl(10% 50% 50%)",
      "color(srgb, 1, 0, 0)",
      "color(unknown 1 0 0)",
      "color(srgb 1 0)",
      "oklch(0.5 0.1 200",
      "color-mix(in srgb, red, blue)",
      "light-dark(red, blue)",
      "rgb(calc(1) 2 3)",
      "constructor",
      "constructor(1 2 3)",
      "color(__proto__ 1 2 3)",
    ])
      expect(parseCssColor(bad), bad).toBeNull();
  });
});
