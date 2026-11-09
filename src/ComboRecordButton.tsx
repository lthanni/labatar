import { Button } from "@mui/material";

export function ComboRecordButton({
  recording = false,
  disabled = false,
  onClick,
  tabIndex,
}: {
  recording?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  tabIndex?: number;
}) {
  return (
    <Button
      variant="contained"
      color={recording ? "error" : "info"}
      onClick={onClick}
      disabled={disabled}
      tabIndex={tabIndex}
    >
      {recording ? "Stop combo recording" : "+ Record local combo"}
    </Button>
  );
}
