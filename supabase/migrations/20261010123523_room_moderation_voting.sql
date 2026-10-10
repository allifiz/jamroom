-- Additive, opt-in rollout. Existing rooms stay disabled until explicitly enabled.
alter table public.rooms add column enhancements_enabled boolean not null default false;
grant update(enhancements_enabled) on public.rooms to authenticated;

create table public.room_restrictions (
  room_id uuid references public.rooms on delete cascade,
  user_id uuid references public.profiles on delete cascade,
  action text not null check (action in ('kick','ban')),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  primary key(room_id,user_id)
);
create table public.room_skip_votes (
  room_id uuid references public.rooms on delete cascade,
  state_version bigint not null,
  user_id uuid references public.profiles on delete cascade,
  created_at timestamptz not null default now(),
  primary key(room_id,state_version,user_id)
);
alter table public.room_restrictions enable row level security;
alter table public.room_skip_votes enable row level security;
revoke all on public.room_restrictions,public.room_skip_votes from anon,authenticated;
grant select on public.room_restrictions to authenticated;
create policy restrictions_owner_read on public.room_restrictions for select to authenticated
using (exists(select 1 from public.rooms r where r.id=room_id and r.owner_id=(select auth.uid())));

-- All existing room RLS/RPC checks inherit this restriction, including public rooms.
create or replace function public.can_read_room(rid uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select auth.uid() is not null and exists (
    select 1 from rooms r where r.id=rid
    and (r.owner_id=auth.uid() or (
      not exists(select 1 from room_restrictions b where b.room_id=rid and b.user_id=auth.uid()
        and (b.expires_at is null or b.expires_at>now()))
      and (r.visibility='public' or exists(select 1 from room_members m where m.room_id=rid and m.user_id=auth.uid()))
    ))
  );
$$;

-- Previously public invite validation could bypass a restriction: check it first.
create or replace function public.join_room(p_slug text,p_invite uuid default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r rooms;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into r from rooms where slug=p_slug for update;
  if r.id is null then raise exception 'Room unavailable or invitation required'; end if;
  if r.owner_id<>auth.uid() and exists(select 1 from room_restrictions where room_id=r.id
    and user_id=auth.uid() and (expires_at is null or expires_at>now())) then
    raise exception 'Your access to this room has been restricted';
  end if;
  if not can_read_room(r.id) and (p_invite is null or p_invite<>r.invite_code) then
    raise exception 'Room unavailable or invitation required';
  end if;
  insert into room_members(room_id,user_id) values(r.id,auth.uid()) on conflict do nothing;
  return to_jsonb(r);
end $$;

create function public.moderate_room(p_room uuid,p_action text,p_user uuid default null) returns void
language plpgsql security definer set search_path=public as $$
declare r rooms;
begin
  select * into r from rooms where id=p_room for update;
  if auth.uid() is null or r.owner_id is distinct from auth.uid() then raise exception 'Owner permission required'; end if;
  if not r.enhancements_enabled then raise exception 'Room enhancements are disabled'; end if;
  if p_action='rotate_invite' then
    update rooms set invite_code=gen_random_uuid(),updated_at=now() where id=p_room;
    return;
  end if;
  if p_action not in ('kick','ban','unban') then raise exception 'Unknown moderation action'; end if;
  if p_user is null or p_user=r.owner_id then raise exception 'Cannot moderate the room owner'; end if;
  if p_action='unban' then
    delete from room_restrictions where room_id=p_room and user_id=p_user;
  else
    if not exists(select 1 from room_members where room_id=p_room and user_id=p_user)
      and not exists(select 1 from room_restrictions where room_id=p_room and user_id=p_user) then
      raise exception 'Participant unavailable';
    end if;
    insert into room_restrictions(room_id,user_id,action,expires_at)
      values(p_room,p_user,p_action,case when p_action='kick' then now()+interval '5 minutes' else null end)
      on conflict(room_id,user_id) do update set action=excluded.action,expires_at=excluded.expires_at,created_at=now();
    delete from room_skip_votes where room_id=p_room and user_id=p_user;
    delete from room_listener_leases where room_id=p_room and user_id=p_user;
    delete from room_members where room_id=p_room and user_id=p_user;
    -- Freeze playback if moderation removed the final active listener.
    if not exists(select 1 from room_listener_leases where room_id=p_room and last_seen>now()-interval '45 seconds') then
      update room_playback_states set
        position_seconds=position_seconds+case when status='playing' then greatest(0,extract(epoch from(clock_timestamp()-playback_started_at))) else 0 end,
        status=case when status='playing' then 'paused' else status end,
        playback_started_at=null,state_version=state_version+1,updated_at=clock_timestamp()
      where room_id=p_room;
    end if;
  end if;
  update rooms set updated_at=now() where id=p_room;
end $$;

create schema if not exists jamroom_private;
revoke all on schema jamroom_private from public,anon,authenticated;
create function jamroom_private.vote_status(p_room uuid) returns jsonb
language sql stable security definer set search_path=public as $$
  with eligible as (
    select distinct l.user_id from room_listener_leases l
    join room_members m on m.room_id=l.room_id and m.user_id=l.user_id
    where l.room_id=p_room and l.last_seen>now()-interval '45 seconds'
    and not exists(select 1 from room_restrictions b where b.room_id=l.room_id and b.user_id=l.user_id
      and (b.expires_at is null or b.expires_at>now()))
  ), votes as (
    select v.user_id from room_skip_votes v join eligible e using(user_id)
    join room_playback_states s on s.room_id=v.room_id and s.state_version=v.state_version
    where v.room_id=p_room
  ) select jsonb_build_object('votes',(select count(*) from votes),
    'required',greatest(1,(select count(*) from eligible)/2+1),
    'eligible',(select count(*) from eligible),
    'has_voted',exists(select 1 from votes where user_id=auth.uid()));
$$;
revoke all on function jamroom_private.vote_status(uuid) from public,anon,authenticated;

create function public.skip_vote_status(p_room uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
begin
  if not can_read_room(p_room) then raise exception 'Permission denied'; end if;
  return jamroom_private.vote_status(p_room);
end $$;

create function public.vote_skip(p_room uuid,p_version bigint) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r rooms; s room_playback_states; target playlist_items; tally jsonb; t timestamptz:=clock_timestamp();
begin
  select * into r from rooms where id=p_room for update;
  if auth.uid() is null or not can_read_room(p_room) then raise exception 'Permission denied'; end if;
  if not r.enhancements_enabled then raise exception 'Room enhancements are disabled'; end if;
  if not exists(select 1 from room_members where room_id=p_room and user_id=auth.uid())
    or not exists(select 1 from room_listener_leases where room_id=p_room and user_id=auth.uid()
      and last_seen>now()-interval '45 seconds') then raise exception 'Join and listen before voting'; end if;
  select * into s from room_playback_states where room_id=p_room for update;
  if s.state_version<>p_version then
    return jsonb_build_object('conflict',true,'skipped',false,'state',to_jsonb(s),'server_time',t);
  end if;
  if s.status<>'playing' or s.current_track_id is null then raise exception 'No playing track to skip'; end if;
  insert into room_skip_votes(room_id,state_version,user_id) values(p_room,p_version,auth.uid()) on conflict do nothing;
  tally:=jamroom_private.vote_status(p_room);
  if (tally->>'votes')::int >= (tally->>'required')::int then
    if s.shuffle_enabled then
      select * into target from playlist_items where room_id=p_room and id<>s.current_track_id order by random() limit 1;
    else
      select * into target from playlist_items where room_id=p_room and position>
        (select position from playlist_items where id=s.current_track_id) order by position limit 1;
    end if;
    if target.id is null then
      select * into target from playlist_items where room_id=p_room order by position limit 1;
    end if;
    update room_playback_states set current_track_id=target.id,status=case when target.id is null then 'stopped' else 'playing' end,
      position_seconds=0,playback_started_at=case when target.id is null then null else t end,
      state_version=state_version+1,updated_at=t,updated_by=auth.uid() where room_id=p_room returning * into s;
    if target.id is not null then
      insert into playback_history(room_id,youtube_video_id,title) values(p_room,target.youtube_video_id,target.title);
      delete from playback_history where room_id=p_room and id not in
        (select id from playback_history where room_id=p_room order by played_at desc limit 50);
    end if;
    return jsonb_build_object('conflict',false,'skipped',true,'state',to_jsonb(s),'server_time',clock_timestamp());
  end if;
  return tally||jsonb_build_object('conflict',false,'skipped',false,'state',to_jsonb(s),'server_time',t);
end $$;

-- Reset votes after every playback command; never apply stale votes to a new state.
create function jamroom_private.clear_skip_votes() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if new.state_version<>old.state_version then delete from room_skip_votes where room_id=new.room_id; end if;
  return null;
end $$;
revoke all on function jamroom_private.clear_skip_votes() from public,anon,authenticated;
create trigger clear_skip_votes after update on public.room_playback_states
for each row execute function jamroom_private.clear_skip_votes();

-- Authorization for an already-open realtime channel may be cached. Broadcast only
-- invalidations, not records, so restricted listeners cannot receive new room data.
create or replace function public.broadcast_room_mutation() returns trigger
language plpgsql security definer set search_path=public as $$
declare rid uuid;
begin
  if tg_table_name='rooms' then rid:=coalesce(new.id,old.id);
  else rid:=coalesce(new.room_id,old.room_id); end if;
  perform realtime.send('{}'::jsonb,'refresh','room:'||rid::text,true);
  return null;
end $$;
create trigger broadcast_votes after insert or delete on public.room_skip_votes
for each row execute function public.broadcast_room_mutation();

revoke all on function public.moderate_room(uuid,text,uuid),public.skip_vote_status(uuid),public.vote_skip(uuid,bigint) from public,anon;
grant execute on function public.moderate_room(uuid,text,uuid),public.skip_vote_status(uuid),public.vote_skip(uuid,bigint) to authenticated;
