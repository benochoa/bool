-- bool — database schema (current-state mirror)
--
-- This file is NOT a chronological migration log. It is a faithful snapshot of
-- the live Supabase database, reconstructed from a full introspection on
-- 2026-08-25 (pg catalog dump of tables, constraints, indexes, RLS policies,
-- functions, triggers, grants and storage buckets). Regenerate it after any
-- dashboard change so it stops drifting; the authoritative tool once Docker is
-- available is `supabase db dump --schema public,storage,auth`.
--
-- It includes the security hardening from the 2026-08 audit (see the SECURITY
-- section headers throughout). The `<WEBHOOK_SECRET>` below is a placeholder —
-- the real value lives in the notify function's WEBHOOK_SECRET secret and is
-- never committed.
--
-- Access model in one line: Supabase grants anon + authenticated broad table
-- privileges by default, and ROW-LEVEL SECURITY is the real gate. Every table
-- has RLS enabled; the policies below (and the private.* helpers they call) are
-- what actually enforce who can see and change what. Anonymous callers get
-- nothing anywhere, because every rule funnels through auth.uid(), which is
-- null for anon.

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
  image_urls         text[] not null default '{}',
  profile_pic_url    text,
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

create table groups (
  id                 text primary key,
  name               text not null default '' constraint groups_name_len check (char_length(name) <= 60),
  qa                 jsonb not null default '[]' constraint groups_qa_size check (char_length(qa::text) <= 8000),
  created_by         uuid references profiles (id),               -- the leader (nullable: legacy rows)
  invite_code        text unique default private.generate_invite_code(),
  image_urls         text[] not null default '{}',
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
-- are kept for History (with the moment and manner each ended).
create table memberships (
  group_id  text not null references groups (id) on delete cascade,
  person_id uuid not null references profiles (id) on delete cascade,
  status    text not null default 'active' check (status in ('active', 'kicked', 'left', 'group_dissolved')),
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
  kind               text not null default 'text' check (kind in ('text', 'image', 'audio')),
  media_url          text,
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
-- nobody else's business. Keyed by the canonical pair.
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

-- Abuse reports. Only one target_* is set, per target_type. message_snapshot
-- copies the body at report time because messages are soft-deletable — without
-- it a sender could blank the evidence before anyone reads the report.
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

-- Realtime streams nothing until a table is added to this publication (no error
-- if forgotten, just silence). Chats watch messages + reactions; the Groups tab
-- and current-group context watch groups + memberships.
alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table message_reactions;
alter publication supabase_realtime add table groups;
alter publication supabase_realtime add table memberships;

-- replica identity full: a change event otherwise carries only the primary key
-- of the old row, but the client and the notify function need the *previous*
-- status to tell a join from a rejoin from a leave.
alter table memberships replica identity full;

-- ===========================================================================
-- Authorization helpers (private schema — never exposed as RPCs)
-- All are STABLE SECURITY DEFINER with a pinned search_path: they bypass RLS
-- internally (so the policies that call them don't recurse), return only a
-- boolean, and test only the caller's own relationships.
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
-- related to one of mine via a suggestion. The past-membership branch is
-- deliberate — History shows a group you've left exactly like any other,
-- current members included.
create or replace function private.can_see_group(p_group_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select
    exists (
      select 1 from memberships
       where group_id = p_group_id and person_id = auth.uid()
    )
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

-- Message rate limit (BEFORE INSERT trigger below): 30 per sender per minute.
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

-- Chat list previews in one round trip. Not security definer — the caller's RLS
-- already hides a blocker's rows, so the lateral lands on the newest message
-- this viewer can see; the case only relabels a message from someone THIS user
-- has blocked (their own block hides nothing by itself).
create or replace function get_chat_previews(my_group_id text)
returns table(other_group_id text, other_group_name text, last_message text,
              last_message_at timestamptz, other_group_image_urls text[])
language sql stable as $$
  select
    g.id::text,
    g.name::text,
    case
      when exists (
        select 1 from blocked_people bp
        where bp.blocker_id = auth.uid() and bp.blocked_id = m.sender_id
      ) then 'Message from blocked user'
      else m.body::text
    end,
    m.created_at::timestamptz,
    g.image_urls::text[]
  from group_suggestions gs
  cross join lateral (
    select case
      when gs.suggesting_group_id = my_group_id then gs.target_group_id
      else gs.suggesting_group_id
    end as other_id
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
  where gs.status = 'matched'
    and (gs.suggesting_group_id = my_group_id or gs.target_group_id = my_group_id)
  order by m.created_at desc nulls last;
$$;

-- Everyone the viewer should see rendered as "Blocked user" (both directions).
create or replace function get_blocked_person_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select blocked_id from blocked_people where blocker_id = auth.uid()
  union
  select blocker_id from blocked_people where blocked_id = auth.uid();
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
-- check in the storage policy has nothing to pass against.
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
  delete from auth.users where id = uid;   -- without this the login/phone survives
end;
$$;

-- ===========================================================================
-- Row-level security
-- ===========================================================================

alter table profiles          enable row level security;
alter table groups            enable row level security;
alter table memberships       enable row level security;
alter table questions         enable row level security;
alter table group_suggestions enable row level security;
alter table messages          enable row level security;
alter table message_reactions enable row level security;
alter table chat_reads        enable row level security;
alter table blocked_people    enable row level security;
alter table push_tokens       enable row level security;
alter table bug_reports       enable row level security;
alter table reports           enable row level security;

-- Safety net: auto-enable RLS on any new table created in public, so a future
-- table can't ship accidentally world-open.
create or replace function public.rls_auto_enable()
returns event_trigger language plpgsql security definer set search_path = pg_catalog as $$
declare cmd record;
begin
  for cmd in
    select * from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      and object_type in ('table', 'partitioned table')
  loop
    if cmd.schema_name = 'public' then
      begin
        execute format('alter table if exists %s enable row level security', cmd.object_identity);
      exception when others then
        raise log 'rls_auto_enable: failed on %', cmd.object_identity;
      end;
    end if;
  end loop;
end;
$$;

drop event trigger if exists rls_auto_enable;
create event trigger rls_auto_enable on ddl_command_end
  execute function public.rls_auto_enable();

-- profiles -------------------------------------------------------------------
create policy profiles_select on profiles
  for select to authenticated using (private.can_see_person((id)::text));
create policy profiles_insert_own on profiles
  for insert to authenticated with check (auth.uid() = id);
create policy profiles_update_own on profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
-- (The live DB also carries a redundant duplicate update policy, "Users can
--  update own profile"; it is harmless and can be dropped.)

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
-- now limited to a group you created (the only legitimate one, on creation);
-- every other join goes through join_group_by_code (definer, bypasses RLS).
create policy memberships_insert_self on memberships
  for insert to authenticated with check (
    auth.uid() = person_id
    and exists (select 1 from groups g where g.id = group_id and g.created_by = auth.uid())
  );
-- SECURITY (2026-08 audit): a bare (auth.uid() = person_id) with_check let a
-- kicked member set their own row back to 'active', or hop it into another
-- group. Self-updates are now limited to leaving; leaders keep full control.
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
create policy messages_update_own on messages
  for update to authenticated using (auth.uid() = sender_id) with check (auth.uid() = sender_id);

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
create policy mr_update_own on message_reactions
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy mr_delete_own on message_reactions
  for delete to authenticated using (auth.uid() = user_id);

-- chat_reads (own rows only — who has read what is private) -------------------
create policy chat_reads_select_own on chat_reads
  for select using (auth.uid() = user_id);
create policy chat_reads_insert_own on chat_reads
  for insert with check (auth.uid() = user_id);
create policy chat_reads_update_own on chat_reads
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- blocked_people (own blocks only) -------------------------------------------
create policy blocked_people_own on blocked_people
  for all using (auth.uid() = blocker_id) with check (auth.uid() = blocker_id);

-- push_tokens (a token is a capability — own rows only; writes via RPC only) --
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
-- recorded here.
-- ===========================================================================

-- invite_code is a key to a group's chats, and clients load other groups
-- constantly, so it must never reach a client. A plain column revoke does not
-- hold while a table-level SELECT grant is present (that implies every column),
-- so SELECT is revoked at the table level and re-granted per column, omitting
-- invite_code.
revoke select on groups from anon, authenticated;
grant select (id, name, qa, created_by, image_urls, status,
              image_aspect_ratio, card_order, age, gender, city, college)
  on groups to anon, authenticated;

-- Sensitive RPCs: lock execute to authenticated. (Supabase grants execute to
-- anon explicitly on new functions, and a revoke from PUBLIC does not remove a
-- role-specific grant — so anon must be named.)
revoke all on function register_push_token(text) from public, anon;
grant execute on function register_push_token(text) to authenticated;
revoke all on function join_group_by_code(text) from public, anon;
grant execute on function join_group_by_code(text) to authenticated;
revoke all on function get_invite_code(text) from public, anon;
grant execute on function get_invite_code(text) to authenticated;

-- ===========================================================================
-- Storage
-- All three buckets are PRIVATE. Reads go through authenticated URLs
-- (lib/storageAuth.ts) gated by the policies below; the public URL path is dead.
-- ===========================================================================

insert into storage.buckets (id, name, public)
values ('groups', 'groups', false), ('people', 'people', false), ('chat-media', 'chat-media', false)
on conflict (id) do update set public = excluded.public;

-- people/{userId}/... — your own folder is yours; others are visible per
-- can_see_person. (The live DB also has redundant "Users can upload/overwrite
-- own photos" insert/update policies subsumed by people_own; safe to drop.)
create policy people_own on storage.objects
  for all to authenticated
  using (bucket_id = 'people' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'people' and (storage.foldername(name))[1] = auth.uid()::text);
create policy people_select on storage.objects
  for select to authenticated
  using (bucket_id = 'people' and private.can_see_person((storage.foldername(name))[1]));

-- groups/{groupId}/... — leader-only writes, visible per can_see_group.
-- SECURITY (2026-08 audit): insert was bucket-only. It now requires leadership,
-- while still allowing the create flow, which uploads to a brand-new group's
-- folder BEFORE the row exists (hence the not-exists branch).
create policy groups_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'groups'
    and (
      private.is_group_leader((storage.foldername(name))[1])
      or not exists (select 1 from groups where id = (storage.foldername(name))[1])
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
-- SECURITY (2026-08 audit): insert was bucket-only; it now requires membership.
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

-- ===========================================================================
-- Triggers
-- ===========================================================================

-- Rate limit (BEFORE INSERT): 30 messages per sender per minute.
drop trigger if exists messages_rate_limit on messages;
create trigger messages_rate_limit
  before insert on messages
  for each row execute function private.check_message_rate();

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