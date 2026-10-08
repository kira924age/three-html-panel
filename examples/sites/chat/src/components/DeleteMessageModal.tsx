import { Button, Group, Modal, Paper, Text, Typography } from "@mantine/core";
import { useEffect, useState } from "react";
import type { Message } from "../data/types";

interface Props {
  message: Message | null;
  onClose: () => void;
  onConfirm: (message: Message) => void;
}

/** Asks before deleting a message (no window.confirm: it is blocked in a sandbox). */
export function DeleteMessageModal({ message, onClose, onConfirm }: Props) {
  // Keep showing the message while the modal closes.
  const [shown, setShown] = useState(message);
  useEffect(() => {
    if (message) setShown(message);
  }, [message]);

  return (
    <Modal opened={message !== null} onClose={onClose} title="Delete message" centered radius="md">
      <Text size="sm">Are you sure you want to delete this message? This can't be undone.</Text>
      {shown && (
        <Paper withBorder radius="md" p="sm" mt="md" bg="var(--mantine-color-default-hover)">
          <Typography fz="sm">
            <div dangerouslySetInnerHTML={{ __html: shown.html }} />
          </Typography>
        </Paper>
      )}
      <Group justify="flex-end" mt="lg">
        <Button variant="default" onClick={onClose}>
          Cancel
        </Button>
        <Button color="red" onClick={() => shown && onConfirm(shown)} data-autofocus>
          Delete
        </Button>
      </Group>
    </Modal>
  );
}
