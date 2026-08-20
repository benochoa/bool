import { useRouter } from 'expo-router';
import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import NotificationBanner, { InAppNotification } from '@/components/notificationBanner';
import { useCurrentGroup } from '@/hooks/use-current-group';
import { useSession } from '@/hooks/use-session';
import { fetchGroup, GroupData } from '@/lib/fetchGroup';
import { fetchPerson } from '@/lib/fetchPerson';
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

interface InAppNotificationContextValue {
  // The chat being looked at right now (the other group's id), so its own
  // messages don't banner over the open thread. Null when none is.
  setOpenChat: (otherGroupId: string | null) => void;
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
  // My group's row backs every banner (its name leads the text; created_by is
  // the leader check). Kept as a promise so an event landing before the fetch
  // resolves still notifies instead of racing it.
  const myGroupRef = useRef<Promise<GroupData | null>>(Promise.resolve(null));

  const userId = session?.user.id;

  useEffect(() => {
    myGroupRef.current = currentGroupId ? fetchGroup(currentGroupId) : Promise.resolve(null);
    // Banners are framed by the acting-as group; switching it drops any that
    // haven't shown yet rather than presenting them under the wrong name.
    setQueue([]);
  }, [currentGroupId]);

  const setOpenChat = useCallback((otherGroupId: string | null) => {
    openChatRef.current = otherGroupId;
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

    // 5) a message in one of this group's chats. Blocked senders never reach
    // here — the messages select policy filters the realtime stream too.
    async function onMessage(row: MessageRow) {
      if (row.sender_id === userId) return;
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
    <InAppNotificationContext.Provider value={{ setOpenChat }}>
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
