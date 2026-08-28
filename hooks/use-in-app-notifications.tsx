import { useRouter } from 'expo-router';
import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import NotificationBanner, { InAppNotification } from '@/components/notificationBanner';
import { useBlockedPeople } from '@/hooks/use-blocked-people';
import { useCurrentGroup } from '@/hooks/use-current-group';
import { useSession } from '@/hooks/use-session';
import { fetchGroup, GroupData } from '@/lib/fetchGroup';
import { fetchPerson } from '@/lib/fetchPerson';
import { fetchReceivedGroupIds } from '@/lib/fetchReceivedGroupIds';
import { NotificationData, routeToNotification } from '@/lib/notificationRouting';
import { supabase } from '@/supabaseClient';

// In-app notification banners, scoped to the group you're acting as — events
// in your other groups show nothing here (push covers them once the app is
// backgrounded). Same four realtime streams the tab badges listen to, but
// these need the row itself, not just "something moved".

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

interface InAppNotificationContextValue {
  // The chat being looked at right now (the other group's id), so its own
  // messages don't banner over the open thread. Null when none is.
  setOpenChat: (otherGroupId: string | null) => void;
  // The same, for the discussion panel: the group being discussed, so its own
  // messages don't banner over the panel you are reading them in.
  setOpenDiscussion: (aboutGroupId: string | null) => void;
}

const InAppNotificationContext = createContext<InAppNotificationContextValue | null>(null);

export function InAppNotificationProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { session } = useSession();
  const { currentGroupId } = useCurrentGroup();
  // Head of the queue is the banner on screen; the cap keeps a burst from
  // holding the screen for half a minute (oldest waiting ones give way).
  const [queue, setQueue] = useState<InAppNotification[]>([]);
  const idRef = useRef(0);
  const openChatRef = useRef<string | null>(null);
  const openDiscussionRef = useRef<string | null>(null);
  // Read through a ref because the realtime handlers below close over it and
  // the channel outlives a block being made.
  const { blockedIds } = useBlockedPeople();
  const blockedRef = useRef(blockedIds);
  blockedRef.current = blockedIds;
  // My group's row backs every banner (its name leads the text; created_by is
  // the leader check). Kept as a promise so an event landing before the fetch
  // resolves still notifies instead of racing it.
  const myGroupRef = useRef<Promise<GroupData | null>>(Promise.resolve(null));

  const userId = session?.user.id;

  useEffect(() => {
    myGroupRef.current = currentGroupId ? fetchGroup(currentGroupId) : Promise.resolve(null);
    // Banners are framed by the acting-as group; switching it drops any that
    // haven't shown yet rather than presenting them under the wrong name.
    // Being removed is the exception, and has to be: losing that group is what
    // moved you off it, so clearing the queue here would delete the one banner
    // explaining why the app just switched under you.
    setQueue(q => q.filter(n => n.data.type === 'removed'));
  }, [currentGroupId]);

  const setOpenChat = useCallback((otherGroupId: string | null) => {
    openChatRef.current = otherGroupId;
  }, []);

  const setOpenDiscussion = useCallback((aboutGroupId: string | null) => {
    openDiscussionRef.current = aboutGroupId;
  }, []);

  const show = useCallback((n: Omit<InAppNotification, 'id'>) => {
    setQueue(q => {
      const next = [...q, { ...n, id: ++idRef.current }];
      return next.length > 4 ? [next[0], ...next.slice(-3)] : next;
    });
  }, []);

  useEffect(() => {
    if (!currentGroupId || !userId) return;

    // 1) someone in my group swiped on another group.
    async function onSuggestionInsert(row: SuggestionRow) {
      if (row.suggested_by === userId || row.status !== 'pending') return;
      const [me, person] = await Promise.all([myGroupRef.current, fetchPerson(row.suggested_by)]);
      if (!me) return;
      show({
        pfpUrl: person?.profilePicUrl ?? null,
        line1: `[${me.name}] ${person?.name || 'Someone'} made a suggestion!`,
        line2: null,
        data: { type: 'suggestion', groupId: row.suggesting_group_id },
      });
    }

    // 2) / 3) movement on a suggestion my group made: the leader sent it, or
    // the other side approved it into a match.
    async function onOutgoingUpdate(row: SuggestionRow) {
      const me = await myGroupRef.current;
      if (!me) return;
      if (row.status === 'sent') {
        // The leader is the one who did this, so they don't hear about it.
        if (!me.created_by || me.created_by === userId) return;
        const leader = await fetchPerson(me.created_by);
        show({
          pfpUrl: leader?.profilePicUrl ?? null,
          line1: `[${me.name}] ${leader?.name || 'Your leader'} approved a group!`,
          line2: null,
          data: { type: 'sent', groupId: row.suggesting_group_id },
        });
      } else if (row.status === 'matched') {
        const other = await fetchGroup(row.target_group_id);
        show({
          pfpUrl: other?.imageUrls[0] ?? null,
          line1: `[${me.name}] there's a match!`,
          line2: null,
          data: { type: 'match', groupId: row.suggesting_group_id, otherGroupId: row.target_group_id },
        });
      }
    }

    // 4) / 3) movement on a suggestion aimed at my group: a request arrived,
    // or my leader approved one into a match.
    async function onIncomingUpdate(row: SuggestionRow) {
      const me = await myGroupRef.current;
      if (!me) return;
      if (row.status === 'sent') {
        const other = await fetchGroup(row.suggesting_group_id);
        show({
          pfpUrl: other?.imageUrls[0] ?? null,
          line1: `[${me.name}] you've received a request!`,
          line2: null,
          data: { type: 'received', groupId: row.target_group_id },
        });
      } else if (row.status === 'matched') {
        // Approving is the leader's own tap — no banner for them.
        if (me.created_by === userId) return;
        const other = await fetchGroup(row.suggesting_group_id);
        show({
          pfpUrl: other?.imageUrls[0] ?? null,
          line1: `[${me.name}] there's a match!`,
          line2: null,
          data: { type: 'match', groupId: row.target_group_id, otherGroupId: row.suggesting_group_id },
        });
      }
    }

    // 5) a message in one of this group's chats. Someone I blocked still
    // reaches here — the select policy only withholds messages from people who
    // blocked *me*, so that their thread shows a tombstone rather than a gap.
    // A banner would undo that by putting the content on screen anyway.
    async function onMessage(row: MessageRow) {
      if (row.sender_id === userId || blockedRef.current.has(row.sender_id)) return;
      const otherGroupId = row.group_1_id === currentGroupId ? row.group_2_id : row.group_1_id;
      if (openChatRef.current === otherGroupId) return;
      const [me, sender] = await Promise.all([myGroupRef.current, fetchPerson(row.sender_id)]);
      if (!me) return;
      show({
        pfpUrl: sender?.profilePicUrl ?? null,
        line1: `[${me.name}] ${sender?.name || 'Someone'}`,
        line2: row.body,
        data: { type: 'message', groupId: currentGroupId!, otherGroupId },
      });
    }

    // 9) a message in one of this group's private discussions. Framed by my own
    // group, exactly as the push is: the candidate being discussed is not named,
    // because the banner is about my group's own conversation. Blocked senders
    // are dropped here for the same reason they are for chat — the thread shows
    // them a tombstone, and a banner would put the content on screen anyway.
    async function onDiscussion(row: DiscussionRow) {
      if (row.sender_id === userId || blockedRef.current.has(row.sender_id)) return;
      // Already reading that discussion — the message is arriving in front of
      // them, so bannering it over the top would only cover it up.
      if (openDiscussionRef.current === row.about_group_id) return;
      const [me, sender, receivedIds] = await Promise.all([
        myGroupRef.current,
        fetchPerson(row.sender_id),
        // Which tab the candidate's tile is on, so tapping the banner opens the
        // discussion rather than merely landing on the wrong list. One query per
        // banner, not per render, and the push works it out the same way.
        fetchReceivedGroupIds(row.group_id),
      ]);
      if (!me) return;
      show({
        pfpUrl: sender?.profilePicUrl ?? null,
        line1: `[${me.name}] ${sender?.name || 'Someone'}`,
        line2: row.body,
        data: {
          type: 'discussion',
          groupId: row.group_id,
          otherGroupId: row.about_group_id,
          surface: receivedIds.includes(row.about_group_id) ? 'received' : 'pending',
        },
      });
    }

    // 6) / 7) / 8) the roster changed. Joining is an insert, or an update back
    // to active for someone rejoining a group they'd left — the invite code
    // path upserts, so a rejoin never inserts. A dissolution
    // ('group_dissolved') stays silent: it would announce every member at once
    // to a group that no longer exists.
    async function onMembership(row: MembershipRow, old: MembershipRow | null) {
      const joined = row.status === 'active' && old?.status !== 'active';
      const left = row.status === 'left' && old?.status === 'active';
      const removed = row.status === 'kicked' && old?.status === 'active';
      if (!joined && !left && !removed) return;

      // Being removed is the one case the subject hears about, in the second
      // person. The group is still readable to them — the membership row stays
      // behind as 'kicked' — so its name and photo are still in reach.
      if (row.person_id === userId) {
        if (!removed) return;
        const myGroup = await myGroupRef.current;
        if (!myGroup) return;
        show({
          pfpUrl: myGroup.imageUrls[0] ?? null,
          line1: `[${myGroup.name}] you were removed from the group!`,
          line2: null,
          data: { type: 'removed', groupId: row.group_id },
        });
        return;
      }

      const me = await myGroupRef.current;
      if (!me) return;
      // A kick is the leader's doing, so the leader is the one who hears
      // nothing; a join or a leave belongs to the person themselves.
      const actorId = removed ? me.created_by : row.person_id;
      if (actorId === userId) return;

      const person = await fetchPerson(row.person_id);
      const what = joined ? 'joined the group!' : removed ? 'was removed from the group!' : 'left the group!';
      show({
        pfpUrl: person?.profilePicUrl ?? null,
        line1: `[${me.name}] ${person?.name || 'Someone'} ${what}`,
        line2: null,
        data: { type: joined ? 'joined' : removed ? 'removed' : 'left', groupId: row.group_id },
      });
    }

    const channel = supabase
      .channel(`notifications-${currentGroupId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'group_suggestions', filter: `suggesting_group_id=eq.${currentGroupId}` },
        payload => { onSuggestionInsert(payload.new as SuggestionRow); }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'group_suggestions', filter: `suggesting_group_id=eq.${currentGroupId}` },
        payload => { onOutgoingUpdate(payload.new as SuggestionRow); }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'group_suggestions', filter: `target_group_id=eq.${currentGroupId}` },
        payload => { onIncomingUpdate(payload.new as SuggestionRow); }
      )
      // Which side of the pair you are depends on canonicalPair's ordering, and
      // a filter takes one condition, so both halves need a listener.
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `group_1_id=eq.${currentGroupId}` },
        payload => { onMessage(payload.new as MessageRow); }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `group_2_id=eq.${currentGroupId}` },
        payload => { onMessage(payload.new as MessageRow); }
      )
      // A fresh join inserts; a rejoin updates a row that was 'left' back to
      // 'active', so both events matter.
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'memberships', filter: `group_id=eq.${currentGroupId}` },
        payload => { onMembership(payload.new as MembershipRow, null); }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'memberships', filter: `group_id=eq.${currentGroupId}` },
        payload => { onMembership(payload.new as MembershipRow, payload.old as MembershipRow); }
      )
      // One condition is enough here, unlike chat: a discussion has a single
      // owning group rather than an unordered pair.
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'discussion_messages', filter: `group_id=eq.${currentGroupId}` },
        payload => { onDiscussion(payload.new as DiscussionRow); }
      )
      .subscribe(status => console.log('[realtime] notifications channel:', status));

    return () => { supabase.removeChannel(channel); };
  }, [currentGroupId, userId, show]);

  const current = queue[0] ?? null;
  const dismiss = useCallback(() => setQueue(q => q.slice(1)), []);
  const handlePress = useCallback(
    (data: NotificationData) => {
      dismiss();
      routeToNotification(router, data);
    },
    [dismiss, router]
  );

  return (
    <InAppNotificationContext.Provider value={{ setOpenChat, setOpenDiscussion }}>
      {children}
      {current && (
        <NotificationBanner
          key={current.id}
          notification={current}
          onDismiss={dismiss}
          onPress={() => handlePress(current.data)}
        />
      )}
    </InAppNotificationContext.Provider>
  );
}

export function useInAppNotifications() {
  const ctx = useContext(InAppNotificationContext);
  if (!ctx) throw new Error('useInAppNotifications must be used within InAppNotificationProvider');
  return ctx;
}
