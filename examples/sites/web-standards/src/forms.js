import { $, $$ } from "./common.js";

// --- Search: filter a list of elements as you type.
const ELEMENTS = [
  "a",
  "abbr",
  "address",
  "article",
  "aside",
  "audio",
  "blockquote",
  "button",
  "canvas",
  "caption",
  "datalist",
  "details",
  "dialog",
  "fieldset",
  "figure",
  "footer",
  "form",
  "header",
  "img",
  "input",
  "label",
  "main",
  "mark",
  "menu",
  "meter",
  "nav",
  "ol",
  "output",
  "picture",
  "progress",
  "ruby",
  "search",
  "section",
  "select",
  "slot",
  "source",
  "summary",
  "table",
  "template",
  "textarea",
  "time",
  "track",
  "video",
];
const list = $("#element-list");
const query = $("#query");
function renderList() {
  const text = query.value.trim().toLowerCase();
  const found = ELEMENTS.filter((name) => name.includes(text));
  list.replaceChildren(
    ...found.map((name) => {
      const item = document.createElement("li");
      const at = text ? name.indexOf(text) : -1;
      if (at < 0) item.textContent = `<${name}>`;
      else {
        const mark = document.createElement("mark");
        mark.textContent = name.slice(at, at + text.length);
        item.append(`<${name.slice(0, at)}`, mark, `${name.slice(at + text.length)}>`);
      }
      return item;
    }),
  );
  $("#search-count").textContent = `${found.length} of ${ELEMENTS.length} elements`;
}
query.addEventListener("input", renderList);
$("#element-search").addEventListener("submit", (event) => event.preventDefault());
renderList();

// --- Sign-up: live outputs, and the browser's validity shown in the page (its
// own bubbles open outside the page, like the native pickers).
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

// --- Constraint validation: the validity of two fields, live, and a rule of
// the page's own.
const password = $("#password");
const again = $("#password-again");
function renderValidity() {
  again.setCustomValidity(
    again.value && again.value !== password.value ? "The passwords differ." : "",
  );
  const cell = (value) => `<td class="${value ? "yes" : "no"}">${value}</td>`;
  $("#validity-rows").innerHTML = [password, again]
    .map((field) => {
      const { valid, valueMissing, tooShort, customError } = field.validity;
      return (
        `<tr><td>${field.labels[0].textContent}</td>${cell(valid)}` +
        `<td>${valueMissing}</td><td>${tooShort}</td><td>${customError}</td>` +
        `<td>${field.validationMessage || "—"}</td></tr>`
      );
    })
    .join("");
}
password.addEventListener("input", renderValidity);
again.addEventListener("input", renderValidity);
renderValidity();

// --- A disabled group.
$("#shipping-same").addEventListener("change", (event) => {
  $("#shipping").disabled = event.target.checked;
});

// --- Progress: a pretend download.
let downloading = 0;
const progress = $("#download");
const downloadButton = $('[data-action="download"]');
downloadButton.addEventListener("click", () => {
  if (downloading) {
    clearInterval(downloading);
    downloading = 0;
    downloadButton.textContent = "Resume";
    return;
  }
  if (progress.value >= progress.max) progress.value = 0;
  downloadButton.textContent = "Pause";
  downloading = setInterval(() => {
    progress.value = Math.min(progress.max, progress.value + 2);
    if (progress.value >= progress.max) {
      clearInterval(downloading);
      downloading = 0;
      downloadButton.textContent = "Start again";
    }
  }, 60);
});
