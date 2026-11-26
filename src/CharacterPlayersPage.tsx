import { useEffect, useState } from "react";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import YouTubeIcon from "@mui/icons-material/YouTube";
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Paper,
  Snackbar,
  Stack,
  SvgIcon,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { CharacterTabActions } from "./CharacterTabActions";
import {
  fetchPublishedPlayers,
  maxPlayerLinks,
  playersForSelection,
  normalizedPlayerLink,
  readLocalPlayers,
  writeLocalPlayers,
  type Player,
  type LocalPlayer,
  type PublishedPlayer,
} from "./players";
import { inferChannelPlatform } from "./channel-links";
import { ScopePortrait, type GetScopePortrait } from "./ScopePortrait";

function PlayerLinks({
  links,
  onOpenError,
  onCopy,
}: {
  links: string[];
  onOpenError: () => void;
  onCopy: (url: string) => void;
}) {
  const openPlayerLink = window.electronAPI?.app?.openPlayerLink;
  const destinations = links.map((url) => ({ url, platform: inferChannelPlatform(url) ?? "Link" }));

  return (
    <Stack
      component="ul"
      direction="row"
      useFlexGap
      spacing={1}
      sx={{ flexWrap: "wrap", listStyle: "none", m: 0, p: 0 }}
    >
      {destinations.map(({ url, platform }, index) => {
        const sharedPlatform = destinations.some(
          (destination, other) => other !== index && destination.platform === platform,
        );
        const icon =
          platform === "YouTube" ? (
            <YouTubeIcon sx={{ color: "#ff0033" }} />
          ) : platform === "Twitch" ? (
            <SvgIcon sx={{ color: "#9146ff" }}>
              {/* https://github.com/simple-icons/simple-icons/blob/develop/icons/twitch.svg */}
              <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0 1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z" />
            </SvgIcon>
          ) : (
            <OpenInNewIcon />
          );

        return (
          <li key={`${url}:${index}`} style={{ minWidth: 0, maxWidth: "100%" }}>
            <Button
              {...(openPlayerLink
                ? { onClick: () => void openPlayerLink(url).catch(onOpenError) }
                : { href: url, target: "_blank", rel: "noopener noreferrer" })}
              onContextMenu={(event) => {
                event.preventDefault();
                onCopy(url);
              }}
              title={`${url}\nRight-click to copy link`}
              size="small"
              variant="outlined"
              color="inherit"
              startIcon={icon}
              sx={{ maxWidth: "100%", textTransform: "none" }}
            >
              <Typography component="span" variant="inherit" noWrap>
                {platform}
                {sharedPlatform && ` · ${url.replace(/^https:\/\//i, "")}`}
              </Typography>
            </Button>
          </li>
        );
      })}
    </Stack>
  );
}

function newPlayer(characterId: string): LocalPlayer {
  return {
    id: crypto.randomUUID(),
    scopeKind: "character",
    subjectId: characterId,
    title: "",
    links: [""],
    updatedAt: new Date().toISOString(),
  };
}

export function CharacterPlayersPage({
  active,
  readOnly = false,
  characterId,
  supportId,
  getScopePortrait,
}: {
  active: boolean;
  readOnly?: boolean;
  characterId: string;
  supportId: string;
  getScopePortrait: GetScopePortrait;
}) {
  const [local, setLocal] = useState(readLocalPlayers);
  const [published, setPublished] = useState<PublishedPlayer[]>([]);
  const [draft, setDraft] = useState<LocalPlayer | null>(null);
  const [error, setError] = useState("");
  const [copyNotice, setCopyNotice] = useState({ open: false, copied: false });
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!active || !characterId) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    void fetchPublishedPlayers(characterId, supportId).then(
      (items) => {
        if (!cancelled) {
          setPublished(items);
          setLoading(false);
        }
      },
      (reason: unknown) => {
        if (!cancelled) {
          setPublished([]);
          setError(reason instanceof Error ? reason.message : String(reason));
          setLoading(false);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [active, characterId, supportId, refresh]);

  const localVisible = readOnly ? [] : playersForSelection(local, characterId, supportId);
  const publishedVisible = playersForSelection(published, characterId, supportId);
  const shown: Player[] = [
    ...localVisible,
    ...publishedVisible.filter((item) => !localVisible.some((draft) => draft.id === item.id)),
  ];
  const draftLinks = draft?.links.map(normalizedPlayerLink) ?? [];
  const validDraft =
    Boolean(draft?.title.trim()) &&
    draftLinks.length > 0 &&
    draftLinks.length <= maxPlayerLinks &&
    draftLinks.every((url) => url !== null) &&
    new Set(draftLinks).size === draftLinks.length;

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopyNotice({ open: true, copied: true });
    } catch {
      setCopyNotice({ open: true, copied: false });
    }
  }

  function save() {
    if (!draft || !validDraft) return;
    const nextPlayer: LocalPlayer = {
      ...draft,
      title: draft.title.trim(),
      links: draftLinks.filter((url) => url !== null),
      updatedAt: new Date().toISOString(),
    };
    const next = [...readLocalPlayers().filter((item) => item.id !== nextPlayer.id), nextPlayer];
    try {
      writeLocalPlayers(next);
      setLocal(next);
      setDraft(null);
      setError("");
    } catch {
      setError("Could not save the local player on this device.");
    }
  }

  async function publish(link: LocalPlayer) {
    const publisher = window.electronAPI?.catalogPublisher;
    if (!publisher?.publishTech) return;
    setBusyId(link.id);
    setError("");
    try {
      const { updatedAt: _updatedAt, publishedRevision: _revision, ...item } = link;
      const result = await publisher.publishTech({
        type: "player",
        item,
        expectedRevision: link.publishedRevision ?? 0,
      });
      if (!result.cancelled && !result.pending) {
        const next = readLocalPlayers().map((current) =>
          current.id === link.id ? { ...current, publishedRevision: result.revision } : current,
        );
        writeLocalPlayers(next);
        setLocal(next);
        setRefresh((count) => count + 1);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyId("");
    }
  }

  async function unpublish(link: PublishedPlayer) {
    const publisher = window.electronAPI?.catalogPublisher;
    if (!publisher?.unpublishPlayer) return;
    setBusyId(link.id);
    setError("");
    try {
      const result = await publisher.unpublishPlayer({
        id: link.id,
        expectedRevision: link.revision,
      });
      if (!result.cancelled) {
        const next = readLocalPlayers().map((current) =>
          current.id === link.id ? { ...current, publishedRevision: result.revision } : current,
        );
        writeLocalPlayers(next);
        setLocal(next);
        setRefresh((count) => count + 1);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyId("");
    }
  }

  function removeLocal(link: LocalPlayer) {
    const message = publishedVisible.some((item) => item.id === link.id)
      ? `Delete the local copy of ${link.title}? Its published profile will remain in the catalog.`
      : `Delete ${link.title} from this device?`;
    if (!window.confirm(message)) return;
    const next = readLocalPlayers().filter((item) => item.id !== link.id);
    try {
      writeLocalPlayers(next);
      setLocal(next);
      setError("");
    } catch {
      setError("Could not delete the local player.");
    }
  }

  return (
    <Stack spacing={2} sx={{ textAlign: "left" }}>
      <CharacterTabActions>
        {!readOnly && (
          <Button
            size="small"
            variant="contained"
            color="info"
            onClick={() => setDraft(newPlayer(characterId))}
          >
            Add player
          </Button>
        )}
        <Button size="small" onClick={() => setRefresh((count) => count + 1)} disabled={loading}>
          Refresh
        </Button>
      </CharacterTabActions>
      <Typography color="text.secondary">
        Players for this character and the selected support.
      </Typography>
      {error && <Alert severity="warning">{error}</Alert>}
      {!loading && !error && shown.length === 0 && (
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography color="text.secondary">No players yet.</Typography>
        </Paper>
      )}
      {shown.map((link) => {
        const localLink = localVisible.find((item) => item.id === link.id);
        const publishedLink = publishedVisible.find((item) => item.id === link.id);
        return (
          <Paper key={link.id} component="article" variant="outlined" sx={{ p: 2 }}>
            <Stack spacing={1}>
              <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", alignItems: "center" }}>
                <Typography variant="h6">{link.title}</Typography>
                <ScopePortrait {...getScopePortrait(link.scopeKind, link.subjectId)} />
                {localLink && (
                  <Chip size="small" label={publishedLink ? "Local / published" : "Local draft"} />
                )}
              </Stack>
              <PlayerLinks
                links={link.links}
                onOpenError={() => setError("Could not open the player link in your browser.")}
                onCopy={(url) => void copyLink(url)}
              />
              {!readOnly && (
                <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
                  {(localLink || publishedLink) && (
                    <Button
                      size="small"
                      variant="outlined"
                      color="info"
                      disabled={Boolean(busyId)}
                      onClick={() => {
                        if (localLink) {
                          setDraft(localLink);
                        } else if (publishedLink) {
                          const { revision, ...player } = publishedLink;
                          setDraft({
                            ...player,
                            updatedAt: new Date().toISOString(),
                            publishedRevision: revision,
                          });
                        }
                      }}
                    >
                      Edit
                    </Button>
                  )}
                  {localLink && window.electronAPI?.catalogPublisher?.publishTech && (
                    <Button
                      size="small"
                      variant="contained"
                      color="secondary"
                      disabled={Boolean(busyId)}
                      onClick={() => void publish(localLink)}
                    >
                      {busyId === link.id
                        ? "Working…"
                        : publishedLink
                          ? "Publish update"
                          : "Publish"}
                    </Button>
                  )}
                  {publishedLink && window.electronAPI?.catalogPublisher?.unpublishPlayer && (
                    <Button
                      size="small"
                      color="error"
                      disabled={Boolean(busyId)}
                      onClick={() => void unpublish(publishedLink)}
                    >
                      Remove from catalog
                    </Button>
                  )}
                  {localLink && (
                    <Button
                      size="small"
                      color="error"
                      disabled={Boolean(busyId)}
                      onClick={() => removeLocal(localLink)}
                    >
                      Delete local copy
                    </Button>
                  )}
                </Stack>
              )}
            </Stack>
          </Paper>
        );
      })}
      <Dialog open={draft !== null} onClose={() => setDraft(null)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {draft && (draft.publishedRevision || local.some((item) => item.id === draft.id))
            ? "Edit"
            : "Add"}{" "}
          player
        </DialogTitle>
        <DialogContent dividers>
          {draft && (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <TextField
                label="Player name"
                required
                autoFocus
                value={draft.title}
                slotProps={{ htmlInput: { maxLength: 100 } }}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              />
              <Stack spacing={1.5}>
                <Typography variant="subtitle2">Links</Typography>
                {draft.links.map((url, index) => {
                  const normalized = draftLinks[index];
                  const duplicate = normalized !== null && draftLinks.indexOf(normalized) !== index;
                  return (
                    <Stack key={index} direction="row" spacing={1} sx={{ alignItems: "start" }}>
                      <TextField
                        label={`Link ${index + 1}`}
                        required
                        fullWidth
                        value={url}
                        slotProps={{ htmlInput: { maxLength: 2048, inputMode: "url" } }}
                        error={Boolean(url.trim() && !normalized) || duplicate}
                        helperText={
                          duplicate
                            ? "This URL is already listed."
                            : (normalized && inferChannelPlatform(normalized)) || "Use an HTTPS URL"
                        }
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            links: draft.links.map((value, row) =>
                              row === index ? event.target.value : value,
                            ),
                          })
                        }
                      />
                      {draft.links.length > 1 && (
                        <Button
                          size="small"
                          color="error"
                          aria-label={`Remove link ${index + 1}`}
                          onClick={() =>
                            setDraft({
                              ...draft,
                              links: draft.links.filter((_, row) => row !== index),
                            })
                          }
                        >
                          Remove
                        </Button>
                      )}
                    </Stack>
                  );
                })}
                <Button
                  size="small"
                  variant="contained"
                  color="info"
                  sx={{ alignSelf: "start" }}
                  disabled={draft.links.length >= maxPlayerLinks}
                  onClick={() => setDraft({ ...draft, links: [...draft.links, ""] })}
                >
                  Add link
                </Button>
              </Stack>
              <FormControlLabel
                label="For the selected support"
                control={
                  <Switch
                    checked={draft.scopeKind === "support"}
                    disabled={!supportId || Boolean(draft.publishedRevision)}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        scopeKind: event.target.checked ? "support" : "character",
                        subjectId: event.target.checked ? supportId : characterId,
                      })
                    }
                  />
                }
              />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDraft(null)}>Cancel</Button>
          <Button variant="contained" color="info" disabled={!validDraft} onClick={save}>
            Save locally
          </Button>
        </DialogActions>
      </Dialog>
      <Snackbar
        open={copyNotice.open}
        message={copyNotice.copied ? undefined : "Could not copy the player link."}
        autoHideDuration={3000}
        onClose={(_, reason) => {
          if (reason !== "clickaway") setCopyNotice((notice) => ({ ...notice, open: false }));
        }}
      >
        {copyNotice.copied ? (
          <Alert severity="success" variant="filled">
            Player link copied to clipboard.
          </Alert>
        ) : undefined}
      </Snackbar>
    </Stack>
  );
}
