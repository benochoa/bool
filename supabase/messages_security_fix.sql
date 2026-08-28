-- messages + message_reactions — security fixes. RUN THIS IN THE SUPABASE DASHBOARD.
--
-- The same two holes discussions_security_fix.sql closed on discussion_messages
-- and discussion_reactions are still open on the older tables those two were
-- modelled on. The fix there was never carried back here.
--
-- Both are of one shape: a policy that checks WHO owns a row but not WHERE the
-- row may live, so an UPDATE can move a row you own into a conversation you are
-- not part of. Neither is reachable through the app, which sends no such
-- request. Both are reachable by anyone willing to call PostgREST directly with
-- their own access token — the threat model RLS exists for.
--
-- Safe to run more than once.

-- ===========================================================================
-- 1. messages: an UPDATE could relocate a message into any conversation
--
-- The shipped policy is:
--   using (auth.uid() = sender_id) with check (auth.uid() = sender_id)
--
-- It never looks at the pair. messages_insert is strict — it demands membership
-- of sender_group_id AND private.groups_matched(group_1_id, group_2_id) — but
-- the update path re-opens everything that guards: send one message in a chat
-- of your own, then PATCH group_1_id/group_2_id/sender_group_id onto any other
-- pair of groups in the database. The message lands in a private conversation
-- between two groups you have never matched with, and `messages` is in the
-- realtime publication, so it arrives on their screens live.
--
-- sender_id is already pinned by the with_check, so this was never an
-- impersonation route — but it is a write into someone else's chat.
-- ===========================================================================

drop policy if exists messages_update_own on messages;
create policy messages_update_own on messages
  for update to authenticated
  using (auth.uid() = sender_id and private.is_active_member(sender_group_id))
  with check (auth.uid() = sender_id and private.is_active_member(sender_group_id));

-- The policy alone still permits shuffling a message between two chats your
-- sending group is in. Nothing legitimate ever does that — the app updates
-- exactly four columns, to soft-delete (chatThread.tsx: deleted_at, body,
-- media_url, media_aspect_ratio) — so the keys are frozen outright rather than
-- left to a policy to reason about. created_at rides along: it is never edited
-- either, and leaving it open lets a message be backdated to sit earlier in a
-- thread than it was actually sent.
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

drop trigger if exists messages_keys_frozen on messages;
create trigger messages_keys_frozen
  before update on messages
  for each row execute function private.message_keys_frozen();

-- ===========================================================================
-- 2. message_reactions: an UPDATE could repoint a reaction
--
-- Same omission, and the same one dr_update_own was fixed for. mr_insert_own
-- checks that the message belongs to a chat you are in; mr_update_own checks
-- only user_id, so your own reaction row can be re-pointed at any message id in
-- the database — including messages in chats you have no part in. Reads stay
-- safe (mr_select gates on membership), so this plants a reaction others can
-- see rather than revealing anything, but it is still a write into their chat.
--
-- The upsert in lib/setMessageReaction.ts keeps message_id fixed, so the added
-- check costs the app nothing.
-- ===========================================================================

drop policy if exists mr_update_own on message_reactions;
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

-- ===========================================================================
-- 3. groups.id: an assumption two storage policies rest on, unenforced
--
-- chat-media and discussion-media both name their folders by joining group ids
-- with '_' and recover them with split_part(..., '_', 1|2). That is only sound
-- while a group id contains no underscore. Ids are Crypto.randomUUID() today,
-- so it holds — but groups.id is client-supplied text with no format rule, and
-- groups_insert only checks that created_by is the caller. Anyone posting
-- straight to PostgREST can choose the id their group gets.
--
-- The same ids are interpolated into a PostgREST .or() filter string by the
-- notify function (discussionSurface), which runs with the SERVICE ROLE and so
-- bypasses RLS entirely. Impact there is limited — the result only picks which
-- tab a notification opens — but a client-controlled string reaching a
-- service-role filter is worth closing off at the source.
--
-- NOT VALID so it binds new writes without forcing a scan of existing rows.
-- Check first, and drop the NOT VALID (or run VALIDATE CONSTRAINT) if clean:
--   select id from groups where id !~ '^[A-Za-z0-9-]+$';
-- ===========================================================================

alter table groups drop constraint if exists groups_id_format;
alter table groups add constraint groups_id_format
  check (id ~ '^[A-Za-z0-9-]+$') not valid;
