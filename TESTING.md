# Verification — single-admin revision

6 October 2026, Asia/Kuala_Lumpur. This supersedes the original Google/membership UI verification report.

## Verified locally

- React/TypeScript/Vite production build, manifest and generated service worker.
- Edge Function TypeScript checks with local Deno declarations.
- **20 unit/PostgreSQL tests:** four name/label/URL/image validation tests; eight original migration regression tests; eight new single-admin migration tests. The new tests apply both actual migrations to PGlite PostgreSQL with Supabase Auth/Storage schema/helper stubs.
- New database coverage: one-admin constraint, no automatic friend accounts, exact admin lookup, rejected anonymous/authenticated direct writes and spoofed RPC actors, anonymous read of new directory content, archived legacy/email privacy, normalized unique labels, linked-file-only Storage reads, denied signing/listing, optimistic concurrency, durable cleanup, HTTPS avatar URLs, and cascading deletion.
- **10 browser checks across 375 × 812 and 1280 × 900:** no-login directory → person → QR, search, back navigation, separate admin login, keyboard entry, dialog dismissal, offline clearing, reduced motion, production static service-worker installation/offline reload, icon/manifest configuration, and cache contents.
- The admin workflow tests use **explicit test-only backend fixtures**: email/password sign-in, add person with linked photo, upload original PNG, preview, save QR, compare downloaded bytes, replace via image-link import, delete QR/person with confirmations and sign out. Chromium interception omits multipart file payloads, so the fixture captures the selected File's bytes in the browser before sending and returns those exact bytes as its Storage response. This tests the UI transport/save path; it does not prove a hosted Supabase upload.
- Mobile and desktop screenshots were visually inspected. The directory is restrained and readable; white QR space retains original proportions; profile thumbnails can use object-fit cover; reduced motion removes transitions.

## Still requires live configuration

The provided project URL/publishable key are present locally, but this revision's migrations/functions have **not** been applied to the user's hosted Supabase project, and no admin password was supplied or created. Real admin authentication, anonymous Storage downloads through Supabase's gateway, deployed Edge Function execution and scheduled cleanup therefore remain unverified.

`npm run test:backend` is a staging-only real endpoint suite. It requires a pre-created, bootstrapped admin and shell variables documented in README. It tests anonymous reads/denied writes, spoofed RPC rejection, byte validation, original downloads, signed-URL denial, simultaneous replacements, stale deletion and removed-file access. It cleans up only the person it created. It has not been run against the live project.

After deployment, verify failed upload/commit/deletion recovery with network interruption; inspect the cleanup job; test original JPEG/WebP as well as PNG; test external image hosts with and without CORS; test sign-out and admin replacement with another open session; and test native iOS/Android install/share/save plus the two-version update prompt.

Format validation is bounded and structural, not a full decoder or verification of QR ownership. Directory links are intentionally public and can be forwarded. Saved images cannot be recalled. External profile photo hosts control their own content and uptime. QR imports copy the original file into Storage and may require a manual upload when the source site blocks CORS.

## Optional DuitNow account - 12 October 2026

Production build (including service worker) and frontend/Edge Function TypeScript checks passed. The database suite passed with migration 003 applied, including numeric validation, leading-zero preservation, public reads and clearing the optional account. All 21 tests passed before the extra validator case was added; the final validation suite then passed all 5 cases. Mobile and desktop admin browser fixtures passed (2/2) using temporary fixture Supabase environment values. The browser flow checks add, persisted edit value, transfer-only display and hiding the section after clearing. Hosted deployment remains unapplied.

## Edit existing QR without uploading - 12 October 2026

All 22 unit/database tests passed with the fourth migration applied. Existing account edits retain the original storage path even when its upload is older than the one-hour new-upload window. Mobile and desktop admin fixture tests passed (2/2): a new entry requires an image, existing image previews load, account details can be cleared without upload, and image replacement still works. Production/PWA build and Edge Function TypeScript checks passed. UI account wording is Transferable account number; date formatting uses English. Deployment requires migration 202610120002 and the updated directory-manage function.

## Automatic QR framing - 13 October 2026

27 unit/database tests passed, including five QR-format cases: bank-style screenshots with QR versions 1, 5, and 10; exact payload preservation and unchanged input pixels; white borders; unreadable images; and multiple-code fallback. Frontend TypeScript and production/PWA build passed with a separate worker chunk. Mobile and desktop browser fixture flows passed: existing image download, automatic square crop, original/formatted toggle, and downloads of both original and formatted PNG. Admin add/edit/replace regression checks passed on both viewports. The first mobile QR test timed out during download while the build was running; the focused rerun passed on both viewports in four seconds each. Mobile screenshot was visually inspected. These are fictional QR fixtures, not live bank-app scanner or real payment tests. Original storage and backend writes are unchanged; production frontend deployment remains outstanding.

## Clean QR regeneration - 13 October 2026

34 unit/database tests passed. Seven new cases cover numeric data with leading zeros, alphanumeric data, fictional payment-style data, URLs, UTF-8 text, mixed segments with non-UTF-8/null bytes, and unreadable/multiple-code fallback. Generated QR data is compared by raw bytes, decoded text and segment structure. Generated pixels are strictly opaque black or white, input pixels are unchanged, and SVG contains generated geometry without payload text. Production TypeScript/PWA build passed with QR generation isolated in the worker. Browser fixture checks verify rasterized SVG and downloaded PNG decode to the fictional source payload, original downloads remain byte-for-byte identical, SVG downloads work, and original/clean toggling works. This supersedes auto-crop as the displayed derivative; real banking-app acceptance remains untested.

## Compact QR actions - 13 October 2026

Four browser fixture checks passed across mobile and desktop. Secondary actions are hidden by default in More options. View original and Back to clean QR switch views, Save original preserves the uploaded bytes, Save QR downloads a decodable Clean QR PNG when available, and SVG download remains available in the expanded menu. Admin regression covers original-image fallback and downloads when Clean QR cannot be generated. Mobile screenshot was visually inspected. QR generation and backend logic are unchanged.

## PayIndex P / index-tab identity - 13 October 2026

Draft D was rebuilt as vector geometry, used by the header and favicon. scripts/icons.mjs renders that same master through Chrome at native 192px/512px app icon and 180px Apple touch sizes; the maskable icon uses a full dark background with the foreground inside the central safe area. Production/PWA build and eight mobile/desktop browser checks passed. The 512px icon and mobile header screenshot were visually inspected. Updated assets require frontend deployment; installed home-screen icons may refresh on the operating system/browser schedule.

## Per-QR styled designs - 13 October 2026

The existing unit suites passed (34 cases), and the expanded database suite passed all 10 cases after the reset fixture was corrected to use SQL NULL rather than JSON null. New database checks cover strict design schema validation, denied anon/authenticated RPC calls, non-admin actor rejection, single-row isolation, unchanged original storage paths, public design reads, stale updates and reset. The actual migration was applied to PGlite; existing hosted data has not been changed.

Browser fixtures passed on mobile/desktop for admin-only customization, preview verification, save without file upload, persisted style after reload, anonymous visitor rendering without customization controls, another QR retaining default style, default reset, and disabling Save design for an unreadable original. The saved styled PNG and rendered SVG decode to the fictional source payload. All 32 palette/shape/logo combinations passed actual SVG raster/decode verification on a fictional payment-style payload; this matrix runs once on desktop. Existing admin and clean-QR browser regressions passed. Final dialog layout was inspected on mobile. Production/PWA build and frontend/Edge Function TypeScript checks passed. Real bank-app scan acceptance, hosted migration and Edge Function deployment remain outstanding.
