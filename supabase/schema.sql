-- Run this once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run

-- Note: id is NOT a foreign key to auth.users. Most rows here are
-- browsable seed/content profiles with no login of their own; a real
-- user's profile just happens to share its id with their auth user id
-- once they sign in (see app/login.tsx's upsert on first login).
create table profiles (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  qa jsonb not null default '[]'
);

create table groups (
  id text primary key,
  name text not null default '',
  qa jsonb not null default '[]'
);

create table group_members (
  group_id text not null references groups (id) on delete cascade,
  person_id uuid not null references profiles (id) on delete cascade,
  primary key (group_id, person_id)
);

create table questions (
  category text primary key,
  questions jsonb not null default '[]'
);

insert into storage.buckets (id, name, public)
values ('groups', 'groups', true), ('people', 'people', true);

-- Row-level security: any logged-in user can read/write everything.
-- Matches the current app's trust level (no per-user restrictions yet).
-- Tighten these later if you want e.g. "only group members can edit their group".

alter table profiles enable row level security;
alter table groups enable row level security;
alter table group_members enable row level security;
alter table questions enable row level security;

create policy "authenticated read/write" on profiles for all to authenticated using (true) with check (true);
create policy "authenticated read/write" on groups for all to authenticated using (true) with check (true);
create policy "authenticated read/write" on group_members for all to authenticated using (true) with check (true);
create policy "authenticated read/write" on questions for all to authenticated using (true) with check (true);

create policy "authenticated read/write" on storage.objects for all to authenticated
  using (bucket_id in ('groups', 'people')) with check (bucket_id in ('groups', 'people'));

-- Migration (run separately — the statements above have already been run):
-- group leader + invite codes. Nullable: pre-existing rows are not backfilled.
alter table groups add column created_by uuid references profiles (id);
alter table groups add column invite_code text unique;
