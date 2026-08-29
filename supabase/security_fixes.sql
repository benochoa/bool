-- ===========================================================================
-- Pre-launch security fixes — 2026-08-29
--
-- Run the whole file in the Supabase SQL editor. It is idempotent and touches
-- no data. Sections 1 and 2 close exploitable holes and should go in before the
-- app is public; 3 onward are hardening.
--
-- Verified safe against the client: no code path in lib/ ever updates the key
-- columns the new triggers freeze (checked 2026-08-29 — leaveGroup writes only
-- status/status_at, and nothing rewrites a suggestion's group ids).
-- ===========================================================================


-- ===========================================================================
-- 1. CRITICAL — a group leader can forge a match with ANY group.
--
-- gs_update's WITH CHECK validates leadership against the NEW row's group ids,
-- but nothing stops the UPDATE from rewriting those ids. So:
--
--   insert into group_suggestions (suggesting_group_id, target_group_id,
--                                  suggested_by, status)
--   values ('my-group', 'my-group', auth.uid(), 'pending');   -- allowed today
--
--   update group_suggestions
--      set suggesting_group_id = 'any-victim-group', status = 'matched'
--    where suggesting_group_id = 'my-group' and target_group_id = 'my-group';
--
-- The USING clause passes (I lead the old row's groups). The WITH CHECK passes
-- via its second branch: I lead the new row's target_group_id, which is still
-- my own group, and status is 'matched'. The result is a matched row between my
-- group and a victim that never suggested anything — private.groups_matched()
-- then returns true, messages_insert accepts, and both groups have a live chat.
--
-- This defeats the app's central invariant: that a chat exists only where both
-- leaders agreed. Two things are needed to close it.
-- ===========================================================================

-- 1a. The pair a suggestion is about is fixed at insert. This is the actual fix
--     — mirrors messages_keys_frozen, which exists for exactly this reason.
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

drop trigger if exists group_suggestions_keys_frozen on group_suggestions;
create trigger group_suggestions_keys_frozen
  before update on group_suggestions
  for each row execute function private.suggestion_keys_frozen();

-- 1b. A group suggesting itself is not something the UI can produce, and it is
--     the seed row the attack above starts from. Belt and braces: with 1a in
--     place the rewrite is already blocked, but a self-row is meaningless data
--     and would make groups_matched(x, x) reachable.
alter table group_suggestions
  drop constraint if exists group_suggestions_not_self;
alter table group_suggestions
  add constraint group_suggestions_not_self
  check (suggesting_group_id <> target_group_id) not valid;


-- ===========================================================================
-- 2. HIGH — any user can grant themselves read access to ANY group.
--
-- memberships_update lets you set your own row to status='left', and no trigger
-- freezes the row's keys. So:
--
--   update memberships
--      set group_id = 'any-group-in-any-city', status = 'left'
--    where person_id = auth.uid() and group_id = 'a-group-i-lead';
--
-- USING passes (person_id = auth.uid()). WITH CHECK passes (person_id =
-- auth.uid() and status = 'left'). The row now says I was once in the target
-- group — and private.can_see_group()'s first branch deliberately does NOT
-- filter on status, because History has to show groups you have left:
--
--   exists (select 1 from memberships
--            where group_id = p_group_id and person_id = auth.uid())
--
-- That one row therefore unlocks the target group's row, its full member
-- roster, every member's profile (via can_see_person), and its photos in the
-- `groups` bucket. It bypasses the city scoping entirely: any group, anywhere.
--
-- The attacker cannot become active — the WITH CHECK's non-'left' branch needs
-- leadership of the new group — so this is read escalation, not write. Still
-- the wrong answer to "can people read things they shouldn't".
--
-- Fixing can_see_group is the wrong lever: leaving the status filter off is
-- correct for History. The row's identity is what should be immutable.
-- ===========================================================================

create or replace function private.membership_keys_frozen()
returns trigger language plpgsql as $$
begin
  if new.group_id <> old.group_id or new.person_id <> old.person_id then
    raise exception 'a membership cannot change group or person';
  end if;
  return new;
end;
$$;

drop trigger if exists memberships_keys_frozen on memberships;
create trigger memberships_keys_frozen
  before update on memberships
  for each row execute function private.membership_keys_frozen();
-- Safe against join_group_by_code: its upsert conflicts on
-- (group_id, person_id) and its DO UPDATE sets only status and status_at, so
-- neither frozen column moves.


-- ===========================================================================
-- 3. MEDIUM — groups_update_leader has an unconditional WITH CHECK.
--
-- USING restricts a leader to rows they created; WITH CHECK (true) then places
-- no constraint on what the row becomes. Two consequences:
--
--   * created_by can be reassigned to another user, handing the group away
--     (and, with 2 fixed, that is the only remaining way to move leadership).
--
--   * invite_code can be overwritten. Because the column is UNIQUE, a failed
--     write is an oracle: "update my group set invite_code='ABC123'" either
--     succeeds or raises a unique violation, which reveals whether that code
--     belongs to some other group. Guessing a live code turns into
--     join_group_by_code() and full active membership of a stranger's group.
--     The keyspace is 31^6 ≈ 887M so this is slow, but it is unmetered and it
--     gets better for the attacker as the app grows.
-- ===========================================================================

-- 3a. The row must still belong to you after the update.
drop policy if exists groups_update_leader on groups;
create policy groups_update_leader on groups
  for update to authenticated
  using (auth.uid() = created_by)
  with check (auth.uid() = created_by);

-- 3b. Close the invite_code oracle at the grant level, the same way SELECT on
--     that column is already withheld. Table-level UPDATE is replaced with
--     column-level UPDATE on everything except invite_code, so the column
--     cannot be written by a client at all — it is set once by the
--     generate_invite_code() default and never touched again.
revoke update on groups from anon, authenticated;
grant update (name, qa, created_by, image_urls, status,
              image_aspect_ratio, card_order, age, gender, city, college)
  on groups to authenticated;
-- `id` is deliberately absent too: it is the primary key half of every storage
-- path and foreign key in the schema.


-- ===========================================================================
-- 4. MEDIUM — an orphaned integrity check.
--
-- private.discussion_reply_in_same_thread() exists but no trigger calls it, so
-- reply_to_id on a discussion message is unconstrained and can point at a
-- message in another thread or another group's discussion. `messages` has had
-- the equivalent trigger all along; discussion_messages never got one.
--
-- Not a read leak — rendering the quoted message still goes through dm_select —
-- but the guarantee the function was written for is simply not in force.
-- ===========================================================================

drop trigger if exists discussion_messages_reply_same_thread on discussion_messages;
create trigger discussion_messages_reply_same_thread
  before insert or update on discussion_messages
  for each row execute function private.discussion_reply_in_same_thread();


-- ===========================================================================
-- 5. LOW — nine policies are `to public` rather than `to authenticated`.
--
-- Each still tests auth.uid(), which is null for anon, so nothing leaks today.
-- But anon is evaluated against them rather than refused at the door, and that
-- is one auth.uid()-less policy edit away from mattering.
-- ===========================================================================

drop policy if exists chat_reads_select_own on chat_reads;
create policy chat_reads_select_own on chat_reads
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists chat_reads_insert_own on chat_reads;
create policy chat_reads_insert_own on chat_reads
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists chat_reads_update_own on chat_reads;
create policy chat_reads_update_own on chat_reads
  for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists discussion_reads_select_own on discussion_reads;
create policy discussion_reads_select_own on discussion_reads
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists discussion_reads_insert_own on discussion_reads;
create policy discussion_reads_insert_own on discussion_reads
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists discussion_reads_update_own on discussion_reads;
create policy discussion_reads_update_own on discussion_reads
  for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists blocked_people_own on blocked_people;
create policy blocked_people_own on blocked_people
  for all to authenticated
  using (auth.uid() = blocker_id) with check (auth.uid() = blocker_id);

drop policy if exists push_tokens_select_own on push_tokens;
create policy push_tokens_select_own on push_tokens
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists push_tokens_delete_own on push_tokens;
create policy push_tokens_delete_own on push_tokens
  for delete to authenticated using (auth.uid() = user_id);

drop policy if exists reports_insert_own on reports;
create policy reports_insert_own on reports
  for insert to authenticated with check (auth.uid() = reporter_id);
drop policy if exists reports_select_own on reports;
create policy reports_select_own on reports
  for select to authenticated using (auth.uid() = reporter_id);


-- ===========================================================================
-- 6. LOW — six constraints are NOT VALID, so rows that predate them were never
-- checked. New writes ARE enforced, so this is about legacy rows only.
--
-- groups_id_format matters most: the notify edge function interpolates group
-- ids into PostgREST .or() filter strings while running as service_role, and
-- the [A-Za-z0-9-] restriction is the only thing keeping a comma or paren out
-- of that string. VALIDATE turns "enforced going forward" into "true of every
-- row".
--
-- Each will raise if an existing row violates it. If one does, fix that row
-- rather than skipping the validation.
-- ===========================================================================

alter table groups              validate constraint groups_id_format;
alter table groups              validate constraint groups_image_urls_storage;
alter table profiles            validate constraint profiles_image_urls_storage;
alter table profiles            validate constraint profiles_pic_url_storage;
alter table messages            validate constraint messages_media_url_storage;
alter table discussion_messages validate constraint discussion_messages_media_url_storage;
alter table group_suggestions   validate constraint group_suggestions_not_self;


-- ===========================================================================
-- 7. Verification. Every row should read OK.
-- ===========================================================================

select 'suggestion keys frozen' as check,
       case when exists (select 1 from pg_trigger
                          where tgname = 'group_suggestions_keys_frozen'
                            and not tgisinternal)
            then 'OK' else 'MISSING' end as result
union all
select 'membership keys frozen',
       case when exists (select 1 from pg_trigger
                          where tgname = 'memberships_keys_frozen'
                            and not tgisinternal)
            then 'OK' else 'MISSING' end
union all
select 'discussion reply trigger',
       case when exists (select 1 from pg_trigger
                          where tgname = 'discussion_messages_reply_same_thread'
                            and not tgisinternal)
            then 'OK' else 'MISSING' end
union all
select 'groups update check tightened',
       case when (select with_check from pg_policies
                   where tablename = 'groups' and policyname = 'groups_update_leader')
                 = '(auth.uid() = created_by)'
            then 'OK' else 'STILL true' end
union all
select 'invite_code not client-writable',
       case when has_column_privilege('authenticated', 'public.groups', 'invite_code', 'UPDATE')
            then 'STILL WRITABLE' else 'OK' end
union all
select 'invite_code not client-readable',
       case when has_column_privilege('authenticated', 'public.groups', 'invite_code', 'SELECT')
            then 'STILL READABLE' else 'OK' end
union all
select 'policies still to public',
       coalesce((select string_agg(policyname, ', ')
                   from pg_policies
                  where schemaname = 'public' and roles = '{public}'), 'none — OK')
union all
select 'constraints still NOT VALID',
       coalesce((select string_agg(conname, ', ')
                   from pg_constraint c
                   join pg_class r on r.oid = c.conrelid
                   join pg_namespace n on n.oid = r.relnamespace
                  where n.nspname = 'public' and not c.convalidated), 'none — OK');
