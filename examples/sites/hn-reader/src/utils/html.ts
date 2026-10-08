// HN's texts (stories, comments, profiles) are HTML. They are parsed into an
// inert document (DOMParser runs no scripts and loads nothing) and rebuilt from
// an allowlist of tags; links keep only an http(s) href and open in a new tab.

const ALLOWED = new Set([
  "P",
  "A",
  "I",
  "EM",
  "B",
  "STRONG",
  "PRE",
  "CODE",
  "BR",
  "BLOCKQUOTE",
  "UL",
  "OL",
  "LI",
]);

function copy(node: Node, into: Node, doc: Document): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      into.appendChild(doc.createTextNode(child.textContent ?? ""));
    } else if (child instanceof Element) {
      if (!ALLOWED.has(child.tagName)) {
        // Dropped, but its text stays (unless it is a script or a style).
        if (child.tagName !== "SCRIPT" && child.tagName !== "STYLE") copy(child, into, doc);
        continue;
      }
      const clean = doc.createElement(child.tagName.toLowerCase());
      if (child.tagName === "A") {
        const href = child.getAttribute("href") ?? "";
        if (/^https?:\/\//i.test(href)) {
          clean.setAttribute("href", href);
          clean.setAttribute("target", "_blank");
          clean.setAttribute("rel", "noopener noreferrer");
        }
      }
      copy(child, clean, doc);
      into.appendChild(clean);
    }
  }
}

export function sanitize(html: string | null | undefined): string {
  if (!html) return "";
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const out = document.implementation.createHTMLDocument("");
  const root = out.createElement("div");
  copy(parsed.body, root, out);
  return root.innerHTML;
}

/** The text of an HTML fragment, for previews. */
export function toPlainText(html: string | null | undefined): string {
  if (!html) return "";
  const parsed = new DOMParser().parseFromString(
    `<body>${html.replace(/<p>/gi, " <p>")}</body>`,
    "text/html",
  );
  return (parsed.body.textContent ?? "").replace(/\s+/g, " ").trim();
}
