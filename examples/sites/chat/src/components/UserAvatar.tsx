import { Avatar, Indicator } from "@mantine/core";
import { IconRobot } from "@tabler/icons-react";
import type { User } from "../data/types";
import { PRESENCE_COLOR, initials } from "../data/users";

interface Props {
  user: User;
  size?: number;
  /** Shows the presence dot. */
  withStatus?: boolean;
  radius?: string;
}

export function UserAvatar({ user, size = 36, withStatus = false, radius = "md" }: Props) {
  const avatar = (
    <Avatar size={size} radius={radius} color={user.color} variant="filled" alt={user.name}>
      {user.bot ? <IconRobot size={size * 0.55} stroke={1.8} /> : initials(user.name)}
    </Avatar>
  );
  if (!withStatus) return avatar;
  return (
    <Indicator
      color={PRESENCE_COLOR[user.presence]}
      size={Math.max(8, Math.round(size / 3.6))}
      offset={Math.round(size / 9)}
      position="bottom-end"
      withBorder
      processing={false}
    >
      {avatar}
    </Indicator>
  );
}
