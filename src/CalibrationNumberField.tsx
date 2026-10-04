import { useEffect, useState } from "react";
import { TextField } from "@mui/material";

/** Keep incomplete typing local; only a committed numeric value reaches disk. */
export function CalibrationNumberField({
  label,
  value,
  onCommit,
  min = 0,
  max,
  step = 0.1,
  width = 132,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  width?: number;
}) {
  const [draft, setDraft] = useState(String(value));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setDraft(String(value));
    setInvalid(false);
  }, [value]);
  const commit = () => {
    const next = Number(draft);
    if (
      !draft.trim() ||
      !Number.isFinite(next) ||
      next < min ||
      (max !== undefined && next > max)
    ) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (next !== value) onCommit(next);
  };
  return (
    <TextField
      label={label}
      type="number"
      size="small"
      value={draft}
      error={invalid}
      helperText={invalid ? "Enter a value in range" : undefined}
      onChange={(event) => {
        setDraft(event.target.value);
        setInvalid(false);
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          commit();
        }
      }}
      slotProps={{ htmlInput: { min, max, step } }}
      sx={{ width }}
    />
  );
}
