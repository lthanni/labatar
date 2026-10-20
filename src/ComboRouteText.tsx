import { Box, Tooltip, Typography } from "@mui/material";
import type { ComboNote } from "./tech-types";
import { comboNoteCategoryLabel, comboNoteRangeOffsets } from "./combo-notes";

export type ComboRoutePart = { text: string; invalid?: boolean };

type Piece = ComboRoutePart & { note: ComboNote | null };

function decoratedPieces(route: string, parts: ComboRoutePart[], notes: ComboNote[]): Piece[] {
  const text = parts.map((part) => part.text).join("");
  const ranges =
    text === route
      ? notes.flatMap((note) => {
          const offsets = note.range && comboNoteRangeOffsets(route, note.range);
          return offsets ? [{ note, ...offsets }] : [];
        })
      : [];
  const pieces: Piece[] = [];
  let cursor = 0;
  for (const part of parts) {
    const partStart = cursor;
    const partEnd = cursor + part.text.length;
    const boundaries = [
      partStart,
      ...ranges
        .flatMap(({ start, end }) => [start, end])
        .filter((offset) => offset > partStart && offset < partEnd),
      partEnd,
    ].sort((left, right) => left - right);
    for (let index = 0; index < boundaries.length - 1; index += 1) {
      const start = boundaries[index];
      const end = boundaries[index + 1];
      if (start === end) continue;
      pieces.push({
        text: part.text.slice(start - partStart, end - partStart),
        invalid: part.invalid,
        note: ranges.find((range) => range.start <= start && end <= range.end)?.note ?? null,
      });
    }
    cursor = partEnd;
  }
  return pieces;
}

export function ComboRouteText({
  route,
  parts,
  notes = [],
}: {
  route: string;
  parts?: ComboRoutePart[];
  notes?: ComboNote[];
}) {
  const pieces = decoratedPieces(route, parts ?? [{ text: route }], notes);
  const groups: Array<{ note: ComboNote | null; pieces: Piece[] }> = [];
  for (const piece of pieces) {
    const last = groups[groups.length - 1];
    if (last && last.note === piece.note) {
      last.pieces.push(piece);
    } else {
      groups.push({ note: piece.note, pieces: [piece] });
    }
  }
  return (
    <>
      {groups.map(({ note, pieces: groupPieces }, index) => {
        const content = groupPieces.map((piece, pieceIndex) => (
          <span key={pieceIndex} style={piece.invalid ? { color: "#f28b82" } : undefined}>
            {piece.text}
          </span>
        ));
        const noteColor =
          note?.category === "execution"
            ? { backgroundColor: "rgba(255, 183, 77, 0.23)", underline: "#ffb74d" }
            : note?.category === "situational"
              ? { backgroundColor: "rgba(206, 147, 216, 0.23)", underline: "#ce93d8" }
              : { backgroundColor: "rgba(144, 202, 249, 0.2)", underline: "#90caf9" };
        return note ? (
          <Tooltip
            key={index}
            title={
              <Box>
                <Typography variant="caption" sx={{ fontWeight: 700 }}>
                  {comboNoteCategoryLabel(note.category)}
                </Typography>
                <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                  {note.text}
                </Typography>
              </Box>
            }
            slotProps={{ tooltip: { sx: { maxWidth: 360 } } }}
          >
            <span
              tabIndex={0}
              aria-label={`${comboNoteCategoryLabel(note.category)} note: ${note.text}`}
              style={{
                backgroundColor: noteColor.backgroundColor,
                boxShadow: `inset 0 -1px ${noteColor.underline}`,
                borderRadius: 3,
                boxDecorationBreak: "clone",
                WebkitBoxDecorationBreak: "clone",
                padding: "1px 2px",
                cursor: "help",
              }}
            >
              {content}
            </span>
          </Tooltip>
        ) : (
          <span key={index}>{content}</span>
        );
      })}
    </>
  );
}
