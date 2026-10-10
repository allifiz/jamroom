\set ON_ERROR_STOP on
begin;
insert into auth.users(id,raw_user_meta_data) values
 ('00000000-0000-4000-8000-000000000021','{"display_name":"Chat owner"}'),
 ('00000000-0000-4000-8000-000000000022','{"display_name":"Chat participant"}'),
 ('00000000-0000-4000-8000-000000000023','{"display_name":"Other owner"}');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000021',true);
select (public.create_room('Chat test','','public','mint')->>'id')::uuid as chat_room \gset
select set_config('test.chat_room',:'chat_room',true);
select public.send_message(:'chat_room','Owner message');
select public.playlist_mutation(:'chat_room','add',p_video=>'jNQXAC9IVRw',p_title=>'Unchanged song',p_thumbnail=>'');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000022',true);
select public.join_room((select slug from public.rooms where id=:'chat_room'));
select public.send_message(:'chat_room','Participant message');
do $$ declare r uuid:=current_setting('test.chat_room')::uuid; begin
  begin perform public.clear_room_chat(r); raise exception 'Participant cleared chat';
  exception when insufficient_privilege then null; end;
  begin delete from public.room_messages where room_id=r; raise exception 'Direct delete allowed';
  exception when insufficient_privilege then null; end;
  if (select count(*) from public.room_messages where room_id=r)<>2 then raise exception 'Denied deletion changed messages'; end if;
  begin perform jamroom_private.vote_status(r); raise exception 'Private helper exposed';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000023',true);
select (public.create_room('Other chat','','public','pink')->>'id')::uuid as other_room \gset
select public.send_message(:'other_room','Other room message');
do $$ begin
  begin perform public.clear_room_chat(current_setting('test.chat_room')::uuid); raise exception 'Outsider cleared chat';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000021',true);
do $$ declare r uuid:=current_setting('test.chat_room')::uuid; begin
  if public.clear_room_chat(r)<>2 then raise exception 'Wrong deletion count'; end if;
  if exists(select 1 from public.room_messages where room_id=r) then raise exception 'Chat not cleared'; end if;
  if public.clear_room_chat(r)<>0 then raise exception 'Empty chat not idempotent'; end if;
  if (select count(*) from public.room_messages)<>1 then raise exception 'Other room modified'; end if;
  if (select count(*) from public.playlist_items where room_id=r)<>1 then raise exception 'Playlist modified'; end if;
  if (select count(*) from public.room_members where room_id=r)<>2 then raise exception 'Membership modified'; end if;
  if not exists(select 1 from public.room_playback_states where room_id=r) then raise exception 'Playback deleted'; end if;
  begin perform public.clear_room_chat(gen_random_uuid()); raise exception 'Missing room accepted';
  exception when insufficient_privilege then null; end;
  begin perform public.clear_room_chat(null); raise exception 'Null room accepted';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','',true);
do $$ begin
  begin perform public.clear_room_chat(current_setting('test.chat_room')::uuid); raise exception 'Missing identity cleared chat';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
  if has_function_privilege('anon','public.clear_room_chat(uuid)','EXECUTE') then raise exception 'Unauthenticated execution allowed'; end if;
  if has_function_privilege('anon','jamroom_private.clear_room_chat(uuid)','EXECUTE') then raise exception 'Unauthenticated helper allowed'; end if;
  raise notice 'PASS: owner-only chat clearing, direct delete denial, no cross-room deletion, unchanged queue/membership/playback, empty repeat, missing room and identity denial';
end $$;
rollback;
