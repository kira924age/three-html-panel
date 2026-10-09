import { useCallback } from "react";
import type { User } from "../data/types";
import { ME, userById } from "../data/users";
import { useSettings } from "./settings";

/** Looks up users, with the current user's profile from the settings. */
export function useUsers(): (id: string) => User {
  const { settings } = useSettings();
  return useCallback(
    (id: string) =>
      id === ME
        ? {
            ...userById(ME),
            name: settings.displayName || "You",
            title: settings.title,
            presence: settings.presence,
          }
        : userById(id),
    [settings.displayName, settings.title, settings.presence],
  );
}
