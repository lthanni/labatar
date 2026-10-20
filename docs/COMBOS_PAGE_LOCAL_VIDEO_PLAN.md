# Local MP4 links on the Combos page

## Goal and scope

A player can attach and play an MP4 while working in **My gameplan** or **Raw**, without opening the Dev combo editor. The first pass gives each combo one primary local video. The link is personal data: it applies to a locally created combo, a local catalog revision, or a published combo being tracked locally. It is never part of the public catalog payload.

This covers MP4s already in the recording library and MP4s elsewhere on disk. It does not add backend video hosting. Editors still supply a YouTube URL when publishing because the current Worker contract requires one.

## Existing pieces

| Existing behavior                                                                                                                                                                                                       | Consequence for this design                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The Dev combo editor saves one `TechCombo.recordingId` and selects from `recordings.list()`; its linked-recording panel uses `RecordingViewer` in `panelOnly` mode.                                                     | Reuse the recording library and the idea of linking by ID.                                                                                                                                                                 |
| `recordings.list()` scans the configured OBS recording directory recursively. A recording ID is its path relative to that directory; the `labatar-media://recording/…` player route resolves IDs within that directory. | A file elsewhere cannot be previewed through the current media route. Importing it into the library is the smallest coherent path. Renaming, moving, deleting, or changing the recording directory can break a saved link. |
| The new Combos page stores local combos, personal entries, and catalog snapshots in `labatar-combo-workspace-v1`; the detail panel currently previews published YouTube only.                                           | Add a private recording-link map to this workspace and a local-video section in the shared detail panel. Store IDs, not video bytes or absolute paths.                                                                     |
| The Dev editor stores combos separately in `labatar-tech-catalog`.                                                                                                                                                      | Existing Dev links do not automatically appear on the new page. A deliberate import/match step is needed.                                                                                                                  |
| The new page can merge a published local combo into its catalog record and can remove a local revision draft.                                                                                                           | A recording link must move to the catalog ID on merge, and draft removal must not erase a separate catalog link.                                                                                                           |

## Detail-panel interaction

1. Place a **Local video** section in the selected combo's detail panel, visible in both tabs. Show the linked file name and an inline player when the recording exists. Keep a separate **Published video** label for the catalog YouTube embed so their sources are clear.
2. **Link existing recording** opens a searchable picker of `recordings.list()` entries with `mediaKind === "local"` and an `.mp4` name. Show file name, date, and, if useful, its folder. Selecting one saves the ID immediately. Do not make the player edit catalog fields or personal status to attach a video.
3. **Import MP4** opens a native file picker. A new Electron recording API copies the file into a collision-safe location under the configured recording directory, then returns its library recording ID. Show import progress or a busy state and errors; attach only after the copy succeeds. The imported file then behaves like any other recording-library video.
4. **Replace** and **Unlink** act on the association only. Unlink never deletes the MP4. An **Open in recording library** action can use the existing recording-selection event for trimming, upload, and other library tools.
5. If an ID no longer resolves, show **Linked video unavailable** with the saved ID or last known file name, plus Replace and Unlink. Do not silently discard the association. If the desktop recording API is unavailable, show the published video as usual and clearly disable local-video actions.

The local player can use the library's resolved `RecordedVideo.url` with native video controls. The existing `RecordingViewer` panel is available if its richer playback controls prove necessary; embedding it everywhere would add a heavier interface to the combo detail view.

## Data and lifecycle

- Add a workspace field such as `recordingLinks: Record<comboId, { recordingId: string; name?: string }>` and parse it defensively. A separate map keeps the link private for every combo source and does not mix it into a catalog revision payload. Old v1 workspaces load with an empty map; no destructive migration is needed.
- Resolve the saved ID against the current `recordings.list()` result before rendering or playing. Refresh when the Combos tab opens and when `recordings.onChanged` fires. Use the library URL returned by the API rather than constructing a path in the renderer.
- Keep links when editing a route or changing its status. On **Merge with published combo**, explicitly transfer the local ID's recording link to the catalog ID, with a choice if the catalog ID already has a different link. Removing a catalog-origin revision deletes only that draft's link. Deleting a local combo removes its association, not its MP4.
- Keep `recordingLinks` out of `PublishComboDraft`, the Worker request, and exported public JSON. The existing YouTube URL remains independently editable and required for publication. A linked MP4 may have a library-associated YouTube URL, but using it for publication should be an explicit reviewed choice rather than an implicit substitution.
- The current recording ID is a relative path, not a stable file UUID. The first pass must preserve missing links and offer relinking. A later library-wide stable-ID migration would be needed for links to survive file renames or moves automatically.

## Existing Dev-editor combos

Add a one-time **Import from Dev combo editor** action to the new page, so players with existing `TechCombo.recordingId` links can leave that editor behind. Show a review list from `labatar-tech-catalog` with route, character/support, and linked recording. Let the player create a new local combo or select an existing local/catalog combo to receive the link. Do not infer a match from route text alone: several combos can share a route or differ by support and conditions. Record the imported Dev combo ID on the new local copy (or in import bookkeeping) so repeated imports do not create duplicates. Leave Dev data untouched until the player verifies the new page.

This import can follow the core attachment flow. Linking or importing an MP4 from the new page should not depend on completing the Dev-data migration.

## Delivery and checks

1. Add the private recording-link data contract, parsing, and merge/delete handling.
2. Add the library picker, inline preview, missing-link state, and recording-change refresh in the shared combo detail panel.
3. Add the native **Import MP4** API with destination validation, collision handling, and an atomic or cleanup-safe copy. Confirm the imported video appears in `recordings.list()` and plays through the existing media route.
4. Add the reviewed Dev-editor import for older combos and their existing recording links.

Verify a link survives reload, works on both tabs, remains private in a publisher preview/request, transfers correctly on merge, and reports a removed or renamed MP4 without losing the saved association. Also verify a newly imported MP4 can be played and that canceling or failing an import creates neither a partial library entry nor a combo link.

## Decision to revisit

The first pass uses **one primary MP4 per combo**, matching the Dev editor's singular `recordingId`. If players need several examples or separate execution clips for one route, change the private link value to an ordered list with a primary selection; the picker and library API can remain the same.
