-- A stand-in for the parts of a Supabase project the migrations lean on, so
-- they can be applied to a plain Postgres in CI and on a laptop: the API
-- roles, auth.users with auth.uid(), realtime.messages with realtime.topic(),
-- and Supabase's default grants on new tables in public. Only for tests: a
-- real project already has all of this.
-- Roles belong to the whole server, so a second run in the same cluster finds them already there.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end
$$;

create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  is_anonymous boolean not null default false
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create schema realtime;
create table realtime.messages (id bigserial primary key, topic text not null, extension text not null, payload jsonb);
alter table realtime.messages enable row level security;
create function realtime.topic() returns text language sql stable as $$
  select nullif(current_setting('realtime.topic', true), '')
$$;

grant usage on schema public, auth, realtime to anon, authenticated, service_role;
-- Supabase gives every API role every privilege on each new table in public; RLS and explicit revokes are what narrow it.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
