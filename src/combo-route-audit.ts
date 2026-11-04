import type { ComboItem, LocalCombo } from "./combo-gameplan";

export type RouteAuditTarget = {
  id: string;
  source: ComboItem["source"];
  route: string;
};

/** Local storage is always in scope. Shared records require a verified owner. */
export function routeAuditTargets(
  localCombos: LocalCombo[],
  items: ComboItem[],
  isOwner: boolean,
): RouteAuditTarget[] {
  const local = localCombos.map((combo) => ({
    id: combo.id,
    source: "Local" as const,
    route: combo.route,
  }));
  if (!isOwner) return local;
  return [
    ...local,
    ...items
      .filter((item) => item.source !== "Local")
      .map(({ id, source, route }) => ({ id, source, route })),
  ];
}
