# Owner-only chat clearing — 11 October 2026 (WIB)

Owners can clear all current chat messages in their room through **The hangout → Clear chat history**. A confirmation warns that deletion applies to everyone and cannot be undone. Participants do not see the button and cannot invoke the action through the API. Clearing works independently of the moderation/voting opt-in.

## Validation

Tests used Supabase staging `bscrmxvouqgfgzoqabcl` with artificial accounts/rooms and a protected Vercel preview. Production project `lyvmjirmondcolhystjp` was not migrated or used for destructive tests.

| Check                                  | Result                                                                                                                                                                                                                                          |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SQL migration and baseline RLS harness | Passed                                                                                                                                                                                                                                          |
| Clear-chat SQL assertions              | Passed: owner authorization, participant/outsider/null identity/missing room denial, direct table delete denial, private vote helper remains inaccessible, scoped deletion, repeat on empty room, preserved playlist/membership/playback        |
| Hosted clear-chat script               | 20 API assertions passed, including two simultaneous owner requests clearing exactly one message batch                                                                                                                                          |
| Chromium against hosted preview        | 8 scenarios passed: owner-only button, cancel, rejected RPC/retry, confirm, participant realtime update, disabled empty button, reload persistence, new messages after clearing; no uncaught JS errors                                          |
| Hosted baseline regression suite       | Final run 11 passed, zero skipped/unhandled errors. The first run had one database-broadcast timeout while other browser tests ran; an isolated rerun passed without code changes. The transient delivery timeout remains a testing limitation. |
| Unit tests, TypeScript, ESLint         | Passed; 27 unit tests                                                                                                                                                                                                                           |
| Vercel preview build                   | READY for application commit `02cb00d4512060419ae02bba490df076c3c4dc0a`                                                                                                                                                                         |

Preview: https://jamroom-git-feat-owner-clear-chat-syren1.vercel.app (Vercel team authentication required).

## Security and data behavior

The public RPC is `SECURITY INVOKER`. It delegates to an unexposed private function with an empty search path, explicit schemas, a required `auth.uid()`, and an ownership check under a room row lock. Both functions deny execution by `PUBLIC`/`anon`. Direct message table DELETE permissions remain denied for both owners and participants. Granting schema usage does not grant access to other private helper functions, verified by SQL tests.

Deletion touches only `room_messages` for the checked room. Existing DELETE broadcast triggers refresh participants, and the owner refreshes the snapshot after success. Failed calls preserve messages and release the busy state for retry. New messages can be sent after clearing; messages arriving after the DELETE statement's snapshot are not included in that deletion. Deleting an already empty chat returns zero.

The migration itself does not remove messages. Supabase staging advisors retained the existing notices for intentional checked RPCs, denied RPC-only tables, guest access policies, and disabled leaked-password protection; the new exposed RPC is not SECURITY DEFINER. See https://supabase.com/docs/guides/database/database-linter and https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection.

## Reproduce and release

Run `npm run test:sql`, `npm test`, `npm run lint`, and `npm run typecheck`. `node scripts/test-clear-chat.mjs` requires `JAMROOM_LIVE_TESTS=1`, staging URL/public key, an exact `JAMROOM_TEST_HOST`, `QA_FIXTURES` with three dedicated confirmed accounts, and a protected preview access URL in `QA_PREVIEW_ACCESS_URL`. Do not commit credentials or access links. Test rooms are cleaned up in a finally block.

For an approved production release, preserve/verify a suitable backup, apply only `20261010172336_clear_room_chat.sql`, then merge/build main with production Supabase variables. Do not promote the staging preview. The action needs no new environment variable. To withdraw the UI, roll back the deployment; revoke RPC/private helper execution too if deletion must be disabled at the API level. Deleted messages require a pre-deletion backup to recover; a deployment rollback cannot restore them.
