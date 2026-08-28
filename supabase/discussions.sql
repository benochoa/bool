-- Group discussions — RUN THIS IN THE SUPABASE DASHBOARD BEFORE RELOADING THE APP.
--
-- A discussion is a group's private back-room about ONE candidate group: the
-- members of `group_id` talking among themselves about `about_group_id`. The
-- candidate has no path to it whatsoever, which is the entire point and the
-- reason this cannot live in `messages`:
--
--   * messages_select grants read to active members of EITHER group in the
--     pair, so a discussion stored there would be readable by the group being
--     discussed.
--   * messages_insert requires private.groups_matched(), and a suggestion in
--     Pending or Received is by definition not matched, so the write would be
--     refused anyway.
--
-- Every policy below gates on `group_id` alone. `about_group_id` is a subject,
-- never a grant.
--
-- Deliberately NOT cascading on the suggestion: a discussion outlives the
-- suggestion that prompted it. Matching or rejecting removes the tile that
-- opens it, not the conversation. The rows go only when a group itself goes.

-- ===========================================================================
-- Tables
-- ===========================================================================

-- Mirrors `messages` column for column, minus the canonical-pair machinery:
-- a discussion has one owning group, not an unordered two.
create table discussion_messages (
  id                 bigint generated always as identity primary key,
  group_id           text not null references groups (id) on delete cascade,
  about_group_id     text not null references groups (id) on delete cascade,
  sender_id          uuid not null references profiles (id) on delete cascade,
  body               text not null constraint discussion_messages_body_len check (char_length(body) <= 4000),
  created_at         timestamptz not null default now(),
  kind               text not null default 'text' check (kind in ('text', 'image', 'audio')),
  media_url          text,
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
-- is measured against. Per-user, like chat_reads.
create table discussion_reads (
  user_id        uuid not null references auth.users (id) on delete cascade,
  group_id       text not null references groups (id) on delete cascade,
  about_group_id text not null references groups (id) on delete cascade,
  last_read_at   timestamptz not null default now(),
  primary key (user_id, group_id, about_group_id)
);

-- ===========================================================================
-- Rate limit — the same 30/minute ceiling messages carries, counted separately
-- so a busy discussion can't starve the real chat or vice versa.
-- ===========================================================================

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

drop trigger if exists discussion_messages_rate_limit on discussion_messages;
create trigger discussion_messages_rate_limit
  before insert on discussion_messages
  for each row execute function private.check_discussion_rate();

-- ===========================================================================
-- Row-level security
-- ===========================================================================

alter table discussion_messages  enable row level security;
alter table discussion_reactions enable row level security;
alter table discussion_reads     enable row level security;

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
-- No delete policy: deletion is soft (deleted_at via update), as in messages.
create policy dm_update_own on discussion_messages
  for update to authenticated
  using (auth.uid() = sender_id) with check (auth.uid() = sender_id);

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
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy dr_delete_own on discussion_reactions
  for delete to authenticated using (auth.uid() = user_id);

-- discussion_reads (own rows only — who has read what is nobody's business) ---
create policy discussion_reads_select_own on discussion_reads
  for select using (auth.uid() = user_id);
create policy discussion_reads_insert_own on discussion_reads
  for insert with check (auth.uid() = user_id);
create policy discussion_reads_update_own on discussion_reads
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ===========================================================================
-- Unread counts
-- Every preview tile carries its own badge, so the list needs one round trip
-- for all of them rather than one query per tile. Not security definer — the
-- caller's RLS already limits it to their own group, and auth.uid() rather than
-- an argument means nobody can ask for another person's counts.
-- ===========================================================================

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

-- ===========================================================================
-- Storage — discussion-media/{groupId}_{aboutGroupId}/...
-- Private, like every other bucket. Only the owning group's members, so the
-- second path segment grants nothing (group ids carry no underscores, which is
-- what lets chat-media split on one the same way).
-- ===========================================================================

insert into storage.buckets (id, name, public)
values ('discussion-media', 'discussion-media', false)
on conflict (id) do update set public = excluded.public;

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

-- ===========================================================================
-- Realtime + push
-- ===========================================================================

alter publication supabase_realtime add table discussion_messages;
alter publication supabase_realtime add table discussion_reactions;

-- Reuses the same notify function the other three webhooks post to; it routes
-- on the table name in the payload.
drop trigger if exists notify_discussion_webhook on public.discussion_messages;
create trigger notify_discussion_webhook
  after insert on public.discussion_messages
  for each row execute function public.notify_webhook();
