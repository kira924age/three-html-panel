import {
  CheckIcon,
  ColorSwatch,
  Group,
  Input,
  Modal,
  SegmentedControl,
  Select,
  Slider,
  Stack,
  Switch,
  Tabs,
  Text,
  TextInput,
  Tooltip,
  useMantineColorScheme,
  useMantineTheme,
  type MantineColorScheme,
} from "@mantine/core";
import { IconBell, IconPalette, IconUser } from "@tabler/icons-react";
import type { Presence } from "../data/types";
import { ME, PRESENCE_COLOR, PRESENCE_LABEL } from "../data/users";
import { ACCENTS, useSettings, type NotifyLevel } from "../hooks/settings";
import { useUsers } from "../hooks/users";
import { UserAvatar } from "./UserAvatar";
import classes from "./SettingsModal.module.css";

export type SettingsTab = "profile" | "notifications" | "appearance";

interface Props {
  opened: boolean;
  tab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
  onClose: () => void;
}

const DENSITY_MARKS = [
  { value: 0, label: "Compact" },
  { value: 1, label: "Cozy" },
  { value: 2, label: "Comfortable" },
];

export function SettingsModal({ opened, tab, onTabChange, onClose }: Props) {
  const { settings, update } = useSettings();
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const theme = useMantineTheme();
  const me = useUsers()(ME);

  return (
    <Modal opened={opened} onClose={onClose} title="Preferences" size="lg" radius="md" centered>
      <Tabs
        value={tab}
        onChange={(v) => v && onTabChange(v as SettingsTab)}
        variant="outline"
        radius="md"
      >
        <Tabs.List mb="md">
          <Tabs.Tab value="profile" leftSection={<IconUser size={16} />}>
            Profile
          </Tabs.Tab>
          <Tabs.Tab value="notifications" leftSection={<IconBell size={16} />}>
            Notifications
          </Tabs.Tab>
          <Tabs.Tab value="appearance" leftSection={<IconPalette size={16} />}>
            Appearance
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="profile" className={classes.panel}>
          <Group align="flex-start" gap="lg" wrap="nowrap">
            <UserAvatar user={me} size={72} withStatus />
            <Stack gap="sm" style={{ flex: 1 }}>
              <TextInput
                label="Display name"
                value={settings.displayName}
                onChange={(e) => update({ displayName: e.currentTarget.value })}
                error={settings.displayName.trim() === "" ? "Enter a name" : undefined}
              />
              <TextInput
                label="Title"
                value={settings.title}
                onChange={(e) => update({ title: e.currentTarget.value })}
              />
              <Group grow align="flex-start">
                <Select
                  label="Status"
                  allowDeselect={false}
                  value={settings.presence}
                  onChange={(v) => v && update({ presence: v as Presence })}
                  data={(Object.keys(PRESENCE_LABEL) as Presence[]).map((p) => ({
                    value: p,
                    label: PRESENCE_LABEL[p],
                  }))}
                  leftSection={
                    <span
                      className={classes.dot}
                      style={{
                        background: `var(--mantine-color-${PRESENCE_COLOR[settings.presence]}-6)`,
                      }}
                    />
                  }
                  comboboxProps={{ withinPortal: true }}
                />
                <TextInput
                  label="Status message"
                  placeholder="What's your status?"
                  value={settings.statusText}
                  onChange={(e) => update({ statusText: e.currentTarget.value })}
                />
              </Group>
            </Stack>
          </Group>
        </Tabs.Panel>

        <Tabs.Panel value="notifications" className={classes.panel}>
          <Stack gap="lg">
            <Input.Wrapper
              label="Notify me about"
              description="Messages in channels you're not looking at"
            >
              <SegmentedControl
                mt={6}
                fullWidth
                value={settings.notifyLevel}
                onChange={(v) => update({ notifyLevel: v as NotifyLevel })}
                data={[
                  { value: "all", label: "All messages" },
                  { value: "mentions", label: "Mentions" },
                  { value: "nothing", label: "Nothing" },
                ]}
              />
            </Input.Wrapper>
            <Switch
              label="Show toast notifications"
              description="Pop up a notification in the corner of the window"
              checked={settings.toasts}
              onChange={(e) => update({ toasts: e.currentTarget.checked })}
            />
            <Switch
              label="Notify me about app messages"
              description="Include Kit's replies in other channels"
              checked={settings.botNotifications}
              disabled={!settings.toasts}
              onChange={(e) => update({ botNotifications: e.currentTarget.checked })}
            />
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="appearance" className={classes.panel}>
          <Stack gap="lg">
            <Input.Wrapper label="Theme">
              <SegmentedControl
                mt={6}
                fullWidth
                value={colorScheme}
                onChange={(v) => setColorScheme(v as MantineColorScheme)}
                data={[
                  { value: "light", label: "Light" },
                  { value: "dark", label: "Dark" },
                  { value: "auto", label: "Sync with system" },
                ]}
              />
            </Input.Wrapper>
            <Input.Wrapper label="Accent color">
              <Group gap="xs" mt={6} role="radiogroup" aria-label="Accent color">
                {ACCENTS.map((color) => (
                  <Tooltip key={color} label={color[0].toUpperCase() + color.slice(1)} withArrow>
                    <ColorSwatch
                      component="button"
                      type="button"
                      role="radio"
                      aria-checked={settings.accent === color}
                      aria-label={color}
                      color={theme.colors[color][6]}
                      onClick={() => update({ accent: color })}
                      className={classes.swatch}
                    >
                      {settings.accent === color && <CheckIcon size={12} color="white" />}
                    </ColorSwatch>
                  </Tooltip>
                ))}
              </Group>
            </Input.Wrapper>
            <Input.Wrapper label="Message density">
              <Slider
                mt="xs"
                mb="lg"
                mx="xl"
                min={0}
                max={2}
                step={1}
                value={settings.density}
                onChange={(v) => update({ density: v })}
                marks={DENSITY_MARKS}
                label={(v) => DENSITY_MARKS[v]?.label}
              />
            </Input.Wrapper>
            <Text size="xs" c="dimmed">
              Settings are kept in memory for this session.
            </Text>
          </Stack>
        </Tabs.Panel>
      </Tabs>
    </Modal>
  );
}
