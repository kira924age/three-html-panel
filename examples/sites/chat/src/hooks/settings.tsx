import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { Presence } from "../data/types";

export type NotifyLevel = "all" | "mentions" | "nothing";

export interface Settings {
  displayName: string;
  title: string;
  presence: Presence;
  statusText: string;
  /** Whether events show a toast. */
  toasts: boolean;
  /** Whether the bot's replies notify too. */
  botNotifications: boolean;
  notifyLevel: NotifyLevel;
  accent: string;
  /** 0 (compact) to 2 (comfortable). */
  density: number;
}

export const ACCENTS = [
  "violet",
  "blue",
  "teal",
  "green",
  "orange",
  "pink",
  "red",
  "indigo",
] as const;

const DEFAULTS: Settings = {
  displayName: "Alex Rivera",
  title: "Frontend engineer",
  presence: "active",
  statusText: "Shipping v2.0 🚢",
  toasts: true,
  botNotifications: false,
  notifyLevel: "mentions",
  accent: "violet",
  density: 1,
};

interface SettingsContextValue {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

/** The user's settings, in memory (the page may be sandboxed, without storage). */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(DEFAULTS);
  const value = useMemo(
    () => ({
      settings,
      update: (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch })),
    }),
    [settings],
  );
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext);
  if (!value) throw new Error("useSettings outside SettingsProvider");
  return value;
}
