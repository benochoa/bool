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

-- Migration (run separately): photos (and, later, voice notes) in a chat. body
-- stays not null and holds a readable label ('Photo') for anything that can't
-- be rendered as text — get_chat_previews returns it as the last message, so a
-- media message still reads properly in the Chats list with no change there.
alter table messages add column kind text not null default 'text'
  check (kind in ('text', 'image', 'audio'));
alter table messages add column media_url text;
alter table messages add column media_aspect_ratio numeric;

-- Its own bucket rather than a folder in groups/people: this is per-message
-- content with a different lifetime from a group's or a person's photos.
insert into storage.buckets (id, name, public) values ('chat-media', 'chat-media', true);

create policy "authenticated read/write chat media" on storage.objects for all to authenticated
  using (bucket_id = 'chat-media') with check (bucket_id = 'chat-media');

-- Migration (run separately): deleting a message. Soft, so the row stays put —
-- ordering, and anything that later points at it, outlive the content. The
-- delete itself blanks body and media_url, both because a delete that leaves
-- the text in the table isn't one, and because get_chat_previews reads body
-- directly: otherwise the Chats list would keep showing a deleted message.
alter table messages add column deleted_at timestamptz;

-- Migration (run separately): tapbacks. One reaction per person per message —
-- the primary key is what enforces that, so picking a different emoji is an
-- upsert that replaces rather than a second row. Nothing here identifies the
-- chat (that's on the message it points at), which is why the client subscribes
-- to the whole table and drops events for messages it isn't showing.
create table message_reactions (
  message_id bigint not null references messages (id) on delete cascade,
  user_id    uuid   not null references profiles (id) on delete cascade,
  emoji      text   not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

alter table message_reactions enable row level security;

create policy "authenticated read/write" on message_reactions for all to authenticated
  using (true) with check (true);

alter publication supabase_realtime add table message_reactions;

-- Migration (run separately): replies. Self-referencing, and null on delete
-- rather than cascade — deleting the message someone answered shouldn't take
-- their answer with it; the reply just loses its quote. The client resolves the
-- quoted message out of the thread it already loaded rather than embedding it.
--
-- Note: message_reactions above points at both messages and profiles, which
-- PostgREST reads as a junction table between them. That makes a bare
-- profiles(...) embed on messages ambiguous, so fetchMessages names its path
-- explicitly: profiles!sender_id(...).
alter table messages add column reply_to_id bigint references messages (id) on delete set null;

-- Migration (run separately): blocking a person, and reporting.
--
-- Blocking is person-to-person and deliberately narrow: it does nothing to
-- matching. A blocked person's group still appears in For You, can still be
-- swiped, and can still match — the two of you simply stop seeing each other's
-- messages inside the chat that results. Everyone else in both groups sees the
-- thread whole, so the same conversation renders differently per viewer.
create table blocked_people (
  blocker_id uuid not null references profiles (id) on delete cascade,
  blocked_id uuid not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocked_people_not_self check (blocker_id <> blocked_id)
);

-- The primary key indexes (blocker_id, blocked_id); hiding is mutual, so the
-- "who blocked me" direction gets read just as often and needs its own index.
create index blocked_people_blocked_idx on blocked_people (blocked_id, blocker_id);

alter table blocked_people enable row level security;

create policy blocked_people_own on blocked_people
  for all using (auth.uid() = blocker_id) with check (auth.uid() = blocker_id);

-- True when either has blocked the other. security definer because the policy
-- above hides "they blocked me" rows from me, and every caller below needs to
-- see both directions — a plain subquery would silently match nothing.
create or replace function blocks_between(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from blocked_people
     where (blocker_id = a and blocked_id = b)
        or (blocker_id = b and blocked_id = a)
  );
$$;

-- Hiding is enforced here rather than in the app, so a blocked person's message
-- never leaves the database: the thread, the Chats preview, the unread count and
-- the realtime stream are all covered by this one rule, including
-- get_chat_previews, whose body lives only in the dashboard.
--
-- Note the shape. The old "for all using (true)" cannot stay alongside this:
-- permissive policies are OR'd together, so leaving it in place would grant
-- every row again and silently undo the block. It is dropped and replaced by
-- one policy per command, with only select carrying the block test.
drop policy "authenticated read/write" on messages;

create policy messages_select_unblocked on messages
  for select to authenticated
  using (not blocks_between(auth.uid(), sender_id));

create policy messages_insert on messages
  for insert to authenticated with check (true);
create policy messages_update on messages
  for update to authenticated using (true) with check (true);
create policy messages_delete on messages
  for delete to authenticated using (true);

-- Same treatment for tapbacks, so a blocked person's reaction doesn't sit on
-- your message after their words are gone.
drop policy "authenticated read/write" on message_reactions;

create policy message_reactions_select_unblocked on message_reactions
  for select to authenticated
  using (not blocks_between(auth.uid(), user_id));

create policy message_reactions_insert on message_reactions
  for insert to authenticated with check (true);
create policy message_reactions_update on message_reactions
  for update to authenticated using (true) with check (true);
create policy message_reactions_delete on message_reactions
  for delete to authenticated using (true);

-- Everyone whose name the viewer should see as "Blocked user" on a members
-- card. Both directions, because the hiding is mutual: the person you blocked
-- stops seeing your name too. security definer for the same reason as above.
create or replace function get_blocked_person_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select blocked_id from blocked_people where blocker_id = auth.uid()
  union
  select blocker_id from blocked_people where blocked_id = auth.uid();
$$;

-- Reporting is independent of blocking — filing one never creates the other.
-- Only one target_* is set, per target_type. message_snapshot copies the body
-- at report time because messages are soft deletable: without it the sender can
-- blank the evidence before anyone reads the report.
create table reports (
  id                bigint generated always as identity primary key,
  reporter_id       uuid not null references profiles (id) on delete cascade,
  target_type       text not null check (target_type in ('group', 'person', 'message')),
  target_group_id   text   references groups (id) on delete set null,
  target_person_id  uuid   references profiles (id) on delete set null,
  target_message_id bigint references messages (id) on delete set null,
  message_snapshot  text,
  reason            text not null,
  details           text,
  created_at        timestamptz not null default now()
);

create index reports_created_at_idx on reports (created_at desc);

alter table reports enable row level security;

-- Insert-only from the app: a readable reports table would let someone check
-- whether they had been reported.
create policy reports_insert_own on reports
  for insert with check (auth.uid() = reporter_id);
create policy reports_select_own on reports
  for select using (auth.uid() = reporter_id);

-- Migration (run separately): waveforms on voice messages. An array of levels
-- between 0 and 1, one per bar, captured from the recorder's metering while the
-- message was being held — nothing can recover it from the .m4a afterwards, so
-- a recording made before this column existed simply has none, and the player
-- falls back to a plain progress bar for it. Nullable for exactly that reason;
-- there is nothing to backfill.
alter table messages add column media_waveform jsonb;

-- Migration (run separately): identifiers. The same four facts on a person and
-- on a group, which is why both tables get the same columns. All text: an
-- individual's age is a year ('21') and a group's is a band ('21-23'), and
-- neither '30+' nor '18-20' is a number. City and college are free text with a
-- bundled list only suggesting values, so nothing here constrains them.
-- Nullable, because every existing row predates them: age, gender and city are
-- required by the app at save time rather than by the schema, so no row already
-- saved becomes unreadable.
alter table profiles add column age text;
alter table profiles add column gender text;
alter table profiles add column city text;
alter table profiles add column college text;

alter table groups add column age text;
alter table groups add column gender text;
alter table groups add column city text;
alter table groups add column college text;

-- Migration (run separately): push notification tokens. One row per device —
-- the token is the key, and a device that changes accounts re-points its row
-- at the new user (the app's upsert conflicts on token), so a phone never
-- keeps notifying its previous owner. Delivery happens in the notify edge
-- function, which reads this table with the service role.
create table push_tokens (
  token      text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  updated_at timestamptz not null default now()
);

-- The edge function's lookup is by recipient, not by token.
create index push_tokens_user_idx on push_tokens (user_id);

alter table push_tokens enable row level security;

-- A token is a capability: anyone holding the string can push to that device
-- through Expo's API. So unlike most tables here, reads are own-rows-only.
create policy push_tokens_select_own on push_tokens
  for select using (auth.uid() = user_id);
create policy push_tokens_delete_own on push_tokens
  for delete using (auth.uid() = user_id);

-- Migration (run separately): registration moves off the table and into a
-- function. The policies this replaces included
--   for update using (true) with check (auth.uid() = user_id)
-- as the account-switch path, and that was a hole: `using (true)` makes every
-- row eligible, and PostgREST will run an update with no filter — so a single
-- unfiltered PATCH re-pointed every token in the table at its sender, handing
-- them the whole app's notifications. There is no insert or update policy now;
-- the client's only write path is this function, which names the owner itself.
create or replace function register_push_token(p_token text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into push_tokens (token, user_id, updated_at)
  values (p_token, auth.uid(), now())
  on conflict (token) do update
    set user_id = auth.uid(), updated_at = now();
$$;

revoke all on function register_push_token(text) from public;
-- Supabase grants EXECUTE to anon explicitly on every new function, and a
-- revoke from PUBLIC does not remove a role-specific grant — so anon keeps it
-- until named here. Worth repeating for every function added below.
revoke all on function register_push_token(text) from anon;
grant execute on function register_push_token(text) to authenticated;

-- Migration (run separately): invite codes stop being readable. fetchGroup
-- used to select invite_code for any group, and the For You deck loads other
-- groups constantly — so every client held every code, and a code is a key to
-- a group's chats. Note that filtering on a column needs select permission on
-- it too, which is why looking a group up by code had to move server-side as
-- well; generation moved into a column default for the same reason.
create or replace function private.generate_invite_code()
returns text language plpgsql security definer set search_path = public as $$
declare
  chars text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';  -- no 0/O, 1/I/L: read aloud
  code text;
  i int;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(chars, floor(random() * length(chars))::int + 1, 1);
    end loop;
    exit when not exists (select 1 from groups where invite_code = code);
  end loop;
  return code;
end;
$$;

alter table groups alter column invite_code set default private.generate_invite_code();

create or replace function join_group_by_code(p_code text)
returns text language plpgsql security definer set search_path = public as $$
declare g_id text;
begin
  select id into g_id from groups where invite_code = upper(trim(p_code));
  if g_id is null then raise exception 'invalid code'; end if;

  insert into memberships (group_id, person_id, status, status_at)
  values (g_id, auth.uid(), 'active', now())
  on conflict (group_id, person_id)
    do update set status = 'active', status_at = now();

  return g_id;
end;
$$;

create or replace function get_invite_code(p_group_id text)
returns text language sql stable security definer set search_path = public as $$
  select invite_code from groups
   where id = p_group_id and created_by = auth.uid();
$$;

revoke select (invite_code) on groups from authenticated, anon;

revoke all on function join_group_by_code(text) from public, anon;
revoke all on function get_invite_code(text)   from public, anon;
grant execute on function join_group_by_code(text) to authenticated;
grant execute on function get_invite_code(text)    to authenticated;

-- Migration (run separately, AFTER the notify edge function is deployed):
-- push webhooks. Two triggers POST row changes to the notify function
-- (supabase/functions/notify), which works out recipients and calls Expo's
-- push API. Built directly on pg_net rather than the dashboard's Database
-- Webhooks feature — same mechanism, no UI dependency. The payload shape
-- (type/table/schema/record/old_record) is the same one that feature sends,
-- which is what the edge function parses. <WEBHOOK_SECRET> is a placeholder —
-- the real value matches the WEBHOOK_SECRET function secret (`supabase
-- secrets set`) and is not recorded here. security definer because the
-- writer is an ordinary authenticated role with no rights on the net schema.
create extension if not exists pg_net;

create or replace function public.notify_webhook()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://vsgdhfwhpiucplkraizw.supabase.co/functions/v1/notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', '<WEBHOOK_SECRET>'
    ),
    body := jsonb_build_object(
      'type', TG_OP,
      'table', TG_TABLE_NAME,
      'schema', TG_TABLE_SCHEMA,
      'record', case when TG_OP = 'DELETE' then null else to_jsonb(NEW) end,
      'old_record', case when TG_OP = 'INSERT' then null else to_jsonb(OLD) end
    ),
    timeout_milliseconds := 5000
  );
  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists notify_suggestions_webhook on public.group_suggestions;
create trigger notify_suggestions_webhook
  after insert or update on public.group_suggestions
  for each row execute function public.notify_webhook();

drop trigger if exists notify_messages_webhook on public.messages;
create trigger notify_messages_webhook
  after insert on public.messages
  for each row execute function public.notify_webhook();
