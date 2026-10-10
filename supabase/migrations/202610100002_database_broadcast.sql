-- Durable database mutations produce private Realtime Broadcast events.
-- Broadcast payloads are notifications only: clients fetch authorized snapshots.
-- This avoids requiring wal2json/Postgres Changes for the listening workflow.
create function public.broadcast_room_mutation() returns trigger
language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  if TG_TABLE_NAME = 'rooms' then
    rid := coalesce(new.id, old.id);
  else
    rid := coalesce(new.room_id, old.room_id);
  end if;
  perform realtime.broadcast_changes(
    'room:' || rid::text, 'refresh', TG_OP, TG_TABLE_NAME, TG_TABLE_SCHEMA, new, old
  );
  return null;
end;
$$;
revoke execute on function public.broadcast_room_mutation() from public,anon,authenticated;
create trigger broadcast_room after insert or update or delete on public.rooms
for each row execute function public.broadcast_room_mutation();
create trigger broadcast_queue after insert or update or delete on public.playlist_items
for each row execute function public.broadcast_room_mutation();
create trigger broadcast_playback after insert or update or delete on public.room_playback_states
for each row execute function public.broadcast_room_mutation();
create trigger broadcast_chat after insert or update or delete on public.room_messages
for each row execute function public.broadcast_room_mutation();
create trigger broadcast_members after insert or update or delete on public.room_members
for each row execute function public.broadcast_room_mutation();
create trigger broadcast_history after insert or update or delete on public.playback_history
for each row execute function public.broadcast_room_mutation();
