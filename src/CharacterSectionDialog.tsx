import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  Switch,
  TextField,
} from "@mui/material";

type SectionFields = { title: string; description: string };

export function CharacterSectionDialog({
  label,
  draft,
  editing,
  supportOnly,
  supportDisabled,
  error,
  onChange,
  onSupportChange,
  onClose,
  onSave,
}: {
  label: "category" | "section";
  draft: SectionFields | null;
  editing: boolean;
  supportOnly: boolean;
  supportDisabled: boolean;
  error?: string;
  onChange: (fields: Partial<SectionFields>) => void;
  onSupportChange: (checked: boolean) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <Dialog open={draft !== null} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{`${editing ? "Edit" : "Add"} ${label}`}</DialogTitle>
      <DialogContent dividers>
        {draft && (
          <Stack spacing={2} sx={{ pt: 1 }}>
            {error && <Alert severity="warning">{error}</Alert>}
            <TextField
              label="Title"
              required
              autoFocus
              value={draft.title}
              slotProps={{ htmlInput: { maxLength: 100 } }}
              onChange={(event) => onChange({ title: event.target.value })}
            />
            <TextField
              label="Description"
              multiline
              minRows={2}
              value={draft.description}
              slotProps={{ htmlInput: { maxLength: 500 } }}
              onChange={(event) => onChange({ description: event.target.value })}
            />
            <FormControlLabel
              label="Only for the selected support"
              control={
                <Switch
                  checked={supportOnly}
                  disabled={supportDisabled}
                  onChange={(event) => onSupportChange(event.target.checked)}
                />
              }
            />
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" color="info" disabled={!draft?.title.trim()} onClick={onSave}>
          Save locally
        </Button>
      </DialogActions>
    </Dialog>
  );
}
