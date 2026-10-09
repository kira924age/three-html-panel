import type { MantineColorScheme, MantineColorSchemeManager } from "@mantine/core";

/**
 * A color scheme manager that keeps the choice in memory. Mantine's default
 * one uses localStorage, which throws in a sandboxed page (on the opaque
 * origin "null"), where this site runs when it is shown in a panel.
 */
export function memoryColorSchemeManager(): MantineColorSchemeManager {
  let value: MantineColorScheme | undefined;
  return {
    get: (defaultValue) => value ?? defaultValue,
    set: (next) => {
      value = next;
    },
    subscribe: () => {},
    unsubscribe: () => {},
    clear: () => {
      value = undefined;
    },
  };
}
