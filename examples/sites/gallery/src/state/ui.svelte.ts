// Which view is shown, the lightbox, and transient notifications.

export type View = "gallery" | "editor";

interface Toast {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
}

class Ui {
  view = $state<View>("gallery");
  /** The lightbox: the photos it steps through, and the one shown. Null when closed. */
  lightbox = $state<{ ids: string[]; index: number } | null>(null);
  /** The info panel starts open where there is room for it beside the photo. */
  infoOpen = $state(typeof innerWidth !== "number" || innerWidth > 760);
  shortcutsOpen = $state(false);
  editingId = $state<string | null>(null);
  /** A photo just added, highlighted in the grid for a moment. */
  highlightId = $state<string | null>(null);
  toasts = $state<Toast[]>([]);

  openLightbox(ids: string[], id: string) {
    const index = Math.max(0, ids.indexOf(id));
    this.lightbox = { ids, index };
  }

  closeLightbox() {
    this.lightbox = null;
  }

  step(delta: number) {
    if (!this.lightbox) return;
    const n = this.lightbox.ids.length;
    this.lightbox.index = (this.lightbox.index + delta + n) % n;
  }

  edit(id: string) {
    this.editingId = id;
    this.lightbox = null;
    this.view = "editor";
  }

  toast(message: string, action?: Toast["action"]) {
    const id = Date.now() + Math.random();
    this.toasts = [...this.toasts, { id, message, action }];
    setTimeout(() => this.dismiss(id), 4500);
  }

  dismiss(id: number) {
    this.toasts = this.toasts.filter((t) => t.id !== id);
  }
}

export const ui = new Ui();
