import { describe, expect, it } from "vite-plus/test";
import {
  inlineCssUrls,
  liveSelector,
  rewriteSelector,
  signatureParts,
  stylesheetsSignature,
  unwrapLiveSelector,
} from "./css";

describe("rewriteSelector", () => {
  it("lets interaction pseudo-classes match their attributes, as for the live page", () => {
    expect(rewriteSelector("a:hover, b:active")).toBe(
      "a:is(:hover,[data-thp-hover]), b:is(:active,[data-thp-active])",
    );
  });

  it("keeps :focus, :focus-visible and :focus-within apart", () => {
    expect(rewriteSelector("input:focus")).toBe("input:is(:focus,[data-thp-focus])");
    expect(rewriteSelector("input:focus-visible")).toBe(
      "input:is(:focus-visible,[data-thp-focus-visible])",
    );
    expect(rewriteSelector(".card:focus-within")).toBe(
      ".card:is(:focus-within,[data-thp-focus-within])",
    );
  });

  it("lets an open popover and a modal dialog match their attributes (the copy is not in the top layer)", () => {
    expect(rewriteSelector(".menu:popover-open, dialog:modal")).toBe(
      ".menu:is(:popover-open,[data-thp-popover-open]), dialog:is(:modal,[data-thp-modal])",
    );
  });

  it("maps :root to html", () => {
    expect(rewriteSelector(":root")).toBe("html");
    expect(rewriteSelector(":root:hover")).toBe("html:is(:hover,[data-thp-hover])");
  });

  it("leaves what the live page rewrote already", () => {
    const live = liveSelector(".row:hover .tools")!;
    expect(rewriteSelector(live)).toBe(live);
  });

  it("leaves other pseudo-classes alone", () => {
    expect(rewriteSelector("li:hover-like, a:hovered, p:not(:first-child)")).toBe(
      "li:hover-like, a:hovered, p:not(:first-child)",
    );
  });
});

describe("liveSelector", () => {
  it("lets each interaction pseudo-class also match its attribute", () => {
    expect(liveSelector(".row:hover .tools, a:active")).toBe(
      ".row:is(:hover,[data-thp-hover]) .tools, a:is(:active,[data-thp-active])",
    );
    expect(liveSelector("form:focus-within .hint, input:focus, input:focus-visible")).toBe(
      "form:is(:focus-within,[data-thp-focus-within]) .hint, input:is(:focus,[data-thp-focus]), input:is(:focus-visible,[data-thp-focus-visible])",
    );
    expect(liveSelector("li:not(:hover)")).toBe("li:not(:is(:hover,[data-thp-hover]))");
  });

  it("leaves an interaction after a pseudo-element, which neither :is() nor an attribute may follow", () => {
    expect(liveSelector(".row:hover .tools, .bar::-webkit-scrollbar-thumb:hover")).toBe(
      ".row:is(:hover,[data-thp-hover]) .tools, .bar::-webkit-scrollbar-thumb:hover",
    );
    expect(liveSelector("x-menu::part(item):hover")).toBeNull();
    // Not a pseudo-element: inside an attribute's value, or an argument.
    expect(liveSelector('[title="a::b"]:hover')).toBe('[title="a::b"]:is(:hover,[data-thp-hover])');
  });

  it("rewrites what was added to a selector rewritten already, and only that", () => {
    expect(liveSelector(".row:is(:hover, [data-thp-hover]) .tools, .card:hover .menu")).toBe(
      ".row:is(:hover, [data-thp-hover]) .tools, .card:is(:hover,[data-thp-hover]) .menu",
    );
  });

  it("takes its rewrite out again, for the selector as the page wrote it", () => {
    const page = ".row:hover .tools, input:focus-visible, a:not(:active)";
    expect(unwrapLiveSelector(liveSelector(page)!)).toBe(page);
    // As browsers serialize it back, with a space.
    expect(unwrapLiveSelector(".row:is(:hover, [data-thp-hover]) .tools")).toBe(
      ".row:hover .tools",
    );
  });

  it("leaves the text of attribute selectors, strings and escapes, which is not a pseudo-class", () => {
    expect(liveSelector('[data-tip=":hover to see"]')).toBeNull();
    expect(liveSelector("[title=':active']:hover")).toBe(
      "[title=':active']:is(:hover,[data-thp-hover])",
    );
    // Tailwind's escaped class names.
    expect(liveSelector(".md\\:hover\\:underline:hover")).toBe(
      ".md\\:hover\\:underline:is(:hover,[data-thp-hover])",
    );
  });

  it("is null for selectors without them, or rewritten already", () => {
    expect(liveSelector("li:hover-like, p:first-child")).toBeNull();
    expect(liveSelector(".row:is(:hover, [data-thp-hover])")).toBeNull();
  });
});

describe("stylesheetsSignature", () => {
  /** A stand-in for a CSSStyleSheet: only what the signature reads. */
  const sheet = (rules: object[], disabled = false) =>
    ({ cssRules: rules, disabled }) as unknown as CSSStyleSheet;
  const rule = (cssText: string) => ({ cssText });

  it("changes when a sheet an @import loads gets its rules", () => {
    const importedRules: object[] = [];
    const imported = sheet(importedRules);
    const page = sheet([
      rule("@layer base;"),
      { cssText: "@import url(menu.css);", styleSheet: imported },
      rule(".a { color: red }"),
    ]);
    const before = stylesheetsSignature(signatureParts([page]));
    importedRules.push(rule(".nav:hover .sub { display: block }"));
    expect(stylesheetsSignature(signatureParts([page]))).not.toBe(before);
  });

  it("changes when a sheet is disabled or enabled", () => {
    const page = sheet([rule(".a { color: red }")]);
    const enabled = stylesheetsSignature(signatureParts([page]));
    (page as { disabled: boolean }).disabled = true;
    expect(stylesheetsSignature(signatureParts([page]))).not.toBe(enabled);
  });
});

describe("inlineCssUrls", () => {
  it("replaces resolvable urls and drops the rest", () => {
    const resolve = (url: string) =>
      url === "https://example.test/a.png" ? "data:image/png;base64,AA" : null;
    expect(
      inlineCssUrls(
        "a{background:url(a.png)} b{background:url('b.png')}",
        "https://example.test/",
        resolve,
      ),
    ).toBe('a{background:url("data:image/png;base64,AA")} b{background:none}');
  });

  it("keeps data urls", () => {
    expect(
      inlineCssUrls(
        'a{background:url("data:image/gif;base64,R0")}',
        "https://example.test/",
        () => null,
      ),
    ).toBe('a{background:url("data:image/gif;base64,R0")}');
  });
});
