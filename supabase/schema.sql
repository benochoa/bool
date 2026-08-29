-- bool — database schema (current-state mirror)
--
-- NOT a chronological migration log. A snapshot of the live Supabase database
-- (Postgres 17.6), captured 2026-08-29T05:31Z by running supabase/introspect.sql
-- in the dashboard and folding the result in here.
--
-- Every line below was read out of pg_catalog: column definitions, constraints,
-- indexes, RLS policies, function bodies, triggers, grants, buckets, realtime
-- membership and event triggers. Nothing is transcribed from intent, which is
-- the point — an earlier copy of this file had drifted three changes behind
-- without anything noticing, and one storage policy did not mean what it said.
--
-- Regenerate after any dashboard change: run supabase/introspect.sql, paste the
-- JSON, fold it in. Its output now exceeds a single paste, so it runs in two
-- halves — function bodies, then everything else.
--
-- The <WEBHOOK_SECRET> below is a placeholder. The live notify_webhook() body
-- carries the real value; introspect.sql redacts it on the way out so a capture
-- can be pasted and committed safely.
--
-- Access model in one line: Supabase grants anon + authenticated broad table
-- privileges by default, and ROW-LEVEL SECURITY is the real gate. Every table in
-- public has RLS enabled; the policies below (and the private.* helpers they
-- call) enforce who sees and changes what. Anonymous callers get nothing
-- anywhere, because every rule funnels through auth.uid(), which is null for
-- anon — verified live by probing all 15 tables with the publishable key.

-- ===========================================================================
-- Extensions & schemas
-- ===========================================================================

create extension if not exists pg_net;            -- outbound HTTP for webhooks

-- Authorization helpers live in their own schema so PostgREST never exposes
-- them as callable RPCs — they are only ever invoked from inside policies.
create schema if not exists private;

-- ===========================================================================
-- Invite-code generator (defined first: it is a column default on groups)
-- ===========================================================================

-- Six readable characters, no 0/O/1/I/L. Loops until unique. security definer
-- so it can check groups.invite_code even though clients can't read that column.
create or replace function private.generate_invite_code()
returns text language plpgsql security definer set search_path = public as $$
declare
  chars text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';  -- no 0/O/1/I/L: read aloud
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

-- ===========================================================================
-- Stored-URL guards (defined before the tables: they are column checks)
--
-- SECURITY (2026-08-29 audit): every URL the app renders comes out of a column a
-- client writes — profile_pic_url, image_urls, media_url — and lib/storageAuth
-- attached the viewer's access token to whatever it was handed. Anyone could
-- point their own profile picture at a server they controlled and collect the
-- token of every person who rendered it. The client now only sends the header to
-- this prefix; these constraints stop a foreign URL being stored at all, which
-- also closes the lesser version — an external URL leaks every viewer's IP even
-- without the header.
--
-- Neither is security definer and neither pins a search_path, deliberately:
-- they read no tables, only their own argument, so there is nothing to capture.
-- ===========================================================================

create or replace function private.is_storage_url(u text)
returns boolean language sql immutable as $$
  select u is null
      or u like 'https://vsgdhfwhpiucplkraizw.supabase.co/storage/v1/object/authenticated/%';
$$;

-- A CHECK cannot contain a subquery, so the all-elements test for a text[]
-- column goes through a function taking the whole array.
create or replace function private.all_storage_urls(us text[])
returns boolean language sql immutable as $$
  select coalesce(bool_and(private.is_storage_url(u)), true) from unnest(us) as u;
$$;

-- ===========================================================================
-- Tables
-- ===========================================================================

-- profiles.id is NOT a foreign key to auth.users: most rows are browsable
-- seed/content profiles with no login. A real user's profile shares its id with
-- their auth user id once they sign in (app/login.tsx upserts on first login).
create table profiles (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null default '' constraint profiles_name_len check (char_length(name) <= 60),
  qa                 jsonb not null default '[]' constraint profiles_qa_size check (char_length(qa::text) <= 8000),
  image_urls         text[] not null default '{}'
                       constraint profiles_image_urls_storage check (private.all_storage_urls(image_urls)) not valid,
  profile_pic_url    text constraint profiles_pic_url_storage check (private.is_storage_url(profile_pic_url)) not valid,
  image_aspect_ratio numeric,
  card_order         text[],
  -- Identifiers: all text. An individual's age is a year ('21'); '30+' and
  -- '18-20' are not numbers. City/college are free text (bundled list is only a
  -- suggestion). Nullable because rows predate them; the app requires them at
  -- save time rather than the schema.
  age                text,
  gender             text,
  city               text,
  college            text
);

-- SECURITY (2026-08 audit): groups.id is client-supplied text. Two storage
-- policies recover group ids from a folder name by splitting on '_', which is
-- only sound while an id contains none — and the notify function interpolates
-- ids into a PostgREST filter string while holding the service role. Ids are
-- Crypto.randomUUID() in the app, but nothing enforced it until this
-- constraint. NOT VALID: it binds new writes without rejecting legacy rows.
--
-- created_by has no ON DELETE: a profile cannot be deleted out from under a
-- group it leads. delete_my_account removes the led groups first, in order.
create table groups (
  id                 text primary key constraint groups_id_format check (id ~ '^[A-Za-z0-9-]+$') not valid,
  name               text not null default '' constraint groups_name_len check (char_length(name) <= 60),
  qa                 jsonb not null default '[]' constraint groups_qa_size check (char_length(qa::text) <= 8000),
  created_by         uuid references profiles (id),               -- the leader (nullable: legacy rows)
  invite_code        text unique default private.generate_invite_code(),
  image_urls         text[] not null default '{}'
                       constraint groups_image_urls_storage check (private.all_storage_urls(image_urls)) not valid,
  status             text not null default 'active' check (status in ('active', 'dissolved')),
  image_aspect_ratio numeric,
  card_order         text[],
  age                text,
  gender             text,
  city               text,
  college            text
);

create table questions (
  category  text primary key,
  questions jsonb not null default '[]'
);

-- Only status='active' rows define a group. left/kicked/group_dissolved rows
-- are kept for History (with the moment and manner each ended). The constraint
-- names still say group_members: the table was renamed, they were not.
create table memberships (
  group_id  text not null references groups (id) on delete cascade,
  person_id uuid not null references profiles (id) on delete cascade,
  status    text not null default 'active'
              constraint group_members_status_check
              check (status in ('active', 'kicked', 'left', 'group_dissolved')),
  status_at timestamptz not null default now(),
  constraint group_members_pkey primary key (group_id, person_id)
);

create index memberships_person_idx on memberships (person_id, status);

-- The matching funnel. One row per (suggesting group, target group) pair — the
-- primary key doubling as the "already suggested" guard. pending -> sent (the
-- suggesting leader) -> matched (the target leader).
create table group_suggestions (
  suggesting_group_id text not null references groups (id) on delete cascade,
  target_group_id     text not null references groups (id) on delete cascade,
  suggested_by        uuid not null references profiles (id),
  created_at          timestamptz not null default now(),
  status              text not null default 'pending' check (status in ('pending', 'sent', 'matched')),
  matched_at          timestamptz,
  primary key (suggesting_group_id, target_group_id)
);

create index group_suggestions_target_idx on group_suggestions (target_group_id);
-- Read by check_suggestion_rate on every insert.
create index group_suggestions_suggester_recent_idx
  on group_suggestions (suggested_by, created_at desc);

-- A conversation is an unordered pair of matched groups, always stored with
-- group_1_id < group_2_id (check constraint) so a thread reads with two plain
-- .eq() filters. sender_group_id is stored directly so it's known without a
-- join. Deletion is soft (deleted_at) — the row stays for ordering and replies.
create table messages (
  id                 bigint generated always as identity primary key,
  group_1_id         text not null references groups (id) on delete cascade,
  group_2_id         text not null references groups (id) on delete cascade,
  sender_group_id    text not null references groups (id) on delete cascade,
  sender_id          uuid not null references profiles (id) on delete cascade,
  body               text not null constraint messages_body_len check (char_length(body) <= 4000),
  created_at         timestamptz not null default now(),
  kind               text not null default 'text' check (kind in ('text', 'image', 'audio', 'video')),
  media_url          text constraint messages_media_url_storage check (private.is_storage_url(media_url)) not valid,
  media_aspect_ratio numeric,
  deleted_at         timestamptz,
  reply_to_id        bigint references messages (id) on delete set null,
  media_waveform     jsonb,
  constraint messages_group_order check (group_1_id < group_2_id)
);

create index messages_conversation_idx on messages (group_1_id, group_2_id, created_at);
create index messages_sender_recent_idx on messages (sender_id, created_at desc);

-- One tapback per person per message (the primary key enforces it, so a new
-- emoji is a replacing upsert). It points at both messages and profiles, so
-- PostgREST reads it as a junction table — fetchMessages names its path
-- explicitly (profiles!sender_id) to disambiguate.
create table message_reactions (
  message_id bigint not null references messages (id) on delete cascade,
  user_id    uuid   not null references profiles (id) on delete cascade,
  emoji      text   not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

-- Read state for Chats: one row per user per chat, stamped when they close the
-- thread. Per-user, unlike the group content above — who has read what is
-- nobody else's business. Keyed by the canonical pair. References auth.users
-- rather than profiles: it is login state, and it should go when the login does.
create table chat_reads (
  user_id      uuid not null references auth.users (id) on delete cascade,
  group_1_id   text not null references groups (id) on delete cascade,
  group_2_id   text not null references groups (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (user_id, group_1_id, group_2_id)
);

-- Person-to-person blocking. Deliberately narrow: it does nothing to matching —
-- a blocked person's group still appears in For You and can still match; the two
-- of you simply stop seeing each other's messages inside the resulting chat.
create table blocked_people (
  blocker_id uuid not null references profiles (id) on delete cascade,
  blocked_id uuid not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocked_people_not_self check (blocker_id <> blocked_id)
);

-- Hiding is mutual, so the "who blocked me" direction is read just as often.
create index blocked_people_blocked_idx on blocked_people (blocked_id, blocker_id);

-- One row per device (token is the key). A device that changes accounts
-- re-points its row at the new user, so a phone never keeps notifying its
-- previous owner. Read by the notify edge function with the service role.
create table push_tokens (
  token      text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  updated_at timestamptz not null default now()
);

create index push_tokens_user_idx on push_tokens (user_id);

-- In-app bug reports. Insert-only from clients; read with the service role.
create table bug_reports (
  id          bigint generated always as identity primary key,
  reporter_id uuid not null references profiles (id) on delete cascade,
  body        text not null,
  created_at  timestamptz not null default now()
);

create index bug_reports_reporter_recent_idx on bug_reports (reporter_id, created_at desc);

-- Abuse reports. Only one target_* is set, per target_type. message_snapshot
-- copies the body at report time because messages are soft-deletable — without
-- it a sender could blank the evidence before anyone reads the report. The
-- targets are ON DELETE SET NULL, so a report outlives what it points at.
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
create index reports_reporter_recent_idx on reports (reporter_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Group discussions
--
-- A discussion is a group's private back-room about ONE candidate group: the
-- members of `group_id` talking among themselves about `about_group_id`. The
-- candidate has no path to it whatsoever, which is the point and the reason it
-- cannot live in `messages`:
--
--   * messages_select grants read to active members of EITHER group in the
--     pair, so a discussion stored there would be readable by the group being
--     discussed.
--   * messages_insert requires private.groups_matched(), and a suggestion in
--     Pending or Received is by definition not matched.
--
-- Every policy gates on `group_id` alone. `about_group_id` is a subject, never
-- a grant. Deliberately NOT cascading on the suggestion: a discussion outlives
-- the suggestion that prompted it. The rows go only when a group itself goes.
-- ---------------------------------------------------------------------------

-- Mirrors `messages` column for column, minus the canonical-pair machinery:
-- a discussion has one owning group, not an unordered two.
create table discussion_messages (
  id                 bigint generated always as identity primary key,
  group_id           text not null references groups (id) on delete cascade,
  about_group_id     text not null references groups (id) on delete cascade,
  sender_id          uuid not null references profiles (id) on delete cascade,
  body               text not null constraint discussion_messages_body_len check (char_length(body) <= 4000),
  created_at         timestamptz not null default now(),
  kind               text not null default 'text' check (kind in ('text', 'image', 'audio', 'video')),
  media_url          text
                       constraint discussion_messages_media_url_storage
                       check (private.is_storage_url(media_url)) not valid,
  media_aspect_ratio numeric,
  deleted_at         timestamptz,
  reply_to_id        bigint references discussion_messages (id) on delete set null,
  media_waveform     jsonb,
  -- A group discussing itself is not a thing the UI can produce, and allowing
  -- it would make the storage path ambiguous.
  constraint discussion_not_self check (group_id <> about_group_id)
);

create index discussion_messages_thread_idx
  on discussion_messages (group_id, about_group_id, created_at);
create index discussion_messages_sender_recent_idx
  on discussion_messages (sender_id, created_at desc);

-- One tapback per person per message, same shape as message_reactions.
create table discussion_reactions (
  message_id bigint not null references discussion_messages (id) on delete cascade,
  user_id    uuid   not null references profiles (id) on delete cascade,
  emoji      text   not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

-- Read state per user per discussion — what the red badge on each preview tile
-- is measured against. Per-user, like chat_reads, and keyed to auth.users too.
create table discussion_reads (
  user_id        uuid not null references auth.users (id) on delete cascade,
  group_id       text not null references groups (id) on delete cascade,
  about_group_id text not null references groups (id) on delete cascade,
  last_read_at   timestamptz not null default now(),
  primary key (user_id, group_id, about_group_id)
);

-- ===========================================================================
-- Realtime
-- Streams nothing until a table is added to this publication (no error if
-- forgotten, just silence). Realtime re-checks the SELECT policy per
-- subscriber, so a table here is only as private as its select policy.
-- ===========================================================================

alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table message_reactions;
alter publication supabase_realtime add table groups;
alter publication supabase_realtime add table memberships;
alter publication supabase_realtime add table group_suggestions;
alter publication supabase_realtime add table discussion_messages;
alter publication supabase_realtime add table discussion_reactions;

-- replica identity full: a change event otherwise carries only the primary key
-- of the old row, but the client and the notify function need the *previous*
-- status to tell a join from a rejoin from a leave.
alter table memberships replica identity full;

-- ===========================================================================
-- Authorization helpers (private schema — never exposed as RPCs)
-- All are STABLE SECURITY DEFINER with a pinned search_path: they bypass RLS
-- internally (so the policies that call them don't recurse), return only a
-- boolean, and test only the caller's own relationships.
--
-- Using these rather than an inline subquery is not a style preference. A
-- subquery inside a policy is itself subject to RLS, which is what broke
-- memberships_insert_self: it asked whether you owned a group you could not yet
-- see, and the answer was always no. See the note on that policy.
-- ===========================================================================

create or replace function private.is_active_member(p_group_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships
     where group_id = p_group_id and person_id = auth.uid() and status = 'active'
  );
$$;

create or replace function private.is_group_leader(p_group_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from groups where id = p_group_id and created_by = auth.uid()
  );
$$;

-- Visible when: it's one of mine now or in the past (History needs the ones I've
-- left), or an active candidate in a city where I have a group, or already
-- related to one of mine via a suggestion.
create or replace function private.can_see_group(p_group_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select
    -- one of mine, now or in the past — History needs the ones I've left
    exists (
      select 1 from memberships
       where group_id = p_group_id and person_id = auth.uid()
    )
    -- or a candidate in the deck: an active group in a city where I have one
    or exists (
      select 1 from groups g
       where g.id = p_group_id
         and g.status = 'active'
         and g.city is not null
         and g.city in (
           select g2.city from memberships m
             join groups g2 on g2.id = m.group_id
            where m.person_id = auth.uid() and m.status = 'active'
         )
    )
    -- or already related to one of mine, whichever way it started
    or exists (
      select 1 from group_suggestions gs
       where (gs.suggesting_group_id = p_group_id and private.is_active_member(gs.target_group_id))
          or (gs.target_group_id     = p_group_id and private.is_active_member(gs.suggesting_group_id))
    );
$$;

create or replace function private.can_see_person(p_person text)
returns boolean language sql stable security definer set search_path = public as $$
  select p_person = auth.uid()::text
      or exists (
        select 1 from memberships m
         where m.person_id::text = p_person and private.can_see_group(m.group_id)
      )
      or exists (
        select 1 from blocked_people
         where blocker_id = auth.uid() and blocked_id::text = p_person
      );
$$;

create or replace function private.groups_matched(a text, b text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from group_suggestions
     where status = 'matched'
       and ((suggesting_group_id = a and target_group_id = b)
         or (suggesting_group_id = b and target_group_id = a))
  );
$$;

-- True when either has blocked the other (both directions, since the policy on
-- blocked_people hides the "they blocked me" rows from me).
create or replace function private.blocks_between(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from blocked_people
     where (blocker_id = a and blocked_id = b)
        or (blocker_id = b and blocked_id = a)
  );
$$;

-- Directional half of blocking: true only when the sender has blocked me. Used
-- by messages_select so I stop seeing a blocker's messages, while everyone else
-- in the chat still sees the thread whole.
create or replace function private.sender_blocked_me(p_sender uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from blocked_people
     where blocker_id = p_sender and blocked_id = auth.uid()
  );
$$;

-- SECURITY (2026-08-29 audit): exists so the groups-bucket insert policy can ask
-- "does this group row exist yet?" without opening a subquery on `groups` inside
-- the policy. It did have one, and the bare `name` in it bound to groups.name
-- rather than storage.objects.name — which made the branch always true and the
-- policy bucket-only, letting any authenticated user write into any group's
-- folder. A function argument cannot be captured that way.
create or replace function private.group_missing(p_group_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (select 1 from groups where id = p_group_id);
$$;

-- ---------------------------------------------------------------------------
-- Rate limits (BEFORE INSERT triggers below)
--
-- One per table rather than one generic function: counted separately so a busy
-- discussion can't starve the real chat, and each carries the message its own
-- callers should see. All definer, so the count sees rows RLS would hide.
-- ---------------------------------------------------------------------------

create or replace function private.check_message_rate()
returns trigger language plpgsql security definer set search_path = public as $$
declare recent int;
begin
  select count(*) into recent
    from messages
   where sender_id = new.sender_id
     and created_at > now() - interval '1 minute';
  if recent >= 30 then
    raise exception 'Too many messages — slow down.';
  end if;
  return new;
end;
$$;

create or replace function private.check_discussion_rate()
returns trigger language plpgsql security definer set search_path = public as $$
declare recent int;
begin
  select count(*) into recent
    from discussion_messages
   where sender_id = new.sender_id
     and created_at > now() - interval '1 minute';
  if recent >= 30 then
    raise exception 'Too many messages — slow down.';
  end if;
  return new;
end;
$$;

-- The primary key already stops the same target being suggested twice, so the
-- row count is bounded anyway — this is about the webhook. Every insert fires
-- notify_suggestions_webhook, which posts to the edge function and pushes to the
-- whole group, so an unthrottled loop is a push amplifier rather than noise.
create or replace function private.check_suggestion_rate()
returns trigger language plpgsql security definer set search_path = public as $$
declare recent int;
begin
  select count(*) into recent
    from group_suggestions
   where suggested_by = new.suggested_by
     and created_at > now() - interval '1 minute';
  if recent >= 30 then
    raise exception 'Too many suggestions — slow down.';
  end if;
  return new;
end;
$$;

-- Nothing constrains a report the way a primary key constrains a suggestion, so
-- the same target can be reported endlessly. Ten an hour is far past what a
-- person does and still leaves a flood visible as a flood rather than burying
-- the queue.
create or replace function private.check_report_rate()
returns trigger language plpgsql security definer set search_path = public as $$
declare recent int;
begin
  select count(*) into recent
    from reports
   where reporter_id = new.reporter_id
     and created_at > now() - interval '1 hour';
  if recent >= 10 then
    raise exception 'Too many reports — try again later.';
  end if;
  return new;
end;
$$;

create or replace function private.check_bug_report_rate()
returns trigger language plpgsql security definer set search_path = public as $$
declare recent int;
begin
  select count(*) into recent
    from bug_reports
   where reporter_id = new.reporter_id
     and created_at > now() - interval '1 hour';
  if recent >= 10 then
    raise exception 'Too many reports — try again later.';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Key freezing (BEFORE UPDATE triggers below)
--
-- SECURITY (2026-08 audit): the update policies check who owns a row; these
-- check that the row cannot move. Without them a policy that passes on both the
-- old and the new row still permits relocating a message between two
-- conversations the sender belongs to. Not definer — they only compare NEW
-- against OLD.
-- ---------------------------------------------------------------------------

create or replace function private.message_keys_frozen()
returns trigger language plpgsql as $$
begin
  if new.group_1_id      <> old.group_1_id
     or new.group_2_id   <> old.group_2_id
     or new.sender_group_id <> old.sender_group_id
     or new.sender_id    <> old.sender_id
     or new.created_at   <> old.created_at then
    raise exception 'a message cannot change conversation, sender or timestamp';
  end if;
  return new;
end;
$$;

create or replace function private.discussion_message_keys_frozen()
returns trigger language plpgsql as $$
begin
  if new.group_id <> old.group_id
     or new.about_group_id <> old.about_group_id
     or new.sender_id <> old.sender_id then
    raise exception 'a discussion message cannot change group, subject or sender';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Upload quota
--
-- SECURITY (2026-08-29 audit): every storage policy bounded a single object's
-- size but nothing bounded how many. Two ceilings, because one alone leaves a
-- hole: a count stops a flood of small files but not ten 50MB videos, and a byte
-- budget stops the reverse.
--
-- Both `owner` and `owner_id` are read. Supabase populates the newer owner_id
-- (text) and keeps the older owner (uuid) for compatibility; which one is set
-- varies by version, and reading only one risks a quota that silently never
-- matches anything. Both are populated today — checked.
--
-- Unindexed: storage.objects is owned by supabase_storage_admin, which a hosted
-- project cannot CREATE INDEX on or SET ROLE to. The scan is trivial at present
-- volume and would want revisiting in the six figures.
-- ---------------------------------------------------------------------------

create or replace function private.under_upload_quota()
returns boolean language sql stable security definer set search_path = public as $$
  select count(*) < 100
     and coalesce(sum((metadata->>'size')::bigint), 0) < 524288000   -- 500 MB
    from storage.objects
   where (owner = auth.uid() or owner_id = auth.uid()::text)
     and created_at > now() - interval '1 hour';
$$;

-- ===========================================================================
-- Client-facing RPCs (public schema)
-- ===========================================================================

-- Red dot on the Chats tab: counts chats with something unread, not messages.
-- The user comes from auth.uid(), not an argument, so no one can ask for
-- another's count. Not security definer — runs with the caller's RLS.
create or replace function get_unread_chat_count(my_group_id text)
returns integer language sql stable as $$
  select count(*)::int from (
    select m.group_1_id, m.group_2_id
    from public.messages m
    left join public.chat_reads r
      on  r.user_id    = auth.uid()
      and r.group_1_id = m.group_1_id
      and r.group_2_id = m.group_2_id
    where (m.group_1_id = my_group_id or m.group_2_id = my_group_id)
      and m.sender_id <> auth.uid()
      and (r.last_read_at is null or m.created_at > r.last_read_at)
    group by m.group_1_id, m.group_2_id
  ) unread_chats;
$$;

-- Chat list previews in one round trip. Not security definer — the caller's RLS
-- already hides a blocker's rows, so the lateral lands on the newest message
-- this viewer can see; the case only relabels a message from someone THIS user
-- has blocked (their own block hides nothing by itself).
--
-- last_message_sender drives the "Name: message" line in the Chats tab.
create or replace function get_chat_previews(my_group_id text)
returns table(other_group_id text, other_group_name text, last_message text,
              last_message_at timestamptz, other_group_image_urls text[],
              last_message_sender text)
language sql stable as $$
  select
    g.id::text,
    g.name::text,
    case
      when exists (select 1 from blocked_people bp
                   where bp.blocker_id = auth.uid() and bp.blocked_id = m.sender_id)
      then 'Message from blocked user'
      else m.body::text
    end,
    m.created_at::timestamptz,
    g.image_urls::text[],
    -- 'You' for your own, so the row reads the way the sender thinks of it.
    -- Null for someone blocked: the body above is already a placeholder, and
    -- naming them would put back exactly what the placeholder removes. Self
    -- comes first, though blocked_people_not_self means the two can't overlap.
    case
      when m.sender_id = auth.uid() then 'You'
      when exists (select 1 from blocked_people bp
                   where bp.blocker_id = auth.uid() and bp.blocked_id = m.sender_id)
      then null
      else p.name::text
    end
  from group_suggestions gs
  cross join lateral (
    select case when gs.suggesting_group_id = my_group_id then gs.target_group_id
                else gs.suggesting_group_id end as other_id
  ) x
  join groups g on g.id = x.other_id
  left join lateral (
    select body, created_at, sender_id
    from messages
    where group_1_id = least(my_group_id, x.other_id)
      and group_2_id = greatest(my_group_id, x.other_id)
    order by created_at desc
    limit 1
  ) m on true
  left join profiles p on p.id = m.sender_id
  where gs.status = 'matched'
    and (gs.suggesting_group_id = my_group_id or gs.target_group_id = my_group_id)
  order by m.created_at desc nulls last;
$$;

-- Every preview tile carries its own badge, so the list needs one round trip
-- for all of them. Not security definer — the caller's RLS already limits it to
-- their own group, and auth.uid() rather than an argument means nobody can ask
-- for another person's counts.
create or replace function get_discussion_unread_counts(my_group_id text)
returns table(about_group_id text, unread integer)
language sql stable as $$
  select m.about_group_id::text, count(*)::int
    from discussion_messages m
    left join discussion_reads r
      on  r.user_id        = auth.uid()
      and r.group_id       = m.group_id
      and r.about_group_id = m.about_group_id
   where m.group_id = my_group_id
     and m.sender_id <> auth.uid()
     and m.deleted_at is null
     and (r.last_read_at is null or m.created_at > r.last_read_at)
   group by m.about_group_id;
$$;

-- Everyone the viewer should see rendered as "Blocked user" (both directions).
create or replace function get_blocked_person_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select blocked_id from blocked_people where blocker_id = auth.uid()
  union
  select blocker_id from blocked_people where blocked_id = auth.uid();
$$;

-- Where a person's own storage objects are, for lib/deleteMyMedia. Chat and
-- discussion media is filed under the conversation, so someone's files are
-- spread across every thread they ever wrote in and no list() of a known folder
-- would find them. security definer because storage.objects isn't readable by
-- clients; the filter is auth.uid(), so it can only return the caller's own.
create or replace function my_media_paths()
returns table(bucket_id text, name text)
language sql stable security definer set search_path = public as $$
  select o.bucket_id::text, o.name::text
    from storage.objects o
   where o.owner = auth.uid() or o.owner_id = auth.uid()::text;
$$;

-- Redeem an invite code. security definer so it can read invite_code (revoked
-- from clients) and insert the membership past RLS. Upserts, so redeeming a code
-- for a group you left reactivates that row.
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

-- The leader's own read of their invite code (the only way it reaches a client).
create or replace function get_invite_code(p_group_id text)
returns text language sql stable security definer set search_path = public as $$
  select invite_code from groups
   where id = p_group_id and created_by = auth.uid();
$$;

-- Register a push token. Replaces a table write path whose update policy had a
-- using(true) hole (an unfiltered PATCH re-pointed every token at its sender).
create or replace function register_push_token(p_token text)
returns void language sql security definer set search_path = public as $$
  insert into push_tokens (token, user_id, updated_at)
  values (p_token, auth.uid(), now())
  on conflict (token) do update
    set user_id = auth.uid(), updated_at = now();
$$;

-- SECURITY (2026-08 audit): dissolve_group is SECURITY DEFINER and callable by
-- anyone, so it MUST check the caller itself. Without the guard, any client
-- could dissolve any group by id. The guard restricts it to the leader.
create or replace function dissolve_group(p_group_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from groups where id = p_group_id and created_by = auth.uid()) then
    raise exception 'not authorized';
  end if;

  update memberships set status = 'group_dissolved', status_at = now()
    where group_id = p_group_id and status = 'active';
  delete from group_suggestions
    where (suggesting_group_id = p_group_id or target_group_id = p_group_id)
      and status <> 'matched';
  update groups set status = 'dissolved' where id = p_group_id;
end;
$$;

-- Full account deletion. Storage objects are cleared client-side first
-- (lib/deleteMyMedia.ts) because Postgres refuses direct deletes on
-- storage.objects, and it must happen before the group rows go, or the leader
-- check in the storage policy has nothing to pass against. That sweep now uses
-- my_media_paths above, so chat and discussion media go with everything else —
-- they used to survive, having no DELETE policy to reach them.
create or replace function delete_my_account()
returns void language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  led_group_id text;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  for led_group_id in select id from groups where created_by = uid loop
    delete from messages where group_1_id = led_group_id or group_2_id = led_group_id;
    delete from group_suggestions where suggesting_group_id = led_group_id or target_group_id = led_group_id;
    delete from memberships where group_id = led_group_id;
    delete from groups where id = led_group_id;
  end loop;

  delete from memberships where person_id = uid;
  delete from messages where sender_id = uid;
  delete from profiles where id = uid;
  -- Without this the login survives, the phone number is kept, and everything
  -- keyed to auth.users (push_tokens, chat_reads, discussion_reads) stays.
  delete from auth.users where id = uid;
end;
$$;

-- ===========================================================================
-- Row-level security
-- ===========================================================================

alter table profiles             enable row level security;
alter table groups               enable row level security;
alter table memberships          enable row level security;
alter table questions            enable row level security;
alter table group_suggestions    enable row level security;
alter table messages             enable row level security;
alter table message_reactions    enable row level security;
alter table chat_reads           enable row level security;
alter table blocked_people       enable row level security;
alter table push_tokens          enable row level security;
alter table bug_reports          enable row level security;
alter table reports              enable row level security;
alter table discussion_messages  enable row level security;
alter table discussion_reactions enable row level security;
alter table discussion_reads     enable row level security;

-- Safety net: auto-enable RLS on any new table created in public, so a future
-- table can't ship accidentally world-open. Live as event trigger `ensure_rls`.
create or replace function public.rls_auto_enable()
returns event_trigger language plpgsql security definer set search_path = pg_catalog as $$
declare cmd record;
begin
  for cmd in
    select * from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      and object_type in ('table', 'partitioned table')
  loop
    if cmd.schema_name is not null and cmd.schema_name in ('public') then
      begin
        execute format('alter table if exists %s enable row level security', cmd.object_identity);
        raise log 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      exception when others then
        raise log 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      end;
    else
      raise log 'rls_auto_enable: skip %', cmd.object_identity;
    end if;
  end loop;
end;
$$;

drop event trigger if exists ensure_rls;
create event trigger ensure_rls on ddl_command_end
  execute function public.rls_auto_enable();

-- profiles -------------------------------------------------------------------
create policy profiles_select on profiles
  for select to authenticated using (private.can_see_person((id)::text));
create policy profiles_insert_own on profiles
  for insert to authenticated with check (auth.uid() = id);
create policy profiles_update_own on profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- groups ---------------------------------------------------------------------
create policy groups_select on groups
  for select to authenticated using (private.can_see_group(id));
create policy groups_insert on groups
  for insert to authenticated with check (auth.uid() = created_by);
-- with_check stays permissive so makeGroupLeader can reassign created_by
-- (leadership transfer). using() already restricts the row to the current leader.
create policy groups_update_leader on groups
  for update to authenticated using (auth.uid() = created_by) with check (true);

-- memberships ----------------------------------------------------------------
create policy memberships_select on memberships
  for select to authenticated using (private.can_see_group(group_id));
-- SECURITY (2026-08 audit): a bare (auth.uid() = person_id) let anyone insert
-- themselves into ANY group, bypassing the invite code. A direct self-insert is
-- limited to a group you created (the only legitimate one, on creation); every
-- other join goes through join_group_by_code (definer, bypasses RLS).
--
-- FIXED 2026-08-29: that audit expressed the ownership test as an inline
-- `exists (select 1 from groups ...)`, which is itself subject to RLS. A
-- brand-new group is invisible to can_see_group — you have no membership yet,
-- that being what is being inserted — so the subquery found nothing and every
-- first group creation was rejected, leaving a group with no members. The
-- definer helper sees the row and enforces exactly the same rule.
create policy memberships_insert_self on memberships
  for insert to authenticated with check (
    auth.uid() = person_id
    and private.is_group_leader(group_id)
  );
-- SECURITY (2026-08 audit): a bare (auth.uid() = person_id) with_check let a
-- kicked member set their own row back to 'active', or hop it into another
-- group. Self-updates are limited to leaving; leaders keep full control.
create policy memberships_update on memberships
  for update to authenticated
  using (auth.uid() = person_id or private.is_group_leader(group_id))
  with check ((auth.uid() = person_id and status = 'left') or private.is_group_leader(group_id));

-- group_suggestions ----------------------------------------------------------
create policy gs_select on group_suggestions
  for select to authenticated
  using (private.is_active_member(suggesting_group_id) or private.is_active_member(target_group_id));
create policy gs_insert on group_suggestions
  for insert to authenticated with check (
    auth.uid() = suggested_by
    and private.is_active_member(suggesting_group_id)
    and status = 'pending'
  );
-- SECURITY (2026-08 audit): with_check was `true`, so the suggesting leader
-- could set 'matched' and force a match the target never approved. Encode the
-- funnel: suggesting leader may produce 'sent', target leader may produce
-- 'matched'.
create policy gs_update on group_suggestions
  for update to authenticated
  using (private.is_group_leader(suggesting_group_id) or private.is_group_leader(target_group_id))
  with check (
    (private.is_group_leader(suggesting_group_id) and status = 'sent')
    or (private.is_group_leader(target_group_id) and status = 'matched')
  );
create policy gs_delete on group_suggestions
  for delete to authenticated
  using (private.is_group_leader(suggesting_group_id) or private.is_group_leader(target_group_id));

-- messages -------------------------------------------------------------------
-- No delete policy: deletion is soft (deleted_at via update), never a hard row
-- delete. Select hides a blocker's messages from me (directional).
create policy messages_select on messages
  for select to authenticated using (
    (private.is_active_member(group_1_id) or private.is_active_member(group_2_id))
    and not private.sender_blocked_me(sender_id)
  );
create policy messages_insert on messages
  for insert to authenticated with check (
    auth.uid() = sender_id
    and private.is_active_member(sender_group_id)
    and (sender_group_id = group_1_id or sender_group_id = group_2_id)
    and private.groups_matched(group_1_id, group_2_id)
  );
-- SECURITY (2026-08-29 audit): was (auth.uid() = sender_id) on both sides and
-- never looked at the pair, so a PATCH could relocate your own message into any
-- conversation in the database — re-opening everything messages_insert guards.
-- The membership check plus the messages_keys_frozen trigger close it.
create policy messages_update_own on messages
  for update to authenticated
  using (auth.uid() = sender_id and private.is_active_member(sender_group_id))
  with check (auth.uid() = sender_id and private.is_active_member(sender_group_id));

-- message_reactions ----------------------------------------------------------
-- SECURITY (2026-08 audit): reactions were readable app-wide and insertable
-- onto any message id. Both are now scoped to a member of the message's chat.
create policy mr_select on message_reactions
  for select to authenticated using (
    not private.blocks_between(auth.uid(), user_id)
    and exists (
      select 1 from messages m
      where m.id = message_id
        and (private.is_active_member(m.group_1_id) or private.is_active_member(m.group_2_id))
    )
  );
create policy mr_insert_own on message_reactions
  for insert to authenticated with check (
    auth.uid() = user_id
    and exists (
      select 1 from messages m
      where m.id = message_id
        and (private.is_active_member(m.group_1_id) or private.is_active_member(m.group_2_id))
    )
  );
-- SECURITY (2026-08-29 audit): the with_check was user_id only, so your own
-- reaction row could be re-pointed at any message id in the database.
create policy mr_update_own on message_reactions
  for update to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from messages m
      where m.id = message_id
        and (private.is_active_member(m.group_1_id) or private.is_active_member(m.group_2_id))
    )
  );
create policy mr_delete_own on message_reactions
  for delete to authenticated using (auth.uid() = user_id);

-- discussion_messages --------------------------------------------------------
-- Membership of the OWNING group and nothing else. sender_blocked_me mirrors
-- the main thread: someone in your group who blocked you goes quiet for you.
create policy dm_select on discussion_messages
  for select to authenticated using (
    private.is_active_member(group_id)
    and not private.sender_blocked_me(sender_id)
  );
create policy dm_insert on discussion_messages
  for insert to authenticated with check (
    auth.uid() = sender_id
    and private.is_active_member(group_id)
  );
-- Membership is checked on update as well as insert: a policy that looked only
-- at sender_id would accept a PATCH that also moved group_id.
create policy dm_update_own on discussion_messages
  for update to authenticated
  using (auth.uid() = sender_id and private.is_active_member(group_id))
  with check (auth.uid() = sender_id and private.is_active_member(group_id));

-- discussion_reactions -------------------------------------------------------
create policy dr_select on discussion_reactions
  for select to authenticated using (
    not private.blocks_between(auth.uid(), user_id)
    and exists (
      select 1 from discussion_messages m
      where m.id = message_id and private.is_active_member(m.group_id)
    )
  );
create policy dr_insert_own on discussion_reactions
  for insert to authenticated with check (
    auth.uid() = user_id
    and exists (
      select 1 from discussion_messages m
      where m.id = message_id and private.is_active_member(m.group_id)
    )
  );
create policy dr_update_own on discussion_reactions
  for update to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from discussion_messages m
      where m.id = message_id and private.is_active_member(m.group_id)
    )
  );
create policy dr_delete_own on discussion_reactions
  for delete to authenticated using (auth.uid() = user_id);

-- Per-user state: read markers, own blocks, own tokens, own reports. These
-- carry no `to authenticated` clause in the live database, so they apply to
-- PUBLIC — safe rather than sloppy only because auth.uid() is null for anon and
-- `null = user_id` is null, never true. Worth tightening for consistency; not a
-- hole.
create policy chat_reads_select_own on chat_reads
  for select using (auth.uid() = user_id);
create policy chat_reads_insert_own on chat_reads
  for insert with check (auth.uid() = user_id);
create policy chat_reads_update_own on chat_reads
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy discussion_reads_select_own on discussion_reads
  for select using (auth.uid() = user_id);
create policy discussion_reads_insert_own on discussion_reads
  for insert with check (auth.uid() = user_id);
create policy discussion_reads_update_own on discussion_reads
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy blocked_people_own on blocked_people
  for all using (auth.uid() = blocker_id) with check (auth.uid() = blocker_id);

-- A token is a capability — own rows only; writes go through register_push_token.
create policy push_tokens_select_own on push_tokens
  for select using (auth.uid() = user_id);
create policy push_tokens_delete_own on push_tokens
  for delete using (auth.uid() = user_id);

-- questions (shared read-only content) ---------------------------------------
create policy questions_select on questions
  for select to authenticated using (true);

-- bug_reports (insert-only from clients; service role reads) ------------------
create policy "insert own bug reports" on bug_reports
  for insert to authenticated with check (auth.uid() = reporter_id);

-- reports (insert-only + read-your-own: a readable table would let someone
-- check whether they had been reported) -------------------------------------
create policy reports_insert_own on reports
  for insert with check (auth.uid() = reporter_id);
create policy reports_select_own on reports
  for select using (auth.uid() = reporter_id);

-- ===========================================================================
-- Grants
-- Supabase's default privileges already grant anon + authenticated broad DML on
-- public tables; RLS above is the gate. Only the deliberate deviations are
-- recorded here. All verified live 2026-08-29.
-- ===========================================================================

-- invite_code is a key to a group's chats, and clients load other groups
-- constantly, so it must never reach a client. A plain column revoke does not
-- hold while a table-level SELECT grant is present (that implies every column),
-- so SELECT is revoked at the table level and re-granted per column, omitting
-- invite_code. The live column grants are exactly these twelve, and `groups` is
-- the one table whose privilege list has no SELECT in it.
revoke select on groups from anon, authenticated;
grant select (id, name, qa, created_by, image_urls, status,
              image_aspect_ratio, card_order, age, gender, city, college)
  on groups to anon, authenticated;

-- Every RPC is authenticated-only. Supabase grants EXECUTE to anon explicitly
-- on new functions, and a revoke from PUBLIC does not remove a role-specific
-- grant — so anon must be named. This also has to be re-run after any DROP and
-- recreate of a function, which resets its ACL: get_chat_previews needed
-- exactly that when its return type changed.
--
-- notify_webhook loses authenticated as well: it is a trigger function whose
-- body carries the webhook secret, and no client has business calling it.
-- Triggers fire without an EXECUTE check, so the four webhooks are unaffected.
revoke all on function register_push_token(text)           from public, anon;
revoke all on function join_group_by_code(text)            from public, anon;
revoke all on function get_invite_code(text)               from public, anon;
revoke all on function my_media_paths()                    from public, anon;
revoke all on function dissolve_group(text)                from anon;
revoke all on function delete_my_account()                 from anon;
revoke all on function get_chat_previews(text)             from anon;
revoke all on function get_unread_chat_count(text)         from anon;
revoke all on function get_discussion_unread_counts(text)  from anon;
revoke all on function get_blocked_person_ids()            from anon;
revoke all on function notify_webhook()                    from public, anon, authenticated;

grant execute on function register_push_token(text) to authenticated;
grant execute on function join_group_by_code(text)  to authenticated;
grant execute on function get_invite_code(text)     to authenticated;
grant execute on function my_media_paths()          to authenticated;

-- ===========================================================================
-- Storage
-- All four buckets are PRIVATE (verified live). Reads go through authenticated
-- URLs (lib/storageAuth.ts) gated by the policies below; the public URL path is
-- dead. RLS is on for storage.buckets with no policies at all, so clients
-- cannot touch bucket rows despite holding DML grants — fail-closed.
--
-- SECURITY (2026-08-29 audit): every bucket had file_size_limit null and no MIME
-- restriction, so a client could store an object of any size and any type. The
-- numbers below come from what the app actually writes: photos are resized to
-- <=1080px and JPEG-compressed at 0.7, so 5MB is roughly a 10x margin; the chat
-- buckets also take 30-second videos (capped by the picker's videoMaxDuration)
-- at 8-15MB, and voice notes capped at five minutes in chatThread.
-- ===========================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('people',           'people',           false,  5242880, array['image/jpeg']),
  ('groups',           'groups',           false,  5242880, array['image/jpeg']),
  ('chat-media',       'chat-media',       false, 52428800, array['image/jpeg','audio/mp4','video/mp4','video/quicktime']),
  ('discussion-media', 'discussion-media', false, 52428800, array['image/jpeg','audio/mp4','video/mp4','video/quicktime'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Applies to every bucket at once and ANDs with the permissive policies below
-- rather than becoming another way in. INSERT only: reads, updates and deletes
-- are untouched.
create policy uploads_under_quota on storage.objects
  as restrictive for insert to authenticated
  with check (private.under_upload_quota());

-- people/{userId}/... — your own folder is yours; others are visible per
-- can_see_person.
create policy people_own on storage.objects
  for all to authenticated
  using (bucket_id = 'people' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'people' and (storage.foldername(name))[1] = auth.uid()::text);
create policy people_select on storage.objects
  for select to authenticated
  using (bucket_id = 'people' and private.can_see_person((storage.foldername(name))[1]));

-- groups/{groupId}/... — leader-only writes, visible per can_see_group.
--
-- SECURITY (2026-08-29 audit): this policy previously inlined
-- `not exists (select 1 from groups where id = (storage.foldername(name))[1])`.
-- Inside that subquery the bare `name` bound to groups.name, not
-- storage.objects.name, so the test asked whether a group's id matched its own
-- display name — never true, making the branch always true and the whole check
-- bucket-only. Any authenticated user could write into any group's folder. The
-- existence test now goes through private.group_missing(), which takes the path
-- segment as an argument and so cannot capture the wrong column.
--
-- The group_missing branch remains because the create flow uploads photos to a
-- brand-new group's folder BEFORE inserting the row (groupPost.tsx). Reversing
-- that order would let the branch go entirely.
create policy groups_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'groups'
    and (
      private.is_group_leader((storage.foldername(name))[1])
      or private.group_missing((storage.foldername(name))[1])
    )
  );
create policy groups_select on storage.objects
  for select to authenticated
  using (bucket_id = 'groups' and private.can_see_group((storage.foldername(name))[1]));
create policy groups_update_leader on storage.objects
  for update to authenticated
  using (bucket_id = 'groups' and private.is_group_leader((storage.foldername(name))[1]))
  with check (bucket_id = 'groups' and private.is_group_leader((storage.foldername(name))[1]));
create policy groups_delete_leader on storage.objects
  for delete to authenticated
  using (bucket_id = 'groups' and private.is_group_leader((storage.foldername(name))[1]));

-- chat-media/{g1}_{g2}/... — members of that chat only.
-- discussion-media/{groupId}_{aboutGroupId}/... — the OWNING group only, so the
-- second path segment grants nothing. Both split on '_', which groups_id_format
-- now guarantees no id contains.
--
-- Neither has an UPDATE policy: sent media is immutable. Both gained a DELETE
-- policy on 2026-08-29 — without one, a departing user's photos and videos had
-- no way out of storage, since deleteMyMedia could not reach them. Ownership is
-- the test: you may remove what you uploaded, and nothing else.
create policy chat_media_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'chat-media'
    and (
      private.is_active_member(split_part((storage.foldername(name))[1], '_', 1))
      or private.is_active_member(split_part((storage.foldername(name))[1], '_', 2))
    )
  );
create policy chat_media_select on storage.objects
  for select to authenticated using (
    bucket_id = 'chat-media'
    and (
      private.is_active_member(split_part((storage.foldername(name))[1], '_', 1))
      or private.is_active_member(split_part((storage.foldername(name))[1], '_', 2))
    )
  );
create policy chat_media_delete_own on storage.objects
  for delete to authenticated using (
    bucket_id = 'chat-media'
    and (owner = auth.uid() or owner_id = auth.uid()::text)
  );

create policy discussion_media_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'discussion-media'
    and private.is_active_member(split_part((storage.foldername(name))[1], '_', 1))
  );
create policy discussion_media_select on storage.objects
  for select to authenticated using (
    bucket_id = 'discussion-media'
    and private.is_active_member(split_part((storage.foldername(name))[1], '_', 1))
  );
create policy discussion_media_delete_own on storage.objects
  for delete to authenticated using (
    bucket_id = 'discussion-media'
    and (owner = auth.uid() or owner_id = auth.uid()::text)
  );

-- ===========================================================================
-- Triggers
-- ===========================================================================

-- Rate limits (BEFORE INSERT).
drop trigger if exists messages_rate_limit on messages;
create trigger messages_rate_limit
  before insert on messages
  for each row execute function private.check_message_rate();

drop trigger if exists discussion_messages_rate_limit on discussion_messages;
create trigger discussion_messages_rate_limit
  before insert on discussion_messages
  for each row execute function private.check_discussion_rate();

drop trigger if exists group_suggestions_rate_limit on group_suggestions;
create trigger group_suggestions_rate_limit
  before insert on group_suggestions
  for each row execute function private.check_suggestion_rate();

drop trigger if exists reports_rate_limit on reports;
create trigger reports_rate_limit
  before insert on reports
  for each row execute function private.check_report_rate();

drop trigger if exists bug_reports_rate_limit on bug_reports;
create trigger bug_reports_rate_limit
  before insert on bug_reports
  for each row execute function private.check_bug_report_rate();

-- Key freezing (BEFORE UPDATE): a row cannot change which conversation it is in.
drop trigger if exists messages_keys_frozen on messages;
create trigger messages_keys_frozen
  before update on messages
  for each row execute function private.message_keys_frozen();

drop trigger if exists discussion_messages_keys_frozen on discussion_messages;
create trigger discussion_messages_keys_frozen
  before update on discussion_messages
  for each row execute function private.discussion_message_keys_frozen();

-- Push webhooks. Each posts the row change to the notify edge function
-- (supabase/functions/notify), which works out recipients and calls Expo's push
-- API. Built on pg_net rather than the dashboard's Database Webhooks feature —
-- same payload shape (type/table/schema/record/old_record). <WEBHOOK_SECRET> is
-- a placeholder; the real value matches the function's WEBHOOK_SECRET secret.
create or replace function public.notify_webhook()
returns trigger language plpgsql security definer set search_path = public as $$
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

drop trigger if exists notify_memberships_webhook on public.memberships;
create trigger notify_memberships_webhook
  after insert or update on public.memberships
  for each row execute function public.notify_webhook();

drop trigger if exists notify_discussion_webhook on public.discussion_messages;
create trigger notify_discussion_webhook
  after insert on public.discussion_messages
  for each row execute function public.notify_webhook();

-- ===========================================================================
-- Known open items (2026-08-29) — none is an access-control hole
-- ===========================================================================
--
-- 1. message_snapshot on reports is supplied by the client (lib/submitReport),
--    so a malicious reporter can fabricate the quoted evidence. Capturing it
--    server-side from the message id would fix it.
--
-- 2. reply_to_id is unconstrained on messages and discussion_messages: it can
--    point at a row in another thread. No read leak — RLS blocks the embedded
--    row, so the quote renders empty — but nothing enforces that a reply and
--    its parent share a conversation.
--
-- 3. The groups-bucket insert policy still allows uploads under a folder named
--    for a group that does not exist yet, because the create flow uploads
--    before inserting the row. Reversing that order in groupPost.tsx would let
--    the branch go entirely.
--
-- 4. The per-user tables' policies apply to PUBLIC rather than `authenticated`
--    (see the comment above chat_reads). Safe, inconsistent.
--
-- 5. rls_auto_enable() still carries EXECUTE for anon and authenticated. It
--    returns event_trigger, so PostgREST cannot expose it and Postgres refuses
--    to call it outside an event trigger — harmless, but it is the last
--    function in public that either role can name.
--
-- 6. under_upload_quota() scans storage.objects unindexed. A hosted project
--    cannot CREATE INDEX on it or SET ROLE to supabase_storage_admin, so the
--    two supporting indexes could not be created. Fine at current volume.
--
-- Not covered by this file at all, and not coverable: Supabase Auth settings
-- (phone provider, OTP and CAPTCHA config, JWT expiry, redirect URLs) live in
-- the control plane, not in pg_catalog. The push recipient logic lives in
-- supabase/functions/notify/index.ts — the triggers above only fire it.
