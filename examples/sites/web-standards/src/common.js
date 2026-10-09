// What every page runs first: the agent, then the header, the theme and the
// table of contents. Each page's own script imports this first.
import "./agent.js";

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

// --- Theme: follows the system until toggled, and goes along to the next page
// in the links' ?theme= (the page may run sandboxed, where storage throws).
const root = document.documentElement;
const systemDark = matchMedia("(prefers-color-scheme: dark)");
const asked = new URLSearchParams(location.search).get("theme");
let chosen = asked === "dark" || asked === "light" ? asked : null;

function applyTheme() {
  const dark = chosen ? chosen === "dark" : systemDark.matches;
  root.dataset.theme = dark ? "dark" : "light";
  $('[data-action="theme"]')?.setAttribute("aria-pressed", String(dark));
  // Links to the other pages carry the choice.
  for (const link of $$("a[data-page]")) {
    const url = new URL(link.getAttribute("href"), location.href);
    if (chosen) url.searchParams.set("theme", chosen);
    else url.searchParams.delete("theme");
    link.href = url.pathname.split("/").pop() + url.search + url.hash;
  }
}
systemDark.addEventListener("change", applyTheme);
document.addEventListener("click", (event) => {
  if (!event.target.closest('[data-action="theme"]')) return;
  chosen = root.dataset.theme === "dark" ? "light" : "dark";
  applyTheme();
});

// --- The header's navigation: the current page is marked.
const page = location.pathname.split("/").pop() || "index.html";
for (const link of $$(".site-nav a")) {
  const target = new URL(link.getAttribute("href"), location.href).pathname.split("/").pop();
  if ((target || "index.html") === page) link.setAttribute("aria-current", "page");
}
applyTheme();

// --- Table of contents: one entry per section of the page, the one in view marked.
const toc = $(".toc ol");
const sections = $$("main > section[id]");
if (toc) {
  toc.replaceChildren(
    ...sections.map((section) => {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = `#${section.id}`;
      link.textContent = $("h2, h1", section)?.textContent ?? section.id;
      item.append(link);
      return item;
    }),
  );
  const links = $$("a", toc);
  const markCurrent = () => {
    const current =
      sections.findLast((section) => section.getBoundingClientRect().top < 140) ?? sections[0];
    links.forEach((link, index) =>
      link.setAttribute("aria-current", String(sections[index] === current)),
    );
  };
  addEventListener("scroll", markCurrent, { passive: true });
  markCurrent();
}
