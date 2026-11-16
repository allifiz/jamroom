# SYNORA v2 — migration foundation

No accounts. No barriers. Just music, together.

This directory is the first isolated implementation slice. The existing Next.js routes still use Supabase; nothing here is connected to production yet. Do not deploy v2 as a replacement or delete the old database.

## Design contract

- First visit: persist a random anonymous identity and a hashed, 256-bit opaque session token in one write transaction; issue HttpOnly Secure SameSite=Lax cookie. Restore existing profile on later visits, renew expiry while active. Never take identity or role from client input. The core helper generates credentials but does not yet persist them.
- A direct room link resolves the anonymous session then joins that room, respecting private invites and restrictions. Home lists public rooms, owned rooms and recent membership; nickname is editable, not an onboarding step.
- Room owner is derived exclusively from rooms.owner_id. Store recovery/invite secret hashes only, display recovery secret once. Recovery must rate-limit, verify hash and atomically rotate key and transfer ownership, demote previous owner and invalidate permission snapshots. A lost cookie and lost key cannot safely be recovered.
- Server-side authorization must replace all Supabase RLS/RPC, including private-room reads, moderation, clear chat, voting, extension actions, leases and queue operations. Never expose a Turso token to browsers. Cookie-authenticated state mutations require same-origin/CSRF validation.
- Realtime: Ably is notifications/presence, never the authoritative state. Short-lived scoped channel tokens are issued after checking membership. Server publishes only after committed writes; use outbox/retry and reconnect snapshots. Private invitation and recovery secrets never appear in snapshots or broadcasts. Restriction/revocation enforcement must account for already-issued realtime tokens.
- Playback: use authoritative UTC epoch milliseconds and version CAS inside write transactions. Freeze idle playback using tab-specific leases. For queue reorder, use a temporary disjoint position range before assigning final positions because SQLite unique constraints are immediate. Cross-room track selection must fail. Only confirmed playable matches enter the queue.
- Music: YouTube / YouTube Music use official YouTube embeds; SoundCloud uses official widgets once implemented. Spotify, Apple Music, Deezer and Bandcamp parsing is reference-only until permitted metadata/matching is implemented. No stream extraction, DRM bypass, or arbitrary URL fetching. Direct audio disabled pending policy.
- MV3 companion: activeTab for user-initiated detection, one-time verifier-bound pairing, scoped revocable token, permission-checked add/play next/play now. Avoid browsing history and broad host permissions.
- Preserve moderation, skip voting, chat clearing, playlist order, history and room settings. Anonymous bans cannot reliably identify someone who deliberately resets their browser storage.

## Implementation status

The isolated `/synora` page exercises anonymous identity, room creation/join and queue insertion against a configured fresh database. For a fresh local SQLite database, run `TURSO_DATABASE_URL=file:./synora-dev.db npm run synora:db:init`, then set the same URL in `.env.local` and start Next.js. Do not rerun the initializer on an existing database.

Implemented here: SQLite migration candidate, secure identity primitives, authorization policy, provider URL normalization, reference/playback distinction, playback clock helpers, transactional libSQL adapter and isolated `/api/synora` session/room/queue endpoints. The existing application pages and production deployment still use Supabase. A successful Vercel build does not mean these endpoints have a configured database.

For local API testing, create a fresh SQLite database by applying `synora/migrations/0001_initial.sql`, set `TURSO_DATABASE_URL=file:./synora-dev.db` in `.env.local`, and run `npm run dev`. For remote Turso, apply the same migration to a fresh database and set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` server-side. The new endpoints are `POST /api/synora/session` (create/restore anonymous identity), `PATCH /api/synora/session` (rename), `GET/POST /api/synora/rooms`, `POST /api/synora/rooms/:slug/join` or `/recover`, and `GET/POST /api/synora/rooms/:slug/queue`. Queue POST takes `{ "url": "..." }` for YouTube or `{ "url": "spotify/other source", "matchUrl": "YouTube URL" }` for explicit playback matching. Metadata is verified through YouTube oEmbed before insertion. Mutations require a same-origin `Origin` header. Recovery and invitation keys are returned only at creation/recovery; store them safely. The API is an isolated implementation slice and does not replace the current UI.

Next required slices: Ably token/notification/presence integration, data export/import, home and player refactor, extension, further integration tests, branding and preview deployment. Confirm provider terms and live playback with real accounts before claiming support.

For existing PostgreSQL data, preserve IDs, memberships and queue positions; hash invites during migration, issue owner recovery credentials through an authenticated pre-cutover handoff, and convert UTC timestamp fields into epoch milliseconds. Do not silently assign old rooms to a random new user. Existing Supabase auth identities cannot be recovered using new anonymous cookies alone. Keep the old deployment and database intact until the migration is verified.

Proposed server-only variables: TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, ABLY_API_KEY. Credentials belong in local ignored environment files and Vercel project settings, never in Git or chat. The SQL file is a candidate fresh schema, not a production migration already applied.
