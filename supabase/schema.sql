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

create table memberships (
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
alter table memberships enable row level security;
alter table questions enable row level security;

create policy "authenticated read/write" on profiles for all to authenticated using (true) with check (true);
create policy "authenticated read/write" on groups for all to authenticated using (true) with check (true);
create policy "authenticated read/write" on memberships for all to authenticated using (true) with check (true);
create policy "authenticated read/write" on questions for all to authenticated using (true) with check (true);

create policy "authenticated read/write" on storage.objects for all to authenticated
  using (bucket_id in ('groups', 'people')) with check (bucket_id in ('groups', 'people'));

-- Migration (run separately — the statements above have already been run):
-- group leader + invite codes. Nullable: pre-existing rows are not backfilled.
alter table groups add column created_by uuid references profiles (id);
alter table groups add column invite_code text unique;

-- Migration (run separately): photo carousel aspect ratio. The first photo added
-- locks the card shape (snapped to a standard ratio) for that carousel; nullable
-- for rows with no photos / legacy rows (derived on the fly at read time).
alter table groups   add column image_aspect_ratio numeric;
alter table profiles add column image_aspect_ratio numeric;

-- Migration (run separately): group feed. One row per (suggesting group, target
-- group) pair — the primary key doubling as the "already suggested" check.
create table group_suggestions (
  suggesting_group_id text not null references groups (id) on delete cascade,
  target_group_id text not null references groups (id) on delete cascade,
  suggested_by uuid not null references profiles (id),
  created_at timestamptz not null default now(),
  primary key (suggesting_group_id, target_group_id)
);

alter table group_suggestions enable row level security;

create policy "authenticated read/write" on group_suggestions for all to authenticated using (true) with check (true);

-- Migration (run separately): the Sent feed. 'pending' = shows in the Group
-- feed; the leader's check flips it to 'sent'. The leader's X deletes the row
-- outright (tentative exclusion, not permanent — see group_suggestions above).
-- Received (not built yet) will read this same table filtered by
-- target_group_id instead of suggesting_group_id — no schema change needed for that.
alter table group_suggestions add column status text not null default 'pending' check (status in ('pending', 'sent'));

-- Migration (run separately): the Received feed + Chats. The receiving
-- leader's check flips status to 'matched' (a permanent record — unlike every
-- other rejection in this table, this one is meant to last); their X deletes
-- the row outright, same tentative pattern as everywhere else.
alter table group_suggestions drop constraint group_suggestions_status_check;
alter table group_suggestions add constraint group_suggestions_status_check check (status in ('pending', 'sent', 'matched'));

-- Migration (run separately): group chat. A "conversation" is identified by
-- an unordered pair of matched groups; group_1_id/group_2_id are always
-- stored with group_1_id < group_2_id (enforced by the check constraint) so
-- a thread can be queried with two plain .eq() filters instead of .or().
-- sender_group_id is stored directly (not derived from memberships) so
-- it's known without a join.
create table messages (
  id bigint generated always as identity primary key,
  group_1_id text not null references groups (id) on delete cascade,
  group_2_id text not null references groups (id) on delete cascade,
  sender_group_id text not null references groups (id) on delete cascade,
  sender_id uuid not null references profiles (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  constraint messages_group_order check (group_1_id < group_2_id)
);

create index messages_conversation_idx on messages (group_1_id, group_2_id, created_at);

alter table messages enable row level security;

create policy "authenticated read/write" on messages for all to authenticated using (true) with check (true);

-- Realtime does not stream changes for any table until it's added to this
-- publication — easy to forget, and there is no error, just silence.
alter publication supabase_realtime add table messages;

-- Migration (run separately): read state for Chats. One row per user per chat,
-- stamped when that user closes the thread — a chat whose newest message is
-- younger than this (or that has no row at all) is unread, which is what bolds
-- its preview row. Keyed by the canonical pair, same ordering as messages.
create table chat_reads (
  user_id      uuid not null references auth.users (id) on delete cascade,
  group_1_id   text not null references groups (id) on delete cascade,
  group_2_id   text not null references groups (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (user_id, group_1_id, group_2_id)
);

-- Unlike the tables above, this one is per-user rather than shared: everything
-- else here is group content, but who has read what is nobody else's business.
alter table chat_reads enable row level security;

create policy chat_reads_select_own on chat_reads
  for select using (auth.uid() = user_id);
create policy chat_reads_insert_own on chat_reads
  for insert with check (auth.uid() = user_id);
create policy chat_reads_update_own on chat_reads
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Migration (run separately): the red dot on the Chats tab. Counts chats with
-- something unread in them, not messages — hence the group by on the pair.
-- Messages you sent yourself never count. The user comes from auth.uid() rather
-- than an argument, so one member can't ask for another's count.
create or replace function get_unread_chat_count(my_group_id text)
returns integer
language sql
stable
as $$
  select count(*)::int from (
    select m.group_1_id, m.group_2_id
    from messages m
    left join chat_reads r
      on  r.user_id    = auth.uid()
      and r.group_1_id = m.group_1_id
      and r.group_2_id = m.group_2_id
    where (m.group_1_id = my_group_id or m.group_2_id = my_group_id)
      and m.sender_id <> auth.uid()
      and (r.last_read_at is null or m.created_at > r.last_read_at)
    group by m.group_1_id, m.group_2_id
  ) unread_chats;
$$;
