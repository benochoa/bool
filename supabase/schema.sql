-- ===========================================================================
-- bool — live database mirror
--
-- Postgres 17.6. Captured from pg_catalog on 2026-08-30T03:09:00Z via
-- introspect.sql, after security_fixes.sql (round 1) and security_fixes_2.sql
-- (round 2) had both been applied and verified. Those two files are now
-- deleted: everything they did is below, and re-running them would be a no-op.
--
-- EVERYTHING HERE IS OBSERVED, NOT TRANSCRIBED: column types, defaults,
-- constraints and their validated state, indexes, policy bodies as Postgres
-- resolved them, function definitions, triggers, table/column/schema grants,
-- buckets, realtime, extensions and event triggers all came out of the catalog.
--
-- Nothing here is second-hand. The replica identity block was truncated out of
-- the 03:09 capture and was re-queried on its own to close that gap.
--
-- Confirmed absent, having actually been looked for: views, materialized views,
-- custom types, domains, generated columns, object comments, triggers on
-- auth.users, tables outside public/storage, and pg_cron. Nothing here depends
-- on their absence, but the mirror can say so rather than stay silent.
--
-- This file is a MIRROR, not a migration. Running it will not build the
-- database, and editing it changes nothing. After any dashboard change, run
-- introspect.sql and regenerate.
--
-- Why generated rather than hand-kept — five things found this way that reading
-- the source could not have found:
--
--   * The groups-bucket insert policy read correctly as written, but Postgres
--     had bound a bare `name` inside its subquery to groups.name rather than
--     storage.objects.name, making the check bucket-only.
--   * discussion_messages carried a documented `discussion_not_self` check that
--     had never been created.
--   * private.discussion_reply_in_same_thread() existed and read as though it
--     were wired up, but no trigger called it.
--   * Seven `revoke ... from anon` lines were inert, because the grant they
--     needed to remove belonged to PUBLIC. Only the ACL showed it — and only
--     after introspect.sql stopped filtering grantee 0 out of the capture.
--   * reports.message_snapshot was readable back by its own reporter, making a
--     SECURITY DEFINER trigger into an oracle over every message in the app.
-- ===========================================================================


-- ===========================================================================
-- Tables
-- Every constraint below is VALIDATED — enforced on new writes AND true of
-- every existing row — with one deliberate exception noted on `reports`.
-- ===========================================================================

-- Everyone, one row per auth user. `id` carries a gen_random_uuid() default,
-- which is vestigial: every insert supplies auth.uid() and profiles_insert_own
-- requires it. qa is the profile questionnaire; card_order is the display order
-- of the post's cards.
create table profiles (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null default '' constraint profiles_name_len check (char_length(name) <= 60),
  qa                 jsonb not null default '[]'
                       constraint profiles_qa_size check (char_length(qa::text) <= 8000),
  image_urls         text[] not null default '{}'
                       constraint profiles_image_urls_storage
                       check (private.all_storage_urls(image_urls)),
  profile_pic_url    text
                       constraint profiles_pic_url_storage
                       check (private.is_storage_url(profile_pic_url)),
  image_aspect_ratio numeric,
  card_order         text[],
  age                text,
  gender             text,
  city               text,
  college            text
);

-- A group. `id` is a client-supplied slug, not a uuid — groups_id_format keeps
-- it to [A-Za-z0-9-], which is what lets storage paths join two ids with '_'
-- and split them back apart unambiguously. It is also the only thing keeping a
-- comma out of the PostgREST .or() filter strings the notify edge function
-- builds while running as service_role, which is why validating it mattered.
--
-- invite_code is the one column no client can touch in either direction: there
-- is no table-level SELECT or UPDATE grant on this table, only per-column
-- grants, and invite_code is in neither list. Reading it goes through
-- get_invite_code(), which checks leadership; writing it is impossible, since
-- the generate_invite_code() default sets it once. See "Grants".
create table groups (
  id                 text primary key
                       constraint groups_id_format check (id ~ '^[A-Za-z0-9-]+$'),
  name               text not null default '' constraint groups_name_len check (char_length(name) <= 60),
  qa                 jsonb not null default '[]'
                       constraint groups_qa_size check (char_length(qa::text) <= 8000),
  created_by         uuid references profiles (id),
  invite_code        text unique default private.generate_invite_code(),
  image_urls         text[] not null default '{}'
                       constraint groups_image_urls_storage
                       check (private.all_storage_urls(image_urls)),
  status             text not null default 'active'
                       check (status in ('active', 'dissolved')),
  image_aspect_ratio numeric,
  card_order         text[],
  age                text,
  gender             text,
  city               text,
  college            text
);

-- Who is in which group, and how it ended if it did. Only status='active'
-- defines a group; the other three are history.
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

-- The matching funnel: pending -> sent -> matched. The primary key is the
-- ordered pair, so a given direction exists at most once. The not-self check
-- closed the seed step of a match-forging attack — see suggestion_keys_frozen.
create table group_suggestions (
  suggesting_group_id text not null references groups (id) on delete cascade,
  target_group_id     text not null references groups (id) on delete cascade,
  suggested_by        uuid not null references profiles (id),
  created_at          timestamptz not null default now(),
  status              text not null default 'pending'
                        check (status in ('pending', 'sent', 'matched')),
  matched_at          timestamptz,
  primary key (suggesting_group_id, target_group_id),
  constraint group_suggestions_not_self check (suggesting_group_id <> target_group_id)
);

create index group_suggestions_target_idx on group_suggestions (target_group_id);
create index group_suggestions_suggester_recent_idx
  on group_suggestions (suggested_by, created_at desc);

-- A matched pair's chat. The pair is canonical — messages_group_order forces
-- group_1_id < group_2_id — so one conversation has exactly one key, which is
-- what lets chat_reads and the realtime filters address it.
--
-- id is `generated always as identity`, so message ids are sequential and
-- guessable. Fine in itself, but it is what made the reports snapshot oracle
-- cheap to walk: an attacker did not have to find ids, only count.
create table messages (
  id                 bigint generated always as identity primary key,
  group_1_id         text not null references groups (id) on delete cascade,
  group_2_id         text not null references groups (id) on delete cascade,
  sender_group_id    text not null references groups (id) on delete cascade,
  sender_id          uuid not null references profiles (id) on delete cascade,
  body               text not null constraint messages_body_len check (char_length(body) <= 4000),
  created_at         timestamptz not null default now(),
  kind               text not null default 'text' check (kind in ('text', 'image', 'audio', 'video')),
  media_url          text
                       constraint messages_media_url_storage
                       check (private.is_storage_url(media_url)),
  media_aspect_ratio numeric,
  deleted_at         timestamptz,
  reply_to_id        bigint references messages (id) on delete set null,
  media_waveform     jsonb,
  constraint messages_group_order check (group_1_id < group_2_id)
);

create index messages_conversation_idx on messages (group_1_id, group_2_id, created_at);
create index messages_sender_recent_idx on messages (sender_id, created_at desc);

-- One group's own room. Mirrors `messages` column for column, minus the
-- canonical-pair machinery: a discussion has one owning group, not an
-- unordered two.
--
-- about_group_id has two meanings:
--   about_group_id <> group_id  — a private discussion about a candidate group
--   about_group_id  = group_id  — the group's own chat, with no subject at all
--
-- The self-referencing form is what the pinned row at the top of the Chats tab
-- reads and writes. There is deliberately NO constraint forbidding it — an
-- earlier version of this file documented one that pg_constraint has never
-- carried. Its absence is load-bearing: adding it would break the group chat.
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
                       check (private.is_storage_url(media_url)),
  media_aspect_ratio numeric,
  deleted_at         timestamptz,
  reply_to_id        bigint references discussion_messages (id) on delete set null,
  media_waveform     jsonb
);

create index discussion_messages_thread_idx
  on discussion_messages (group_id, about_group_id, created_at);
create index discussion_messages_sender_recent_idx
  on discussion_messages (sender_id, created_at desc);

-- One tapback per person per message.
create table message_reactions (
  message_id bigint not null references messages (id) on delete cascade,
  user_id    uuid   not null references profiles (id) on delete cascade,
  emoji      text   not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create table discussion_reactions (
  message_id bigint not null references discussion_messages (id) on delete cascade,
  user_id    uuid   not null references profiles (id) on delete cascade,
  emoji      text   not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

-- Read state, per user per conversation. Keyed to auth.users rather than
-- profiles: deleting the profile should not orphan these, and delete_my_account
-- removes the auth row last.
create table chat_reads (
  user_id      uuid not null references auth.users (id) on delete cascade,
  group_1_id   text not null references groups (id) on delete cascade,
  group_2_id   text not null references groups (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (user_id, group_1_id, group_2_id)
);

-- Same, per discussion. about_group_id is part of the key, which is why the
-- group chat uses group_id as a sentinel rather than null: in Postgres
-- null = null is never true, so a nullable column here would make every
-- read-state lookup miss and stop the key deduplicating.
create table discussion_reads (
  user_id        uuid not null references auth.users (id) on delete cascade,
  group_id       text not null references groups (id) on delete cascade,
  about_group_id text not null references groups (id) on delete cascade,
  last_read_at   timestamptz not null default now(),
  primary key (user_id, group_id, about_group_id)
);

-- Expo push tokens. Written only through register_push_token() — there is no
-- INSERT or UPDATE policy on this table, so a direct write is refused.
create table push_tokens (
  token      text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  updated_at timestamptz not null default now()
);

create index push_tokens_user_idx on push_tokens (user_id);

-- Moderation reports.
--
-- message_snapshot is filled by the reports_snapshot trigger, never by the
-- client: messages are soft-deletable, so a sender could blank the evidence
-- before anyone read the report, and a snapshot the reporter writes is one the
-- reporter can invent. That trigger is SECURITY DEFINER, and until 2026-08-30
-- it copied any message id it was handed — which turned this table into a read
-- oracle over every message in the database. It is now membership-gated.
--
-- A message report names exactly one message from exactly one of two tables:
-- target_message_id for a chat, target_discussion_message_id for a discussion.
-- Before the second column existed, a discussion message's id was written into
-- the first, whose FK points at `messages` — and since the two tables have
-- independent identity sequences, that id usually existed over there, so the
-- report silently attached to an unrelated stranger's message.
create table reports (
  id                           bigint generated always as identity primary key,
  reporter_id                  uuid not null references profiles (id) on delete cascade,
  target_type                  text not null check (target_type in ('group', 'person', 'message')),
  target_group_id              text references groups (id) on delete set null,
  target_person_id             uuid references profiles (id) on delete set null,
  target_message_id            bigint references messages (id) on delete set null,
  target_discussion_message_id bigint references discussion_messages (id) on delete set null,
  message_snapshot             text,
  reason                       text not null,
  details                      text,
  created_at                   timestamptz not null default now(),
  -- THE ONE NOT VALID CONSTRAINT IN THE SCHEMA (convalidated = false, verified
  -- live). Enforced on every new row; existing rows were never tested, because
  -- some may predate target_discussion_message_id and carry the mismatched id
  -- described above. To finish the job:
  --   select id, target_type, target_message_id, target_discussion_message_id
  --     from reports where target_type = 'message';
  --   alter table reports validate constraint reports_one_message_target;
  constraint reports_one_message_target check (
    case when target_type = 'message'
         then (target_message_id is not null) <> (target_discussion_message_id is not null)
         else target_message_id is null and target_discussion_message_id is null
    end
  ) not valid
);

create index reports_created_at_idx on reports (created_at desc);
create index reports_reporter_recent_idx on reports (reporter_id, created_at desc);

create table bug_reports (
  id          bigint generated always as identity primary key,
  reporter_id uuid not null references profiles (id) on delete cascade,
  body        text not null,
  created_at  timestamptz not null default now()
);

create index bug_reports_reporter_recent_idx on bug_reports (reporter_id, created_at desc);

-- Blocks are one-directional rows but read both ways: see sender_blocked_me
-- (hides their messages from you) and blocks_between (hides reactions either
-- way). The reverse index exists because the "did they block me" direction is
-- queried as often as the forward one.
create table blocked_people (
  blocker_id uuid not null references profiles (id) on delete cascade,
  blocked_id uuid not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocked_people_not_self check (blocker_id <> blocked_id)
);

create index blocked_people_blocked_idx on blocked_people (blocked_id, blocker_id);

-- Static questionnaire content. Readable by any signed-in user.
create table questions (
  category  text primary key,
  questions jsonb not null default '[]'
);

-- Four sequences, all owned by the identity columns above: bug_reports_id_seq,
-- discussion_messages_id_seq, messages_id_seq, reports_id_seq. No standalone
-- sequences, no generated columns, no views or materialized views (a view is
-- NOT covered by its base table's RLS unless created with security_invoker, so
-- one appearing later is worth noticing).


-- ===========================================================================
-- Realtime
-- Streams nothing until a table is added to this publication (no error if
-- forgotten, just silence). Realtime re-checks the SELECT policy per
-- subscriber, so a table here is only as private as its select policy.
-- Seven tables, verified live; the publication carries insert, update, delete
-- and truncate.
-- ===========================================================================

alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table message_reactions;
alter publication supabase_realtime add table groups;
alter publication supabase_realtime add table memberships;
alter publication supabase_realtime add table group_suggestions;
alter publication supabase_realtime add table discussion_messages;
alter publication supabase_realtime add table discussion_reactions;

-- Supabase owns a second publication, supabase_realtime_messages_publication,
-- carrying its own realtime.messages table. Not ours; listed so a future
-- capture showing two publications does not read as drift.

-- replica identity full: a change event otherwise carries only the primary key
-- of the old row, but the client and notify_webhook need the PREVIOUS status —
-- to tell a join from a rejoin from a leave, and pending->sent from
-- sent->matched. The other five realtime tables are on 'default', which is fine
-- because nothing keys off a previous value there.
--
-- Verified live 2026-08-30: pg_class.relreplident is 'f' for exactly these two
-- and 'd' for the other thirteen public tables. If either ever reverts to
-- 'default' the failure is silent — notify_webhook still fires, but old_record
-- carries only the primary key, so a rejoin reads as a join and a match reads
-- as a send.
alter table memberships       replica identity full;
alter table group_suggestions replica identity full;


-- ===========================================================================
-- Extensions (live)
--
--   pg_net              0.20.3   schema public       -- net.http_post, used by
--                                                       notify_webhook()
--   pg_stat_statements  1.11     schema extensions
--   pgcrypto            1.3      schema extensions   -- gen_random_uuid()
--   plpgsql             1.0      schema pg_catalog
--   supabase_vault      0.3.1    schema vault
--   uuid-ossp           1.1      schema extensions
--
-- No pg_cron, so nothing runs on a schedule inside the database. Schemas
-- present: auth, extensions, graphql, graphql_public, net, pgbouncer, private,
-- public, realtime, storage, vault — all Supabase's or ours, none unexpected.
-- ===========================================================================


-- ===========================================================================
-- Authorization helpers (private schema)
-- All STABLE SECURITY DEFINER with a pinned search_path: they bypass RLS
-- internally (so the policies calling them don't recurse), return only a
-- boolean, and test only the caller's own relationships.
--
-- Using these rather than an inline subquery is not a style preference. A
-- subquery inside a policy is itself subject to RLS, which is what broke
-- memberships_insert_self: it asked whether you owned a group you could not yet
-- see, and the answer was always no.
--
-- REACHABILITY: 22 of these 24 helpers are EXECUTE-to-PUBLIC — none was ever
-- revoked, and Postgres grants EXECUTE to PUBLIC by default. What contains them
-- is one line up the stack: USAGE on schema `private` is granted to
-- `authenticated` and to nobody else (verified live — anon holds USAGE on
-- public, auth, extensions, graphql, graphql_public, net, realtime and storage,
-- but not private). PostgREST exposes only public and graphql_public, so no
-- client reaches them by URL either. The two helpers added on 2026-08-30 were
-- revoked from PUBLIC anyway, as the pattern new work should follow.
-- ===========================================================================

create or replace function private.is_active_member(p_group_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships
     where group_id = p_group_id and person_id = auth.uid() and status = 'active'
  );
$$;

-- The same question about somebody else. Added for groups_update_leader, which
-- has to ask whether the person a leader is handing the group to is in it.
create or replace function private.is_active_member_of(p_group_id text, p_person uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships
     where group_id = p_group_id and person_id = p_person and status = 'active'
  );
$$;

create or replace function private.is_group_leader(p_group_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from groups where id = p_group_id and created_by = auth.uid()
  );
$$;

-- True while the group row does not exist yet. Exists for one reason: the
-- leader uploads the group's photos before the row is inserted, so
-- is_group_leader has nothing to pass against at that moment.
create or replace function private.group_missing(p_group_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (select 1 from groups where id = p_group_id);
$$;

-- The visibility rule for a whole group. TWO THINGS TO KNOW:
--
-- 1. The first branch deliberately does NOT filter on status — History has to
--    show groups you have left. That makes a membership row's identity
--    security-relevant, which is why memberships_keys_frozen exists: without
--    it, re-pointing your own row's group_id granted sight of any group.
--
-- 2. The middle branch makes every active group in your city visible. That is
--    the swipe deck, and it is deliberately wide — see "Known open items".
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

-- A person is visible if they are you, if they are in a group you can see, or
-- if you have blocked them (so the block list can render who is on it).
--
-- That third branch used to be a read primitive: blocked_people accepted any
-- profile id, so inserting a block made a stranger's profile and photos
-- readable. blocked_people_own now requires shares_visible_group, which is what
-- keeps the branch honest.
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

-- can_see_person's second branch, alone. Deliberately NOT the whole function:
-- blocked_people_own calls this, and can_see_person's third branch reads
-- blocked_people, so using it there would be circular.
create or replace function private.shares_visible_group(p_person uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships m
     where m.person_id = p_person and private.can_see_group(m.group_id)
  );
$$;

-- One-directional: has this sender blocked ME. Used by the message SELECT
-- policies, so someone who blocked you goes quiet for you — your own block does
-- not hide their messages, it replaces their text client-side.
create or replace function private.sender_blocked_me(p_sender uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from blocked_people
     where blocker_id = p_sender and blocked_id = auth.uid()
  );
$$;

-- Bidirectional. Used by the reaction SELECT policies, where either direction
-- should hide the row.
create or replace function private.blocks_between(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from blocked_people
     where (blocker_id = a and blocked_id = b)
        or (blocker_id = b and blocked_id = a)
  );
$$;

-- The gate on messages_insert: two groups may only talk once a suggestion
-- between them reached 'matched'. group_suggestions_keys_frozen is what makes
-- that gate trustworthy — without it a leader could rewrite an existing row's
-- group ids and manufacture a match with anyone.
create or replace function private.groups_matched(a text, b text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from group_suggestions
     where status = 'matched'
       and ((suggesting_group_id = a and target_group_id = b)
         or (suggesting_group_id = b and target_group_id = a))
  );
$$;

-- Media URL validation, behind the check constraints on messages,
-- discussion_messages, profiles and groups. Its job is to stop a client writing
-- an arbitrary URL into a column the app will later attach the viewer's JWT to.
-- The client half of that defence is lib/storageAuth.ts, which refuses to
-- attach a token to any URI outside this prefix.
create or replace function private.is_storage_url(u text)
returns boolean language sql immutable as $$
  select u is null
      or u like 'https://vsgdhfwhpiucplkraizw.supabase.co/storage/v1/object/authenticated/%';
$$;

create or replace function private.all_storage_urls(us text[])
returns boolean language sql immutable as $$
  select coalesce(bool_and(private.is_storage_url(u)), true) from unnest(us) as u;
$$;

-- Ambiguity-free invite codes: no 0/O/1/I/L, since they get read aloud.
create or replace function private.generate_invite_code()
returns text language plpgsql security definer set search_path = public as $$
declare
  chars text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
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

-- Per-hour storage ceiling, ANDed onto every bucket by the restrictive
-- uploads_under_quota policy. Unindexed: CREATE INDEX on storage.objects needs
-- ownership of that table, which a hosted project does not grant.
create or replace function private.under_upload_quota()
returns boolean language sql stable security definer set search_path = public as $$
  select count(*) < 100
     and coalesce(sum((metadata->>'size')::bigint), 0) < 524288000   -- 500 MB
    from storage.objects
   where (owner = auth.uid() or owner_id = auth.uid()::text)
     and created_at > now() - interval '1 hour';
$$;


-- ===========================================================================
-- Trigger functions
-- ===========================================================================

-- Rate limits. Each counts the caller's own recent rows and raises. All are
-- BEFORE INSERT, so the row never lands.
create or replace function private.check_message_rate()
returns trigger language plpgsql security definer set search_path = public as $$
declare recent int;
begin
  select count(*) into recent
    from messages
   where sender_id = new.sender_id and created_at > now() - interval '1 minute';
  if recent >= 30 then raise exception 'Too many messages — slow down.'; end if;
  return new;
end;
$$;

create or replace function private.check_discussion_rate()
returns trigger language plpgsql security definer set search_path = public as $$
declare recent int;
begin
  select count(*) into recent
    from discussion_messages
   where sender_id = new.sender_id and created_at > now() - interval '1 minute';
  if recent >= 30 then raise exception 'Too many messages — slow down.'; end if;
  return new;
end;
$$;

create or replace function private.check_suggestion_rate()
returns trigger language plpgsql security definer set search_path = public as $$
declare recent int;
begin
  select count(*) into recent
    from group_suggestions
   where suggested_by = new.suggested_by and created_at > now() - interval '1 minute';
  if recent >= 30 then raise exception 'Too many suggestions — slow down.'; end if;
  return new;
end;
$$;

-- 10/hour. This was also the throttle on how fast anyone could have walked the
-- old reports oracle, which is why it mattered more than it looked.
create or replace function private.check_report_rate()
returns trigger language plpgsql security definer set search_path = public as $$
declare recent int;
begin
  select count(*) into recent
    from reports
   where reporter_id = new.reporter_id and created_at > now() - interval '1 hour';
  if recent >= 10 then raise exception 'Too many reports — try again later.'; end if;
  return new;
end;
$$;

create or replace function private.check_bug_report_rate()
returns trigger language plpgsql security definer set search_path = public as $$
declare recent int;
begin
  select count(*) into recent
    from bug_reports
   where reporter_id = new.reporter_id and created_at > now() - interval '1 hour';
  if recent >= 10 then raise exception 'Too many reports — try again later.'; end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Key freezing. Four tables, one reason: an UPDATE policy checks the NEW row,
-- so unless a row's identity is pinned, an "edit" can silently become a "move".
-- Three of these four were added on 2026-08-29 after exactly that turned out to
-- be exploitable twice.
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

-- CRITICAL FIX. gs_update validates leadership against the NEW row's group ids,
-- but nothing stopped the UPDATE from rewriting them. A leader could seed a
-- self-suggestion, then rewrite the other side and set 'matched' — the WITH
-- CHECK still passed, because they led the new row's target. That produced a
-- match with a group that never suggested anything, and through
-- groups_matched() a live chat. This plus group_suggestions_not_self closes it.
create or replace function private.suggestion_keys_frozen()
returns trigger language plpgsql as $$
begin
  if new.suggesting_group_id <> old.suggesting_group_id
     or new.target_group_id <> old.target_group_id then
    raise exception 'a suggestion cannot change which groups it is between';
  end if;
  return new;
end;
$$;

-- HIGH FIX. memberships_update lets you set your own row to 'left', and nothing
-- froze the keys — so re-pointing group_id at any group left a row saying "I was
-- once in that group", which can_see_group's status-blind first branch accepts.
-- That one row exposed the target's roster, every member's profile, and its
-- bucket photos, bypassing city scoping entirely. Safe against
-- join_group_by_code: its upsert conflicts on (group_id, person_id) and its DO
-- UPDATE touches only status/status_at.
create or replace function private.membership_keys_frozen()
returns trigger language plpgsql as $$
begin
  if new.group_id <> old.group_id or new.person_id <> old.person_id then
    raise exception 'a membership cannot change group or person';
  end if;
  return new;
end;
$$;

-- A reply must answer a message in the same conversation, so reply_to_id cannot
-- be used to quote a message from somewhere else.
create or replace function private.reply_in_same_conversation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.reply_to_id is not null and not exists (
    select 1 from messages m
     where m.id = new.reply_to_id
       and m.group_1_id = new.group_1_id
       and m.group_2_id = new.group_2_id
  ) then
    raise exception 'a reply must answer a message in the same conversation';
  end if;
  return new;
end;
$$;

-- The discussion equivalent. Existed unattached for some time — it read as
-- though it were wired up, and only a live trigger capture showed that nothing
-- called it.
create or replace function private.discussion_reply_in_same_thread()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.reply_to_id is not null and not exists (
    select 1 from discussion_messages m
     where m.id = new.reply_to_id
       and m.group_id = new.group_id
       and m.about_group_id = new.about_group_id
  ) then
    raise exception 'a reply must answer a message in the same discussion';
  end if;
  return new;
end;
$$;

-- HIGH FIX. Takes the evidence copy server-side so a reporter cannot invent it,
-- and — since 2026-08-30 — only for a message the reporter can actually see.
--
-- Without that gate this function was an oracle: SECURITY DEFINER reads
-- `messages` with RLS bypassed, reports_insert_own accepts any target id, and
-- reports_select_own hands the row back. With sequential message ids that meant
-- ~240 arbitrary message bodies a day, indefinitely.
--
-- The sender_blocked_me half of messages_select is deliberately NOT applied:
-- being blocked by someone is not a reason to be unable to report them.
create or replace function private.snapshot_reported_message()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.target_type <> 'message' then
    new.message_snapshot := null;
    return new;
  end if;

  if new.target_discussion_message_id is not null then
    select d.body into new.message_snapshot
      from discussion_messages d
     where d.id = new.target_discussion_message_id
       and private.is_active_member(d.group_id);
  elsif new.target_message_id is not null then
    select m.body into new.message_snapshot
      from messages m
     where m.id = new.target_message_id
       and (private.is_active_member(m.group_1_id)
         or private.is_active_member(m.group_2_id));
  else
    new.message_snapshot := null;
  end if;

  return new;
end;
$$;

-- Push fan-out. Carries the webhook secret as a literal, which is why EXECUTE
-- is revoked from every client role — triggers fire without an EXECUTE check,
-- so the four webhooks below are unaffected. The receiving edge function
-- compares that header in constant time.
create or replace function public.notify_webhook()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url := 'https://vsgdhfwhpiucplkraizw.supabase.co/functions/v1/notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', '<REDACTED — real value lives only in the database>'
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


-- ===========================================================================
-- Triggers (live, all enabled — tgenabled = 'O')
-- ===========================================================================

create trigger messages_rate_limit before insert on messages
  for each row execute function private.check_message_rate();
create trigger messages_keys_frozen before update on messages
  for each row execute function private.message_keys_frozen();
create trigger messages_reply_same_conversation before insert or update on messages
  for each row execute function private.reply_in_same_conversation();
create trigger notify_messages_webhook after insert on messages
  for each row execute function notify_webhook();

create trigger discussion_messages_rate_limit before insert on discussion_messages
  for each row execute function private.check_discussion_rate();
create trigger discussion_messages_keys_frozen before update on discussion_messages
  for each row execute function private.discussion_message_keys_frozen();
create trigger discussion_messages_reply_same_thread before insert or update on discussion_messages
  for each row execute function private.discussion_reply_in_same_thread();
create trigger notify_discussion_webhook after insert on discussion_messages
  for each row execute function notify_webhook();

create trigger group_suggestions_rate_limit before insert on group_suggestions
  for each row execute function private.check_suggestion_rate();
create trigger group_suggestions_keys_frozen before update on group_suggestions
  for each row execute function private.suggestion_keys_frozen();
create trigger notify_suggestions_webhook after insert or update on group_suggestions
  for each row execute function notify_webhook();

create trigger memberships_keys_frozen before update on memberships
  for each row execute function private.membership_keys_frozen();
create trigger notify_memberships_webhook after insert or update on memberships
  for each row execute function notify_webhook();

create trigger reports_rate_limit before insert on reports
  for each row execute function private.check_report_rate();
create trigger reports_snapshot before insert on reports
  for each row execute function private.snapshot_reported_message();

create trigger bug_reports_rate_limit before insert on bug_reports
  for each row execute function private.check_bug_report_rate();

-- Not ours, listed for completeness: enforce_bucket_name_length_trigger and
-- protect_buckets_delete on storage.buckets; protect_objects_delete and
-- update_objects_updated_at on storage.objects; tr_check_filters on
-- realtime.subscription. Nothing on auth.users — worth knowing, since a trigger
-- there is the usual place new-user setup hides, and no policy would govern it.


-- ===========================================================================
-- Row Level Security
-- Every table in public has RLS enabled, none FORCED (forced only matters for
-- the table owner, which no client role is; all tables are owned by postgres).
-- ===========================================================================

alter table profiles             enable row level security;
alter table groups               enable row level security;
alter table memberships          enable row level security;
alter table group_suggestions    enable row level security;
alter table messages             enable row level security;
alter table message_reactions    enable row level security;
alter table chat_reads           enable row level security;
alter table questions            enable row level security;
alter table blocked_people       enable row level security;
alter table push_tokens          enable row level security;
alter table bug_reports          enable row level security;
alter table reports              enable row level security;
alter table discussion_messages  enable row level security;
alter table discussion_reactions enable row level security;
alter table discussion_reads     enable row level security;

-- Safety net: auto-enable RLS on any new table created in public, so a future
-- table cannot ship accidentally world-open. Live as event trigger `ensure_rls`
-- on ddl_command_end, enabled.
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
      exception when others then
        raise log 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      end;
    end if;
  end loop;
end;
$$;

create event trigger ensure_rls on ddl_command_end execute function rls_auto_enable();

-- storage.buckets has RLS on with NO policies at all, so clients cannot touch
-- bucket rows despite holding DML grants — fail-closed by construction.


-- ===========================================================================
-- Policies (bodies exactly as Postgres deparses them)
--
-- ALL 53 ARE `to authenticated`. Verified live: pg_policies returns no row with
-- roles = {public}.
-- ===========================================================================

-- profiles -------------------------------------------------------------------
create policy profiles_select on profiles
  for select to authenticated using (private.can_see_person(id::text));
create policy profiles_insert_own on profiles
  for insert to authenticated with check (auth.uid() = id);
create policy profiles_update_own on profiles
  for update to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);

-- groups ---------------------------------------------------------------------
create policy groups_select on groups
  for select to authenticated using (private.can_see_group(id));
create policy groups_insert on groups
  for insert to authenticated with check (auth.uid() = created_by);
-- The WITH CHECK has been three different things. `true` let a leader reassign
-- created_by to any user id and rewrite invite_code (a UNIQUE column, so a
-- failed write was an oracle for other groups' codes). Mirroring the USING
-- clause closed that but broke lib/makeGroupLeader.ts, which is precisely an
-- update setting created_by to someone else. This is the rule actually wanted:
-- a leader may hand the group to an ACTIVE MEMBER, and to nobody else. The
-- invite_code half is closed independently, at the grant level.
create policy groups_update_leader on groups
  for update to authenticated
  using (auth.uid() = created_by)
  with check (
    auth.uid() = created_by or private.is_active_member_of(id, created_by)
  );
-- No DELETE policy: groups are dissolved via dissolve_group(), not removed.

-- memberships ----------------------------------------------------------------
-- Leadership rather than an inline subquery: a brand-new group is invisible to
-- can_see_group at the moment its leader inserts their own membership, so an
-- `exists (select 1 from groups ...)` here was always false and left groups
-- with no members at all.
create policy memberships_insert_self on memberships
  for insert to authenticated
  with check (auth.uid() = person_id and private.is_group_leader(group_id));
create policy memberships_select on memberships
  for select to authenticated using (private.can_see_group(group_id));
-- You may leave; the leader may set any status. Only safe because
-- memberships_keys_frozen pins group_id and person_id — the WITH CHECK
-- constrains the status but says nothing about which row it applies to.
create policy memberships_update on memberships
  for update to authenticated
  using (auth.uid() = person_id or private.is_group_leader(group_id))
  with check (
    (auth.uid() = person_id and status = 'left') or private.is_group_leader(group_id)
  );

-- group_suggestions ----------------------------------------------------------
create policy gs_select on group_suggestions
  for select to authenticated using (
    private.is_active_member(suggesting_group_id) or private.is_active_member(target_group_id)
  );
-- Any active member may propose, but only as 'pending'.
create policy gs_insert on group_suggestions
  for insert to authenticated with check (
    auth.uid() = suggested_by
    and private.is_active_member(suggesting_group_id)
    and status = 'pending'
  );
-- Each side may only advance its own step: the suggester sends, the target
-- matches. Like memberships_update, only safe with its keys-frozen trigger —
-- the branches below name group ids the UPDATE could otherwise have rewritten.
create policy gs_update on group_suggestions
  for update to authenticated
  using (private.is_group_leader(suggesting_group_id) or private.is_group_leader(target_group_id))
  with check (
    (private.is_group_leader(suggesting_group_id) and status = 'sent')
    or (private.is_group_leader(target_group_id) and status = 'matched')
  );
create policy gs_delete on group_suggestions
  for delete to authenticated using (
    private.is_group_leader(suggesting_group_id) or private.is_group_leader(target_group_id)
  );

-- messages -------------------------------------------------------------------
create policy messages_select on messages
  for select to authenticated using (
    (private.is_active_member(group_1_id) or private.is_active_member(group_2_id))
    and not private.sender_blocked_me(sender_id)
  );
-- Four conditions: it is you, you are in the sending group, the sending group
-- is one of the two, and the two are actually matched.
create policy messages_insert on messages
  for insert to authenticated with check (
    auth.uid() = sender_id
    and private.is_active_member(sender_group_id)
    and (sender_group_id = group_1_id or sender_group_id = group_2_id)
    and private.groups_matched(group_1_id, group_2_id)
  );
create policy messages_update_own on messages
  for update to authenticated
  using (auth.uid() = sender_id and private.is_active_member(sender_group_id))
  with check (auth.uid() = sender_id and private.is_active_member(sender_group_id));
-- No DELETE policy: messages are soft-deleted via deleted_at.

-- message_reactions ----------------------------------------------------------
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
-- Membership of the OWNING group and nothing else — which is exactly why the
-- group chat needed no new table, no new policy and no new storage rule.
create policy dm_select on discussion_messages
  for select to authenticated using (
    private.is_active_member(group_id) and not private.sender_blocked_me(sender_id)
  );
create policy dm_insert on discussion_messages
  for insert to authenticated with check (
    auth.uid() = sender_id and private.is_active_member(group_id)
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

-- Read state, blocks, reports, tokens ----------------------------------------
create policy chat_reads_select_own on chat_reads
  for select to authenticated using (auth.uid() = user_id);
create policy chat_reads_insert_own on chat_reads
  for insert to authenticated with check (auth.uid() = user_id);
create policy chat_reads_update_own on chat_reads
  for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy discussion_reads_select_own on discussion_reads
  for select to authenticated using (auth.uid() = user_id);
create policy discussion_reads_insert_own on discussion_reads
  for insert to authenticated with check (auth.uid() = user_id);
create policy discussion_reads_update_own on discussion_reads
  for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- The WITH CHECK is what stops "block anyone to read them": can_see_person's
-- third branch makes a blocked person visible, and without shares_visible_group
-- any profile id could be inserted here. USING stays broad on purpose, so an
-- existing block remains visible and removable even if the other person later
-- leaves every group you can see.
create policy blocked_people_own on blocked_people
  for all to authenticated
  using (auth.uid() = blocker_id)
  with check (auth.uid() = blocker_id and private.shares_visible_group(blocked_id));

-- SELECT and DELETE only. Writes go through register_push_token(), so a client
-- cannot point someone else's token row at itself.
create policy push_tokens_select_own on push_tokens
  for select to authenticated using (auth.uid() = user_id);
create policy push_tokens_delete_own on push_tokens
  for delete to authenticated using (auth.uid() = user_id);

create policy reports_insert_own on reports
  for insert to authenticated with check (auth.uid() = reporter_id);
create policy reports_select_own on reports
  for select to authenticated using (auth.uid() = reporter_id);

-- INSERT only — no SELECT policy, so a reporter cannot read back even their own.
create policy "insert own bug reports" on bug_reports
  for insert to authenticated with check (auth.uid() = reporter_id);

create policy questions_select on questions
  for select to authenticated using (true);


-- ===========================================================================
-- Grants
--
-- RLS gates rows; grants gate reachability. anon and authenticated both hold
-- DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE and UPDATE on
-- every public table except groups. RLS is carrying all of it.
--
-- TRUNCATE IS THE ONE RLS DOES NOT GATE — policies are not consulted for it. The
-- only thing between a client role and an empty table is that PostgREST never
-- emits TRUNCATE and these roles have no direct Postgres connection. That is
-- Supabase's default grant, not a choice made here, and removing it is not
-- obviously safe because the REST layer depends on the rest of the set.
-- Recorded because "RLS protects these tables" is true of the four DML verbs
-- and of nothing else.
--
-- public.groups is the deliberate exception, load-bearing in BOTH directions:
--
--   * No table-level SELECT. Twelve columns granted individually; invite_code
--     is not among them, so no client can read it.
--   * No table-level UPDATE. Eleven columns granted individually; neither
--     invite_code nor id is among them. That kills the unique-violation oracle
--     that let a leader probe for other groups' invite codes, and pins the
--     primary key every storage path and foreign key hangs off.
--
-- Live ACL confirms it: `authenticated=rw` on the eleven, `authenticated=r` on
-- id alone, and no ACL entry at all for invite_code. Re-adding a table-level
-- SELECT or UPDATE grant on groups silently re-exposes invite_code and makes
-- every column grant here meaningless.
-- ===========================================================================

revoke select, update on groups from anon, authenticated;

grant select (id, name, qa, created_by, image_urls, status,
              image_aspect_ratio, card_order, age, gender, city, college)
  on groups to anon, authenticated;

grant update (name, qa, created_by, image_urls, status,
              image_aspect_ratio, card_order, age, gender, city, college)
  on groups to authenticated;
-- and NOT invite_code, in either list. And NOT id, in the update list.

-- Function EXECUTE.
--
-- EVERY REVOKE BELOW NAMES `public` AS WELL AS `anon`, AND THAT IS THE POINT.
-- `revoke ... from anon` alone does nothing: Postgres grants EXECUTE to PUBLIC
-- by default, a role's effective privilege is the union of its own grants and
-- PUBLIC's, and removing anon's named grant leaves the PUBLIC entry standing.
-- Seven of these lines were written that way and were inert for as long as they
-- existed. Verified live after correction: the only function in `public` still
-- carrying an EXECUTE grant to PUBLIC is rls_auto_enable(), an event-trigger
-- function with no ddl-command context when called directly.
revoke all on function register_push_token(text)           from public, anon;
revoke all on function join_group_by_code(text)            from public, anon;
revoke all on function get_invite_code(text)               from public, anon;
revoke all on function my_media_paths()                    from public, anon;
revoke all on function dissolve_group(text)                from public, anon;
revoke all on function delete_my_account()                 from public, anon;
revoke all on function get_chat_previews(text)             from public, anon;
revoke all on function get_unread_chat_count(text)         from public, anon;
revoke all on function get_discussion_unread_counts(text)  from public, anon;
revoke all on function get_group_chat_preview(text)        from public, anon;
revoke all on function get_blocked_person_ids()            from public, anon;
revoke all on function notify_webhook()                    from public, anon, authenticated;

grant execute on function register_push_token(text)           to authenticated;
grant execute on function join_group_by_code(text)            to authenticated;
grant execute on function get_invite_code(text)               to authenticated;
grant execute on function my_media_paths()                    to authenticated;
grant execute on function dissolve_group(text)                to authenticated;
grant execute on function delete_my_account()                 to authenticated;
grant execute on function get_chat_previews(text)             to authenticated;
grant execute on function get_unread_chat_count(text)         to authenticated;
grant execute on function get_discussion_unread_counts(text)  to authenticated;
grant execute on function get_group_chat_preview(text)        to authenticated;
grant execute on function get_blocked_person_ids()            to authenticated;

-- The two helpers added 2026-08-30 follow the same rule from the start. The
-- other 22 private.* helpers remain EXECUTE-to-PUBLIC and are contained by
-- schema USAGE instead — see the note above the helpers section.
revoke all on function private.is_active_member_of(text, uuid) from public, anon;
revoke all on function private.shares_visible_group(uuid)      from public, anon;


-- ===========================================================================
-- RPCs (public schema)
-- ===========================================================================

-- The Chats tab in one round trip. Not security definer: the caller's own RLS
-- hides a blocker's rows, so the lateral lands on the newest message this
-- viewer can see.
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
  -- deleted_at filtered: the thread renders a soft-deleted message as "Message
  -- deleted", so printing its body out here would undo the deletion in the one
  -- place the sender cannot see it.
  left join lateral (
    select body, created_at, sender_id
    from messages
    where group_1_id = least(my_group_id, x.other_id)
      and group_2_id = greatest(my_group_id, x.other_id)
      and deleted_at is null
    order by created_at desc
    limit 1
  ) m on true
  left join profiles p on p.id = m.sender_id
  where gs.status = 'matched'
    and (gs.suggesting_group_id = my_group_id or gs.target_group_id = my_group_id)
  order by m.created_at desc nulls last;
$$;

-- The pinned row above the matches: the group's own room. Same shape as
-- get_chat_previews, addressed at the self-referencing discussion.
create or replace function get_group_chat_preview(my_group_id text)
returns table(group_name text, image_urls text[], last_message text,
              last_message_at timestamptz, last_message_sender text,
              unread integer)
language sql stable as $$
  select
    g.name::text,
    g.image_urls::text[],
    case
      when exists (select 1 from blocked_people bp
                   where bp.blocker_id = auth.uid() and bp.blocked_id = m.sender_id)
      then 'Message from blocked user'
      else m.body::text
    end,
    m.created_at::timestamptz,
    case
      when m.sender_id = auth.uid() then 'You'
      when exists (select 1 from blocked_people bp
                   where bp.blocker_id = auth.uid() and bp.blocked_id = m.sender_id)
      then null
      else p.name::text
    end,
    (select count(*)::int
       from discussion_messages u
       left join discussion_reads r
         on  r.user_id        = auth.uid()
         and r.group_id       = u.group_id
         and r.about_group_id = u.about_group_id
      where u.group_id       = my_group_id
        and u.about_group_id = my_group_id
        and u.sender_id     <> auth.uid()
        and u.deleted_at is null
        and (r.last_read_at is null or u.created_at > r.last_read_at))
  from groups g
  left join lateral (
    select body, created_at, sender_id
      from discussion_messages
     where group_id = my_group_id
       and about_group_id = my_group_id
       and deleted_at is null
     order by created_at desc
     limit 1
  ) m on true
  left join profiles p on p.id = m.sender_id
  where g.id = my_group_id;
$$;

-- The Chats tab badge. Counts CONVERSATIONS, not messages, so the group's own
-- room adds at most one — the same weight as any other chat in the list.
create or replace function get_unread_chat_count(my_group_id text)
returns integer language sql stable as $$
  select (
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
    ) unread_chats
  ) + (
    select case when exists (
      select 1
        from public.discussion_messages m
        left join public.discussion_reads r
          on  r.user_id        = auth.uid()
          and r.group_id       = m.group_id
          and r.about_group_id = m.about_group_id
       where m.group_id       = my_group_id
         and m.about_group_id = my_group_id
         and m.sender_id     <> auth.uid()
         and m.deleted_at is null
         and (r.last_read_at is null or m.created_at > r.last_read_at)
    ) then 1 else 0 end
  );
$$;

-- Badges for the candidate preview tiles. The `about_group_id <> group_id`
-- exclusion keeps the group's own room out of these counts — it is not a
-- candidate, and without this it would surface as a badge keyed to your own id.
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
     and m.about_group_id <> m.group_id
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

-- The only way to read invite_code, and it checks leadership.
create or replace function get_invite_code(p_group_id text)
returns text language sql stable security definer set search_path = public as $$
  select invite_code from groups
   where id = p_group_id and created_by = auth.uid();
$$;

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

create or replace function register_push_token(p_token text)
returns void language sql security definer set search_path = public as $$
  insert into push_tokens (token, user_id, updated_at)
  values (p_token, auth.uid(), now())
  on conflict (token) do update
    set user_id = auth.uid(), updated_at = now();
$$;

-- Everything the caller owns in storage, for the client-side media sweep that
-- has to run before delete_my_account().
create or replace function my_media_paths()
returns table(bucket_id text, name text)
language sql stable security definer set search_path = public as $$
  select o.bucket_id::text, o.name::text
    from storage.objects o
   where o.owner = auth.uid() or o.owner_id = auth.uid()::text;
$$;

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

create or replace function delete_my_account()
returns void language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  led_group_id text;
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  -- Photos are not removed here: Postgres refuses a direct delete against
  -- storage.objects, so the app clears them through the Storage API first (see
  -- lib/deleteMyMedia.ts). Order matters — once the group rows are gone, the
  -- leader check in the storage policy has nothing left to pass against.
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
-- Storage
-- All four buckets PRIVATE, type STANDARD, versioning DISABLED, each with a
-- size cap and a MIME allowlist (verified live). Reads go through authenticated
-- URLs (lib/storageAuth.ts); the public URL path is dead.
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

-- RESTRICTIVE: ANDs with every permissive policy below rather than becoming
-- another way in. INSERT only — reads, updates and deletes are untouched.
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

-- groups/{groupId}/... — group_missing covers the upload that happens before
-- the group row exists. The bare `name` bug lived here: written as an inline
-- subquery it bound to groups.name rather than storage.objects.name, making the
-- whole check bucket-only. A helper function cannot be captured that way.
create policy groups_select on storage.objects
  for select to authenticated
  using (bucket_id = 'groups' and private.can_see_group((storage.foldername(name))[1]));
create policy groups_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'groups'
    and (private.is_group_leader((storage.foldername(name))[1])
      or private.group_missing((storage.foldername(name))[1]))
  );
create policy groups_update_leader on storage.objects
  for update to authenticated
  using (bucket_id = 'groups' and private.is_group_leader((storage.foldername(name))[1]))
  with check (bucket_id = 'groups' and private.is_group_leader((storage.foldername(name))[1]));
create policy groups_delete_leader on storage.objects
  for delete to authenticated
  using (bucket_id = 'groups' and private.is_group_leader((storage.foldername(name))[1]));

-- chat-media/{g1}_{g2}/...        — members of either side of that chat.
-- discussion-media/{gid}_{about}/ — the OWNING group only, so the second path
-- segment grants nothing. For the group's own chat both segments are the same
-- id, which the same split_part resolves identically.
--
-- Neither has an UPDATE policy: sent media is immutable. Both delete by
-- ownership of the object rather than by path.
create policy chat_media_select on storage.objects
  for select to authenticated using (
    bucket_id = 'chat-media'
    and (private.is_active_member(split_part((storage.foldername(name))[1], '_', 1))
      or private.is_active_member(split_part((storage.foldername(name))[1], '_', 2)))
  );
create policy chat_media_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'chat-media'
    and (private.is_active_member(split_part((storage.foldername(name))[1], '_', 1))
      or private.is_active_member(split_part((storage.foldername(name))[1], '_', 2)))
  );
create policy chat_media_delete_own on storage.objects
  for delete to authenticated using (
    bucket_id = 'chat-media' and (owner = auth.uid() or owner_id = auth.uid()::text)
  );

create policy discussion_media_select on storage.objects
  for select to authenticated using (
    bucket_id = 'discussion-media'
    and private.is_active_member(split_part((storage.foldername(name))[1], '_', 1))
  );
create policy discussion_media_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'discussion-media'
    and private.is_active_member(split_part((storage.foldername(name))[1], '_', 1))
  );
create policy discussion_media_delete_own on storage.objects
  for delete to authenticated using (
    bucket_id = 'discussion-media' and (owner = auth.uid() or owner_id = auth.uid()::text)
  );


-- ===========================================================================
-- Closed on 2026-08-29 / 30 — all verified live in this capture
--
--  CRITICAL  Any group leader could forge a match with any group: seed a
--            self-suggestion, rewrite the other side, set 'matched'. The WITH
--            CHECK passed because they still led the new row's target.
--            -> group_suggestions_keys_frozen + group_suggestions_not_self
--
--  HIGH      reports.message_snapshot was an oracle over every message in the
--            database. SECURITY DEFINER read with RLS off, any target id
--            accepted, own rows readable back, sequential ids. ~240 bodies/day.
--            -> snapshot_reported_message() is membership-gated
--
--  HIGH      Any user could read any group in any city by re-pointing their own
--            membership row's group_id and setting status='left', which
--            can_see_group's status-blind first branch accepted.
--            -> memberships_keys_frozen
--
--  HIGH      Leadership transfer was broken by the first attempt at the fix
--            below — a regression, not an attack.
--            -> groups_update_leader allows transfer to an active member
--
--  MEDIUM    groups_update_leader had `with check (true)`: created_by
--            reassignment, and invite_code overwrites that the UNIQUE index
--            turned into a code-guessing oracle.
--            -> check mirrors using; UPDATE moved to column grants
--
--  MEDIUM    Blocking any profile id made it readable via can_see_person.
--            -> blocked_people_own requires shares_visible_group
--
--  MEDIUM    Reporting a discussion message attached the report to an unrelated
--            chat message, because both ids went into one column FK'd to
--            `messages` and the two sequences overlap.
--            -> reports.target_discussion_message_id + one-target constraint
--
--  MEDIUM    discussion_reply_in_same_thread() was orphaned.  -> attached
--  MEDIUM    Seven revokes were inert (`from anon` not `from public, anon`).
--                                                              -> corrected
--  LOW       Nine policies were `to public`.        -> all `to authenticated`
--  LOW       Six constraints were NOT VALID.        -> all validated
--  LOW       get_chat_previews printed deleted bodies.        -> filtered
--  LOW       The notify edge function compared its webhook secret with `!==`,
--            leaking match length through timing.  -> constant-time
-- ===========================================================================


-- ===========================================================================
-- Known open items
--
-- 1. CITY-WIDE PROFILE VISIBILITY. can_see_group's middle branch makes every
--    active group in your city visible, and can_see_person extends that to
--    their members' full profiles and photos. This is the app's largest
--    remaining data exposure: anyone who joins any group in a city can
--    enumerate every profile there. A product decision, not a bug — and one
--    Google Play's Data Safety form will ask you to declare.
--
-- 2. TRUNCATE is granted to anon and authenticated on every public table and is
--    not gated by RLS. Unreachable through PostgREST, which never emits it.
--    See the note in "Grants".
--
-- 3. reports_one_message_target is NOT VALID: enforced on new rows, untested on
--    old ones. The query to check and validate is on the constraint itself.
--
-- 4. storage groups_insert accepts uploads to any path whose group row does not
--    exist yet (private.group_missing), needed because photos are uploaded
--    before the group row is created. Bounded by the uploads_under_quota
--    ceiling, so it is a storage-cost vector rather than an access issue.
--
-- 5. chat_media_insert checks membership of one side of the path pair but not
--    that the two groups are matched. Writing an object there is possible
--    without a matching chat; referencing it from a message still is not.
--
-- 6. register_push_token() upserts on the token, so a caller who somehow learns
--    another device's Expo push token can re-point it at themselves. Tokens are
--    not readable (push_tokens_select_own), so this needs an out-of-band leak.
--
-- 7. 22 of the 24 private.* helpers are EXECUTE-to-PUBLIC, contained only by
--    USAGE on schema `private` being limited to `authenticated`. That is a real
--    gate, but it is one line — and `authenticated` does hold direct EXECUTE on
--    every helper, which is an oracle rather than a leak (they return booleans
--    about the caller's own relationships).
--
-- 8. NEVER EMPIRICALLY TESTED: account deletion end to end on a throwaway
--    account, and the cross-tenant isolation probe
--    (scratchpad/cross-tenant-test.ps1), which authenticates as one user and
--    attempts the reads and writes against another's data through PostgREST.
--    Every finding in this file came from reading. That probe is the only check
--    that does not share the reader's blind spots, and it has not been run.
--
-- 9. Supabase Auth settings (JWT expiry, OTP rate limits, providers) are
--    dashboard config and are NOT captured by introspect.sql. Review separately.
-- ===========================================================================
