import type { PublishedCombo } from "./published-catalog";
import type { ComboNote } from "./tech-types";
import { youtubeVideoId } from "./YouTubeRecordingPlayer";

export type PublishComboDraft = {
  schemaVersion: 1;
  source: string;
  warnings: string[];
  expectedRevision?: number;
  combo: {
    id: string;
    sourceCandidateId?: string;
    characterId: string;
    supportId: string;
    name?: string;
    difficulty?: number;
    editorPickReason?: string;
    editorPickContext?: string;
    route: string;
    starterIsNonAttackStance?: boolean;
    routingMode?: "autopilot" | "unique";
    moveIds: string[];
    screenPosition: string;
    damage: string;
    notes?: ComboNote[];
    resourceCosts: Record<string, number>;
    mechanics: string[];
    youtubeUrl: string;
    startSeconds: number;
  };
};

export function publishedComboFromDraft(draft: PublishComboDraft): PublishedCombo | null {
  const videoId = youtubeVideoId(draft.combo.youtubeUrl);
  if (!videoId) return null;
  return {
    id: draft.combo.id,
    ...(draft.combo.sourceCandidateId ? { sourceCandidateId: draft.combo.sourceCandidateId } : {}),
    characterId: draft.combo.characterId,
    supportId: draft.combo.supportId,
    name: draft.combo.name ?? "",
    difficulty: draft.combo.difficulty ?? null,
    editorPickReason: draft.combo.editorPickReason ?? "",
    editorPickContext: draft.combo.editorPickContext ?? "",
    route: draft.combo.route.trim(),
    ...(draft.combo.starterIsNonAttackStance ? { starterIsNonAttackStance: true } : {}),
    routingMode: draft.combo.routingMode ?? "autopilot",
    moveIds: draft.combo.moveIds,
    screenPosition: draft.combo.screenPosition.trim(),
    damage: draft.combo.damage.trim(),
    notes: draft.combo.notes ?? [],
    resourceCosts: draft.combo.resourceCosts,
    mechanics: draft.combo.mechanics,
    youtubeVideoId: videoId,
    startSeconds: draft.combo.startSeconds,
  };
}
