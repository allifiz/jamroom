-- Isolated PostgreSQL harness only. Production uses actual Supabase Auth/Realtime.
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}'::jsonb);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
grant usage on schema auth to authenticated;
grant execute on all functions in schema auth to authenticated;
create schema realtime;
create table realtime.messages(id bigint,topic text);
alter table realtime.messages enable row level security;
create function realtime.topic() returns text language sql stable as $$ select current_setting('realtime.topic',true) $$;
create publication supabase_realtime;
-- Broadcast is tested against the actual Realtime service in the live suite.
create function realtime.broadcast_changes(text,text,text,text,text,record,record,text default 'ROW') returns void language plpgsql as $$ begin return; end $$;

create function realtime.send(jsonb,text,text,boolean default true) returns void language plpgsql as $$ begin return; end $$;
