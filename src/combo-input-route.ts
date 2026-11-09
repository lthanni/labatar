export const comboClipExportedEvent = "labatar-combo-clip-exported";
export const comboClipTrimmedEvent = "labatar-combo-clip-trimmed";
export const comboRecordingRenamedEvent = "labatar-combo-recording-renamed";

const actionLabels: Record<string, string> = {
  Atk1: "A",
  Atk2: "B",
  Atk3: "C",
  Atk4: "F",
  EX: "EX",
  Support: "SUP",
  SUP: "SUP",
  Throw: "TH",
  TH: "TH",
};

export function gameButtonForAction(action: string): string | null {
  return actionLabels[action] ?? null;
}
