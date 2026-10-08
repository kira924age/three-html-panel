// A long article, with what such pages keep in view as they scroll: a sticky
// header and table of contents, a fixed reading-progress bar and notice, and a
// table and a glossary that scroll under their sticky headers. Nothing in it knows that it is
// shown in 3D.

const sections = document.querySelector<HTMLElement>("#sections")!;
const tocList = document.querySelector<HTMLElement>("#toc-list")!;
const rows = document.querySelector<HTMLTableSectionElement>("#rows")!;
const progress = document.querySelector<HTMLElement>("#progress")!;

const LIGHTS = ["Eddystone", "Bell Rock", "Fastnet", "Hook Head", "Pharos", "Tower of Hercules"];

for (const [index, name] of [...LIGHTS, ...LIGHTS].entries()) {
  const row = rows.insertRow();
  row.insertCell().textContent = name;
  row.insertCell().textContent = `${20 + ((index * 7) % 40)} m`;
  row.insertCell().textContent = `${12 + ((index * 5) % 20)} nmi`;
}

for (const name of LIGHTS) {
  const id = name.toLowerCase().replace(/\s+/g, "-");
  const heading = document.createElement("h2");
  heading.id = id;
  heading.textContent = name;
  sections.appendChild(heading);
  for (let paragraph = 0; paragraph < 3; paragraph++) {
    const text = document.createElement("p");
    text.textContent =
      `${name} stands where ships once broke on the rocks. Its keepers wound the clockwork ` +
      "every few hours through the night, trimmed the wicks, and wrote the weather in the log. " +
      "The light turned, the fog came and went, and the ships passed by.";
    sections.appendChild(text);
  }
  const item = document.createElement("li");
  const link = document.createElement("a");
  link.href = `#${id}`;
  link.textContent = name;
  link.style.color = "inherit";
  item.appendChild(link);
  tocList.appendChild(item);
}

function showProgress(): void {
  const root = document.documentElement;
  const max = root.scrollHeight - root.clientHeight;
  progress.style.width = `${max > 0 ? (100 * root.scrollTop) / max : 0}%`;
}
addEventListener("scroll", showProgress, { passive: true });
showProgress();
