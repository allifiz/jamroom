#!/usr/bin/env bash
# Real Supabase services, constrained to local development; never used by Vercel.
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/init-dev-backend.mjs
chmod 644 dev/bootstrap.sql dev/kong.yml
docker compose --env-file dev/.env -f dev/compose.yml -p jamroom-dev up -d
for attempt in {1..60}; do
  if curl -fsS --max-time 2 http://127.0.0.1:54321/auth/v1/health >/dev/null; then break; fi
  sleep 0.5
done
curl -fsS --max-time 5 http://127.0.0.1:54321/auth/v1/health >/dev/null
# Realtime tenant migrations must finish before application broadcast policies/triggers.
for attempt in {1..60}; do
  realtime_ready=$(docker compose --env-file dev/.env -f dev/compose.yml -p jamroom-dev exec -T db psql -U postgres -Atc "select exists(select 1 from pg_proc where pronamespace='realtime'::regnamespace and proname='broadcast_changes');")
  if [[ "$realtime_ready" == "t" ]]; then break; fi
  sleep 0.5
done
if [[ "$realtime_ready" != "t" ]]; then
  echo 'Realtime database migrations did not become ready. Inspect local service logs.' >&2
  exit 1
fi
# Do not reapply or reset an existing database. Validate a complete installed schema.
exists=$(docker compose --env-file dev/.env -f dev/compose.yml -p jamroom-dev exec -T db psql -U postgres -Atc "select to_regclass('public.rooms') is not null;")
if [[ "$exists" == "f" ]]; then
  for migration in supabase/migrations/*.sql; do
    docker compose --env-file dev/.env -f dev/compose.yml -p jamroom-dev exec -T db psql -U postgres -v ON_ERROR_STOP=1 < "$migration"
  done
  docker compose --env-file dev/.env -f dev/compose.yml -p jamroom-dev exec -T db psql -U postgres -c "notify pgrst, 'reload schema';"
else
  ready=$(docker compose --env-file dev/.env -f dev/compose.yml -p jamroom-dev exec -T db psql -U postgres -Atc "select to_regprocedure('public.broadcast_room_mutation()') is not null;")
  if [[ "$ready" != "t" ]]; then
    echo 'Existing database needs the database_broadcast migration; apply it explicitly without resetting data.' >&2
    exit 1
  fi
fi
printf 'Local Auth, PostgreSQL, PostgREST, and Realtime are running. Database records are preserved.\n'
