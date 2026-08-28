// Push notifications. Called by four Database Webhooks (dashboard → Database →
// Webhooks): group_suggestions on INSERT + UPDATE, messages on INSERT,
// memberships on INSERT + UPDATE, and discussion_messages on INSERT — all POST
// here with an `x-webhook-secret` header matching the WEBHOOK_SECRET function
// secret. Deploy with --no-verify-jwt (webhooks carry no user JWT).
//
// Recipients are worked out server-side from active memberships, minus the
// person whose action caused the event, so pushes go out even after the actor
// closes the app. In-app banners are the client's own job (realtime, current
// group only); this function covers every group a recipient is in.
import { createClient } from 'npm:@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

type WebhookPayload = {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  table: string;
  record: Record<string, unknown> | null;
  old_record: Record<string, unknown> | null;
};

type SuggestionRow = {
  suggesting_group_id: string;
  target_group_id: string;
  suggested_by: string;
  status: string;
};

type MessageRow = {
  group_1_id: string;
  group_2_id: string;
  sender_group_id: string;
  sender_id: string;
  body: string;
};

type MembershipRow = {
  group_id: string;
  person_id: string;
  status: string;
};

type DiscussionRow = {
  group_id: string;
  about_group_id: string;
  sender_id: string;
  body: string;
};

// One push to one person; fan-out to their devices happens at send time. data
// is what a tap routes on (lib/notificationRouting.ts parses the same shape).
type Push = {
  userId: string;
  title: string;
  body: string;
  data: {
    type: string;
    groupId: string;
    otherGroupId?: string;
    // Discussion pushes only: which tab the candidate's tile is on.
    surface?: 'pending' | 'received';
  };
};

async function activeMembers(groupIds: string[]): Promise<Map<string, string[]>> {
  const { data } = await supabase
    .from('memberships')
    .select('group_id, person_id')
    .in('group_id', groupIds)
    .eq('status', 'active');
  const map = new Map<string, string[]>(groupIds.map(id => [id, []]));
  for (const row of data ?? []) map.get(row.group_id)?.push(row.person_id);
  return map;
}

async function groupInfo(
  groupIds: string[],
): Promise<Map<string, { name: string; created_by: string | null }>> {
  const { data } = await supabase
    .from('groups')
    .select('id, name, created_by')
    .in('id', groupIds);
  return new Map((data ?? []).map(g => [g.id, { name: g.name, created_by: g.created_by }]));
}

async function personName(personId: string): Promise<string> {
  const { data } = await supabase.from('profiles').select('name').eq('id', personId).single();
  return data?.name || 'Someone';
}

// Everyone with a block in either direction with `userId` — mirrors the RLS
// rule that hides these two people's messages from each other in the app.
async function blockedWith(userId: string): Promise<Set<string>> {
  const { data } = await supabase
    .from('blocked_people')
    .select('blocker_id, blocked_id')
    .or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`);
  const set = new Set<string>();
  for (const row of data ?? []) {
    set.add(row.blocker_id === userId ? row.blocked_id : row.blocker_id);
  }
  return set;
}

// Case 5: a message landed in a chat — both groups hear about it, minus the
// sender and anyone in a block with them. body already reads correctly for
// media ('Photo', voice-note label): the row carries a human-readable body.
async function forMessage(payload: WebhookPayload): Promise<Push[]> {
  if (payload.type !== 'INSERT' || !payload.record) return [];
  const msg = payload.record as MessageRow;
  const otherOf = (g: string) => (g === msg.group_1_id ? msg.group_2_id : msg.group_1_id);

  const [members, groups, senderName, blocked] = await Promise.all([
    activeMembers([msg.group_1_id, msg.group_2_id]),
    groupInfo([msg.group_1_id, msg.group_2_id]),
    personName(msg.sender_id),
    blockedWith(msg.sender_id),
  ]);

  // A recipient's own group frames the notification. Someone in both groups is
  // filed under the one that isn't the sender's, and only pushed once.
  const pushes = new Map<string, Push>();
  for (const groupId of [otherOf(msg.sender_group_id), msg.sender_group_id]) {
    for (const userId of members.get(groupId) ?? []) {
      if (userId === msg.sender_id || blocked.has(userId) || pushes.has(userId)) continue;
      pushes.set(userId, {
        userId,
        title: `[${groups.get(groupId)?.name ?? ''}] ${senderName}`,
        body: msg.body,
        data: { type: 'message', groupId, otherGroupId: otherOf(groupId) },
      });
    }
  }
  return [...pushes.values()];
}

async function forSuggestion(payload: WebhookPayload): Promise<Push[]> {
  const row = payload.record as SuggestionRow | null;
  if (!row) return [];
  const sg = row.suggesting_group_id;
  const tg = row.target_group_id;

  // Case 1: a member swiped — tell the rest of their group.
  if (payload.type === 'INSERT' && row.status === 'pending') {
    const [members, groups, suggesterName] = await Promise.all([
      activeMembers([sg]),
      groupInfo([sg]),
      personName(row.suggested_by),
    ]);
    return (members.get(sg) ?? [])
      .filter(id => id !== row.suggested_by)
      .map(userId => ({
        userId,
        title: `[${groups.get(sg)?.name ?? ''}]`,
        body: `${suggesterName} made a suggestion!`,
        data: { type: 'suggestion', groupId: sg },
      }));
  }

  // Status is the only column whose change notifies; matched_at riding along
  // with 'matched' is the same event, not a second one.
  const oldStatus = (payload.old_record as SuggestionRow | null)?.status;
  if (payload.type !== 'UPDATE' || row.status === oldStatus) return [];

  // Cases 2 + 4: the leader sent it — their group hears who approved, the
  // target group hears a request arrived.
  if (row.status === 'sent') {
    const [members, groups] = await Promise.all([activeMembers([sg, tg]), groupInfo([sg, tg])]);
    const leaderId = groups.get(sg)?.created_by ?? null;
    const leaderName = leaderId ? await personName(leaderId) : 'Your leader';
    const mine: Push[] = (members.get(sg) ?? [])
      .filter(id => id !== leaderId)
      .map(userId => ({
        userId,
        title: `[${groups.get(sg)?.name ?? ''}]`,
        body: `${leaderName} approved a group!`,
        data: { type: 'sent', groupId: sg },
      }));
    const theirs: Push[] = (members.get(tg) ?? []).map(userId => ({
      userId,
      title: `[${groups.get(tg)?.name ?? ''}]`,
      body: `you've received a request!`,
      data: { type: 'received', groupId: tg },
    }));
    return [...mine, ...theirs];
  }

  // Case 3: the receiving leader approved — both groups have a match. The
  // approver is the target group's leader, so only that side filters anyone.
  if (row.status === 'matched') {
    const [members, groups] = await Promise.all([activeMembers([sg, tg]), groupInfo([sg, tg])]);
    const approverId = groups.get(tg)?.created_by ?? null;
    const pushes = new Map<string, Push>();
    for (const [groupId, otherGroupId] of [[sg, tg], [tg, sg]] as const) {
      for (const userId of members.get(groupId) ?? []) {
        if (userId === approverId || pushes.has(userId)) continue;
        pushes.set(userId, {
          userId,
          title: `[${groups.get(groupId)?.name ?? ''}]`,
          body: `there's a match!`,
          data: { type: 'match', groupId, otherGroupId },
        });
      }
    }
    return [...pushes.values()];
  }

  return [];
}

// Case 9: someone posted in the group's private discussion about a candidate
// group. Only that group's own members hear about it — the group under
// discussion has no part in this and is never told it is being talked about.
async function forDiscussion(payload: WebhookPayload): Promise<Push[]> {
  if (payload.type !== 'INSERT' || !payload.record) return [];
  const row = payload.record as DiscussionRow;

  const [members, groups, senderName, blocked, surface] = await Promise.all([
    activeMembers([row.group_id]),
    groupInfo([row.group_id]),
    personName(row.sender_id),
    blockedWith(row.sender_id),
    discussionSurface(row.group_id, row.about_group_id),
  ]);

  return (members.get(row.group_id) ?? [])
    .filter(id => id !== row.sender_id && !blocked.has(id))
    .map(userId => ({
      userId,
      // The recipient's OWN group, as every other notification in the app does
      // — the bracket answers "which of my groups is this about?", and someone
      // in several would otherwise have no way to tell. The candidate being
      // discussed is deliberately left out of it.
      title: `[${groups.get(row.group_id)?.name ?? ''}] ${senderName}`,
      body: row.body,
      // A discussion has no screen of its own — it opens from a tile, so the tap
      // has to land on whichever tab that tile is sitting on.
      data: { type: 'discussion', groupId: row.group_id, otherGroupId: row.about_group_id, surface },
    }));
}

// Which tab the candidate's tile lives on. A suggestion this group made is in
// Pending; one aimed at it is in Received. Defaults to Pending for a discussion
// whose suggestion has since been answered — the tile is gone either way, and
// the tab is the closest thing to right.
async function discussionSurface(
  groupId: string,
  aboutGroupId: string,
): Promise<'pending' | 'received'> {
  const { data } = await supabase
    .from('group_suggestions')
    .select('suggesting_group_id')
    .or(
      `and(suggesting_group_id.eq.${groupId},target_group_id.eq.${aboutGroupId}),` +
      `and(suggesting_group_id.eq.${aboutGroupId},target_group_id.eq.${groupId})`,
    )
    .maybeSingle();
  return data?.suggesting_group_id === aboutGroupId ? 'received' : 'pending';
}

// Cases 6, 7 + 8: the roster changed. A fresh join inserts; a rejoin updates a
// row that was 'left' back to 'active', because redeeming an invite code
// upserts. A dissolution ('group_dissolved') stays silent — it would announce
// every member at once to a group that no longer exists.
async function forMembership(payload: WebhookPayload): Promise<Push[]> {
  const row = payload.record as MembershipRow | null;
  if (!row) return [];
  const old = payload.old_record as MembershipRow | null;

  const joined = row.status === 'active' && old?.status !== 'active';
  const left = row.status === 'left' && old?.status === 'active';
  const removed = row.status === 'kicked' && old?.status === 'active';
  if (!joined && !left && !removed) return [];

  const [members, groups, who] = await Promise.all([
    activeMembers([row.group_id]),
    groupInfo([row.group_id]),
    personName(row.person_id),
  ]);

  // A kick is the leader's doing, so the leader hears nothing; a join or a
  // leave belongs to the person themselves. Someone who left or was removed is
  // already out of activeMembers, so the person_id filter mainly covers a
  // joiner being told about their own arrival.
  const actorId = removed ? groups.get(row.group_id)?.created_by ?? null : row.person_id;
  const what = joined ? 'joined the group!' : removed ? 'was removed from the group!' : 'left the group!';
  const groupName = groups.get(row.group_id)?.name ?? '';
  const type = joined ? 'joined' : removed ? 'removed' : 'left';

  const pushes: Push[] = (members.get(row.group_id) ?? [])
    .filter(id => id !== row.person_id && id !== actorId)
    .map(userId => ({
      userId,
      title: `[${groupName}]`,
      body: `${who} ${what}`,
      data: { type, groupId: row.group_id },
    }));

  // The one notification that goes to the subject rather than about them.
  // They're already out of activeMembers by now, so it has to be added rather
  // than left to the loop above.
  if (removed) {
    pushes.push({
      userId: row.person_id,
      title: `[${groupName}]`,
      body: 'you were removed from the group!',
      data: { type: 'removed', groupId: row.group_id },
    });
  }

  return pushes;
}

async function send(pushes: Push[]) {
  const userIds = [...new Set(pushes.map(p => p.userId))];
  const { data: tokenRows } = await supabase
    .from('push_tokens')
    .select('token, user_id')
    .in('user_id', userIds);
  if (!tokenRows?.length) return;

  const tokensByUser = new Map<string, string[]>();
  for (const row of tokenRows) {
    tokensByUser.set(row.user_id, [...(tokensByUser.get(row.user_id) ?? []), row.token]);
  }

  // App logo only, both platforms — no images attached. channelId matches the
  // 'default' channel the app creates on Android at registration time.
  const messages = pushes.flatMap(p =>
    (tokensByUser.get(p.userId) ?? []).map(token => ({
      to: token,
      title: p.title,
      body: p.body,
      data: p.data,
      sound: 'default',
      channelId: 'default',
    })),
  );

  // Expo accepts at most 100 messages per request.
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(chunk),
    });
    const tickets = (await res.json())?.data;
    if (!Array.isArray(tickets)) continue;
    // A device that uninstalled the app answers every send with this error;
    // its token is dropped the first time Expo reports it dead.
    const dead = chunk
      .filter((_, j) => tickets[j]?.details?.error === 'DeviceNotRegistered')
      .map(m => m.to);
    if (dead.length) await supabase.from('push_tokens').delete().in('token', dead);
  }
}

Deno.serve(async req => {
  if (req.headers.get('x-webhook-secret') !== Deno.env.get('WEBHOOK_SECRET')) {
    return new Response('forbidden', { status: 403 });
  }

  let payload: WebhookPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response('bad payload', { status: 400 });
  }

  const pushes =
    payload.table === 'messages'
      ? await forMessage(payload)
      : payload.table === 'group_suggestions'
        ? await forSuggestion(payload)
        : payload.table === 'memberships'
          ? await forMembership(payload)
          : payload.table === 'discussion_messages'
            ? await forDiscussion(payload)
            : [];
  if (pushes.length) await send(pushes);
  return new Response('ok');
});
