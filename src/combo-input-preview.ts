import type { ProcessedComboInput } from "./recording-types";

type Press = ProcessedComboInput["presses"][number];
type PressEdit = NonNullable<Press["manualEdit"]>;

function withPosition(
  notation: string | null,
  position: Press["context"]["position"],
): string | null {
  if (!notation) return notation;
  const delayed = notation.startsWith("dl.");
  return `${delayed ? "dl." : ""}${position === "airborne" ? "j." : ""}${notation.replace(/^(?:dl\.)?(?:j\.)?/, "")}`;
}

function withDirectionOverride(
  notation: string | null,
  directionOverride: string | undefined,
  facing: "right" | "left",
): string | null {
  if (!notation || directionOverride === undefined) return notation;
  const direction =
    facing === "left"
      ? directionOverride.replace(
          /[134679]/g,
          (digit) =>
            ({
              1: "3",
              3: "1",
              4: "6",
              6: "4",
              7: "9",
              9: "7",
            })[digit as "1" | "3" | "4" | "6" | "7" | "9"],
        )
      : directionOverride;
  return notation.replace(/^(j\.)?[1-9]*/, (_, jump = "") => `${jump}${direction}`);
}

function withAnyAttackButton(notation: string | null, anyAttack: boolean): string | null {
  if (!notation || !anyAttack) return notation;
  return notation.replace(
    /^((?:j\.)?(?:1-9|[1-9]*))(?:\[([ABC])\]|([ABC]))(!?)$/,
    (_, prefix, bracketed, _plain, critical) => `${prefix}${bracketed ? "[X]" : "X"}${critical}`,
  );
}

function withDecorations(notation: string | null, edit: PressEdit): string | null {
  if (!notation) return notation;
  let result = notation;
  if (edit.charged) {
    const suffix = result.endsWith("!") ? "!" : "";
    const base = suffix ? result.slice(0, -1) : result;
    result = base.replace(/(?<!\[)(EX|SUP|TH|[A-Z])$/, "[$1]") + suffix;
  }
  if (edit.crit && !result.endsWith("!")) result += "!";
  if (edit.delay && !result.startsWith("dl.")) result = `dl.${result}`;
  return result;
}

export function previewComboChipEdit(
  processed: ProcessedComboInput,
  selected: Pick<Press, "timeMs" | "physicalButton">,
  edit: PressEdit,
): ProcessedComboInput {
  const selectedIndex = processed.presses.findIndex(
    (press) => press.timeMs === selected.timeMs && press.physicalButton === selected.physicalButton,
  );
  if (selectedIndex < 0) return processed;
  const previous = processed.presses[selectedIndex];
  const positionChanged =
    Boolean(previous.manualEdit?.togglePosition) !== Boolean(edit.togglePosition);
  const presses = processed.presses.map((press, index) => {
    if (index < selectedIndex || (index > selectedIndex && !positionChanged)) return press;
    const position = positionChanged
      ? press.context.position === "airborne"
        ? "grounded"
        : "airborne"
      : press.context.position;
    const interpretations = { ...press.interpretations };
    for (const facing of ["right", "left"] as const) {
      const prior = press.interpretations[facing];
      const suggestedNotation = positionChanged
        ? withPosition(prior.suggestedNotation ?? null, position)
        : prior.suggestedNotation;
      const notation =
        index === selectedIndex
          ? withDecorations(
              withAnyAttackButton(
                withDirectionOverride(
                  facing === "right" && edit.notation
                    ? withPosition(edit.notation, position)
                    : (suggestedNotation ?? null),
                  edit.directionOverride,
                  facing,
                ),
                Boolean(edit.anyAttack) && ["A", "B", "C"].includes(press.gameButton ?? ""),
              ),
              edit,
            )
          : positionChanged
            ? withPosition(prior.notation, position)
            : prior.notation;
      interpretations[facing] = {
        ...prior,
        notation,
        suggestedNotation,
      };
    }
    return {
      ...press,
      context: { ...press.context, position },
      positionAfter:
        positionChanged && press.positionAfter
          ? press.positionAfter === "airborne"
            ? "grounded"
            : "airborne"
          : press.positionAfter,
      manualEdit: index === selectedIndex ? edit : press.manualEdit,
      interpretations,
    };
  });
  const routes = Object.fromEntries(
    (["right", "left"] as const).map((facing) => {
      const tokens = presses.filter((press) => press.interpretations[facing].notation);
      return [
        facing,
        tokens
          .map(
            (press, index) =>
              `${index && facing === "right" ? (press.manualEdit?.separator ?? " ") : index ? " " : ""}${press.interpretations[facing].notation}`,
          )
          .join(""),
      ];
    }),
  ) as ProcessedComboInput["routes"];
  return { ...processed, presses, routes };
}
