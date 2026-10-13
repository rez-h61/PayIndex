# PayIndex — one admin, a simple directory

**Current version:** friends open the link → choose a person → choose a label → view/save the receiving QR. No visitor accounts, Google OAuth, invitations or membership approvals. One admin signs in with email/password and manages everyone.

The interface uses the supplied Raycast reference: nearly black canvas, quiet hairline borders, neutral buttons, small coral branding, generous spacing and short fade/slide transitions. Reduced-motion preferences disable animations. Each screen has one task: directory, person, QR, admin sign-in or person editor.

## What is stored where

- **Supabase Auth:** the one admin's email and securely managed password credentials. Never store a plaintext password in an application table, `.env`, or frontend code.
- **PostgreSQL:** people's names and file references, optional external photo URLs, QR labels and timestamps. Friends are directory entries, not user accounts.
- **Supabase Storage:** uploaded photos and original QR images. Image bytes are never stored in database rows.
- **External profile photos:** optionally supply a direct HTTPS image URL instead of uploading. The browser loads it without a Referer; initials appear if the URL fails. The external host still receives the request, and it controls that photo's content/availability.
- **QR image links:** optional browser import of a direct HTTPS PNG/JPEG/WebP URL. The original bytes are validated and saved in Storage. This keeps the saved QR independent of future changes to the external link. Some hosts block imports through CORS: upload the image instead in that case. The server never fetches arbitrary URLs.

**Anyone with the link can view names, photos and QRs, and can share the link further.** `noindex` discourages search indexing; it is not access control. Only the one admin can change records. This replaces the original private membership requirement at the user's request.

## Start locally

Node 22.12+ (Node 24 recommended):

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:5173/`. The existing `.env` contains the provided Supabase URL and public publishable key. On a new checkout, copy `.env.example` to `.env` and supply your project values. No secret/service key belongs in `VITE_` variables.

Development design preview: `http://127.0.0.1:5173/?demo=1`. It is explicitly labelled, uses fictional names and non-payment placeholders, and never writes data. Login is disabled in this mode. In production the demo is excluded unless you deliberately build with `VITE_ENABLE_DEMO=true`.

## Finish Supabase setup

Google Cloud configuration is no longer needed. Disable the Google provider in Supabase if you enabled it. Keep email/password sign-in enabled and disable new user signups.

### 1. Apply the database

In Supabase **SQL Editor**, run the appropriate script:

- If you have **not run any previous PayIndex SQL**, run `supabase/setup-new.sql`. It applies both migrations in order.
- If you **already applied the original PayIndex migration**, run only `supabase/migrations/202610060002_single_admin_directory.sql`.
- If using the CLI, `supabase link --project-ref YOUR_PROJECT_REF`, then `supabase db push` applies outstanding migrations.

The upgrade preserves old profile/membership/QR records and the old private bucket as an archive, removes their client access, disables the signup trigger and original membership/QR mutation APIs. **It does not copy old private content into the public directory.** Add people and QRs afresh through the new admin interface. Do not rerun the first migration over an existing installation.

The current tables are `directory_people`, `directory_qrs`, `private.directory_admin` and `private.directory_cleanup`. RLS grants public read of directory metadata, and denies all direct client writes. The single admin mapping is a private one-row table. Signing in alone never grants admin privileges.

### 2. Create your only admin

1. Supabase **Authentication → Users → Add user → Create new user**: set your email and a strong password; confirm the email for this account. Do this directly in Supabase, not in chat. Disable public signups in Authentication settings after creating the account (dashboard administrative creation still works).
2. Run `supabase/bootstrap-admin.sql` in SQL Editor, replacing `YOUR_ADMIN_EMAIL` with that exact email. This selects an existing Auth user; it does not store their password. The singleton constraint guarantees only one configured admin.
3. Open `/admin/login` in PayIndex and sign in. There is no signup page. To recover a lost password, use your Supabase administrator access to reset the account. Do not put recovery/admin secrets in the browser.

To change the sole admin later, run the bootstrap SQL with the replacement email. The server rechecks the configured user on each mutation, so the previous user's existing session can no longer write.

### 3. Deploy the two server functions

Use the Supabase CLI from this project folder:

```sh
supabase login
supabase link --project-ref kdrjgkvwhaqougbcrwxf
supabase secrets set ALLOWED_ORIGINS="http://localhost:5173,http://127.0.0.1:5173,https://YOUR_PRODUCTION_DOMAIN" CLEANUP_SECRET="YOUR_RANDOM_SECRET_AT_LEAST_32_BYTES"
supabase functions deploy directory-manage --no-verify-jwt
supabase functions deploy directory-cleanup --no-verify-jwt
```

Replace the production origin and random cleanup secret. Supabase injects `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` on the server. `directory-manage` validates user JWTs with `getUser(token)`, verifies the sole admin, validates bytes, then calls a service-only database transaction that rechecks admin identity. Gateway JWT verification is disabled to work with publishable keys; do not remove the function's own authentication. `directory-cleanup` requires its separate secret. Do not deploy the legacy `qr-manage` function; if deployed previously, it is disabled by the upgrade's revoked database permissions and can be removed from the dashboard.

### 4. Enable automatic file cleanup

Enable `pg_cron` and `pg_net` in Database → Extensions, then run `supabase/schedule-cleanup.sql` with the project URL and the same `CLEANUP_SECRET`. The job calls `directory-cleanup` every 15 minutes. Inspect `cron.job_run_details` and `net._http_response`; alert on failures. Each run handles at most 100 files.

Normal saves/deletes also attempt cleanup immediately. Replacement uploads first, commits metadata second, then deletes old files. Deletion removes metadata and queues files atomically. Failed file deletion is visibly reported as queued cleanup. A lost commit response never causes blind deletion of the new file. Orphans older than 24 hours are cleaned; files older than one hour cannot be newly attached, and retained tombstones prevent reattachment races.

## Images and security

- Bucket `directory-assets` is private at the Storage setting level, with explicit anonymous read policies for currently referenced directory images. It is **not confidential** because the directory was intentionally made available without visitor login.
- Only the authenticated download operation is permitted; listing, signed URL creation, transforms and all direct client uploads/updates/deletes are denied. Supabase's current `storage.allow_only_operation(text)` helper is required.
- Browser and server accept PNG/JPEG/WebP up to 5 MB, maximum 40 megapixels. Server checks MIME against signatures, structure and dimensions; animated WebP is rejected. These are pragmatic format checks, not a full image decoder, malware scanner, QR decoder or ownership verification.
- QR display and Save QR use the original bytes with original proportions and whitespace. Profile photos can be cropped visually for their avatar; QRs are never cropped, recolored or decorated.
- Acknowledgement confirms that the admin has permission to share a receiving QR. It is not proof of ownership. Never upload authorization QRs. Provider labels do not guarantee interoperability.
- Mutations use the previous update timestamp to reject stale edits. Labels normalize lowercase English alphanumerics so `ACME Pay` and `acme-pay` cannot duplicate an entry for one person.
- Public content is still loaded fresh: no directory/image content in localStorage, IndexedDB or service-worker caches. Only static app assets are cached; Auth session persistence is allowed. Admin sign-out clears in-memory images and state before reloading public content. Images already saved or shared cannot be recalled.

## Deploy / install

For GitHub + Vercel, follow [DEPLOY-VERCEL.md](./DEPLOY-VERCEL.md), the step-by-step Malay guide that continues after admin bootstrap. The included `vercel.json` configures Vite builds, SPA deep links and security/cache headers on Vercel.

Run `npm run build`, publish `dist/` to an HTTPS static host. Set the public environment variables at build time and rebuild after changes. `_headers` and `_redirects` support Netlify/Cloudflare Pages; configure equivalent SPA fallbacks and headers elsewhere. Serve `/admin/*`, `/people/*`, and `/qr/*` through `/index.html`. This app assumes hosting at the domain root.

The CSP permits HTTPS image hosts for external photos and HTTPS fetches for QR import. Scripts stay restricted to the app origin. Do not add a caching proxy in front of API/Storage responses. HTML, manifest and service worker use no-cache; only fingerprinted static assets may be immutable.

Android/desktop: browser Install app menu. iPhone/iPad: Safari → Share → Add to Home Screen. The manifest includes dark theme colors and maskable PNGs. The static-only service worker shows an offline state; loading directory content requires a connection. Updates are user-triggered and disabled during an open editor. Short page transitions respect reduced motion.

## Verification

```sh
npm test
npx tsc -p tsconfig.edge.json
npm run build
npm run test:e2e
```

On Windows browser tests use installed Chrome. On other platforms install Chromium with `npx playwright install chromium`, or choose an installed browser with `PLAYWRIGHT_CHANNEL=chrome` / `msedge`. Tests cover public browsing, a separately labelled admin UI fixture, form validation, photo links, QR replacement, original-byte download, destructive confirmations, keyboard access, reduced motion and offline caches.

`npm run test:backend` runs real REST/Storage/Edge checks against a **staging** project when `TEST_SUPABASE_URL`, `TEST_SUPABASE_PUBLISHABLE_KEY`, `TEST_ADMIN_EMAIL`, `TEST_ADMIN_PASSWORD` and `PAYINDEX_STAGING_TEST=true` are supplied in the shell. The staging admin must already be bootstrapped; only records created by that run are deleted. Never use your production directory for fixture tests.

Read `TESTING.md` for the verification record and outstanding live-service/device checks. Change the name in `src/config.ts`, `vite.config.ts` and `index.html`; regenerate icons using `node scripts/icons.mjs` after editing the icon design.

## Optional DuitNow account number

Each QR can include an optional numeric DuitNow account number for manual transfers. Visitors can copy it from the QR page, marked Transfer only. Leaving it blank hides the section. Leading zeros are preserved. This is a displayed transfer detail; PayIndex does not initiate or enforce transfers in banking apps.

Existing installations: apply `supabase/migrations/202610120001_optional_duitnow_account.sql` and redeploy the `directory-manage` Edge Function before deploying the updated frontend. Fresh installations can use the regenerated `supabase/setup-new.sql`.

Existing payment options can be edited without uploading their QR again. A new payment option still requires an image. Apply `supabase/migrations/202610120002_edit_qr_without_upload.sql` and redeploy `directory-manage` before deploying this frontend. The optional field is labelled Transferable account number in the English UI.

## Clean QR rendering

Existing and new QR images are processed locally when previewed or viewed. A Web Worker detects a single readable QR and generates a fresh black-and-white module grid with eight modules of white padding. Numeric and alphanumeric segments retain their text and encoding modes; byte segments retain the original bytes without a Unicode round trip. The result is decoded again and must match the source raw bytes, decoded text, and segment structure before being used. The same verified matrix produces the SVG preview and a PNG rendered at eight pixels per module.

Original uploads and storage paths stay unchanged. The primary Save QR button downloads the verified Clean QR PNG when available, otherwise the original image. More options contains View original, Save original, Download SVG (when available), and Open original image. Viewing the original reveals Back to clean QR. No database migration, Edge Function deployment, or bulk rewrite is needed. Deploy the updated frontend to enable it.

Unreadable images, multiple detected QRs, failed verification, oversized payloads, and unsupported encodings (including ECI and Kanji) retain the original image. Detection uses a maximum 1600-pixel working image and a 20-second worker deadline. Payloads are not logged, followed as URLs, or sent to another service; generated images stay in memory. Original expiry or transaction restrictions are not changed. These checks verify data preservation, not acceptance by every banking application; scan-test Clean QR with the intended bank apps before relying on it.

Uses [jsQR](https://github.com/cozmo/jsQR) for decoding and [node-qrcode](https://github.com/soldair/node-qrcode) for generation.

## Per-QR design customization (admin)

Open a receiving QR, then More options -> Customize QR. Only the directory admin sees this action. Choose Classic, PayIndex, Midnight or Cyber; Square, Rounded, Dots or Classy modules; and optionally embed the PayIndex app icon. Save design stores settings on that QR only. Reset to default Clean QR removes that row's custom style. Existing uploads are kept unchanged, and no image re-upload is needed.

A generated preview must decode to the same raw bytes, text and segment structure after the SVG's colours, curves and embedded logo have been rasterized. That verified raster is also the downloadable PNG. Rounded modules join smoothly at neighbouring edges, Dots use individual circles, and Classy rounds selected exposed corners. Finder eyes use square, rounded or circular rings to match the selected shape; timing/alignment and format/version modules remain square, the white quiet zone stays intact, and logo variants use high error correction with a small badge. A preview that fails verification cannot be saved through the editor. Viewers recheck the saved style; if it cannot be verified on their device, they fall back to the standard Clean QR, then the original if necessary. Test with the intended banking app; library decode checks do not prove acceptance by every banking app.

Existing installations must apply `supabase/migrations/20261013060157_per_qr_design.sql`, deploy the updated `directory-manage` function (including `_shared/qr-style.ts`), then deploy the frontend. In Supabase SQL Editor, run the full migration and confirm success before updating the frontend. Do not rerun setup-new.sql on existing installations. The migration adds qr_style and a service-only admin-checked RPC with stale-update protection, while public read access inherits the existing directory policy. No shortlink feature is included.

The vector master for the PayIndex logo now lives at `src/assets/payindex-icon.svg`. Header/favicon/home-screen assets and the embedded QR badge derive from that source; regenerate standalone icons with `node scripts/icons.mjs` after changing it.

## QR worker loading after deployment updates

The QR worker is bundled inline with the application, so a cached app cannot request a removed hashed worker file from another deployment. CSP permits same-origin and blob workers (script-src remains self only). Online service-worker navigation fetches the current public app shell; offline navigation uses the precached shell and its matching assets. Navigation URLs, API responses and payment images are not added to the cache. This increases the main bundle in exchange for avoiding a separate worker asset/version dependency. After deploying this update, hard-refresh an already-open tab to leave the old cached app version.

The hosted PayIndex project received the per-QR design migration and directory-manage version 4 on 13 October 2026. `20261013084229_restrict_directory_mutate_execute.sql` also restores the service-only mutation RPC permission expected by the code, for installations that created the new overload manually. Apply outstanding migrations on other installations; avoid rerunning already-applied manual SQL.

## 15 QR colours and directory-wide actions

Customize QR now offers 15 presets: Classic, PayIndex, Midnight, Cyber, Pink, Crimson, Coral, Amber, Olive, Forest, Teal, Ocean, Indigo, Violet and Plum. Pink is sampled directly from the supplied reference: #ED3068 for both modules and finder eyes. Existing presets remain compatible.

Admin-only directory actions appear in Customize QR. Apply this design to all QRs freezes the current colour/shape/logo choice, checks every original sequentially, and shows a separate confirmation screen. Every QR must pass actual rendered scan verification before applying; failures are listed and block all writes. Back preserves the draft; Cancel changes nothing. Reset all QRs to default has a separate confirmation and clears all custom settings, restoring the standard Clean QR without changing original images or account details.

The server saves a bulk operation in one transaction. Its complete ID/timestamp snapshot must still match the directory, including inserts/deletions; otherwise all changes are rejected and the admin must refresh. Bulk operations currently support up to 5,000 records and only records visible in the loaded directory can form a complete snapshot. The RPC is service-only, with the sole admin rechecked inside the transaction.

Migration `20261013085314_qr_palette_and_bulk_style.sql` and directory-manage version 5 were applied to the hosted PayIndex project on 13 October 2026. No live bulk design changes were performed as part of deployment. Deploy the frontend for the new controls. Other installations must apply that migration and deploy the updated function and shared palette module first.
