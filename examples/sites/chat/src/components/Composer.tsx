import { ActionIcon, CloseButton, Group, Paper, Text, Tooltip } from "@mantine/core";
import { RichTextEditor } from "@mantine/tiptap";
import { IconArrowBackUp, IconAt, IconSend2 } from "@tabler/icons-react";
import { useEditor, useEditorState } from "@tiptap/react";
import { useEffect, useMemo, useRef } from "react";
import { channelLabel, useChat } from "../hooks/chat";
import { useUsers } from "../hooks/users";
import { htmlToText, isEmptyHtml } from "../lib/html";
import { EmojiPicker } from "./EmojiPicker";
import { MAX_LENGTH, chatExtensions } from "./editor/extensions";
import { MentionPopup } from "./editor/MentionPopup";
import { MentionPopupStore } from "./editor/mention-suggestion";
import classes from "./Composer.module.css";

/** The message composer: a rich text editor; Enter sends, Shift+Enter starts a new line. */
export function Composer() {
  const chat = useChat();
  const user = useUsers();
  const mentions = useMemo(() => new MentionPopupStore(), []);
  const sendRef = useRef<() => void>(() => {});
  const placeholder = useRef("");
  placeholder.current = `Message ${channelLabel(chat.active)}`;

  const editor = useEditor({
    extensions: chatExtensions({
      placeholder: () => placeholder.current,
      mentions,
      onSubmit: () => sendRef.current(),
      onEscape: () => chat.setReplyTo(null),
    }),
    autofocus: "end",
    editorProps: { attributes: { "aria-label": "Message", class: classes.prose } },
  });

  // Focus the composer when the channel changes (redrawing its placeholder), or when replying.
  useEffect(() => {
    if (!editor) return;
    editor.view.dispatch(editor.state.tr);
    editor.commands.focus("end");
  }, [editor, chat.activeId, chat.replyToId]);

  const { characters, empty } = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      characters: e?.storage.characterCount.characters() ?? 0,
      empty: e ? isEmptyHtml(e.getHTML()) : true,
    }),
  }) ?? { characters: 0, empty: true };

  sendRef.current = () => {
    if (!editor) return;
    const html = editor.getHTML();
    if (isEmptyHtml(html)) return;
    chat.send(html);
    editor.commands.clearContent(true);
    editor.commands.focus();
  };

  const replyTo = chat.replyToId ? chat.messages.find((m) => m.id === chat.replyToId) : undefined;
  const nearLimit = characters > MAX_LENGTH * 0.8;

  return (
    <div className={classes.root}>
      {replyTo && (
        <Paper className={classes.reply} withBorder radius="md" px="sm" py={6}>
          <Group gap="xs" wrap="nowrap">
            <IconArrowBackUp size={16} className={classes.replyIcon} />
            <Text size="xs" c="dimmed" style={{ flex: "none" }}>
              Replying to <b>{user(replyTo.userId).name}</b>
            </Text>
            <Text size="xs" truncate style={{ flex: 1 }}>
              {htmlToText(replyTo.html)}
            </Text>
            <CloseButton
              size="sm"
              aria-label="Cancel reply"
              onClick={() => chat.setReplyTo(null)}
            />
          </Group>
        </Paper>
      )}
      <RichTextEditor editor={editor} className={classes.editor} variant="subtle">
        <RichTextEditor.Toolbar className={classes.toolbar}>
          <RichTextEditor.ControlsGroup>
            <RichTextEditor.Bold />
            <RichTextEditor.Italic />
            <RichTextEditor.Strikethrough />
            <RichTextEditor.Code />
          </RichTextEditor.ControlsGroup>
          <RichTextEditor.ControlsGroup>
            <RichTextEditor.Link />
            <RichTextEditor.Unlink />
          </RichTextEditor.ControlsGroup>
          <RichTextEditor.ControlsGroup>
            <RichTextEditor.BulletList />
            <RichTextEditor.OrderedList />
            <RichTextEditor.CodeBlock />
          </RichTextEditor.ControlsGroup>
        </RichTextEditor.Toolbar>
        <RichTextEditor.Content className={classes.content} />
        <Group justify="space-between" px={6} pb={6} gap="xs" wrap="nowrap">
          <Group gap={2} wrap="nowrap">
            <EmojiPicker onPick={(emoji) => editor?.chain().focus().insertContent(emoji).run()} />
            <Tooltip label="Mention someone" withArrow>
              <ActionIcon
                variant="subtle"
                color="gray"
                aria-label="Mention someone"
                onClick={() => editor?.chain().focus().insertContent(" @").run()}
              >
                <IconAt size={18} />
              </ActionIcon>
            </Tooltip>
          </Group>
          <Group gap="sm" wrap="nowrap">
            <Text
              size="xs"
              c={nearLimit ? "red" : "dimmed"}
              className={classes.count}
              aria-live="polite"
            >
              {characters} / {MAX_LENGTH}
            </Text>
            <Tooltip label="Send (Enter)" withArrow>
              <ActionIcon
                variant={empty ? "subtle" : "filled"}
                color={empty ? "gray" : undefined}
                disabled={empty}
                aria-label="Send message"
                onClick={() => sendRef.current()}
              >
                <IconSend2 size={18} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
      </RichTextEditor>
      <Text size="xs" c="dimmed" className={classes.hint} visibleFrom="sm">
        <b>Enter</b> to send · <b>Shift + Enter</b> for a new line · <b>@</b> to mention
      </Text>
      <MentionPopup store={mentions} />
    </div>
  );
}
