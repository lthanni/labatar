import { Stack } from "@mui/material";
import type { ReactNode } from "react";

export function CharacterTabActions({ children }: { children: ReactNode }) {
  return (
    <Stack
      direction="row"
      spacing={1}
      useFlexGap
      sx={{ alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end", minWidth: 0 }}
    >
      {children}
    </Stack>
  );
}
