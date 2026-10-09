// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { DocumentCss } from "./css";

afterEach(() => {
  vi.unstubAllGlobals();
  document.head.innerHTML = "";
});

describe("DocumentCss", () => {
  it("copies the rules of the @media blocks that match the page, and only those", () => {
    // What the page's window says matches (jsdom has no matchMedia).
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("min-width") }));
    document.head.innerHTML =
      "<style>@media (min-width: 1px) { .wide { color: red } } @media print { .printed { color: blue } }</style>";
    const css = new DocumentCss(document, () => null).get();
    expect(css).toContain(".wide");
    expect(css).not.toContain(".printed");
  });
});

describe("@namespace rules", () => {
  it("come first in the copied CSS, prefixed ones only", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    document.head.innerHTML =
      "<style>p { color: red }</style>" +
      '<style>@namespace svg url("http://www.w3.org/2000/svg"); @namespace url("http://www.w3.org/2000/svg"); svg|a { fill: blue }</style>';
    const css = new DocumentCss(document, () => null).get();
    expect(css.startsWith('@namespace svg url("http://www.w3.org/2000/svg");')).toBe(true);
    expect(css.match(/@namespace/g)).toHaveLength(1);
    expect(css).toContain("svg|a");
  });
});
