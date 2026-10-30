# Combos page: consumption design

The implementation progress and remaining integration checks are in [COMBOS_PAGE_IMPLEMENTATION.md](COMBOS_PAGE_IMPLEMENTATION.md). This document records the design decisions; some descriptions of the original backend contract below predate the new source changes.

## Direction

The page has two tabs: **My gameplan** and **Raw**. My gameplan is the player's working space for the combos they use, practice, consider, or have retired, including routes they add themselves. Raw is a dense, filterable table of published and local combos. Both tabs use the same detail view, with a visible source label.

An [interactive mockup](combos-page-mockup/index.html) illustrates this layout with sample data. Static previews show [My gameplan](combos-page-mockup/preview-desktop.png), its [character picker](combos-page-mockup/preview-character-picker.png), [support picker](combos-page-mockup/preview-support-picker.png), [Raw](combos-page-mockup/preview-raw.png), [Add my combo](combos-page-mockup/preview-add-local.png), the [narrow add form](combos-page-mockup/preview-add-local-mobile.png), [editor submission](combos-page-mockup/preview-editor-submit.png), and the [narrow layout](combos-page-mockup/preview-mobile.png). Routes, damage, portraits, and video areas in the mockup are illustrative.

## Why two tabs

The earlier four-entry design separated Learn, Improve, My gameplan, and Explore. Those are tasks a player may perform in one session with the same set of saved combos. Putting them inside My gameplan keeps the player oriented around their own repertoire. Raw gives power users a direct route to every record and filter without editorial framing. Discovery and comparison happen in Raw, so players switch tabs when looking beyond their saved routes.

## My gameplan

### Main view

1. **Portrait scope, then one starter.** Character opens a grid of roster portraits; support opens the selected character's available support portraits. The standalone mockup uses illustrative tiles for those choices, while the implementation should use decoded portrait artwork with a text fallback. After choosing the pairing, select exactly one starter from grouped buttons using move-type groups (for example, Grounded normals and Air normals). Critical starters preserve their `!` suffix and appear in a separate **Crits** group, so `2B!` is distinct from `2B`. Show only groups with available starters. The active button is visually distinct; there is no "all starters" state in My gameplan. Remember the last selected starter when possible, or choose a starter with a Using route. The mockup defaults to `5B`. Changing the pairing or starter updates saved routes, counts, and detail selection. A pairing with no published starters shows an empty state.
2. **Autopilot first.** Show the dependable routes marked Using or Learning for this starter. Usually there is one Autopilot route. More than one is allowed when each covers a distinct position, such as midscreen/near corner versus fullscreen. Label that coverage on each route rather than imposing a fixed limit.
3. **Situational routes next.** Allow any number of Using or Learning variants under the same starter. Each needs a visible condition such as high hit height, close spacing, counterhit, or screen position, so the player knows when to switch away from an autopilot.
4. **Candidates and history.** Put **Saved for later** and **Considering** in a Candidates section. **Maybe someday** has its own section below Candidates for routes worth keeping without near-term attention. Retired routes remain available for comparison and history. Dismissed routes are hidden from the default gameplan, with a dedicated filter to recover them. Use Raw to discover and compare catalog and local routes.
5. **Selected combo.** Show the player's optional personal name as the main heading, with the editor name alongside it when they differ. Show route, video, costs, known catalog conditions, editor rationale when present, the effective execution difficulty and its personal rating control, personal role, use condition, status, tags, and personal note. Put published notes in an **Editor notes** section, separate from the editable Personal note; show an empty state when the editor has not supplied one. Place status and role together on cards and side by side in tracking controls. A saved entry can be renamed without changing the published combo.

The **role** expresses how a route fits into the selected starter's gameplan: Autopilot or Situational. The **use condition** says when it applies. The **status** expresses where that route is in the player's repertoire. A candidate need not have a role yet; a Using or Learning route with no role appears under **Role not set** until the player assigns one. **Tags are separate, user-defined labels** for situations or intent, such as `neutral`, `punish`, `fullscreen`, or `needs practice`. A player can change tags without changing role or status. The design assumes freeform personal tags; this is a reversible choice to review in the mockup.

### Tracking states

| State           | Meaning                                                                          | Default location             |
| --------------- | -------------------------------------------------------------------------------- | ---------------------------- |
| Blank           | No personal decision has been saved. Merely opening a combo does not create one. | Raw                          |
| Saved for later | Bookmarked to inspect or try later, without a decision to practice.              | Candidates                   |
| Maybe someday   | Interesting route with no near-term plan to evaluate or practice it.             | Maybe someday                |
| Considering     | Actively evaluating this route for the gameplan.                                 | Candidates                   |
| Learning        | Practicing the route, but not relying on it yet.                                 | Autopilot or Situational     |
| Using           | Part of the current gameplan.                                                    | Autopilot or Situational     |
| Retired         | Previously used and kept for reference.                                          | Retired                      |
| Dismissed       | Reviewed and deliberately rejected for now.                                      | Raw and the Dismissed filter |

A blank status means no adoption decision has been saved, so Raw leaves the status cell empty. A personal difficulty rating may still exist for that combo. Dismissed is an explicit, reversible personal decision. The editor's recommendation remains visible even if the player dismisses a route. Saving a route with no status starts at Saved for later, without assigning it an Autopilot role. Maybe someday is a farther-off parking place than Saved for later, so it stays out of the Candidates section while remaining visible in the default gameplan and Raw. A dismissed route may have a private, optional **dismissal reason**, separate from the general personal note. The reason is shown when reviewing that dismissed route and is preserved if it is reconsidered. The added status costs another filter choice but keeps distant ideas separate from active candidates.

The editor may supply a base name for the published combo. A player can set a private name on their saved gameplan entry, such as “Older 5B route.” Gameplan lists, comparisons, and the detail heading use that name when present; the detail view also shows the editor name for recognition. Clearing the personal name restores the editor name when one exists. Without either name, no name is shown; Raw leaves the Name value empty, and the route remains in its own field. Replacement keeps each combo's own name, so the retired route's nickname does not transfer to the new route. The mockup demonstrates this behavior with sample data; its changes still reset on reload.

Gameplan cards give **damage** a large, separate value for quick scanning. Their smaller fields show position, resource cost, and one effective difficulty rating. The starter is already selected above the cards, so the automatic position chip does not repeat it. Card selection opens the detail panel, where editing and publishing actions live. The **New combos** section has its own subtle container and contains only untracked routes, excluding local revision drafts and copies already linked to published combos; setting a route to Learning moves it into its role group. **Execution difficulty** uses an ordinal five point scale in the mockup: 1 very easy, 2 easy, 3 moderate, 4 hard, 5 very hard. The player can set or clear a private rating on any combo, including one with a blank status. The player's rating is used wherever difficulty appears; the editor's published rating is the fallback. Show the editor rating in the rating dropdown's fallback option so the player can inspect it when choosing. Difficulty is subjective and does not claim reliability, consistency, or hitconfirmability. An unrated value stays distinct from 1.

The combo detail panel puts local combo editing and candidate submission actions at the top, followed by **Video**, which groups the YouTube and MP4 players with recording, linking, library, and candidate video controls. Record is hidden when a playable MP4 already exists; record and local MP4 linking are hidden once a usable YouTube video is available. Removing or replacing a recording link asks whether to keep or delete the old MP4, and shared MP4s cannot be deleted from this prompt. Read-only combo values follow, then **Edit my data** for private overrides and tracking. **Editor / catalog data** is last for catalog revision and publication actions. The **Add YouTube video for catalog** action appears only when the dedicated combos upload connection is configured and connected. Editing an existing local combo's shared data does not repeat the private tracking controls in its dialog.

### Finding and replacing

Raw handles discovery with starter, position, counterhit, hitconfirm, resource, and other filters. It includes every published combo, including dismissed ones. Selecting a candidate shows its details and, when the player has a Using route for the same character, support, and starter, offers a current route to compare and replace. The comparison shows both routes' damage, resource cost, and position; unknown values remain unknown in the eventual data-backed implementation. There is no separate Find alternatives button.

**Use instead** in Raw marks the selected candidate Using and the chosen current route Retired together, with Undo. It keeps the retired route and personal note. In the mockup the replacement takes over the old route's role and use condition; the player can edit those fields afterward. The eventual workflow should make that transfer visible before committing. An unlisted old route can be saved manually, but numeric comparisons remain unknown unless its data is entered.

### Beginners and editor picks

An empty gameplan offers local creation and points the player to Raw, where editor picks have a short reason and can be saved. There is no separate beginner page or forced learning order. **Recommended** is an editor's judgment with a reason; computed sorts say **Highest damage**, **Lowest cost**, and so on. Editorial guidance and personal status are independent.

## Local combos and editor submission

Players can add a combo from either tab without publishing it. The form starts with the current character and support, then collects a name, route, position, damage, resource costs, optional difficulty, hitconfirm and counterhit facts, repertoire status, role, use condition, and personal note. The starter is always inferred from the beginning of the route and is never entered separately. A new route starts as **Considering** unless the player chooses another status. After saving, the combo appears under its inferred starter in My gameplan and as a **Local** row in Raw. Players can edit or delete their own local combos. The prototype keeps local combos and their tracking entries in browser storage so they survive a reload; production should use the app's actual local persistence layer and handle storage failure visibly. A catalog record is not mutated by local editing: selecting **Edit catalog combo locally** creates a separate draft for a later authorized revision. That revision editor shows only catalog fields; the catalog combo's personal tracking remains in its detail panel.

Local identity is separate from catalog identity. A local route gets a stable local ID, and its status, name override, difficulty, role, tags, and personal note refer to that ID. Publishing must not expose those private fields. The editor reviews an explicit public payload with a distinct backend combo ID, route, character and support IDs, position, damage, costs, mechanics, move IDs, editor notes, and a YouTube video link. The backend requires a valid YouTube video URL and supports editor notes. The deployed Worker accepts an optional editor name and difficulty.

Only server-authorized editors can write to the catalog. The existing `/v1/editor/combos/{id}` `PUT` endpoint verifies Cloudflare Access identity and an approved editor email, then publishes directly. A real in-page submission shows the exact payload, uses `If-None-Match: *` for a new ID (or an expected revision when editing), and displays success or validation errors. After any local combo or catalog revision draft is published, the local draft is removed. A new local combo's personal tracking and local video link move to the catalog combo; a catalog revision keeps the catalog combo's existing tracking and local video link. The catalog stores the source candidate ID so the original submitter's unchanged local draft can make the same transition on a later refresh, including on another device. A locally changed candidate draft stays separate for review until publication succeeds.

A local revision draft carries the catalog ID and the revision it was copied from. It preserves public fields the editor did not change, including move links, editor notes, video start, and mechanics. An editor can adjust public fields locally and review the exact outgoing payload. Publishing refuses a draft whose source revision is no longer current; the editor must review the newer catalog record before starting a fresh draft. Removing a catalog-origin draft does not replace personal tracking on the catalog combo.

The standalone mockup cannot authenticate or write to this backend. Its **Preview editor access** checkbox demonstrates the original authorized layout only; it predates the local revision flow. The desktop implementation uses the authenticated publisher for actual editor publication.

## Raw

Raw opens with every published and locally saved combo and no filters or recommendation sort applied. A wide table shows character, support, starter, combo name, optional personal name, source, position, damage, effective difficulty, pips, flow, counterhit, hitconfirm status, route, editor pick, personal status, dismissal reason when currently Dismissed, and personal tags where available. Selecting a row opens details and actions without leaving Raw.

Power-user controls include text search, source and other facets, numeric limits, an effective difficulty limit, column sorting, a column chooser, applied-filter summary, result count, and clear-all. Filters compose, and the table must make unknown values distinct from false or zero. Sorting and filtering difficulty use the player's rating when present and otherwise the editor's rating; the difficulty limit excludes combos unrated by both. The player can filter routes with no status, Saved for later, or Dismissed; bookmark or dismiss a route with no status; reconsider a dismissed one; tag a tracked combo; or choose a current route to replace from a selected row. Raw should not hide data merely because a combo lacks editorial metadata, is local, or was personally dismissed.

Raw's default scope is all characters, supports, and starters. My gameplan can remember the player's last character/support/starter selection separately. Moving between tabs must not silently turn a Raw filter into a personal gameplan change.

## Example journeys

| Player intent                          | Path                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------ |
| "What am I using after 5B?"            | My gameplan → select 5B → review Autopilot and Situational routes marked Using |
| "I want to replace this 5B route."     | Raw → filter to 5B → select a candidate → choose a Using route → Use instead   |
| "I need a fullscreen confirm from 5B." | Raw → set starter, position, hitconfirm, and resource filters                  |
| "I just started this character."       | My gameplan empty state → Raw → review editor picks → save a few as Learning   |
| "Show me literally everything."        | Raw → clear filters → sort and inspect the full table                          |
| "This only works on a high hit."       | Save or select combo → set Situational and record the high-hit condition       |
| "I use this for whiff punishes."       | Save or select combo → add personal `whiff punish` tag                         |

Two more journeys: “Maybe later, but not in practice yet” goes from Raw to **Save for later** and the Candidates section. “I already ruled this out” goes from Raw to **Dismiss**, then remains recoverable through the Dismissed filter.

## Data contracts

The published catalog includes combo ID, character, support, route, move IDs, position, damage, resource costs, mechanics, notes, and video reference. The updated source also supports an optional editor name, difficulty rating, and editor-pick reason and context. Existing records with no editor name keep an empty name and remain unrated. The earlier table derived a starter and filtered starter, position, damage, pips, flow, and counterhit.

Add separate data for:

- **Editor picks:** combo ID, situation/context, recommendation reason, optional learning priority, and review metadata. This belongs with editor-controlled published data.
- **Editor execution difficulty:** optional integer from 1 to 5 on the published combo. It is editor-controlled and distinct from editor picks and player ratings.
- **Local combos:** stable local ID, character, support, starter, local name, route, position, damage, resource costs, hitconfirm and counterhit facts, and optional public-submission draft fields. Keep these distinct from catalog records and preserve them across reloads. A published match should be linked explicitly rather than inferred from route text.
- **Personal tracking entries:** catalog or local combo ID, optional status, optional private name override, optional private execution difficulty from 1 to 5, optional role (`Autopilot` or `Situational`), explicit use condition or position coverage, freeform personal tags, personal note, optional dismissal reason, and a display snapshot in case a published combo disappears. No status produces a blank status cell even when a private difficulty rating exists; Dismissed has an explicit status. This belongs in local personal storage first, with a path to sync later. Do not enforce one Autopilot per starter; multiple routes may cover different positions.
- **Searchable facts:** explicit hitconfirm `yes` / `no` / `unknown` and clearly named position semantics. Add reliability or outcome filters only after those terms have editorial definitions.

Publishing currently emits a hitconfirm mechanic only when the local field is true. An absent published mechanic therefore means **unknown**, not **no**. Damage is text today; numeric sort and comparison need validated numeric damage or a specified parser, with unparseable values displayed as unknown.

## Open definitions

1. **Meterless:** zero pips and zero flow, or zero pips with flow allowed. Until decided, expose pips and flow separately.
2. **Screen position:** verify whether the existing field is the starting position before labeling it that way.
3. **Hitconfirmable:** define the initial conversion and the evidence needed to mark yes or no.
4. **Tag scope:** the mockup treats tags as private, freeform labels on a player's saved combo. Shared editor tags would be a different field.
5. **Autopilot terminology:** published combos already have a `routingMode` of `autopilot` or `unique`. Its meaning needs confirmation before mapping it to the player's gameplan role. A catalog route marked `unique` is not automatically Situational, and personal use can differ from a catalog label.
6. **Use condition:** decide whether the first implementation uses free text, structured fields, or both. The mockup uses free text so height and spacing cases can be expressed without inventing a catalog taxonomy.
7. **Difficulty rubric:** the mockup uses a provisional five point execution scale. Editors still need guidance on timing, spacing, and input demands, and whether ratings are relative to a character's routes or to the whole game. Keep unrated combos visibly unrated until that rubric is agreed.

## Delivery slices

1. Build the two-tab shell and Raw table with clear filters, sorting, and full-catalog default.
2. Add editor-controlled combo names and execution difficulty, then the single-starter gameplan view and local entries with optional personal names, personal difficulty, role, use condition, status, tags, notes, dismissal reasons, and missing-catalog handling. Distinguish a blank status from explicit dismissal.
3. Add comparison and reversible replacement to Raw's selected combo details.
4. Add editor picks with reasons in Raw and a link from the empty gameplan.
5. Expand structured search only as confirmed catalog data becomes available.
6. Add local combo creation, editing, persistence, source filtering, and private tracking without requiring publication.
7. Integrate an authorized in-page editor review and publish action with the current backend contract, then reconcile the resulting catalog record with its local origin.

## Review criteria

- My gameplan always has exactly one selected starter button in its move-type groups; changing it updates the whole workspace while Raw still opens with every starter.
- A player can identify their current Autopilot coverage and situational conditions for that starter in one glance. Multiple Autopilots can cover different screen positions, and any number of Situational routes can be saved.
- A player can change role, use condition, status, and personal tags independently.
- A combo with a blank personal status can be saved for later or dismissed. Candidates stay separate from current route groups; dismissed routes stay out of the default gameplan, remain visible in Raw, and can be reconsidered.
- A dismissed route can have a private reason without requiring one. Editor and personal difficulty remain separate in storage, while all displays, sorts, and filters use the personal rating with the editor rating as fallback. The editor rating is visible in the difficulty dropdown. A player can rate an unsaved combo without assigning a status, and unrated does not sort or filter as easiest.
- Damage is visually prominent on every gameplan combo card, with resource cost and difficulty in smaller fields.
- A player can rename a saved combo locally; its editor name stays visible in details, and clearing the override restores that name.
- A player can filter Raw, compare a candidate with a Using route for the same character, support, and starter, switch to that replacement, and undo it.
- A beginner can reach editor picks from an empty gameplan through Raw without a dedicated beginner mode.
- Character and support portrait grids show all available options and close after a selection, on Escape, or on backdrop click.
- Raw initially shows every catalog and local row, and filters/sorts never relabel a computed winner as an editor recommendation.
- A local combo survives a reload and can be edited, tracked, replaced, or deleted without changing the published catalog.
- The editor submission preview contains only public fields, requires a valid YouTube link, and never treats the mockup's access toggle as real authorization. Its JSON export imports into the existing publisher; real writes require server-verified editor privilege.
- Unknown hitconfirm or damage is not treated as negative or zero.

## Evidence and limits

The current implementation is in `src/CombosPage.tsx`, `src/combo-gameplan.ts`, `src/published-catalog.ts`, and `src/publish-combo-draft.ts`. The mockup's portrait options mirror the character names in `src/AnalyticsSection.tsx` and support pairings in `electron/support-map.json`; its artwork tiles are placeholders because real portraits are resolved from locally decoded game art. Showing applied filters and clear sorting is informed by product-list usability research, applied here by analogy rather than direct combo-page testing: https://baymard.com/research-articles/how-to-design-applied-filters and https://baymard.com/research/ecommerce-product-lists.
