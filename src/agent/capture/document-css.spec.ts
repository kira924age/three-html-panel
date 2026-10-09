// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { DocumentCss } from "./css";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.head.innerHTML = "";
});

describe("DocumentCss", () => {
  it("copies the rules of the @media blocks that match the page, and only those", () => {
    // What the page's window says matches (jsdom has no matchMedia).
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("min-width") }));
    document.head.innerHTML =
      "<style>@media (min-width: 1px) { .wide { color: red } } @media print { .printed { color: blue } }</style>";
    const css = new DocumentCss(document, () => null).get().join("\n");
    expect(css).toContain(".wide");
    expect(css).not.toContain(".printed");
  });
});

describe("@namespace rules", () => {
  it("stay first in their own sheet, which the copy keeps apart from the others", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    document.head.innerHTML =
      '<style>@namespace x url("urn:a"); x|item, .sep::after { content: "x|y" }</style>' +
      '<style>@namespace url("http://www.w3.org/2000/svg"); a, [lang|=en] { fill: blue }</style>' +
      "<style>x|item { color: green }</style>";
    const sheets = new DocumentCss(document, () => null).get();
    // The focus ring's, the page's three, and the animations' freeze.
    expect(sheets).toHaveLength(5);
    // As written: prefixes and the default namespace count in their own sheet only.
    expect(sheets[1]).toBe('@namespace x url("urn:a");\nx|item, .sep::after{content: "x|y";}');
    expect(sheets[2]).toBe(
      '@namespace url("http://www.w3.org/2000/svg");\na, [lang|=en]{fill: blue;}',
    );
    expect(sheets[3]).toBe("x|item{color: green;}");
  });

  it("put an @import'ed sheet in a sheet of its own, before the one importing it", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    document.head.innerHTML =
      '<style>x|item { color: red }</style><style>@namespace x url("urn:o"); x|item { color: blue }</style>';
    const [imported, importing] = Array.from(document.styleSheets);
    // jsdom loads no @import: one standing for it, of the sheet it imports.
    const importRule = Object.create(window.CSSImportRule.prototype, {
      styleSheet: { value: imported },
      media: { value: { mediaText: "" } },
    }) as CSSImportRule;
    const sheet = {
      href: null,
      disabled: false,
      cssRules: [importRule, ...Array.from(importing!.cssRules)],
    } as unknown as CSSStyleSheet;
    vi.spyOn(document, "styleSheets", "get").mockReturnValue([sheet] as unknown as StyleSheetList);
    const sheets = new DocumentCss(document, () => null).get();
    // The importing sheet's prefix does not count in the imported one.
    expect(sheets.slice(1, 3)).toEqual([
      "x|item{color: red;}",
      '@namespace x url("urn:o");\nx|item{color: blue;}',
    ]);
  });

  it("keep a linked sheet's relative namespace as it is", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    document.head.innerHTML = '<style>@namespace app url("app"); app|widget { color: red }</style>';
    Object.defineProperty(document.styleSheets[0]!, "href", {
      value: "https://site.test/css/main.css",
    });
    const sheets = new DocumentCss(document, () => null).get();
    expect(sheets[1]!.startsWith('@namespace app url("app");')).toBe(true);
  });
});
