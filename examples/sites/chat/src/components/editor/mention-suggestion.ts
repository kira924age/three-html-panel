import type { MentionOptions } from "@tiptap/extension-mention";
import type { SuggestionKeyDownProps, SuggestionProps } from "@tiptap/suggestion";
import type { User } from "../../data/types";
import { USERS } from "../../data/users";

/** What the mention popup shows: the matching users, where, and which is selected. */
export interface MentionPopupState {
  items: User[];
  selected: number;
  /** The caret's rectangle, to place the popup at. */
  rect: DOMRect | null;
  command: (user: User) => void;
}

/**
 * The state of an editor's mention popup, outside React: the suggestion
 * plugin updates it, and the MentionPopup component renders it with Mantine.
 */
export class MentionPopupStore {
  state: MentionPopupState | null = null;
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
  getSnapshot = () => this.state;

  private set(state: MentionPopupState | null) {
    this.state = state;
    this.listeners.forEach((l) => l());
  }

  get open(): boolean {
    return this.state !== null;
  }

  select(index: number) {
    if (this.state) this.set({ ...this.state, selected: index });
  }

  /** The suggestion options of the Mention extension. */
  suggestion(): MentionOptions["suggestion"] {
    const fromProps = (props: SuggestionProps<User>, selected: number): MentionPopupState => ({
      items: props.items,
      selected: Math.min(selected, Math.max(props.items.length - 1, 0)),
      rect: props.clientRect?.() ?? null,
      command: (user) => props.command({ id: user.id, label: user.handle }),
    });
    return {
      items: ({ query }) => {
        const q = query.toLowerCase();
        return USERS.filter((u) => u.handle.includes(q) || u.name.toLowerCase().includes(q)).slice(
          0,
          6,
        );
      },
      render: () => ({
        onStart: (props) => this.set(fromProps(props as SuggestionProps<User>, 0)),
        onUpdate: (props) =>
          this.set(fromProps(props as SuggestionProps<User>, this.state?.selected ?? 0)),
        onExit: () => this.set(null),
        onKeyDown: ({ event }: SuggestionKeyDownProps) => {
          const s = this.state;
          if (!s) return false;
          if (event.key === "Escape") {
            this.set(null);
            return true;
          }
          if (s.items.length === 0) return false;
          if (event.key === "ArrowDown") {
            this.select((s.selected + 1) % s.items.length);
            return true;
          }
          if (event.key === "ArrowUp") {
            this.select((s.selected + s.items.length - 1) % s.items.length);
            return true;
          }
          if (event.key === "Enter" || event.key === "Tab") {
            s.command(s.items[s.selected]);
            return true;
          }
          return false;
        },
      }),
    };
  }
}
