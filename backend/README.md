# Labatar catalog backend

This folder is a Cloudflare Worker backed by D1 and an R2 bucket for combo candidate MP4s. Published moves, combos, and Tech are publicly readable. Upload and editor routes require a valid Cloudflare Access JWT and an approved email in D1 or the private `EDITOR_EMAILS` Worker secret. Editors can also publish and review candidates.

The desktop app has a public Combos page that fetches published records from this Worker and saves an offline snapshot in IndexedDB. Players can also keep local combos and personal tracking on their device. Existing drafts are not published automatically; select a combo and choose **Publish combo** to publish it.

The desktop app uses `https://labatar-catalog.landenhanni.workers.dev` by default. Development builds have a **Catalog: Hosted / Local Wrangler** button in the footer. It switches catalog reads and Electron editor/candidate requests together and reloads the app. The local target defaults to `http://127.0.0.1:8787`; set `VITE_CATALOG_API_URL` before starting the app only if Wrangler uses another local port. The setting is public, not a credential, and is unavailable in packaged builds.

Character Tech, Pressure, Oki, and Guides can be drafted on the device from their tabs. An editor uses **Publish** on a local section or entry to send it to the selected catalog backend. When an entry belongs to a section, publish the section first. Pressure, Oki, and Guides use `character_note_sections` for their sections and retain their existing fields and guide links in `character_notes`. Existing notes appear under Unsectioned until assigned to a section. A linked recording remains local. The Worker checks editor access for every publish request and rejects stale revisions. The public `/v1/tech` and `/v1/character-notes` routes serve published material. Apply the updated `schema.sql` to each D1 database before deploying the Worker.

The Characters **Players** tab keeps local drafts of player profiles for a character or support. A profile has a name and up to 20 HTTPS links, with a platform label derived from each URL. Catalog editors manage publication through `/v1/editor/players`, and public readers use `/v1/players`. Apply `schema.sql` before deploying the Player routes. It copies each existing `channel_links` record into `catalog_players` with its original ID, scope, revision, and publication status. Rerunning the schema preserves player edits. Local channel drafts carry over as profiles with one link. Older app versions still use the separate legacy Channels catalog.

## Automatic guide video publication

Tech guides (in every character or support subsection) and the separate Guides tab accept local MP4s and existing YouTube links. On **Publish**, Electron uses the editor's catalog session to stage MP4s in the private R2 bucket. It then queues the guide in D1. A scheduled Worker uploads staged MP4s to **@ATLAbatar** as unlisted videos and publishes the complete guide only after every upload succeeds. Existing public revisions remain visible while an update is queued. Editors never connect a Google account or receive channel credentials for this flow. The separate permission for uploading to a user's own YouTube channel is not required.

Owner setup, from the repository root:

1. Apply the schema: `vp dlx wrangler d1 execute labatar-catalog --remote --file backend/schema.sql --config backend/wrangler.toml`. The new guide upload, publication, and worker lock tables do not modify existing records.
2. Enable YouTube Data API v3 on the Google OAuth project. Use a Desktop OAuth client. The script reads the existing `.dev/youtube-client.json` Google download or `electron/youtube-client.json`; `LABATAR_YOUTUBE_CLIENT_ID` and `LABATAR_YOUTUBE_CLIENT_SECRET` environment variables override the files.
3. Run `node backend/scripts/authorize-guide-youtube.mjs` under the owner's Windows account. Open the printed Google authorization URL and select **@ATLAbatar**. The script requests upload and channel read permissions, resolves the handle, and checks that the authorized channel matches before changing any secrets. It sends `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN`, and the resolved `YOUTUBE_CHANNEL_ID` directly to Wrangler's secret bulk command over stdin. It does not print or save tokens. Wrangler must already be signed in to the correct Cloudflare account. This command updates the Worker's secrets; do not run it for an editor.
4. Deploy: `vp dlx wrangler deploy --config backend/wrangler.toml`. The configured cron runs once per minute. Allow for Cloudflare's cron propagation delay. Use a Workers plan with sufficient CPU and subrequest limits for the scheduled uploader. Google OAuth publishing, consent, quota, or token expiry requirements can still prevent uploads and require owner attention.
5. Submit a small MP4 guide as an editor with no direct YouTube access. Confirm the queued status survives closing and reopening the app, the video appears on @ATLAbatar, and the guide appears publicly only when the job completes. This live Google/Cloudflare verification is required after setup; local tests use test doubles.

If the backend and schema are already deployed, run only step 3 and then test a small guide. The script's secret update activates the credentials on the deployed Worker. `node backend/scripts/authorize-guide-youtube.mjs --check` checks local setup without requesting Google authorization or changing secrets. On Windows, the script reuses an existing Wrangler CLI from the owner's pnpm cache to avoid a new `vp dlx` install. You can set `LABATAR_WRANGLER_CLI` to a specific `wrangler/bin/wrangler.js` path if needed.

Google refresh credentials stay in Worker secrets. The Worker checks both the authorized channel ID and `YOUTUBE_CHANNEL_HANDLE = "@ATLAbatar"` before starting new video uploads. Each resumable session and completed video is retained in private D1 metadata, so retrying an interrupted publication resumes the upload or reuses its completed YouTube ID. The worker serializes processing using a D1 lease, uploads at most eight 8 MiB chunks per scheduled invocation, and stops on stale catalog revisions or revoked editor access. Jobs continue when the editor disconnects. The app checks persisted job IDs after restarting and reports terminal failures so the editor can retry **Publish**.

MP4s are capped at 2 GiB each, with a 50 GiB staging cap. R2 copies are removed after successful publication; unpublished failed jobs retain their files for retry. Unreferenced staging files and abandoned multipart uploads are cleaned after seven days. Cleanup preserves completed YouTube IDs. For local Wrangler, supply separate test credentials using its ignored `.dev.vars` file and invoke the scheduled handler with Wrangler's test scheduled support. Never copy production refresh tokens into the repository or desktop distribution.

Private editor API routes:

| Method | Route                                       | Purpose                                                        |
| ------ | ------------------------------------------- | -------------------------------------------------------------- |
| POST   | `/v1/editor/guide-videos`                   | Create or recover an MP4 staging upload by UUID and byte size  |
| PUT    | `/v1/editor/guide-videos/:id/parts/:number` | Upload an authenticated 8 MiB part                             |
| POST   | `/v1/editor/guide-videos/:id/complete`      | Complete staging with ordered R2 part ETags                    |
| POST   | `/v1/editor/guide-publications`             | Queue an idempotent guide publication, or retry its failed job |
| GET    | `/v1/editor/guide-publications/:id`         | Read the creator's pending, published, or failed job           |

Run `node --test backend/test/guide-publications.node-check.mjs electron/catalog-tech-publisher.node-check.cjs electron/guide-video-library.node-check.cjs` for queue, authentication, channel checks, upload recovery, revision conflicts, and local backend isolation checks.

Implementation references: [YouTube resumable uploads](https://developers.google.com/youtube/data/guides/using_resumable_upload_protocol), [Cloudflare scheduled handlers](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/), [Worker request content length](https://developers.cloudflare.com/workers/runtime-apis/request/#set-the-content-length-header).

## Discord candidate alerts

The Worker can post to a private Discord channel when a combo MP4 finishes uploading and enters the pending review queue. It sends the verified submitter email, candidate ID, character, support, damage, and route. It does not send the MP4, local file path, or upload token. A retry of an already completed upload does not send another alert. Discord delivery is best effort: a failed alert is logged and does not fail the candidate upload. Candidates created before the submitter migration show "unknown submitter" if they finish afterward.

1. In the Discord server, create a private text channel for alerts. Under **Server Settings → Integrations → Webhooks**, create a webhook for that channel and copy its URL. No Discord bot application is needed for these one-way alerts.
2. In **Cloudflare → Workers & Pages → labatar-catalog → Settings → Variables and Secrets**, add the URL as a **Secret** named `DISCORD_ALERT_WEBHOOK_URL`. Do not put the URL in `wrangler.toml`, the desktop app, or this repository. This secret is optional so the catalog remains available before Discord is configured. The existing `[secrets].required` list is for mandatory Access secrets.
3. Deploy the Worker code. Open `https://labatar-catalog.landenhanni.workers.dev/v1/editor/access` as an owner listed in `EDITOR_EMAILS`, then select **Send test alert**. The page reports delivery success or a configuration error. Check the private channel for the test message.
4. Submit a small combo candidate through Labatar and confirm that one new alert appears after the upload finishes. Editors can then review it under **Combos → Candidates**.

The test button calls the owner-only `POST /v1/editor/discord-alert-test` route. The webhook URL stays on the Worker. If the webhook is changed or revoked, update the Cloudflare secret and send another test alert.

## Combo upload access

The owner access page at `/v1/editor/access` also grants an independent **Upload to own YouTube channel** permission. A person can have combo access, YouTube access, or both. Apply `schema.sql` to the remote D1 database before deploying this Worker version so `catalog_youtube_upload_access` exists. The desktop app checks `GET /v1/editor/youtube-upload-access` before connecting a YouTube account and again before each queued upload starts. The endpoint requires a signed Cloudflare Access identity and either this permission or an owner email. It returns no Google credentials. Because the Desktop OAuth client ID is public, this permission controls the normal Labatar workflow, not modified clients using the ID directly.

The Combos page opens for everyone and reads published records from public `/v1/combos`. When a user submits a local MP4, the app signs in through Cloudflare Access and calls `POST /v1/editor/candidates/upload`. The Worker verifies the signed Access JWT and checks for a `viewer` or `editor` role in D1. The existing `viewer` role now means combo uploader; editors and owner emails in `EDITOR_EMAILS` can also upload. The older preview check remains for installed clients that still use it, but current clients do not gate page access on it.

The owner manages people at `https://labatar-catalog.landenhanni.workers.dev/v1/editor/access`. Add one email, choose its combo role, and independently select **Upload to own YouTube channel**. Choose **No combo access** to grant only YouTube upload permission. Changes take effect on the next upload permission check. This page and its API require the signed owner identity from `EDITOR_EMAILS`; the secret is a fixed bootstrap owner list, not the place to add ordinary users. The old `COMBO_PREVIEW_ACCESS_MODE` setting is ignored and can be deleted. No Worker deployment or new installer is needed for each person.

If an authenticated person lacks an uploader role, the desktop app shows **Request upload access**. Clicking it sends the email from their verified Cloudflare Access token to the configured private Discord alert channel. The request cannot supply a different email. Repeat clicks for the same email return a confirmation without another alert for 24 hours; a failed Discord delivery can be retried. The owner grants access through the access page above. Apply `schema.sql` to D1 before deploying this Worker change so `catalog_upload_access_requests` exists. The button only appears when the Worker returns a role denial; someone blocked by Cloudflare Access before the Worker needs an Access policy change or a separate denial page.

The Access application must cover only `/v1/editor/*`. To make the D1 roles the sole member list, enable One-time PIN for that application and add a dedicated **Allow** policy with **Include → Login Methods → One-time PIN**. Keep the existing owner policy if it uses another login method; do not broaden a reusable policy shared by other applications. Never use **Bypass**. Access then verifies each email and forwards a signed JWT; the Worker rejects anyone absent from the D1 role table and owner secret. This deliberately makes the Access login available to more people, while the Worker remains the authorization gate. Keep the public API paths outside the Access application. Do not delete the owner secret: it is needed to manage roles.

## Character and support Tech

Apply `schema.sql` to D1 before deploying this version. It adds `tech_sections` and
`tech_entries` without changing existing catalog records.

The Characters → Tech tab reads `GET /v1/tech?character=aang&support=gyatso`.
Each subsection belongs either to one character or to one support. A character
subsection appears with every support selected for that character; a support
subsection appears wherever that support is selected. Tech entries are short
individual tools under a subsection. Each entry can have up to 12 ordered
YouTube videos, with a separate heading and description for every video. The
backend stores validated video IDs, not arbitrary URLs or local recordings.

Editors can open `/v1/editor/tech` to create, revise, or unpublish subsections
and entries. The editor uses the same Cloudflare Access session and editor role
as the combo publisher. It writes to these routes:

| Method     | Path                           | Purpose                                           |
| ---------- | ------------------------------ | ------------------------------------------------- |
| GET        | `/v1/editor/tech-sections`     | List all subsections, including unpublished ones  |
| PUT/DELETE | `/v1/editor/tech-sections/:id` | Publish or unpublish a subsection                 |
| GET        | `/v1/editor/tech-entries`      | List all Tech entries, including unpublished ones |
| PUT/DELETE | `/v1/editor/tech-entries/:id`  | Publish or unpublish an entry                     |

Create with `If-None-Match: *`; update or unpublish with `If-Match: "<revision>"`.
Unpublishing a subsection hides its entries from public results. Entry bodies
use `id`, `sectionId`, `title`, optional `description`, `notation`, `sortOrder`,
and `videos: [{"title":"Setup","description":"Timing","url":"https://youtu.be/M7lc1UVf-VE"}]`.

## Combo publisher

The publisher supports an optional public combo name, editor difficulty from 1 to 5, and starter move override. Use `starterOverride` when the first route token is the input but a different move comes out. The route remains the recorded input, while the override controls starter grouping and display. Leaving it empty uses the first route token.

After deploying the Worker, open `https://labatar-catalog.landenhanni.workers.dev/v1/editor/app` in a browser. The existing Access application path `/v1/editor/*` should prompt for sign-in before the page loads. The Worker also checks the Access JWT and editor role for the page, its script and stylesheet, and every editor API request. The page and API share an origin, so the browser can use the Access session without a cross-origin editor request.

Create a combo by entering its lowercase slug IDs, notation, damage, costs, mechanics, and a YouTube URL. A local MP4 can be selected for reference and plays only in the browser; neither the file nor its path is sent to the Worker. Form fields are saved as a draft in that browser's local storage, but the selected video file must be reselected after a reload. Review the JSON preview, then select **Publish combo**. Existing combos can be loaded, revised, or unpublished from the same page. Publishing requires a YouTube link; the public API stores its video ID.

In the development build of the desktop app, select a local combo in **Tech editor** and choose **Publish combo**. If needed, sign in to Cloudflare Access in the app's sign-in window. The app displays the combo and any route-link warnings for confirmation, then submits the combo to the editor API using the current revision. The request includes combo metadata and the linked recording's YouTube URL; it never uploads the local recording or analysis evidence. A YouTube link is required. Route entries without matched move IDs are flagged for review; move IDs can remain empty for a route whose moves have not yet been published.

The publisher uses revision headers for safe edits. A conflict means another editor changed the record; reload the editor list and review the latest version before publishing again. Public reads may remain cached for up to 60 seconds after a publish or unpublish action.

## Cloudflare setup

1. Install or run Wrangler with Vite+: `vp dlx wrangler --version`, then log in with `vp dlx wrangler login` from this directory.
2. Create a D1 database with `vp dlx wrangler d1 create labatar-catalog`. Put the returned `database_id` in `wrangler.toml`; keep `binding = "DB"` because the Worker uses `env.DB`.
3. Enable R2 in the Cloudflare dashboard for this account, then create the private bucket with `vp dlx wrangler r2 bucket create labatar-combo-candidates`. Keep `binding = "CANDIDATE_VIDEOS"` in `wrangler.toml` and do not enable public bucket access. Cloudflare error 10042 means R2 still needs to be enabled for the account.
4. For an existing database, first apply `migrations/001_candidate_submitter_email.sql` once with `vp dlx wrangler d1 execute labatar-catalog --remote --file migrations/001_candidate_submitter_email.sql`. For a fresh database, skip that migration. Apply `schema.sql` with `vp dlx wrangler d1 execute labatar-catalog --remote --file schema.sql`. It creates any missing catalog tables, including `catalog_youtube_upload_access`, without changing existing catalog records. Older review clients may have stored an approval marker in the `rejection_reason` field; the current upload path no longer requires it. Rejected candidates continue to use that field for the editor's reason.
5. This Worker uses the `landenhanni.workers.dev` account subdomain. With `name = "labatar-catalog"` and `workers_dev = true`, its expected URL is `https://labatar-catalog.landenhanni.workers.dev`. No custom domain or change to the GitHub Pages site is needed.
6. In Cloudflare Zero Trust, create a self-hosted Access application for **only** `labatar-catalog.landenhanni.workers.dev/v1/editor/*`. Enable One-time PIN and attach a dedicated **Allow** policy with **Include → Login Methods → One-time PIN**. Keep any existing owner policy needed for another login method. Never use **Bypass**, which would prevent the Worker from receiving a verified identity. Do not protect the entire Worker because its read endpoints and candidate submission are public.
7. In Cloudflare **Workers & Pages → labatar-catalog → Settings → Variables and Secrets**, set `ACCESS_TEAM_DOMAIN` to the Access team name, `ACCESS_AUD` to the application Audience (AUD) tag, and `EDITOR_EMAILS` to the fixed owner email(s). Set each as a Secret. These values are not stored in `wrangler.toml`; its `[secrets]` section names the required bindings without exposing their values. Remove any old `COMBO_PREVIEW_ACCESS_MODE` secret. Alternatively, use `vp dlx wrangler secret put <NAME>` for each binding. Keep local `.dev.vars` files out of Git.
8. Deploy with `vp dlx wrangler deploy`. Existing Worker secrets are preserved by deploy. Check `GET https://labatar-catalog.landenhanni.workers.dev/health` and `GET https://labatar-catalog.landenhanni.workers.dev/v1/combos`.

If `vp dlx wrangler` stops with `ERR_PNPM_IGNORED_BUILDS` for `esbuild` and `workerd` on Windows, use `pnpm.cmd dlx --allow-build=esbuild --allow-build=workerd wrangler <command>` instead for each Wrangler command above. For example, run `pnpm.cmd dlx --allow-build=esbuild --allow-build=workerd wrangler login`. The `.cmd` launcher also avoids PowerShell's script execution policy for `pnpm.ps1`.

The configured Access team name and audience must match the Access application. The owner list stays in the Worker secret. Everyone else is managed one person at a time through the private admin page and D1. No Cloudflare credentials, email lists, or user secrets belong in the repository.

After deployment, verify `GET /health` returns `{"ok":true,"features":{"comboNotes":true,"comboCandidates":true}}`. This confirms the deployed Worker accepts combo notes and has candidate video storage. Check the public `GET /v1/moves` and `GET /v1/combos` routes too. Open `/v1/editor/moves` in a browser: Access should prompt for sign-in, then the Worker should return an editor list for an approved editor. If the public routes prompt for sign-in, the Access application covers too broad a path. If the editor route still returns HTTP 401 after sign-in, check the Access team name, audience, and allowed email.

### Debug candidate uploads locally

Run these commands from `backend` in one PowerShell terminal:

```powershell
pnpm.cmd dlx --allow-build=esbuild --allow-build=workerd wrangler d1 execute labatar-catalog-local --config wrangler.local.toml --local --file schema.sql
pnpm.cmd dlx --allow-build=esbuild --allow-build=workerd wrangler dev --config wrangler.local.toml --local --port 8787
```

In another terminal, from the repository root, start the desktop app:

```powershell
vp run electron:dev
```

Click **Catalog: Hosted** in the app footer to switch to **Local Wrangler**. Click **Catalog: Local Wrangler** to switch back. The selection persists across dev app restarts; published catalog snapshots are kept separately for each backend. The local config uses local D1 and R2 storage. Its separate entrypoint supplies a test identity for editor and candidate requests only when the request URL is local, so Cloudflare Access sign-in is not needed for this debugging workflow. The local catalog starts empty. The console running Wrangler shows candidate R2 creation and D1 insertion failures separately. Do not deploy `wrangler.local.toml`; the hosted `wrangler.toml` retains Access verification.

For an existing hosted database, apply `migrations/001_candidate_submitter_email.sql` if its column is missing. The Worker accepts candidate uploads on the old schema until the migration runs, but those rows cannot retain the verified submitter email or include it in Discord alerts. The running Worker logs when this fallback is used.

## API

| Method         | Path                                              | Access       | Purpose                                                           |
| -------------- | ------------------------------------------------- | ------------ | ----------------------------------------------------------------- |
| GET            | `/health`                                         | Public       | Health response                                                   |
| GET            | `/v1/editor/app`                                  | Editor       | Browser combo publisher                                           |
| GET            | `/v1/editor/combo-preview`                        | Legacy       | Preview check for older desktop clients                           |
| GET            | `/v1/editor/access`                               | Owner        | Manage uploader and editor roles in a browser                     |
| GET/PUT/DELETE | `/v1/editor/access-roles`                         | Owner        | List, set, or remove individual roles                             |
| GET            | `/v1/moves?character=aang`                        | Public       | Published moves                                                   |
| GET            | `/v1/combos?character=aang&support=gyatso`        | Public       | Published combos                                                  |
| GET            | `/v1/editor/moves` or `/v1/editor/combos`         | Editor       | Latest records, including unpublished records and revisions       |
| PUT            | `/v1/editor/moves/:id` or `/v1/editor/combos/:id` | Editor       | Create or replace a record                                        |
| DELETE         | `/v1/editor/moves/:id` or `/v1/editor/combos/:id` | Editor       | Unpublish a record; older revisions remain in D1                  |
| GET/POST       | `/v1/editor/candidates/upload`                    | Uploader     | Check upload access or create an MP4 upload and receive its token |
| POST           | `/v1/editor/upload-access-request`                | Signed-in    | Request uploader access by private Discord alert                  |
| PUT            | `/v1/candidates/:id/parts/:number`                | Upload token | Upload an 8 MiB part (last part may be smaller)                   |
| POST           | `/v1/candidates/:id/complete`                     | Upload token | Complete the MP4 and place the combo in review                    |
| POST           | `/v1/candidates/:id/abort`                        | Upload token | Abort an unfinished upload                                        |
| GET            | `/v1/editor/candidates`                           | Editor       | List submitted candidates                                         |
| PATCH          | `/v1/editor/candidates/:id`                       | Editor       | Revise queued combo details in place; resets legacy approval      |
| GET            | `/v1/editor/candidates/:id/video`                 | Editor       | Download the submitted MP4                                        |
| POST           | `/v1/editor/candidates/:id/approve`               | Editor       | Legacy approval endpoint for older desktop clients                |
| POST           | `/v1/editor/candidates/:id/reject`                | Editor       | Reject and remove the queued MP4                                  |
| POST           | `/v1/editor/candidates/:id/uploaded`              | Editor       | Save a pending candidate's YouTube URL                            |

To revise a queued candidate, send `PATCH /v1/editor/candidates/:id` with
`{"combo": <full candidate combo>, "updatedAt": "<last updatedAt from the queue>"}`.
The Worker validates the full public combo, keeps the candidate and original
submitter IDs, and returns HTTP 409 if the queue row changed meanwhile. A
revision clears any legacy approval marker. Edit the downloaded MP4 in the
recording library before uploading that local file to YouTube; editing combo
details does not overwrite the private queued MP4.

Create with `If-None-Match: *`. Update or unpublish with `If-Match: "<revision>"` using the latest revision returned by the editor list. A stale revision returns HTTP 409. Record IDs, character IDs, support IDs, move IDs, and resource keys are lowercase slugs.

Example combo body for `PUT /v1/editor/combos/aang-basic`:

```json
{
  "id": "aang-basic",
  "characterId": "aang",
  "supportId": "gyatso",
  "route": "2A > 5B > 236A",
  "routingMode": "autopilot",
  "characterCompatibility": { "whitelist": ["korra"], "blacklist": ["toph"] },
  "moveIds": ["aang-2a", "aang-5b", "aang-236a"],
  "screenPosition": "midscreen",
  "damage": "3200",
  "resourceCosts": { "pips": 1, "flow": 0 },
  "mechanics": ["corner carry"],
  "notes": [
    {
      "id": "note-1",
      "text": "Delay the last hit",
      "category": "execution",
      "range": { "startToken": 1, "endToken": 3, "excerpt": "5B > 236A" }
    }
  ],
  "youtubeUrl": "https://www.youtube.com/watch?v=M7lc1UVf-VE",
  "startSeconds": 0
}
```

The optional `characterCompatibility` object contains two lists of opponent character IDs. The whitelist records opponents the combo works against, and the blacklist records opponents it fails against. Unlisted opponents have unspecified compatibility. Each list accepts up to 100 unique lowercase character slugs, and a character can appear in one list. Omitting the object during a catalog or candidate edit preserves its current lists. Send both arrays empty to clear them.

The API validates the YouTube URL and stores only its 11-character video ID. A local MP4, file path, recording ID, or video bytes are rejected. The desktop editor uses local recordings as unpublished working material. After an embeddable YouTube upload loads and its duration matches the recording, the desktop app keeps the recording's catalog metadata and chapters, then deletes the local video file.

## Combo candidate review

Approved uploaders can submit any combo with a linked local MP4. The app sends catalog-facing combo fields and the MP4. When the linked recording has processed, clip-aligned inputs, it sends that artifact and facing even if the selected facing route differs from the edited combo route. The Worker keeps the submitted combo route; older clients that omit it can still have the route derived from the artifact. If processing fails or the JSON is too large, the app reports an error instead of silently omitting available inputs. Personal status, role, tags, nickname, difficulty override, and personal notes stay on the device. The candidate is separate from the published catalog. Uploads use 8 MiB R2 multipart chunks and accept MP4s up to 2 GiB. The queue caps unfinished and pending video bytes at 50 GiB. The R2 bucket stays private.

Editors review candidates in the desktop Combos page. They can download the queued MP4 into the recording library, preview it, connect the combos YouTube account, upload it as unlisted, or reject it with an optional reason. Uploading no longer requires a separate approval action. Rejection removes the queued R2 object. A successful YouTube upload marks the candidate `uploaded` and also removes its queued R2 copy; the editor's downloaded copy remains local. If YouTube succeeds but the queue update fails, paste its URL into **Save link** to avoid uploading twice. After upload, the combo becomes a local draft and opens **Publish candidate** for catalog review. The local draft keeps that action available until publication succeeds.

Publishing a candidate-derived draft includes the candidate UUID as `sourceCandidateId` on the catalog combo. The original submitter and an editor holding a local candidate copy can match that ID on catalog refresh and move their personal tracking and recording link to the catalog combo. The Worker removes the source candidate and queued MP4 after successful publication. It also removes other candidate rows with the same character, support, route, damage, screen position, resource costs, mechanics, starter stance, and opponent compatibility. Editor names and move IDs may differ. Candidate listing reconciles older duplicate rows against published catalog combos. The Worker preserves the UUID when an older editor updates the catalog record without sending it. Existing catalog records without the field remain valid. This field does not identify the submitter.

When a candidate carries processed inputs, publication copies that versioned artifact and its selected facing into the public combo record before removing the candidate. Later catalog revisions preserve the artifact if an older editor omits it. The route remains a readable projection for existing combo displays and range notes; an editor may correct it independently after reviewing the captured inputs. Catalog lists omit the large artifact; `GET /v1/combos/:id/inputs` returns its route, selected facing, revision, and full processed artifact. The public artifact contains processed events, interpretations, edits, and source hashes, but no raw controller states.

Candidate uploads must be created with `POST /v1/editor/candidates/upload` using JSON `{ "combo": { ...catalogComboWithoutYoutube }, "fileName": "clip.mp4", "fileSize": 12345 }`. For captured inputs, add `processedInput` (the versioned `.combo-inputs.processed.json` object) and `inputFacing` (`right` or `left`). Keep `combo.route` to preserve any edit that differs from the processed route. If it is omitted, the Worker derives it from `processedInput.routes[inputFacing]`. The JSON body is limited to 512 KiB. The response includes `id`, `token`, `partSize`, and `partCount`. Send `X-Candidate-Token` on part, complete, and abort requests. Complete with `{ "parts": [{ "partNumber": 1, "etag": "..." }] }` in order. A candidate is invisible to reviewers until completion. Abandoned multipart uploads expire according to R2 lifecycle policy. The former public `POST /v1/candidates` route rejects new uploads.

Combo notes may cover the whole combo or a move range. Ranges use zero-based move positions with an exclusive `endToken`; the stored `excerpt` must match that span of the route. Segment notes cannot overlap. Older plain-string notes are accepted and converted to general notes.

Move bodies require `id`, `characterId`, `input`, and `resourceCosts` (including `pips` and `flow`). Optional fields include `label`, `supportId`, `mechanics`, move and stance flags, charge/parent links, nonstandard and not-applicable details, and numeric or `null` values for `startup`, `active`, `recovery`, `onBlock`, `blockstun`, and `hitstun`. Local evidence, recording references, and arbitrary properties are deliberately excluded from the public schema.

Set a move's `isNonAttack` flag for a stance entry that does not attack. Published combos may include `starterIsNonAttackStance` so the public table can display the stance and first followup together, such as `6F~B`, even when the move is absent from the public move catalog.

The Worker validates Access JWT signature, issuer, audience, expiry, and editor email for every editor request, even if someone bypasses the Access-protected route. The Access application should cover the editor path so approved editors can sign in. Public read endpoints allow cross-origin GET and are cached for up to 60 seconds.

## Verify

Run `node --test backend/test/worker.node-check.mjs backend/test/candidates.node-check.mjs` from the repository root. The tests use an in-memory SQLite database and an R2 test double to exercise the actual SQL statements, plus a generated signing key to check JWT validation.

Cloudflare documentation: [D1 setup](https://developers.cloudflare.com/d1/get-started/), [R2 multipart uploads](https://developers.cloudflare.com/r2/api/workers/workers-multipart-usage/), [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [Access paths](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/), [Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/).
