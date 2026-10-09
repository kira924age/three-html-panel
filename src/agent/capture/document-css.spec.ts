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

/**
 * Makes `importing` @import `imported`, after its first `at` rules (jsdom
 * loads no @import): the document has that one sheet.
 */
function importSheet(
  imported: CSSStyleSheet,
  importing: CSSStyleSheet,
  conditions: { layerName?: string | null; supportsText?: string | null } = {},
  at = 0,
): void {
  const importRule = Object.create(window.CSSImportRule.prototype, {
    styleSheet: { value: imported },
    media: { value: { mediaText: "" } },
    layerName: { value: conditions.layerName ?? null },
    supportsText: { value: conditions.supportsText ?? null },
  }) as CSSImportRule;
  const sheet = {
    href: null,
    disabled: false,
    cssRules: [
      ...Array.from(importing.cssRules).slice(0, at),
      importRule,
      ...Array.from(importing.cssRules).slice(at),
    ],
  } as unknown as CSSStyleSheet;
  vi.spyOn(document, "styleSheets", "get").mockReturnValue([sheet] as unknown as StyleSheetList);
}

describe("blocks of rules", () => {
  it("copy @layer and @container blocks with their rules as the top level's", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("min-width") }));
    document.head.innerHTML =
      "<style>@layer utilities { .a:hover { color: red } @media (min-width: 1px) { .wide { color: blue } } " +
      "@media print { .printed { color: green } } } @container (min-width: 1px) { .b:focus { color: red } }</style>";
    const css = new DocumentCss(document, () => null).get()[1];
    expect(css).toBe(
      "@layer utilities {\n.a[data-thp-hover]{color: red;}\n.wide{color: blue;}\n}\n" +
        "@container (min-width: 1px) {\n.b[data-thp-focus]{color: red;}\n}",
    );
  });
});

describe("@import rules", () => {
  it("put the imported sheet in the layer it is imported into, @namespace rules outside it", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    document.head.innerHTML =
      '<style>@namespace x url("urn:i"); a { color: blue }</style><style>a { color: red }</style>';
    const [imported, importing] = Array.from(document.styleSheets);
    importSheet(imported!, importing!, { layerName: "base" });
    expect(new DocumentCss(document, () => null).get()[1]).toBe(
      '@namespace x url("urn:i");\n@layer base {\na{color: blue;}\n}',
    );
    // An anonymous layer too.
    importSheet(imported!, importing!, { layerName: "" });
    expect(new DocumentCss(document, () => null).get()[1]).toBe(
      '@namespace x url("urn:i");\n@layer {\na{color: blue;}\n}',
    );
  });

  it("keep @layer statements before the imports before the imported sheets", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    document.head.innerHTML =
      "<style>a { color: blue }</style><style>@layer components, base; a { color: red }</style>";
    const [imported, importing] = Array.from(document.styleSheets);
    importSheet(imported!, importing!, { layerName: "base" }, 1);
    const sheets = new DocumentCss(document, () => null).get();
    // components first, as on the page (not base, imported first in the copy).
    expect(sheets.slice(1, 4)).toEqual([
      "@layer components, base;",
      "@layer base {\na{color: blue;}\n}",
      "a{color: red;}",
    ]);
  });

  it("nest the layers of a sheet imported by an imported one", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    document.head.innerHTML =
      "<style>a { color: blue }</style><style>b { color: green }</style><style>c { color: red }</style>";
    const [deepest, middle, top] = Array.from(document.styleSheets);
    // middle imports deepest into layer "reset"; top imports middle into "base".
    const middleImporting = Object.create(window.CSSStyleSheet.prototype, {
      href: { value: null },
      disabled: { value: false },
      cssRules: {
        value: [
          Object.create(window.CSSImportRule.prototype, {
            styleSheet: { value: deepest },
            media: { value: { mediaText: "" } },
            layerName: { value: "reset" },
            supportsText: { value: null },
          }),
          ...Array.from(middle!.cssRules),
        ],
      },
    }) as CSSStyleSheet;
    importSheet(middleImporting, top!, { layerName: "base" });
    const sheets = new DocumentCss(document, () => null).get();
    expect(sheets.slice(1, 4)).toEqual([
      "@layer base {\n@layer reset {\na{color: blue;}\n}\n}",
      "@layer base {\nb{color: green;}\n}",
      "c{color: red;}",
    ]);
  });

  it("leave out a sheet imported under supports() the browser does not meet", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    vi.stubGlobal("CSS", { supports: (condition: string) => condition === "display: grid" });
    document.head.innerHTML = "<style>a { color: blue }</style><style>a { color: red }</style>";
    const [imported, importing] = Array.from(document.styleSheets);
    importSheet(imported!, importing!, { supportsText: "display: frobnicate" });
    expect(new DocumentCss(document, () => null).get().join("\n")).not.toContain("blue");
    importSheet(imported!, importing!, { supportsText: "display: grid" });
    expect(new DocumentCss(document, () => null).get().join("\n")).toContain("blue");
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
    importSheet(imported!, importing!);
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
