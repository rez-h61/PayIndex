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
