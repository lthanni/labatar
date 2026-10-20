import supportMap from "../electron/support-map.json";
import { slugComboText } from "./combo-gameplan";
import { comboStarterFromRoute } from "./combo-starter";

type RecordingNameParts = {
  character: string;
  support: string;
  starter: string;
  screenPosition: string;
  damage: string;
};

const rosterNames = [
  ...Object.keys(supportMap),
  ...Object.values(supportMap).flatMap((supports) => Object.values(supports)),
];
const namesById = new Map(rosterNames.map((name) => [slugComboText(name), name]));

function displayName(id: string) {
  return (
    namesById.get(id) ??
    id
      .split("-")
      .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : ""))
      .join(" ")
  );
}

/** The base name used by “Record for this combo” and candidate YouTube uploads. */
export function formatComboRecordingBaseName(parts: RecordingNameParts): string {
  return [
    parts.character,
    parts.support,
    parts.starter === "Unknown starter" || parts.starter === "Unknown move" ? "" : parts.starter,
    parts.screenPosition,
    parts.damage.trim() ? `damage ${parts.damage.trim()}` : "",
  ]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" - ");
}

export function candidateRecordingTitle(combo: {
  characterId: string;
  supportId: string;
  route: string;
  starterIsNonAttackStance?: boolean;
  screenPosition: string;
  damage: string;
}): string {
  return formatComboRecordingBaseName({
    character: displayName(combo.characterId),
    support: displayName(combo.supportId),
    starter: comboStarterFromRoute(combo.route, combo.starterIsNonAttackStance),
    screenPosition: combo.screenPosition,
    damage: combo.damage,
  });
}
