import { reactive } from "vue";

export const snackbar = reactive({
  show: false,
  text: "",
  color: "" as "" | "error" | "success",
  action: null as null | { label: string; run: () => void },
});

export function notify(
  text: string,
  options: { color?: "error" | "success"; action?: { label: string; run: () => void } } = {},
): void {
  snackbar.text = text;
  snackbar.color = options.color ?? "";
  snackbar.action = options.action ?? null;
  // Shown again even when it is already: a new message, a new timeout.
  snackbar.show = false;
  requestAnimationFrame(() => (snackbar.show = true));
}

export function notifyError(error: unknown, action?: { label: string; run: () => void }): void {
  const message = error instanceof Error ? error.message : String(error);
  notify(message, { color: "error", action });
}
