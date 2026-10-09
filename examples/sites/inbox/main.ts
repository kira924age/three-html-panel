// A message list whose actions show only on hover (CSS :hover), with a menu
// that opens while focus is in it (CSS :focus-within). Nothing here knows of
// the panel: the agent makes those states apply to the page itself, so that
// what the panel draws is what a press reaches.
import "./style.css";

const subjects = ["Lunch on Friday?", "Quarterly report", "Your order has shipped"];

const list = document.querySelector<HTMLUListElement>("#messages")!;
const status = document.querySelector<HTMLParagraphElement>("#status")!;

for (const subject of subjects) {
  const item = document.createElement("li");
  item.className = "message";
  item.innerHTML = `
    <span class="subject"></span>
    <span class="actions">
      <button type="button" class="archive">Archive</button>
      <span class="more">
        <button type="button" class="more-button">More</button>
        <ul class="menu">
          <li><button type="button" class="mark-unread">Mark as unread</button></li>
        </ul>
      </span>
    </span>`;
  item.querySelector(".subject")!.textContent = subject;
  item.querySelector(".archive")!.addEventListener("click", () => {
    item.remove();
    status.textContent = `Archived: ${subject}`;
  });
  item.querySelector(".mark-unread")!.addEventListener("click", (event) => {
    (event.currentTarget as HTMLButtonElement).blur();
    status.textContent = `Marked as unread: ${subject}`;
  });
  list.append(item);
}

document.querySelector("#compose")!.addEventListener("click", () => {
  document.querySelector("#draft")!.classList.toggle("open");
});
