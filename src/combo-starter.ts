import { classifyMoveInput, parseMoveNotation } from "./move-notation";

export const comboStarterGroups = [
  { id: "crit", label: "Crits" },
  { id: "ground-normal", label: "Grounded normals" },
  { id: "ground-command", label: "Grounded command normals" },
  { id: "ground-special", label: "Grounded specials" },
  { id: "ground-ex", label: "Grounded EX specials" },
  { id: "ground-throw", label: "Grounded throws" },
  { id: "air-normal", label: "Air normals" },
  { id: "air-command", label: "Air command normals" },
  { id: "air-special", label: "Air specials" },
  { id: "air-ex", label: "Air EX specials" },
  { id: "air-throw", label: "Air throws" },
  { id: "other", label: "Other starters" },
] as const;

export function comboStarterGroup(input: string): (typeof comboStarterGroups)[number]["id"] {
  const base = input.split("~", 1)[0];
  if (base.endsWith("!")) return "crit";
  const parsed = parseMoveNotation(base, { allowDirectionless: true });
  if (!parsed.ok) return "other";
  const location = parsed.isAirborne ? "air" : "ground";
  if (parsed.button === "EX") return `${location}-ex`;
  if (parsed.button === "TH") return `${location}-throw`;
  const kind = classifyMoveInput(base, { allowDirectionless: true });
  if (kind === "normal") return `${location}-normal`;
  if (kind === "command-normal") return `${location}-command`;
  return `${location}-special`;
}

/** Include the first stance followup when the starter itself does not attack. */
export function comboStarterLabel(
  starter: string,
  route: string,
  isNonAttackStance: boolean,
  fallbackFollowup?: string,
): string {
  if (!isNonAttackStance) return starter;
  const leadingFollowup = /^\s*([^\s>~,→]+)\s*~\s*([^\s>~,→]+)/.exec(route);
  const routeStarter = leadingFollowup?.[1].replace(/!$/, "");
  const routeFollowup =
    routeStarter?.toLowerCase() === starter.replace(/!$/, "").toLowerCase()
      ? leadingFollowup?.[2].replace(/!$/, "")
      : undefined;
  const followup = routeFollowup || fallbackFollowup;
  return followup ? `${starter}~${followup}` : starter;
}

/** The first route token is the starter; a non-attacking stance includes its follow-up. */
export function comboStarterFromRoute(route: string, isNonAttackStance = false): string {
  const starter = /^\s*([^\s>~,→]+)/.exec(route)?.[1] ?? "";
  return comboStarterLabel(starter, route, isNonAttackStance);
}
