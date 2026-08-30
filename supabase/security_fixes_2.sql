-- ===========================================================================
-- Security review round 2 — 2026-08-29 (pre-launch)
--
-- Run the whole file in the Supabase SQL editor. Idempotent, touches no data,
-- ends with a verification query whose every row should read OK.
--
-- Round 1 (security_fixes.sql) closed the two write-side holes: forged matches
-- and membership re-pointing. This round is mostly READ-side, plus one
-- regression that round 1 introduced.
--
-- Sections 1 and 2 must go in before launch. 3-6 are hardening and a
-- correctness fix. Section 6 also needs a small client change — see the note at
-- the end of that section.
-- ===========================================================================


-- ===========================================================================
-- 1. HIGH — reports.message_snapshot is an oracle for ANY message in the app.
--
-- private.snapshot_reported_message() is SECURITY DEFINER, so it reads
-- public.messages with RLS bypassed, and it never asks whether the reporter can
-- see the message it is copying:
--
--   select body into new.message_snapshot
--     from messages where id = new.target_message_id;
--
-- reports_insert_own only requires auth.uid() = reporter_id, and
-- reports_select_own hands your own rows back. So:
--
--   insert into reports (reporter_id, target_type, target_message_id, reason)
--   values (auth.uid(), 'message', <any id>, 'x');
--   select message_snapshot from reports order by id desc limit 1;
--
-- returns the body of any message in the database, from any chat between any
-- two groups. messages.id is `generated always as identity`, so the ids are
-- sequential and need no guessing — an attacker walks 1, 2, 3.
--
-- The reports_rate_limit trigger caps this at 10/hour, so it is a slow drip
-- rather than a bulk dump: ~240 message bodies a day, indefinitely. Message
-- bodies are the most sensitive content in the app, which makes this the most
-- serious issue found in any round.
--
-- The fix keeps the anti-tamper property that put the snapshot server-side in
-- the first place — a reporter must not be able to invent the evidence — while
-- adding the visibility test that was missing. Superseded by section 6 below,
-- which extends the same function to discussion messages; this section is kept
-- so the reasoning stays with the finding.
-- ===========================================================================

-- (superseded by section 6 — the final version of this function is there)


-- ===========================================================================
-- 2. HIGH (regression introduced by round 1) — leadership transfer is broken.
--
-- security_fixes.sql tightened groups_update_leader to
-- `with check (auth.uid() = created_by)`. That closed the reassign-to-anyone
-- hole, but it also blocks the app's own Make Leader action
-- (lib/makeGroupLeader.ts), which is precisely an update setting created_by to
-- somebody else. Every transfer currently fails the check.
--
-- The correct rule is narrower than either version: a leader may hand the group
-- to an ACTIVE MEMBER of that group, and to nobody else. `with check (true)`
-- allowed handing it to any user id in the database; the round-1 version
-- allowed handing it to nobody at all.
-- ===========================================================================

create or replace function private.is_active_member_of(p_group_id text, p_person uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships
     where group_id = p_group_id and person_id = p_person and status = 'active'
  );
$$;

drop policy if exists groups_update_leader on groups;
create policy groups_update_leader on groups
  for update to authenticated
  using (auth.uid() = created_by)
  with check (
    auth.uid() = created_by                          -- ordinary edit
    or private.is_active_member_of(id, created_by)   -- transfer to a member
  );


-- ===========================================================================
-- 3. MEDIUM — blocking someone reveals their profile.
--
-- private.can_see_person()'s third branch makes anyone you have blocked
-- visible, so the block list can render who is on it. But blocked_people_own
-- puts no constraint on WHO you may block:
--
--   insert into blocked_people (blocker_id, blocked_id)
--   values (auth.uid(), '<any profile id>');
--
-- and that person's full profile — name, age, gender, city, college, every
-- questionnaire answer — plus their photos in the `people` bucket (people_select
-- also keys off can_see_person) become readable.
--
-- Exploitability is limited by uuid supply: profile ids are not enumerable, and
-- the ones a client can observe generally belong to people it can already see.
-- So this is a privilege the design did not intend rather than a live breach —
-- but "block anyone to read them" should not be a primitive, and the fix is free.
--
-- The helper deliberately does NOT reuse can_see_person: that function's third
-- branch is the block table itself, so calling it from a policy on that table
-- would be circular.
-- ===========================================================================

create or replace function private.shares_visible_group(p_person uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships m
     where m.person_id = p_person and private.can_see_group(m.group_id)
  );
$$;

drop policy if exists blocked_people_own on blocked_people;
create policy blocked_people_own on blocked_people
  for all to authenticated
  using (auth.uid() = blocker_id)
  with check (
    auth.uid() = blocker_id
    and private.shares_visible_group(blocked_id)
  );
-- USING stays broad so an existing block remains visible and removable even if
-- the other person later leaves every group you can see — otherwise a block
-- could become permanently unremovable.


-- ===========================================================================
-- 4. MEDIUM — seven revokes that do nothing.
--
-- `revoke ... from anon` removes only the grant anon holds by name. The default
-- EXECUTE is a separate ACL entry whose grantee is PUBLIC, and a role's
-- effective privilege is the union of its own grants and PUBLIC's — so anon
-- keeps EXECUTE through the PUBLIC entry. Only `from public` removes it.
--
-- Nothing is reachable through them today (each function is safe for its own
-- internal reason), so this is a missing defence rather than an open door. It
-- matters before launch because the next SECURITY DEFINER RPC that copies the
-- `from anon` pattern would ship callable by anon.
-- ===========================================================================

revoke all on function dissolve_group(text)                from public, anon;
revoke all on function delete_my_account()                 from public, anon;
revoke all on function get_chat_previews(text)             from public, anon;
revoke all on function get_unread_chat_count(text)         from public, anon;
revoke all on function get_discussion_unread_counts(text)  from public, anon;
revoke all on function get_group_chat_preview(text)        from public, anon;
revoke all on function get_blocked_person_ids()            from public, anon;

grant execute on function dissolve_group(text)               to authenticated;
grant execute on function delete_my_account()                to authenticated;
grant execute on function get_chat_previews(text)            to authenticated;
grant execute on function get_unread_chat_count(text)        to authenticated;
grant execute on function get_discussion_unread_counts(text) to authenticated;
grant execute on function get_group_chat_preview(text)       to authenticated;
grant execute on function get_blocked_person_ids()           to authenticated;

-- The two helpers added by this file follow the same rule from the start.
revoke all on function private.is_active_member_of(text, uuid) from public, anon;
revoke all on function private.shares_visible_group(uuid)      from public, anon;


-- ===========================================================================
-- 5. LOW — get_chat_previews shows the body of a deleted message.
--
-- The thread renders a soft-deleted message as "Message deleted", but the chat
-- list still printed its body, because this lateral never filtered deleted_at.
-- get_group_chat_preview already does. Bringing the two into line.
-- ===========================================================================

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

revoke all on function get_chat_previews(text) from public, anon;
grant execute on function get_chat_previews(text) to authenticated;


-- ===========================================================================
-- 6. MEDIUM — reporting a discussion message points at the wrong row,
--    and the final form of the section 1 fix.
--
-- chatThread reports with `{ type: 'message', messageId: message.id }` in both
-- modes, but in discussion mode that id belongs to discussion_messages, while
-- reports.target_message_id is FK'd to messages(id). The two tables have
-- independent identity sequences, so the id usually EXISTS on the other table —
-- the FK passes and the report silently attaches to an unrelated message in a
-- stranger's chat. Where it does not exist, the report just fails.
--
-- The membership gate below stops that from leaking anything. What it cannot
-- fix on its own is the wrong target, which needs a column that can name a
-- discussion message.
--
-- target_type stays 'message' for both kinds, so the existing check constraint
-- and any moderation query keep working; which column is set says which table
-- the id came from.
-- ===========================================================================

alter table reports
  add column if not exists target_discussion_message_id bigint
    references discussion_messages (id) on delete set null;

-- A message report names exactly one message, from exactly one of the two
-- tables. Non-message reports name neither.
alter table reports drop constraint if exists reports_one_message_target;
alter table reports add constraint reports_one_message_target check (
  case when target_type = 'message'
       then (target_message_id is not null) <> (target_discussion_message_id is not null)
       else target_message_id is null and target_discussion_message_id is null
  end
) not valid;
-- NOT VALID deliberately: rows predating the column may already carry the
-- mismatched id described above, and this file must not fail on your existing
-- data. Check them, then validate:
--   select id, target_type, target_message_id, target_discussion_message_id
--     from reports where target_type = 'message';
--   alter table reports validate constraint reports_one_message_target;

-- The trigger handles both tables, each gated by the membership rule that
-- governs reading it: either side of the chat for a message, the owning group
-- for a discussion. This is the final version of the section 1 fix.
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
    -- Membership of one side of the conversation, mirroring messages_select's
    -- first half. The sender_blocked_me half is deliberately NOT applied: being
    -- blocked by someone is not a reason to be unable to report them.
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

-- CLIENT CHANGE THAT GOES WITH THIS SECTION (already applied in the repo):
--   lib/submitReport.ts  — ReportTarget's message variant carries `discussion`,
--                          and the insert picks the matching column.
--   components/chats/chatThread.tsx — passes `discussion` when reporting.
-- Run this SQL BEFORE reloading the app: the client now sends a column that
-- does not exist until the ALTER above has run.


-- ===========================================================================
-- 7. Verification. Every row should read OK.
-- ===========================================================================

select 'report snapshot is visibility-gated' as check,
       case when pg_get_functiondef('private.snapshot_reported_message()'::regprocedure)
                 like '%is_active_member(m.group_1_id)%'
            then 'OK' else 'NOT GATED' end as result
union all
select 'report snapshot handles discussions',
       case when pg_get_functiondef('private.snapshot_reported_message()'::regprocedure)
                 like '%target_discussion_message_id%'
            then 'OK' else 'MISSING' end
union all
select 'reports has discussion target column',
       case when exists (select 1 from information_schema.columns
                          where table_schema = 'public' and table_name = 'reports'
                            and column_name = 'target_discussion_message_id')
            then 'OK' else 'MISSING' end
union all
select 'leadership transfer possible again',
       case when (select with_check from pg_policies
                   where tablename = 'groups' and policyname = 'groups_update_leader')
                 like '%is_active_member_of%'
            then 'OK' else 'STILL BLOCKED' end
union all
select 'block requires shared visibility',
       case when (select with_check from pg_policies
                   where tablename = 'blocked_people' and policyname = 'blocked_people_own')
                 like '%shares_visible_group%'
            then 'OK' else 'UNRESTRICTED' end
union all
select 'no PUBLIC execute left on app RPCs',
       coalesce((
         select string_agg(p.proname, ', ')
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          where n.nspname = 'public'
            and p.prokind = 'f'
            and a.privilege_type = 'EXECUTE'
            and a.grantee = 0                    -- 0 = PUBLIC
            and p.proname <> 'rls_auto_enable'   -- event trigger fn, harmless
       ), 'none — OK')
union all
select 'chat previews hide deleted bodies',
       case when pg_get_functiondef('public.get_chat_previews(text)'::regprocedure)
                 like '%deleted_at is null%'
            then 'OK' else 'STILL SHOWN' end;
