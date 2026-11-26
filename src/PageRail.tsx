import { useState, type ReactNode } from "react";
import { Box, Divider, IconButton, Tooltip, Typography, useMediaQuery } from "@mui/material";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";

export type PageRailItem<T extends string | number> = {
  value: T;
  label: string;
  icon: ReactNode;
  isNew?: boolean;
};

export function PageRail<T extends string | number>({
  items,
  value,
  onChange,
  actions,
  bottom,
}: {
  items: PageRailItem<T>[];
  value: T;
  onChange: (value: T) => void;
  actions?: (expanded: boolean) => ReactNode;
  bottom?: (expanded: boolean) => ReactNode;
}) {
  const [expanded, setExpanded] = useState(
    () => localStorage.getItem("labatar-page-rail-expanded") === "true",
  );
  const compact = useMediaQuery("(max-width: 900px)");
  const showExpanded = expanded && !compact;

  const toggleExpanded = () => {
    const next = !expanded;
    localStorage.setItem("labatar-page-rail-expanded", String(next));
    setExpanded(next);
  };

  return (
    <Box
      component="aside"
      sx={{
        width: showExpanded ? 224 : 56,
        flex: "0 0 auto",
        minHeight: 0,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        overflowX: "hidden",
        overflowY: "auto",
        scrollbarWidth: "thin",
        "&::-webkit-scrollbar": { width: 6 },
        bgcolor: "background.paper",
        borderRight: 1,
        borderColor: "divider",
        transition: "width 180ms ease",
      }}
    >
      <Tooltip title={showExpanded ? "Collapse sidebar" : "Expand sidebar"} placement="right">
        <IconButton
          aria-label={showExpanded ? "Collapse sidebar" : "Expand sidebar"}
          onClick={toggleExpanded}
          sx={{
            alignSelf: showExpanded ? "flex-end" : "center",
            m: 0.75,
            display: compact ? "none" : undefined,
          }}
        >
          {showExpanded ? <ChevronLeftIcon /> : <ChevronRightIcon />}
        </IconButton>
      </Tooltip>
      <Box component="nav" aria-label="Pages" sx={{ px: 0.5, display: "grid", gap: 0.25 }}>
        {items.map((item) => (
          <Tooltip
            key={item.value}
            title={showExpanded ? "" : item.isNew ? `${item.label} · New` : item.label}
            placement="right"
          >
            <Box
              component="button"
              type="button"
              aria-label={item.isNew ? `${item.label} (new)` : item.label}
              aria-current={value === item.value ? "page" : undefined}
              onClick={() => onChange(item.value)}
              sx={{
                width: "100%",
                height: 44,
                px: 1.25,
                display: "flex",
                alignItems: "center",
                justifyContent: showExpanded ? "flex-start" : "center",
                gap: 1.5,
                border: 0,
                borderRadius: 1,
                bgcolor:
                  value === item.value
                    ? "action.selected"
                    : item.isNew
                      ? "action.hover"
                      : "transparent",
                color:
                  value === item.value
                    ? "primary.main"
                    : item.isNew
                      ? "info.main"
                      : "text.secondary",
                cursor: "pointer",
                textAlign: "left",
                whiteSpace: "nowrap",
                font: "inherit",
                "&:hover": { bgcolor: "action.hover", color: "text.primary" },
                "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main" },
              }}
            >
              <Box sx={{ position: "relative", width: 24, height: 24, flex: "0 0 24px" }}>
                {item.icon}
                {item.isNew && !showExpanded && (
                  <Box
                    aria-hidden="true"
                    sx={{
                      position: "absolute",
                      top: -2,
                      right: -3,
                      width: 8,
                      height: 8,
                      bgcolor: "info.main",
                      borderRadius: "50%",
                    }}
                  />
                )}
              </Box>
              {showExpanded && (
                <Typography variant="body2" noWrap>
                  {item.label}
                </Typography>
              )}
              {showExpanded && item.isNew && (
                <Typography
                  component="span"
                  variant="caption"
                  aria-hidden="true"
                  sx={{ ml: "auto", fontWeight: 700 }}
                >
                  New
                </Typography>
              )}
            </Box>
          </Tooltip>
        ))}
      </Box>
      {actions && (
        <>
          <Divider sx={{ my: 1, mx: 1 }} />
          <Box sx={{ px: 0.5, pb: 1 }}>{actions(showExpanded)}</Box>
        </>
      )}
      {bottom && (
        <Box sx={{ mt: "auto" }}>
          <Divider sx={{ my: 1, mx: 1 }} />
          {bottom(showExpanded)}
        </Box>
      )}
    </Box>
  );
}
