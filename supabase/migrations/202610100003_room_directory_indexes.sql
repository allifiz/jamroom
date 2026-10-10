create index rooms_owner_updated on public.rooms(owner_id,updated_at desc);
create index rooms_public_updated on public.rooms(updated_at desc) where visibility='public';
