-- Only the room owner can clear its chat. No data is removed by this migration.
-- Keep privileged deletion outside the exposed API schema.
create function jamroom_private.clear_room_chat(p_room uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare
  room_owner uuid;
  deleted_count integer;
begin
  if auth.uid() is null then
    raise exception 'Permission denied' using errcode='42501';
  end if;
  select owner_id into room_owner from public.rooms where id=p_room for update;
  if room_owner is null or room_owner<>auth.uid() then
    raise exception 'Permission denied' using errcode='42501';
  end if;
  delete from public.room_messages where room_id=p_room;
  get diagnostics deleted_count=row_count;
  return deleted_count;
end;
$$;
revoke all on function jamroom_private.clear_room_chat(uuid) from public,anon,authenticated;
grant usage on schema jamroom_private to authenticated;
grant execute on function jamroom_private.clear_room_chat(uuid) to authenticated;

create function public.clear_room_chat(p_room uuid) returns integer
language sql security invoker set search_path='' as $$
  select jamroom_private.clear_room_chat(p_room);
$$;
revoke all on function public.clear_room_chat(uuid) from public,anon,authenticated;
grant execute on function public.clear_room_chat(uuid) to authenticated;
