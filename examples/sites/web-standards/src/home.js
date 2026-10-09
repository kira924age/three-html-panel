import { $ } from "./common.js";

// Copy: the clipboard API needs a permission a sandboxed iframe does not have;
// then the code is selected, for the usual shortcut to copy.
$('[data-action="copy-code"]').addEventListener("click", async () => {
  const code = $("#code-sample");
  const status = $("#copy-status");
  try {
    await navigator.clipboard.writeText(code.textContent);
    status.textContent = "Copied.";
  } catch {
    getSelection().selectAllChildren(code);
    status.textContent = "Selected: press Ctrl+C (⌘C on a Mac) to copy.";
  }
});
