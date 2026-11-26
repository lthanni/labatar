export type ComboCharacterCompatibility = {
  whitelist: string[];
  blacklist: string[];
};

export type ComboCharacterList = keyof ComboCharacterCompatibility;
export type ComboCharacterAssignments = ReadonlyMap<string, ComboCharacterList | null>;

export const maxComboCharacterIds = 100;

function isCharacterList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= maxComboCharacterIds &&
    value.every(
      (id) => typeof id === "string" && id.length <= 100 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id),
    ) &&
    new Set(value).size === value.length
  );
}

export function applyComboCharacterAssignments(
  value: ComboCharacterCompatibility | undefined,
  assignments: ComboCharacterAssignments,
): ComboCharacterCompatibility {
  const next: ComboCharacterCompatibility = {
    whitelist: (value?.whitelist ?? []).filter((id) => !assignments.has(id)),
    blacklist: (value?.blacklist ?? []).filter((id) => !assignments.has(id)),
  };
  for (const [id, list] of assignments) {
    if (list) next[list].push(id);
  }
  return next;
}

export function isComboCharacterCompatibility(
  value: unknown,
): value is ComboCharacterCompatibility {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const { whitelist, blacklist } = value as Partial<ComboCharacterCompatibility>;
  return (
    isCharacterList(whitelist) &&
    isCharacterList(blacklist) &&
    !whitelist.some((id) => blacklist.includes(id))
  );
}

export function sameComboCharacterCompatibility(
  first?: ComboCharacterCompatibility,
  second?: ComboCharacterCompatibility,
): boolean {
  const sameIds = (left: string[] = [], right: string[] = []) =>
    left.length === right.length && left.every((id) => right.includes(id));
  return (
    sameIds(first?.whitelist, second?.whitelist) && sameIds(first?.blacklist, second?.blacklist)
  );
}
