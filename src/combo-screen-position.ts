export const comboScreenPositions = ["corner", "midscreen", "fullscreen"] as const;

export function isComboScreenPosition(value: string): boolean {
  return comboScreenPositions.includes(value as (typeof comboScreenPositions)[number]);
}

export function comboScreenPositionOrEmpty(value: string): string {
  const normalized = value.trim().toLowerCase();
  return isComboScreenPosition(normalized) ? normalized : "";
}
