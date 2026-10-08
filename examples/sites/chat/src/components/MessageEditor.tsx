import { Button, Group, Text } from "@mantine/core";
import { RichTextEditor } from "@mantine/tiptap";
import { useEditor } from "@tiptap/react";
import { useMemo, useRef } from "react";
import { isEmptyHtml } from "../lib/html";
import { chatExtensions } from "./editor/extensions";
import { MentionPopup } from "./editor/MentionPopup";
import { MentionPopupStore } from "./editor/mention-suggestion";
import classes from "./MessageEditor.module.css";

interface Props {
  html: string;
  onSave: (html: string) => void;
  onCancel: () => void;
}

/** Edits a message in place: Enter saves, Escape cancels. */
export function MessageEditor({ html, onSave, onCancel }: Props) {
  const mentions = useMemo(() => new MentionPopupStore(), []);
  const save = useRef<() => void>(() => {});
  const editor = useEditor({
    extensions: chatExtensions({
      placeholder: "Edit message",
      mentions,
      onSubmit: () => save.current(),
      onEscape: () => onCancel(),
    }),
    content: html,
    autofocus: "end",
    editorProps: { attributes: { "aria-label": "Edit message", class: classes.prose } },
  });

  save.current = () => {
    if (!editor) return;
    const next = editor.getHTML();
    if (isEmptyHtml(next)) return;
    if (next === html) onCancel();
    else onSave(next);
  };

  return (
    <div className={classes.root}>
      <RichTextEditor editor={editor} className={classes.editor}>
        <RichTextEditor.Toolbar>
          <RichTextEditor.ControlsGroup>
            <RichTextEditor.Bold />
            <RichTextEditor.Italic />
            <RichTextEditor.Strikethrough />
            <RichTextEditor.Code />
            <RichTextEditor.BulletList />
            <RichTextEditor.OrderedList />
            <RichTextEditor.CodeBlock />
          </RichTextEditor.ControlsGroup>
        </RichTextEditor.Toolbar>
        <RichTextEditor.Content />
      </RichTextEditor>
      <Group justify="space-between" mt={6}>
        <Text size="xs" c="dimmed">
          Escape to <b>cancel</b> · Enter to <b>save</b>
        </Text>
        <Group gap="xs">
          <Button size="compact-sm" variant="default" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="compact-sm" onClick={() => save.current()}>
            Save
          </Button>
        </Group>
      </Group>
      <MentionPopup store={mentions} />
    </div>
  );
}
