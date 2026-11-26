import { Avatar } from "@mui/material";

type ScopePortraitProps = { kind: "character" | "support"; name: string; src: string | null };
export type GetScopePortrait = (kind: ScopePortraitProps["kind"], id: string) => ScopePortraitProps;

export function ScopePortrait({ kind, name, src }: ScopePortraitProps) {
  return (
    <Avatar
      component="span"
      variant="rounded"
      role="img"
      aria-label={`${kind === "character" ? "Character" : "Support"}: ${name}`}
      title={name}
      src={src ?? undefined}
      sx={{
        width: 32,
        height: 34,
        fontSize: "0.75rem",
        color: "text.secondary",
        bgcolor: "action.hover",
        "& .MuiAvatar-img": { objectFit: "contain" },
      }}
    >
      {name.slice(0, 2).toUpperCase()}
    </Avatar>
  );
}
