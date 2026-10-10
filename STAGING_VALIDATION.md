# Room moderation and majority voting — staging validation

Validated on 2026-10-10 against a separate hosted Supabase project and a protected Vercel preview. No production migrations, production environment variables, or main-branch commits were changed.

## Environment and behavior

- Branch: `feat/room-moderation-voting`.
- Supabase staging: `bscrmxvouqgfgzoqabcl` (four migrations applied in order).
- Preview: https://jamroom-git-feat-room-moderation-voting-syren1.vercel.app (Vercel team authentication required).
- Preview-only branch variables: staging URL/public key and `NEXT_PUBLIC_ROOM_ENHANCEMENTS=true`. No service-role key in the frontend.
- Existing rooms default to enhancements disabled. Owners explicitly opt in through room settings.
- Kick blocks an account for five minutes; ban blocks it until restored. Rotating an invite keeps existing memberships while invalidating the old link for new members.
- One vote per account per playback version. Only fresh listening leases count, with a strict majority required. Multiple tabs count as one listener. Concurrent votes use the same room lock and playback version checks as playback commands.
- Revoked users lose database/RPC access immediately; the player/UI disconnects on refresh, with a 15-second fallback poll. Broadcast refresh events contain no row contents (hosted Realtime adds a random delivery ID).

## Results

| Verification                                                              | Result                                                                                    |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| ESLint, TypeScript, unit suite                                            | Passed; 26 unit tests                                                                     |
| Production build                                                          | Passed locally and Vercel preview READY                                                   |
| Isolated PostgreSQL migration/RLS harness                                 | Passed                                                                                    |
| Hosted enhancement API tests (`scripts/test-enhancements.mjs`)            | 39 assertions passed with locked Supabase SDK 2.117.3                                     |
| Hosted baseline integration suite                                         | 11 passed, zero skipped and zero unhandled errors                                         |
| Chromium against hosted preview (`scripts/test-enhancements-browser.mjs`) | Passed 10 scenarios across three separate account/browser contexts; no uncaught JS errors |

Positive cases include opt-in, majority transition, restore access, new private invite, playlist/chat persistence, returning owner, and Realtime Broadcast/Presence.

Negative cases include non-owner moderation, self-moderation, unknown actions, restricted users reading/chatting/queuing/voting/rejoining, non-DJ playback commands, unauthenticated calls, direct table writes, privilege escalation, stale versions, and anonymous room ownership.

Concurrency cases include simultaneous votes causing exactly one skip, duplicate tabs/votes, simultaneous ordinary skips, concurrent queue insertions, and duplicate playback-end callbacks.

Browser cases include real account login, owner-only settings, opt-in, realtime queue display, majority voting UI, disabled repeat vote, ban/access removal, restore and reload, invite rotation, and no uncaught exceptions. YouTube iframe readiness was exercised, but audible playback and timing synchronization across physical devices are **not verified**.

Anonymous Sign-Ins was enabled by the project owner on staging and the anonymous ownership regression passed. Email delivery/OAuth are outside this change. Account-based bans do not prevent a person creating a different anonymous identity.

Dedicated QA accounts contain artificial identities. Test-created rooms are removed; no production users/data were copied.

## Reproduce safely

Run `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:sql` locally. Hosted tests require `JAMROOM_LIVE_TESTS=1`, the staging URL/public key, and `JAMROOM_TEST_HOST` matching that URL; scripts reject the known production project. The integration suite needs confirmed `E2E_USER_A_EMAIL/PASSWORD` and `E2E_USER_B_EMAIL/PASSWORD`, plus staging Anonymous Sign-Ins. Enhancement scripts use `QA_FIXTURES` with five dedicated users (`id`, `name`, `email`, `password`). Browser tests also require a temporary protected-preview access URL in `QA_PREVIEW_ACCESS_URL`; keep this and account passwords out of git/logs.

## Production release and recovery

1. Review this branch/PR. Do not promote the staging deployment: its compiled public variables point to staging.
2. Before an approved production release, capture/verify a restorable production backup or logical export appropriate to the project's plan. Record the current deployment and migration state. Production backup coverage has not been verified in this staging task.
3. Apply only `20261010123523_room_moderation_voting.sql` to production if the three baseline migrations are already present. It adds tables/a default-false column and replaces checked RPCs/triggers; it does not delete existing chats, playlists, rooms, or users. Test room access immediately afterward.
4. Build a production deployment from the reviewed commit with production Supabase variables. Keep the environment feature flag disabled initially, then enable and redeploy for a controlled owner opt-in rollout.
5. Smoke-test existing feature-disabled rooms and one opted-in canary room. Watch RPC failures, denied access, and player state. Do not run destructive QA suites against production.
6. For recovery, disable enhancements on canary rooms, remove/disable the production feature flag, and redeploy or restore the previous production deployment. Keep additive tables/data; do not automatically reverse/drop migrations. If a database defect needs a fix, use a forward migration and the verified backup recovery procedure.
