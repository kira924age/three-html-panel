// What every page runs first: the agent, then the header, the theme and the
// table of contents. Each page's own script imports this first.
import "./agent.js";

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

// --- Theme: light, dark, or the system's (until chosen), and goes along to the
// next page in the links' ?theme= (the page may run sandboxed, where storage throws).
const root = document.documentElement;
const systemDark = matchMedia("(prefers-color-scheme: dark)");
const asked = new URLSearchParams(location.search).get("theme");
/** "light", "dark", or null: the system's. */
let chosen = asked === "dark" || asked === "light" ? asked : null;

const icon = (paths) =>
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const THEMES = [
  {
    value: "light",
    label: "Light",
    icon: icon(
      '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    ),
  },
  {
    value: "system",
    label: "System",
    icon: icon('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>'),
  },
  {
    value: "dark",
    label: "Dark",
    icon: icon('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'),
  },
];

const CHECK = icon('<path d="M20 6 9 17l-5-5"/>').replace("<svg", '<svg class="check"');

// The button shows the theme in use; it opens a menu of the three.
const themeSwitch = $("[data-theme-switch]");
if (themeSwitch) {
  themeSwitch.innerHTML =
    `<button type="button" class="theme-button" popovertarget="theme-menu" aria-haspopup="menu" aria-expanded="false" data-theme-current></button>` +
    `<div id="theme-menu" class="theme-menu" popover role="menu" aria-label="Theme">` +
    THEMES.map(
      ({ value, label, icon }) =>
        `<button type="button" role="menuitemradio" data-theme-choice="${value}">${icon}<span>${label}</span>${CHECK}</button>`,
    ).join("") +
    `</div>`;
}
const themeButton = $("[data-theme-current]");
const themeMenu = $("#theme-menu");
const themeItems = $$("[data-theme-choice]");

function chooseTheme(value) {
  chosen = value === "system" ? null : value;
  applyTheme();
}

function applyTheme() {
  const dark = chosen ? chosen === "dark" : systemDark.matches;
  root.dataset.theme = dark ? "dark" : "light";
  const current = THEMES.find((theme) => theme.value === (chosen ?? "system"));
  if (themeButton) {
    themeButton.innerHTML = current.icon;
    themeButton.setAttribute("aria-label", `Theme: ${current.label}`);
    themeButton.title = `Theme: ${current.label}`;
  }
  for (const item of themeItems) {
    item.setAttribute("aria-checked", String(item.dataset.themeChoice === current.value));
  }
  // Links to the other pages carry the choice.
  for (const link of $$("a[data-page]")) {
    const url = new URL(link.getAttribute("href"), location.href);
    if (chosen) url.searchParams.set("theme", chosen);
    else url.searchParams.delete("theme");
    link.href = url.pathname.split("/").pop() + url.search + url.hash;
  }
}
systemDark.addEventListener("change", applyTheme);

themeMenu?.addEventListener("toggle", (event) => {
  const open = event.newState === "open";
  themeButton.setAttribute("aria-expanded", String(open));
  if (!open) return;
  // Under the button, right edges lined up: CSS anchor positioning, or by hand where it is missing.
  if (!CSS.supports("position-area", "bottom")) {
    const button = themeButton.getBoundingClientRect();
    themeMenu.style.top = `${button.bottom + 6}px`;
    themeMenu.style.right = `${document.documentElement.clientWidth - button.right}px`;
  }
  (
    themeItems.find((item) => item.getAttribute("aria-checked") === "true") ?? themeItems[0]
  ).focus();
});
themeMenu?.addEventListener("click", (event) => {
  const item = event.target.closest("[data-theme-choice]");
  if (!item) return;
  chooseTheme(item.dataset.themeChoice);
  themeMenu.hidePopover();
  themeButton.focus();
});
// The keys of a menu: the arrows, Home and End move; Escape and Tab close it.
themeMenu?.addEventListener("keydown", (event) => {
  const index = themeItems.indexOf(document.activeElement);
  const next = {
    ArrowDown: themeItems[(index + 1) % themeItems.length],
    ArrowUp: themeItems[(index - 1 + themeItems.length) % themeItems.length],
    Home: themeItems[0],
    End: themeItems.at(-1),
  }[event.key];
  if (next) {
    event.preventDefault();
    next.focus();
  } else if (event.key === "Escape" || event.key === "Tab") {
    themeMenu.hidePopover();
    if (event.key === "Escape") themeButton.focus();
  }
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
