# Labatar catalog backend

This folder is a Cloudflare Worker backed by D1 and an R2 bucket for combo candidate MP4s. Published moves and combos are publicly readable. Upload and editor routes require a valid Cloudflare Access JWT and an approved email in D1 or the private `EDITOR_EMAILS` Worker secret. Editors can also publish and review candidates.

The desktop app has a public Combos page that fetches published records from this Worker and saves an offline snapshot in IndexedDB. Players can also keep local combos and personal tracking on their device. Existing drafts are not published automatically; select a combo and choose **Publish combo** to publish it.

The desktop reader uses `https://labatar-catalog.landenhanni.workers.dev` by default. Set `VITE_CATALOG_API_URL` before starting the app to point it at a local Worker, for example `http://localhost:8787`. The override is a public build-time setting, not a credential. Direct publishing is enabled only when the reader targets the hosted catalog; the app sends editor writes to that same hosted Worker.

## Discord candidate alerts

The Worker can post to a private Discord channel when a combo MP4 finishes uploading and enters the pending review queue. It sends the character, support, route, and candidate ID. It does not send the MP4, submitter identity, local file path, or upload token. A retry of an already completed upload does not send another alert. Discord delivery is best effort: a failed alert is logged and does not fail the candidate upload.

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

## Combo publisher

The publisher supports an optional public combo name, editor difficulty from 1 to 5, and an editor-pick context and reason. Deploy this Worker update before publishing those fields from the new Combos page.

After deploying the Worker, open `https://labatar-catalog.landenhanni.workers.dev/v1/editor/app` in a browser. The existing Access application path `/v1/editor/*` should prompt for sign-in before the page loads. The Worker also checks the Access JWT and editor role for the page, its script and stylesheet, and every editor API request. The page and API share an origin, so the browser can use the Access session without a cross-origin editor request.

Create a combo by entering its lowercase slug IDs, notation, damage, costs, mechanics, and a YouTube URL. A local MP4 can be selected for reference and plays only in the browser; neither the file nor its path is sent to the Worker. Form fields are saved as a draft in that browser's local storage, but the selected video file must be reselected after a reload. Review the JSON preview, then select **Publish combo**. Existing combos can be loaded, revised, or unpublished from the same page. Publishing requires a YouTube link; the public API stores its video ID.

In the development build of the desktop app, select a local combo in **Tech editor** and choose **Publish combo**. If needed, sign in to Cloudflare Access in the app's sign-in window. The app displays the combo and any route-link warnings for confirmation, then submits the combo to the editor API using the current revision. The request includes combo metadata and the linked recording's YouTube URL; it never uploads the local recording or analysis evidence. A YouTube link is required. Route entries without matched move IDs are flagged for review; move IDs can remain empty for a route whose moves have not yet been published.

The publisher uses revision headers for safe edits. A conflict means another editor changed the record; reload the editor list and review the latest version before publishing again. Public reads may remain cached for up to 60 seconds after a publish or unpublish action.

## Cloudflare setup

1. Install or run Wrangler with Vite+: `vp dlx wrangler --version`, then log in with `vp dlx wrangler login` from this directory.
2. Create a D1 database with `vp dlx wrangler d1 create labatar-catalog`. Put the returned `database_id` in `wrangler.toml`; keep `binding = "DB"` because the Worker uses `env.DB`.
3. Enable R2 in the Cloudflare dashboard for this account, then create the private bucket with `vp dlx wrangler r2 bucket create labatar-combo-candidates`. Keep `binding = "CANDIDATE_VIDEOS"` in `wrangler.toml` and do not enable public bucket access. Cloudflare error 10042 means R2 still needs to be enabled for the account.
4. Apply `schema.sql` with `vp dlx wrangler d1 execute labatar-catalog --remote --file schema.sql`. It creates any missing catalog tables, including `catalog_youtube_upload_access`, without changing existing catalog records. Older review clients may have stored an approval marker in the `rejection_reason` field; the current upload path no longer requires it. Rejected candidates continue to use that field for the editor's reason.
5. This Worker uses the `landenhanni.workers.dev` account subdomain. With `name = "labatar-catalog"` and `workers_dev = true`, its expected URL is `https://labatar-catalog.landenhanni.workers.dev`. No custom domain or change to the GitHub Pages site is needed.
6. In Cloudflare Zero Trust, create a self-hosted Access application for **only** `labatar-catalog.landenhanni.workers.dev/v1/editor/*`. Enable One-time PIN and attach a dedicated **Allow** policy with **Include → Login Methods → One-time PIN**. Keep any existing owner policy needed for another login method. Never use **Bypass**, which would prevent the Worker from receiving a verified identity. Do not protect the entire Worker because its read endpoints and candidate submission are public.
7. In Cloudflare **Workers & Pages → labatar-catalog → Settings → Variables and Secrets**, set `ACCESS_TEAM_DOMAIN` to the Access team name, `ACCESS_AUD` to the application Audience (AUD) tag, and `EDITOR_EMAILS` to the fixed owner email(s). Set each as a Secret. These values are not stored in `wrangler.toml`; its `[secrets]` section names the required bindings without exposing their values. Remove any old `COMBO_PREVIEW_ACCESS_MODE` secret. Alternatively, use `vp dlx wrangler secret put <NAME>` for each binding. Keep local `.dev.vars` files out of Git.
8. Deploy with `vp dlx wrangler deploy`. Existing Worker secrets are preserved by deploy. Check `GET https://labatar-catalog.landenhanni.workers.dev/health` and `GET https://labatar-catalog.landenhanni.workers.dev/v1/combos`.

If `vp dlx wrangler` stops with `ERR_PNPM_IGNORED_BUILDS` for `esbuild` and `workerd` on Windows, use `pnpm.cmd dlx --allow-build=esbuild --allow-build=workerd wrangler <command>` instead for each Wrangler command above. For example, run `pnpm.cmd dlx --allow-build=esbuild --allow-build=workerd wrangler login`. The `.cmd` launcher also avoids PowerShell's script execution policy for `pnpm.ps1`.

The configured Access team name and audience must match the Access application. The owner list stays in the Worker secret. Everyone else is managed one person at a time through the private admin page and D1. No Cloudflare credentials, email lists, or user secrets belong in the repository.

After deployment, verify `GET /health` returns `{"ok":true,"features":{"comboNotes":true,"comboCandidates":true}}`. This confirms the deployed Worker accepts combo notes and has candidate video storage. Check the public `GET /v1/moves` and `GET /v1/combos` routes too. Open `/v1/editor/moves` in a browser: Access should prompt for sign-in, then the Worker should return an editor list for an approved editor. If the public routes prompt for sign-in, the Access application covers too broad a path. If the editor route still returns HTTP 401 after sign-in, check the Access team name, audience, and allowed email.

For local database work, run `vp dlx wrangler d1 execute labatar-catalog --local --file schema.sql` and `vp dlx wrangler dev`. The local Worker still requires a real Access JWT to write; the unit tests exercise writes with a test identity.

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
| GET            | `/v1/editor/candidates/:id/video`                 | Editor       | Download the submitted MP4                                        |
| POST           | `/v1/editor/candidates/:id/approve`               | Editor       | Legacy approval endpoint for older desktop clients                |
| POST           | `/v1/editor/candidates/:id/reject`                | Editor       | Reject and remove the queued MP4                                  |
| POST           | `/v1/editor/candidates/:id/uploaded`              | Editor       | Save a pending candidate's YouTube URL                            |

Create with `If-None-Match: *`. Update or unpublish with `If-Match: "<revision>"` using the latest revision returned by the editor list. A stale revision returns HTTP 409. Record IDs, character IDs, support IDs, move IDs, and resource keys are lowercase slugs.

Example combo body for `PUT /v1/editor/combos/aang-basic`:

```json
{
  "id": "aang-basic",
  "characterId": "aang",
  "supportId": "gyatso",
  "route": "2A > 5B > 236A",
  "routingMode": "autopilot",
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

The API validates the YouTube URL and stores only its 11-character video ID. A local MP4, file path, recording ID, or video bytes are rejected. The desktop editor uses local recordings as unpublished working material. After an embeddable YouTube upload loads and its duration matches the recording, the desktop app keeps the recording's catalog metadata and chapters, then deletes the local video file.

## Combo candidate review

Approved uploaders can submit any combo with a linked local MP4. The app sends a snapshot of catalog-facing combo fields and the MP4, while personal status, role, tags, nickname, difficulty override, and notes stay on the device. The candidate is separate from the published catalog. Uploads use 8 MiB R2 multipart chunks and accept MP4s up to 2 GiB. The queue caps unfinished and pending video bytes at 50 GiB. The R2 bucket stays private.

Editors review candidates in the desktop Combos page. They can download the queued MP4 into the recording library, preview it, connect the combos YouTube account, upload it as unlisted, or reject it with an optional reason. Uploading no longer requires a separate approval action. Rejection removes the queued R2 object. A successful YouTube upload marks the candidate `uploaded` and also removes its queued R2 copy; the editor's downloaded copy remains local. If YouTube succeeds but the queue update fails, paste its URL into **Save link** to avoid uploading twice. After upload, the combo becomes a local draft and opens **Publish candidate** for catalog review. The local draft keeps that action available until publication succeeds.

Publishing a candidate-derived draft includes the candidate UUID as `sourceCandidateId` on the catalog combo. The original submitter and an editor holding a local candidate copy can match that ID on catalog refresh and move their personal tracking and recording link to the catalog combo. The Worker removes the source candidate and queued MP4 after successful publication. It also removes other candidate rows with the same character, support, route, damage, screen position, resource costs, mechanics, and starter stance; editor names and move IDs may differ. Candidate listing reconciles older duplicate rows against published catalog combos. The Worker preserves the UUID when an older editor updates the catalog record without sending it. Existing catalog records without the field remain valid. This field does not identify the submitter.

Candidate uploads must be created with `POST /v1/editor/candidates/upload` using JSON `{ "combo": { ...catalogComboWithoutYoutube }, "fileName": "clip.mp4", "fileSize": 12345 }`. The response includes `id`, `token`, `partSize`, and `partCount`. Send `X-Candidate-Token` on part, complete, and abort requests. Complete with `{ "parts": [{ "partNumber": 1, "etag": "..." }] }` in order. A candidate is invisible to reviewers until completion. Abandoned multipart uploads expire according to R2 lifecycle policy. The former public `POST /v1/candidates` route rejects new uploads.

Combo notes may cover the whole combo or a move range. Ranges use zero-based move positions with an exclusive `endToken`; the stored `excerpt` must match that span of the route. Segment notes cannot overlap. Older plain-string notes are accepted and converted to general notes.

Move bodies require `id`, `characterId`, `input`, and `resourceCosts` (including `pips` and `flow`). Optional fields include `label`, `supportId`, `mechanics`, move and stance flags, charge/parent links, nonstandard and not-applicable details, and numeric or `null` values for `startup`, `active`, `recovery`, `onBlock`, `blockstun`, and `hitstun`. Local evidence, recording references, and arbitrary properties are deliberately excluded from the public schema.

Set a move's `isNonAttack` flag for a stance entry that does not attack. Published combos may include `starterIsNonAttackStance` so the public table can display the stance and first followup together, such as `6F~B`, even when the move is absent from the public move catalog.

The Worker validates Access JWT signature, issuer, audience, expiry, and editor email for every editor request, even if someone bypasses the Access-protected route. The Access application should cover the editor path so approved editors can sign in. Public read endpoints allow cross-origin GET and are cached for up to 60 seconds.

## Verify

Run `node --test backend/test/worker.node-check.mjs backend/test/candidates.node-check.mjs` from the repository root. The tests use an in-memory SQLite database and an R2 test double to exercise the actual SQL statements, plus a generated signing key to check JWT validation.

Cloudflare documentation: [D1 setup](https://developers.cloudflare.com/d1/get-started/), [R2 multipart uploads](https://developers.cloudflare.com/r2/api/workers/workers-multipart-usage/), [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [Access paths](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/), [Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/).
