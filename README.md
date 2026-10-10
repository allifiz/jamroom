# JAMROOM ✳

**Your friends. Your music. Same frequency.** A persistent social listening app built with Next.js App Router, TypeScript, Tailwind 4, a customized shadcn-style Radix Button, Lucide, Motion, Supabase Auth/PostgreSQL/Realtime, Zod, dnd-kit, and the official YouTube IFrame API. Deploy the Next.js app to Vercel; Supabase runs the database and realtime infrastructure. No custom always-on application server, extracted audio, or filesystem persistence.

## Start locally

Requirements: Node.js 22+ (validated with Node 24), npm, and either a hosted Supabase project or Docker + Supabase CLI for the optional local backend.

```sh
npm ci
cp .env.example .env.local
# Fill NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.
npm run dev
```

Without Supabase configuration, the landing page works and application routes show a setup notice. There are no mock rooms or fallback playlists.

### Hosted Supabase

1. Create a Supabase project. Apply all SQL files in `supabase/migrations` in filename order using the SQL editor, or use `supabase link --project-ref YOUR_REF` followed by `supabase db push`. Apply this migration once to a fresh project; it includes the Realtime publication and RLS policies.
2. Copy the project URL and **anon/publishable client key** into `.env.local`. Never place a service-role key in a `NEXT_PUBLIC_` variable. This app needs no service-role key.
3. Auth → Providers: enable email/password and **anonymous sign-ins** for quick nickname listening and public discovery. Guest accounts cannot create rooms. They can upgrade their identity to an email account through Register.
4. Auth → URL Configuration: set Site URL to your application origin. Allow `https://YOUR_DOMAIN/dashboard` and `https://YOUR_DOMAIN/profile` (and local equivalents). These handle email confirmation and password-reset links. For production, enable email confirmation, configure SMTP, configure CAPTCHA/abuse controls, and use confirmed dedicated accounts for integration tests. Local test configuration disables email confirmation.
5. Realtime: enable service/publication access and private Broadcast/Presence channel authorization. The migrations add policies on `realtime.messages`. Do not turn off RLS to get realtime working.
6. If using a custom avatar URL, choose an HTTPS image host that your browser can reach. Images load directly; this app does not proxy arbitrary remote images.

### Lightweight local backend (validated in this cloud workspace)

```sh
npm run backend:start
npm run dev
# Stop services without deleting records:
npm run backend:stop
```

This starts the official Supabase Auth and Realtime images, PostgREST, PostgreSQL 17, and Kong on loopback using `dev/compose.yml`. It generates real local signing/database keys in ignored `dev/.env`, applies the actual migrations on a fresh database, and creates `.env.local` only if absent. It never overwrites hosted configuration or resets an existing database. Anonymous listening and email registration work locally; email confirmation is disabled and SMTP delivery is not configured. **Development only. Do not deploy this Compose file to production.** Vercel uses hosted Supabase.

Docker volume `jamroom-dev_data` contains local records; restarting services preserves it. Never remove that volume unless intentionally deleting local data. The helper checks an existing schema and requests explicit migrations when necessary rather than silently resetting it. This smaller stack avoids the very large Supabase CLI database image on Docker’s VFS driver. The frontend uses database-triggered Broadcast and Presence; the optional local stack does not include wal2json, Storage, Studio, or SMTP.

### Optional local Supabase

```sh
# Install the official Supabase CLI following https://supabase.com/docs/guides/cli
supabase start -x studio,imgproxy,edge-runtime,logflare,vector,supavisor,postgres-meta,storage-api,mailpit
# On networks that permit Docker Hub but block ECR:
# SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io supabase start -x ...
```

`supabase/config.toml` enables anonymous accounts and local redirect URLs. Copy only the local API URL and anon key from `supabase status` to `.env.local`. The CLI automatically applies migrations on first startup. Running `supabase db reset` destroys local test data; do not use it on an existing workspace without intentionally accepting that loss. Docker database volumes persist across container restarts, but cloud publication does not guarantee restoration of Docker volumes. Use a hosted project for durable deployed rooms.

## Environment variables

| Variable                                  | Required                 | Purpose                                                                   |
| ----------------------------------------- | ------------------------ | ------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`                | Yes                      | Supabase project HTTPS URL; local development can use the local API       |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`           | Yes                      | Public client key; data access is protected by RLS and authenticated RPCs |
| `YOUTUBE_DATA_API_KEY`                    | Optional                 | Server-only YouTube Data API v3 key for duration/channel metadata         |
| `E2E_USER_A_EMAIL`, `E2E_USER_A_PASSWORD` | Hosted integration tests | Confirmed dedicated owner test account                                    |
| `E2E_USER_B_EMAIL`, `E2E_USER_B_PASSWORD` | Hosted integration tests | Confirmed dedicated listener test account                                 |
| `JAMROOM_LIVE_TESTS=1`                    | Integration tests        | Explicitly opts into real database mutations                              |
| `JAMROOM_YOUTUBE_TESTS=1`                 | Live player E2E          | Opts into playback checks requiring working YouTube embeds                |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`     | Optional                 | Use an installed Chromium instead of Playwright’s browser download        |

The optional YouTube key needs **YouTube Data API v3 enabled** and appropriate server/API restrictions. Without it, metadata comes from the official YouTube oEmbed endpoint. If metadata cannot be fetched, the queue stores a safe video-ID label and official thumbnail, and the visible iframe determines playability. No scraping or unofficial stream extraction. Playlist URL bulk import is intentionally unsupported.

## What works

- Permanent account ownership, profile names/avatars, anonymous nickname guests, email account upgrades, sign-in/register/sign-out, and password reset/change.
- Multiple permanent public/private rooms with collision-resistant slugs, description, color identity, share links, discover/my/recently-joined lists, and live online counts.
- PostgreSQL-backed YouTube queue: URL validation, metadata, duplicate handling, keyboard/pointer drag reorder, search, remove, track selection, and reactive queue updates.
- Visible official YouTube player, explicit Join & Listen, local volume, seek, play/pause, next/previous, shuffle, repeat song/playlist, end advancement, embed failure notice and skip.
- Shared server-clock playback snapshots, atomic version compare-and-swap, private realtime events, reconnect snapshot recovery, drift correction, tab-specific listener leases.
- Private room invites, owner-only settings/delete, configurable participant rights and per-member DJ/queue grants. The owner never needs to stay connected.
- Room chat (last 100 messages), online avatars, emoji broadcasts, and last 50 played records (12 shown).
- Neo-brutal arcade art direction, self-hosted Google Fonts, mobile layout, reduced-motion support, tactile controls, toasts, skeletons, empty/error states, and creation confetti.

## Data and authority

`profiles`, `rooms`, `room_members`, `playlist_items`, `room_playback_states`, `room_messages`, `playback_history`, and `room_listener_leases` live in PostgreSQL. React renders snapshots. Local storage is used by Supabase for auth session persistence and by the player for volume; it is never the queue or room source of truth.

Database triggers call the official `realtime.broadcast_changes` function after mutations, so every client (including external API clients) notifies authorized private room subscribers. Broadcast payloads trigger database snapshot reads; they never replace authoritative records. No wal2json-based Postgres Changes subscription is required for the app.

Critical mutations use `SECURITY DEFINER` RPCs with fixed search paths and explicit authenticated permission checks. Table-level queue/playback writes are revoked from clients. Ownership is never client-editable. Room membership cannot self-promote. Cross-room reorder/selection is rejected. Playlist operations lock the room row and defer position uniqueness until commit. Playback commands lock the same room and compare `state_version`; competing Next/end events against the same version cause one update and one conflict response, rather than a double-skip. Settings updates are restricted by RLS and column-level grants.

Playback writes happen on user commands and listener heartbeat transitions, never every second. While playing, position is `position_seconds + elapsed_since_server_playback_started_at`, with an offset estimated from authoritative RPC timestamps. Clients reconcile after realtime notifications and every 20-second listening heartbeat. Local player drift correction uses the API without database writes. Native YouTube controls are local; use the JAMROOM controls to change the shared session. Reactions are transient and never authoritative. Presence deduplicates tabs by authenticated user ID; leases distinguish tabs to avoid one tab stopping another.

When the final listener leaves cleanly, playback pauses atomically. If tabs crash, the next heartbeat detects leases older than 45 seconds and freezes at the final recorded heartbeat, rather than accumulating days of empty-room time. This can conservatively lose up to roughly one heartbeat interval (20 seconds) after a crash. No cron, server audio, or owner device is necessary. Browser background timer throttling can cause an inactive tab’s lease to expire; returning to the visible tab recovers via a heartbeat. Room and playlist records are never deleted by presence, disconnect, or lease cleanup.

YouTube loading and autoplay may be blocked by browser policy, extensions, network access, creator embedding policy, region, or video availability. The app does not bypass these restrictions or claim reliable background audio. A blocked video does not remove persistent queue records.

## Tests

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run test:sql                    # Docker; real PostgreSQL SQL/RLS/CAS assertions
npx playwright install chromium
npm run test:e2e -- e2e/public.spec.ts
# Or use a preinstalled browser:
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e
```

`test:sql` creates an isolated PostgreSQL 17 container with no network, applies the actual migrations, checks database persistence/permissions/concurrency/empty-room recovery, and removes only its own container. Supabase auth claim functions and the Realtime schema are a clearly identified harness in this test, not a replacement for the live Supabase tests.

Real integration tests use actual Supabase Auth and database records, never mocks. Set variables in your shell or use Node’s env-file support:

```sh
JAMROOM_LIVE_TESTS=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts
JAMROOM_LIVE_TESTS=1 node --env-file=.env.local node_modules/@playwright/test/cli.js test e2e/live.spec.ts
# Also opt into official iframe position checks only when YouTube is reachable:
JAMROOM_LIVE_TESTS=1 JAMROOM_YOUTUBE_TESTS=1 node --env-file=.env.local node_modules/@playwright/test/cli.js test e2e/live.spec.ts
```

With no dedicated E2E accounts, integration tests register randomly named test accounts; this requires disabled email confirmation (appropriate for local development). With hosted Supabase, provide all four E2E account variables. Tests delete only rooms they create; test auth accounts remain when created without admin access. Use a dedicated test project. Playwright traces can contain test-account information; do not publish trace artifacts. Without opt-in/configuration these suites are **skipped, not passed**.

Persistence checks explicitly query the database after refresh/reopened browser. Owner-offline checks use a distinct account. Concurrency checks race actual RPCs. The optional YouTube test compares API-reported player positions, not merely UI counters. CI does not imply live services work.

## Deploy to Vercel

1. Push this repository to GitHub and import it into Vercel as a Next.js project. Use Node 22 or 24; default build command is `npm run build`. Commit `package-lock.json`.
2. Configure the two public Supabase variables and optional server-only YouTube key in the correct Vercel environments. Public values are baked into the browser bundle, so rebuild after changing them.
3. Apply the migration to the hosted Supabase project before testing rooms. Set Supabase auth Site URL and redirect allowlist to your deployed origin.
4. Deploy. Verify registration/email confirmation, guest join, a permanent room with five songs, reload/reopen persistence, an owner-offline participant session, two-browser pause/seek/skip, private access denial, and an actual audible YouTube embed.
5. Set up error monitoring, database backups/retention, SMTP delivery, CAPTCHA/auth abuse controls, and dependency/security updates appropriate to your traffic before public launch.

No deployment is performed by the repository or setup scripts. Never use the local Docker URL for Vercel. No Vercel Function holds persistent room state.

## Important limits

No bulk playlist import, external music streaming providers, background-playback guarantees, mobile background synchronization guarantees, or YouTube embed-policy bypass. Invites are bearer links: any invite holder can join and retain membership, and existing members can share them. Membership revocation/invite rotation are future moderation features; do not use this version for sensitive private discussions. Recently joined means persisted membership join time, not tracking browsing history.

The migrations target a fresh Supabase project. Subsequent schema changes should be separate migrations. Application checks and a local backend do not establish validation against a hosted project or a successful Vercel deployment.
