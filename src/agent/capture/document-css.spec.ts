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
  it("come first in the copied CSS, prefixed ones only, each sheet's prefixes its own", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    document.head.innerHTML =
      '<style>@namespace x url("urn:a"); x|item { color: red }</style>' +
      '<style>@namespace x url("urn:b"); @namespace url("urn:c"); x|item, [lang|=en] { color: blue }</style>' +
      "<style>x|item { color: green }</style>";
    const css = new DocumentCss(document, () => null).get();
    expect(css.split("\n").slice(0, 2)).toEqual([
      '@namespace thp1-x url("urn:a");',
      '@namespace thp2-x url("urn:b");',
    ]);
    expect(css.match(/@namespace/g)).toHaveLength(2);
    expect(css).toContain("\nthp1-x|item{color: red;}");
    expect(css).toContain("\nthp2-x|item, [lang|=en]{color: blue;}");
    // Not declared in its own sheet: dropped by the page, and by the copy.
    expect(css).toContain("\nx|item{color: green;}");
  });

  it("keep a linked sheet's relative namespace as it is", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    document.head.innerHTML = '<style>@namespace app url("app"); app|widget { color: red }</style>';
    Object.defineProperty(document.styleSheets[0]!, "href", {
      value: "https://site.test/css/main.css",
    });
    const css = new DocumentCss(document, () => null).get();
    expect(css.startsWith('@namespace thp1-app url("app");')).toBe(true);
  });
});
