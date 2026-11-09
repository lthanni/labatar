export const chipShortcutActions = [
  "followup",
  "togglePosition",
  "removeDirection",
  "anyAttack",
  "delay",
  "charged",
  "crit",
] as const;

export type ChipShortcutAction = (typeof chipShortcutActions)[number];
export type ChipShortcutBindings = Record<ChipShortcutAction, string>;

export const defaultChipShortcutBindings: ChipShortcutBindings = {
  followup: "`",
  togglePosition: "j",
  removeDirection: "r",
  anyAttack: "x",
  delay: "d",
  charged: "[",
  crit: "1",
};

const storageKey = "labatar-combo-chip-shortcuts-v1";

export function normalizeChipShortcutKey(key: string): string | null {
  const normalized = key.toLowerCase();
  return key.length === 1 && normalized.length === 1 && !/\s/.test(key) ? normalized : null;
}

export function parseChipShortcutBindings(value: unknown): ChipShortcutBindings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...defaultChipShortcutBindings };
  }
  const existingActions = ["togglePosition", "removeDirection", "charged", "crit"] as const;
  const entries = existingActions.map((action) => {
    const stored = (value as Record<string, unknown>)[action];
    return [action, typeof stored === "string" ? normalizeChipShortcutKey(stored) : null] as const;
  });
  const keys = entries.map(([, key]) => key);
  if (keys.some((key) => key === null) || new Set(keys).size !== existingActions.length) {
    return { ...defaultChipShortcutBindings };
  }
  const bindings: Partial<ChipShortcutBindings> = Object.fromEntries(entries);
  const used = new Set(keys);
  for (const action of ["followup", "anyAttack", "delay"] as const) {
    const stored = (value as Record<string, unknown>)[action];
    const candidates =
      action === "followup"
        ? ["`", "~", "f", "g", "h"]
        : action === "anyAttack"
          ? ["x", "v", "z", "b", "n", "m"]
          : ["d", "e", "q", "w", "s"];
    const key =
      stored === undefined
        ? candidates.find((candidate) => !used.has(candidate))
        : typeof stored === "string"
          ? normalizeChipShortcutKey(stored)
          : null;
    if (!key || used.has(key)) return { ...defaultChipShortcutBindings };
    bindings[action] = key;
    used.add(key);
  }
  return bindings as ChipShortcutBindings;
}

export function loadChipShortcutBindings(): ChipShortcutBindings {
  try {
    return parseChipShortcutBindings(JSON.parse(localStorage.getItem(storageKey) ?? "null"));
  } catch {
    return { ...defaultChipShortcutBindings };
  }
}

export function saveChipShortcutBindings(bindings: ChipShortcutBindings): void {
  localStorage.setItem(storageKey, JSON.stringify(bindings));
  window.dispatchEvent(new Event("labatar:combo-chip-shortcuts-changed"));
}

export const chipShortcutChangedEvent = "labatar:combo-chip-shortcuts-changed";
