import { Extension, type Extensions } from "@tiptap/core";
import Mention from "@tiptap/extension-mention";
import { CharacterCount, Placeholder } from "@tiptap/extensions";
import StarterKit from "@tiptap/starter-kit";
import type { MentionPopupStore } from "./mention-suggestion";

export const MAX_LENGTH = 2000;

interface Options {
  placeholder: string | (() => string);
  mentions: MentionPopupStore;
  /** Enter (without Shift): send, or save an edit. */
  onSubmit: () => void;
  onEscape?: () => void;
}

/** The editor's extensions, shared by the composer and the in-place message editor. */
export function chatExtensions({ placeholder, mentions, onSubmit, onEscape }: Options): Extensions {
  const SubmitOnEnter = Extension.create({
    name: "submitOnEnter",
    // Before the lists' and code blocks' own Enter.
    priority: 1000,
    addKeyboardShortcuts() {
      return {
        Enter: () => {
          // The mention popup's Enter picks a user.
          if (mentions.open) return false;
          onSubmit();
          return true;
        },
        "Shift-Enter": ({ editor }) =>
          editor.commands.first(({ commands }) => [
            () => commands.newlineInCode(),
            () => commands.splitListItem("listItem"),
            () => commands.splitBlock(),
          ]),
        Escape: () => {
          if (mentions.open || !onEscape) return false;
          onEscape();
          return true;
        },
      };
    },
  });

  return [
    StarterKit.configure({
      heading: false,
      horizontalRule: false,
      blockquote: false,
      link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
    }),
    Placeholder.configure({
      placeholder: typeof placeholder === "string" ? placeholder : () => placeholder(),
    }),
    CharacterCount.configure({ limit: MAX_LENGTH }),
    Mention.configure({
      HTMLAttributes: { class: "mention" },
      suggestion: mentions.suggestion(),
    }),
    SubmitOnEnter,
  ];
}
