-- Discussions — security fixes. RUN THIS IN THE SUPABASE DASHBOARD.
--
-- Two holes in the policies shipped with discussions.sql, both of the same
-- shape: a policy that checks WHO owns a row but not WHERE the row may live, so
-- an UPDATE could move a row you own into a group you are not in.
--
-- Neither is reachable through the app, which never sends such a request. Both
-- are reachable by anyone willing to call PostgREST directly with their own
-- access token — which is the threat model RLS exists for.
--
-- Safe to run more than once.

-- ===========================================================================
-- 1. discussion_messages: an UPDATE could relocate a message
--
-- The shipped policy was:
--   using (auth.uid() = sender_id) with check (auth.uid() = sender_id)
--
-- It never looks at group_id. So a PATCH on your own message setting
-- group_id to some other group would be accepted, planting a message inside a
-- discussion you have no membership of. The insert policy has always been
-- correct; only the update path was open.
-- ===========================================================================

drop policy if exists dm_update_own on discussion_messages;
create policy dm_update_own on discussion_messages
  for update to authenticated
  using (auth.uid() = sender_id and private.is_active_member(group_id))
  with check (auth.uid() = sender_id and private.is_active_member(group_id));

-- The policy alone still permits shuffling a message between two groups you
-- happen to be in. Nothing legitimate ever does that — the app updates exactly
-- four columns, to soft-delete — so the keys are frozen outright rather than
-- left to a policy to reason about.
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

drop trigger if exists discussion_messages_keys_frozen on discussion_messages;
create trigger discussion_messages_keys_frozen
  before update on discussion_messages
  for each row execute function private.discussion_message_keys_frozen();

-- ===========================================================================
-- 2. discussion_reactions: an UPDATE could repoint a reaction
--
-- Same omission. The insert policy checks that the message belongs to a group
-- you are in; the update policy checked only user_id, so your own reaction row
-- could be re-pointed at any message id in the database — including messages in
-- other groups' discussions.
-- ===========================================================================

drop policy if exists dr_update_own on discussion_reactions;
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
