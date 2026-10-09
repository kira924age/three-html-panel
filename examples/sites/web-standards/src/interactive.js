import { $, $$ } from "./common.js";

// --- Table: rows from data, sorted by the header pressed.
const elements = [
  ["details", "Interactive", 2011, 97],
  ["dialog", "Interactive", 2022, 96],
  ["popover", "Global attribute", 2024, 91],
  ["datalist", "Forms", 2013, 95],
  ["meter", "Forms", 2013, 97],
  ["output", "Forms", 2011, 98],
  ["picture", "Embedded", 2015, 97],
  ["template", "Scripting", 2014, 98],
  ["slot", "Scripting", 2018, 96],
  ["search", "Sections", 2023, 90],
  ["mark", "Text", 2010, 99],
  ["time", "Text", 2011, 99],
];
const tbody = $("#elements-table tbody");
let sortColumn = -1;
let ascending = true;
function renderTable() {
  const rows = [...elements];
  if (sortColumn >= 0) {
    rows.sort((a, b) => {
      const x = a[sortColumn];
      const y = b[sortColumn];
      const order = typeof x === "number" ? x - y : String(x).localeCompare(String(y));
      return ascending ? order : -order;
    });
  }
  tbody.replaceChildren(
    ...rows.map(([name, category, year, support]) => {
      const row = document.createElement("tr");
      row.innerHTML =
        `<td><code>&lt;${name}&gt;</code></td><td>${category}</td>` +
        `<td class="number">${year}</td><td class="number">${support}%</td>`;
      return row;
    }),
  );
  $$("#elements-table th").forEach((th, index) => {
    if (index === sortColumn) th.setAttribute("aria-sort", ascending ? "ascending" : "descending");
    else th.removeAttribute("aria-sort");
  });
}
$$("#elements-table th button").forEach((button, index) =>
  button.addEventListener("click", () => {
    ascending = sortColumn === index ? !ascending : true;
    sortColumn = index;
    renderTable();
  }),
);
const average = elements.reduce((sum, row) => sum + row[3], 0) / elements.length;
$("#support-average").textContent = `${average.toFixed(1)}%`;
renderTable();

// --- Dialog and popovers.
const dialog = $("#dialog");
const overlayResult = $("#overlay-result");
$('[data-action="open-dialog"]').addEventListener("click", () => dialog.showModal());
dialog.addEventListener("close", () => {
  const title = $('input[name="title"]', dialog).value;
  overlayResult.textContent = dialog.returnValue === "save" ? `Saved: “${title}”.` : "Cancelled.";
  if (dialog.returnValue === "save") document.title = `${title} · Interactive`;
});
for (const item of $$("[data-choice]")) {
  item.addEventListener("click", () => {
    $("#menu").hidePopover();
    overlayResult.textContent = `Chose “${item.dataset.choice}”.`;
  });
}

// --- Tabs: click, or the arrow keys, Home and End.
const tabs = $$('[role="tab"]');
function selectTab(tab, focus = false) {
  for (const other of tabs) {
    const selected = other === tab;
    other.setAttribute("aria-selected", String(selected));
    other.tabIndex = selected ? 0 : -1;
    $(`#${other.getAttribute("aria-controls")}`).hidden = !selected;
  }
  if (focus) tab.focus();
}
for (const tab of tabs) {
  tab.addEventListener("click", () => selectTab(tab));
  tab.addEventListener("keydown", (event) => {
    const index = tabs.indexOf(tab);
    const next = {
      ArrowRight: tabs[(index + 1) % tabs.length],
      ArrowLeft: tabs[(index - 1 + tabs.length) % tabs.length],
      Home: tabs[0],
      End: tabs.at(-1),
    }[event.key];
    if (!next) return;
    event.preventDefault();
    selectTab(next, true);
  });
}

// --- A custom element with its own shadow DOM: a rating of five stars.
class Rating extends HTMLElement {
  static observedAttributes = ["value"];
  #buttons = [];

  constructor() {
    super();
    const shadow = this.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { display: inline-grid; gap: 0.3rem; font: 0.9rem system-ui, sans-serif; }
        .stars { display: flex; gap: 0.15rem; }
        button { all: unset; cursor: pointer; font-size: 1.6rem; line-height: 1; color: #c9ccd2; transition: transform 0.1s, color 0.1s; }
        button:hover { transform: scale(1.15); }
        button[aria-checked="true"] { color: #f59e0b; }
        button:focus-visible { outline: 2px solid #2f6fde; outline-offset: 2px; border-radius: 4px; }
      </style>
      <slot></slot>
      <div class="stars" role="radiogroup"></div>`;
    const stars = shadow.querySelector(".stars");
    for (let value = 1; value <= 5; value++) {
      const button = document.createElement("button");
      button.textContent = "★";
      button.setAttribute("role", "radio");
      button.setAttribute("aria-label", `${value} star${value > 1 ? "s" : ""}`);
      button.addEventListener("click", () => {
        this.setAttribute("value", String(value));
        this.dispatchEvent(new CustomEvent("change", { detail: value, bubbles: true }));
      });
      stars.append(button);
      this.#buttons.push(button);
    }
  }

  attributeChangedCallback() {
    const value = Number(this.getAttribute("value")) || 0;
    this.#buttons.forEach((button, index) =>
      button.setAttribute("aria-checked", String(index < value)),
    );
  }
}
customElements.define("fg-rating", Rating);
// The badge's shadow root is declared in the HTML; the element only needs a name.
customElements.define("fg-badge", class extends HTMLElement {});
$("fg-rating").addEventListener("change", (event) => {
  $("#rating-result").textContent = `Rated ${event.detail} of 5.`;
});

// --- View transitions within the page: the list moves to its new order.
const names = ["Grid", "Flexbox", "Subgrid", "Anchors", "Popover", "Dialog", "Ruby", "Has"];
const list = $("#vt-list");
let order = names.map((_, index) => index);
function renderVtList() {
  list.replaceChildren(
    ...order.map((index) => {
      const item = document.createElement("li");
      item.textContent = names[index];
      item.style.setProperty("--hue", String(index * 45));
      item.style.viewTransitionName = `vt-item-${index}`;
      return item;
    }),
  );
}
function reorder(next) {
  const update = () => {
    order = next;
    renderVtList();
  };
  if (document.startViewTransition) document.startViewTransition(update);
  else update();
}
$('[data-action="shuffle"]').addEventListener("click", () => {
  const next = [...order];
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  reorder(next);
});
$('[data-action="sort"]').addEventListener("click", () =>
  reorder([...order].sort((a, b) => names[a].localeCompare(names[b]))),
);
renderVtList();

// --- Intl: the same values in four languages.
const sample = new Date(Date.UTC(2026, 9, 9, 9, 30));
function renderIntl(locale) {
  const rows = [
    [
      "Date",
      new Intl.DateTimeFormat(locale, { dateStyle: "full", timeZone: "UTC" }).format(sample),
    ],
    [
      "Time",
      new Intl.DateTimeFormat(locale, { timeStyle: "short", timeZone: "UTC" }).format(sample),
    ],
    ["Number", new Intl.NumberFormat(locale).format(1234567.891)],
    ["Price", new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(1999.5)],
    ["Compact", new Intl.NumberFormat(locale, { notation: "compact" }).format(4_200_000)],
    ["Relative", new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-1, "day")],
    ["List", new Intl.ListFormat(locale).format(["HTML", "CSS", "JavaScript"])],
    [
      "Unit",
      new Intl.NumberFormat(locale, { style: "unit", unit: "kilometer-per-hour" }).format(88),
    ],
  ];
  const intl = $("#intl-list");
  intl.lang = locale;
  intl.dir = locale.startsWith("ar") ? "rtl" : "ltr";
  intl.replaceChildren(
    ...rows.flatMap(([label, value]) => {
      const term = document.createElement("dt");
      term.textContent = label;
      term.lang = "en";
      const description = document.createElement("dd");
      description.textContent = value;
      return [term, description];
    }),
  );
}
for (const button of $$("[data-locale]")) {
  button.addEventListener("click", () => {
    renderIntl(button.dataset.locale);
    for (const other of $$("[data-locale]"))
      other.setAttribute("aria-pressed", String(other === button));
  });
}
renderIntl("en-GB");
