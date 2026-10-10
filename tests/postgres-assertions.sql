\set ON_ERROR_STOP on
begin;
insert into auth.users(id,raw_user_meta_data) values ('00000000-0000-4000-8000-000000000001','{"display_name":"Owner"}'),('00000000-0000-4000-8000-000000000002','{"display_name":"Friend"}'),('00000000-0000-4000-8000-000000000003','{"display_name":"Stranger"}');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select (public.create_room('SQL permanent room','','public','pink')->>'id')::uuid as rid \gset
select (public.create_room('SQL private room','','private','mint')->>'id')::uuid as private_rid \gset
select public.playlist_mutation(:'rid','add',p_video=>'dQw4w9WgXcQ',p_title=>'First',p_thumbnail=>'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
select public.playlist_mutation(:'rid','add',p_video=>'jNQXAC9IVRw',p_title=>'Second',p_thumbnail=>'https://i.ytimg.com/vi/jNQXAC9IVRw/hqdefault.jpg');
select set_config('test.rid',:'rid',true),set_config('test.private_rid',:'private_rid',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select public.join_room((select slug from rooms where id=:'rid'))->>'id';
do $$ declare r uuid:=current_setting('test.rid')::uuid; v bigint; a jsonb; b jsonb; track uuid; begin
 if (select count(*) from playlist_items where room_id=r)<>2 then raise exception 'Persistence broken'; end if;
 if exists(select 1 from rooms where id=current_setting('test.private_rid')::uuid) then raise exception 'Private room leak'; end if;
 if room_permission(r,'manage') then raise exception 'Queue permission leak'; end if;
 if not room_permission(r,'control') then raise exception 'Offline owner controls broken'; end if;
 perform listener_heartbeat(r,'00000000-0000-4000-8000-000000000011');
 select state_version into v from room_playback_states where room_id=r;
 a:=playback_command(r,v,'play');
 if a->'state'->>'status'<>'playing' then raise exception 'Playback broken'; end if;
 v:=(a->'state'->>'state_version')::bigint;
 a:=playback_command(r,v,'next'); b:=playback_command(r,v,'next');
 if (a->>'conflict')::boolean or not (b->>'conflict')::boolean then raise exception 'CAS broken'; end if;
 if (b->'state'->>'state_version')::bigint<>v+1 then raise exception 'Double-skip'; end if;
 select id into track from playlist_items where room_id=r order by position limit 1;
 a:=playback_command(r,(b->'state'->>'state_version')::bigint,'select',track);
 v:=(a->'state'->>'state_version')::bigint;
 a:=playback_command(r,v,'ended'); b:=playback_command(r,v,'ended');
 if (a->>'conflict')::boolean or not (b->>'conflict')::boolean or (b->'state'->>'state_version')::bigint<>v+1 then raise exception 'Duplicate onEnded advanced twice'; end if;

 begin perform playlist_mutation(r,'remove',p_item=>track); raise exception 'Unauthorized removal succeeded'; exception when others then if sqlerrm<>'Permission denied' then raise; end if; end;
 update room_members set can_manage=true where room_id=r and user_id=auth.uid();
 if room_permission(r,'manage') then raise exception 'Member escalated privileges'; end if;
 perform listener_heartbeat(r,'00000000-0000-4000-8000-000000000011',true);
 if (select status from room_playback_states where room_id=r)<>'paused' then raise exception 'Empty room did not pause'; end if;
 raise notice 'PASS: persistent rows, private RLS, offline owner, permission checks, CAS double-skip, empty-room pause';
end $$;
reset role;
-- Simulate a crashed tab and several days offline without waiting.
update room_playback_states set status='playing',position_seconds=10,playback_started_at=now()-interval '3 days' where room_id=:'rid';
insert into room_listener_leases(room_id,user_id,tab_id,last_seen) values(:'rid','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000012',now()-interval '3 days'+interval '10 seconds');
set local role authenticated;
select public.listener_heartbeat(:'rid','00000000-0000-4000-8000-000000000013');
do $$ declare r uuid:=current_setting('test.rid')::uuid; s room_playback_states; begin select * into s from room_playback_states where room_id=r; if s.status<>'paused' or s.position_seconds>21 then raise exception 'Empty time accumulated: %',s.position_seconds; end if; raise notice 'PASS: stale listener lease caps offline elapsed time'; end $$;
rollback;
