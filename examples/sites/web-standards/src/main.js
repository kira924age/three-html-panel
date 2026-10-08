// The page's own script: small, as most of the page needs none.
import "./agent.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

// --- Theme: follows the system until toggled. No storage: the page may run
// sandboxed, where localStorage throws.
const root = document.documentElement;
const systemDark = matchMedia("(prefers-color-scheme: dark)");
const setTheme = (dark) => {
  root.dataset.theme = dark ? "dark" : "light";
  $('[data-action="theme"]').setAttribute("aria-pressed", String(dark));
};
setTheme(systemDark.matches);
systemDark.addEventListener("change", (event) => setTheme(event.matches));

// --- Buttons with a data-action.
const actions = {
  theme: () => setTheme(root.dataset.theme !== "dark"),
  "open-dialog": () => {
    $("#menu").hidePopover?.();
    $("#dialog").showModal();
  },
  "copy-code": copyCode,
  download: startDownload,
};
document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (button) actions[button.dataset.action]?.();
});

// --- Dialog: report what the user chose.
const dialog = $("#dialog");
dialog.addEventListener("close", () => {
  const title = $('input[name="title"]', dialog).value;
  $("#dialog-result").textContent =
    dialog.returnValue === "save" ? `Saved: “${title}”.` : "Cancelled.";
  if (dialog.returnValue === "save") $(".brand").textContent = title;
});

// --- Copy: the clipboard API needs a permission a sandboxed iframe does not
// have; then the code is selected, for the usual shortcut to copy.
async function copyCode() {
  const code = $("#code-sample");
  const status = $("#copy-status");
  try {
    await navigator.clipboard.writeText(code.textContent);
    status.textContent = "Copied.";
  } catch {
    getSelection().selectAllChildren(code);
    status.textContent = "Selected: press Ctrl+C (⌘C on a Mac) to copy.";
  }
}

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
$("#support-average").className = "number";
renderTable();

// --- Form: live outputs, and the browser's validity shown in the page (its own
// bubbles open outside the page, like the native pickers).
const form = $("#signup");
$("#seats").addEventListener("input", (event) => ($("#seats-out").value = event.target.value));
$("#bio").addEventListener(
  "input",
  (event) => ($("#bio-count").textContent = event.target.value.length),
);
form.addEventListener("submit", (event) => {
  event.preventDefault();
  form.classList.add("submitted");
  const summary = $("#form-summary");
  const invalid = $$("input, select, textarea", form).filter((field) => !field.checkValidity());
  if (invalid.length > 0) {
    summary.className = "form-summary failed";
    summary.innerHTML = `<strong>Check ${invalid.length} field${invalid.length > 1 ? "s" : ""}:</strong><ul></ul>`;
    for (const field of invalid) {
      const item = document.createElement("li");
      const label = field.labels?.[0]?.textContent.trim().replace(/\s+/g, " ") ?? field.name;
      item.textContent = `${label}: ${field.validationMessage}`;
      $("ul", summary).append(item);
    }
    invalid[0].focus();
    return;
  }
  const data = new FormData(form);
  // Text fields only: a file field's entry would be a File.
  const field = (name) => {
    const value = data.get(name);
    return typeof value === "string" ? value : "";
  };
  summary.className = "form-summary done";
  summary.textContent = `Welcome, ${field("name")}! (${field("plan")}, ${field("seats")} seats; nothing was sent.)`;
});
form.addEventListener("reset", () => {
  form.classList.remove("submitted");
  $("#form-summary").textContent = "";
  $("#seats-out").value = "5";
  $("#bio-count").textContent = "0";
});

// --- Progress: a pretend download.
let downloading = 0;
function startDownload() {
  const progress = $("#download");
  const button = $('[data-action="download"]');
  if (downloading) {
    clearInterval(downloading);
    downloading = 0;
    button.textContent = "Resume";
    return;
  }
  if (progress.value >= progress.max) progress.value = 0;
  button.textContent = "Pause";
  downloading = setInterval(() => {
    progress.value = Math.min(progress.max, progress.value + 2);
    if (progress.value >= progress.max) {
      clearInterval(downloading);
      downloading = 0;
      button.textContent = "Start again";
    }
  }, 60);
}

// --- Container queries: the grid's own width, set by a slider.
$("#container-width").addEventListener("input", (event) => {
  $("#card-grid").style.width = `${event.target.value}%`;
  $("#container-width-out").value = `${event.target.value}%`;
});

// --- An SVG bar chart, drawn from data.
const chartData = [
  ["Static", 42],
  ["SSR", 65],
  ["SPA", 88],
  ["Islands", 30],
  ["Edge", 21],
];
const bars = $(".chart .bars");
const barWidth = 40;
const svg = "http://www.w3.org/2000/svg";
chartData.forEach(([label, value], index) => {
  const x = 20 + index * 60;
  const height = value * 1.3;
  const rect = document.createElementNS(svg, "rect");
  Object.entries({ x, y: 135 - height, width: barWidth, height, rx: 4 }).forEach(([key, val]) =>
    rect.setAttribute(key, String(val)),
  );
  const title = document.createElementNS(svg, "title");
  title.textContent = `${label}: ${value}`;
  rect.append(title);
  const text = document.createElementNS(svg, "text");
  text.setAttribute("x", String(x + barWidth / 2));
  text.setAttribute("y", "150");
  text.setAttribute("text-anchor", "middle");
  text.textContent = label;
  bars.append(rect, text);
});

// --- Table of contents: the section in view is marked.
const links = $$(".toc a");
const sections = links.map((link) => $(link.getAttribute("href")));
function markCurrent() {
  const current =
    sections.findLast((section) => section.getBoundingClientRect().top < 120) ?? sections[0];
  links.forEach((link, index) =>
    link.setAttribute("aria-current", String(sections[index] === current)),
  );
}
addEventListener("scroll", markCurrent, { passive: true });
markCurrent();
