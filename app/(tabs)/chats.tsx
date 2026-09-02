import { StyleSheet, View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { Pin } from '@/assets/symbols/Pin';
import { authedSource } from '@/lib/storageAuth';
import { Image } from 'expo-image';
import { useState, useCallback, useEffect } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase } from '@/supabaseClient';
import ChatThread from '@/components/chats/chatThread';
import GroupChatSheet from '@/components/chats/groupChatSheet';
import ImageViewer, { ViewerImage } from '@/components/chats/imageViewer';
import { ChatRowSkeleton, SkeletonList } from '@/components/ui/skeleton';
import SlideOver from '@/components/ui/slideOver';
import { FontFamily, Type } from '@/constants/theme';
import { fetchChatPreviews, ChatPreview } from '@/lib/fetchChatPreviews';
import { fetchChatReads, chatReadKey } from '@/lib/fetchChatReads';
import { fetchGroupChatPreview, GroupChatPreview } from '@/lib/fetchGroupChatPreview';
import { formatRelativeTime } from '@/lib/formatRelativeTime';
import { markChatRead } from '@/lib/markChatRead';
import { markDiscussionRead } from '@/lib/markDiscussionRead';
import { useAppResume } from '@/hooks/use-app-resume';
import { useCurrentGroup } from '@/hooks/use-current-group';
import { useInAppNotifications } from '@/hooks/use-in-app-notifications';
import { useSession } from '@/hooks/use-session';
import { useTabBadges } from '@/hooks/use-tab-badges';
import { HEADER_TOP } from '@/constants/layout';

export default function ChatsScreen() {

  const { currentGroupId, loadingGroups } = useCurrentGroup();
  const { session, loading: sessionLoading } = useSession();
  const { refreshBadges } = useTabBadges();
  const [previews, setPreviews] = useState<ChatPreview[]>([]);
  // Which group the previews were fetched for — a notification tap can switch
  // the acting-as group on its way here, and the pair it wants to open won't
  // be in the previous group's list.
  const [previewsFor, setPreviewsFor] = useState<string | null>(null);
  // When this user last closed each chat, keyed by chatReadKey. A row whose
  // newest message is younger than its entry here — or that has no entry at
  // all — hasn't been seen yet.
  const [reads, setReads] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ChatPreview | null>(null);
  const [viewerImage, setViewerImage] = useState<ViewerImage | null>(null);
  // Your own group's room, pinned above the matches. Its unread state comes
  // from the RPC rather than the `reads` map above: it is keyed in
  // discussion_reads, not chat_reads, so chatReadKey doesn't reach it.
  const [groupChat, setGroupChat] = useState<GroupChatPreview | null>(null);
  const [groupChatOpen, setGroupChatOpen] = useState(false);

  const userId = session?.user.id;

  const refresh = useCallback(() => {
    // Nothing is knowable until the session and the group list have landed —
    // and this runs on mount, before either has. Clearing `loading` here is
    // what put "No matches yet" on screen for the moment before the fetch
    // could even start; staying loading holds the skeleton instead.
    if (sessionLoading || loadingGroups) return;
    // Past that, no group really does mean no chats.
    if (!currentGroupId || !userId) {
      setPreviews([]);
      setGroupChat(null);
      setPreviewsFor(null);
      setLoading(false);
      return;
    }
    // All three together: a preview painted before its read timestamp lands
    // would show every chat bold for a frame, and the pinned row appearing a
    // beat after the list would shove the list down under your thumb.
    Promise.all([
      fetchChatPreviews(currentGroupId),
      fetchChatReads(userId),
      fetchGroupChatPreview(currentGroupId),
    ]).then(([rows, nextReads, ownRoom]) => {
      setPreviews(rows);
      setGroupChat(ownRoom);
      setPreviewsFor(currentGroupId);
      setReads(nextReads);
      setLoading(false);
    });
  }, [currentGroupId, userId, sessionLoading, loadingGroups]);

  useFocusEffect(refresh);

  // Resume runs the same fetch: a message that landed while the socket was down
  // is one the channel will never deliver, so without this the row stays
  // un-bold and out of order — the app quietly claiming nothing happened.
  useAppResume(refresh);

  // Live updates, so a preview's last message changes under you and a brand
  // new chat appears without leaving the tab. Two things move this list: a
  // message in any of your threads, and a match creating a thread that isn't
  // here yet. Each preview is a joined row (name, photo, newest message), so
  // an event re-runs the fetcher rather than patching a row.
  useEffect(() => {
    if (!currentGroupId) return;

    const refetch = () => { fetchChatPreviews(currentGroupId).then(setPreviews); };

    const channel = supabase
      .channel(`chat-previews-${currentGroupId}`)
      // Which side of the pair you are depends on canonicalPair's ordering,
      // and a filter takes one condition, so both halves need a listener.
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `group_1_id=eq.${currentGroupId}` },
        refetch
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `group_2_id=eq.${currentGroupId}` },
        refetch
      )
      // A new match is a chat that isn't in the list yet — and it can be one
      // you sent or one you received.
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'group_suggestions', filter: `target_group_id=eq.${currentGroupId}` },
        refetch
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'group_suggestions', filter: `suggesting_group_id=eq.${currentGroupId}` },
        refetch
      )
      // Your own room. A filter takes one condition, so this catches every
      // discussion your group owns and the payload check narrows it to the
      // self-referencing one — the rest belong to the candidate tiles.
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'discussion_messages', filter: `group_id=eq.${currentGroupId}` },
        payload => {
          if ((payload.new as any)?.about_group_id !== currentGroupId) return;
          fetchGroupChatPreview(currentGroupId).then(setGroupChat);
        }
      )
      .subscribe(status => console.log('[realtime] chat previews channel:', status));

    return () => { supabase.removeChannel(channel); };
  }, [currentGroupId]);

  // A notification tap: the chat to open rides in as a param, consumed only
  // once the list belongs to the acting-as group. If the pair isn't there
  // (stale tap), the param is still cleared and the list is where you land.
  const { openChat, openGroupChat } = useLocalSearchParams<{ openChat?: string; openGroupChat?: string }>();
  useEffect(() => {
    if (!openChat || previewsFor !== currentGroupId) return;
    const preview = previews.find(p => p.otherGroupId === openChat);
    if (preview) setSelected(preview);
    router.setParams({ openChat: undefined });
  }, [openChat, previews, previewsFor, currentGroupId]);

  // The same for your own group's room. There is no row to look up — the pinned
  // row is always there — so the wait is only for the name its header shows,
  // which lands with the preview.
  useEffect(() => {
    if (!openGroupChat || previewsFor !== currentGroupId) return;
    if (openGroupChat === currentGroupId) setGroupChatOpen(true);
    router.setParams({ openGroupChat: undefined });
  }, [openGroupChat, previewsFor, currentGroupId]);

  // While a thread is open its own messages shouldn't banner over it —
  // they're already on screen.
  const { setOpenChat } = useInAppNotifications();
  useEffect(() => {
    setOpenChat(selected?.otherGroupId ?? null);
    return () => setOpenChat(null);
  }, [selected, setOpenChat]);

  // Closing the thread is what marks it seen — every way out of it (chevron,
  // Android back, swipe) comes through here, and messages that arrived while
  // you had it open are ones you saw. The panel closes first; the write is
  // reflected locally so the row un-bolds without refetching the list, and
  // skipped on failure so a row never claims to be read when the table
  // disagrees.
  async function handleCloseThread() {
    const chat = selected;
    setSelected(null);
    if (!chat || !currentGroupId || !userId) return;

    const lastReadAt = await markChatRead(userId, currentGroupId, chat.otherGroupId);
    if (!lastReadAt) return;
    setReads(prev => new Map(prev).set(chatReadKey(currentGroupId, chat.otherGroupId), lastReadAt));
    // Writing to chat_reads emits nothing the tab bar's channel listens for, so
    // its unread count has to be told to catch up.
    refreshBadges();
  }

  // The sheet marks itself read on open, so by the time it closes the count in
  // hand is stale. Cleared locally rather than refetched: the row is on screen
  // behind the closing panel, and a round trip would leave it bold meanwhile.
  async function handleCloseGroupChat() {
    setGroupChatOpen(false);
    setGroupChat(prev => (prev ? { ...prev, unread: 0 } : prev));
    // Marked again on the way out, not only on the way in: a message that
    // arrived while you had it open is one you saw, and without this the row
    // re-bolds on the next refresh for a message still on your screen.
    if (userId && currentGroupId) {
      await markDiscussionRead(userId, currentGroupId, currentGroupId);
    }
    refreshBadges();
  }

  // Timestamps come from two places — Postgres for the message, the device for
  // the read — so they're parsed rather than compared as strings.
  function isUnread(preview: ChatPreview): boolean {
    if (!preview.lastMessageAt || !currentGroupId) return false;
    const lastRead = reads.get(chatReadKey(currentGroupId, preview.otherGroupId));
    if (!lastRead) return true;
    return new Date(preview.lastMessageAt).getTime() > new Date(lastRead).getTime();
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerBand}>
        <Text style={styles.headerTitle}>Chats</Text>
      </View>

      {loading ? (
        <View style={styles.content}>
          <SkeletonList count={4}>{i => <ChatRowSkeleton key={i} />}</SkeletonList>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>

          {/* Your own group's room, above everything. Shown even when empty:
              it is the only way in, so hiding it until someone has already
              posted would leave nobody able to post first. */}
          {groupChat && (
            <>
              <Text style={styles.sectionHeader}>YOUR GROUP</Text>
              <TouchableOpacity style={styles.previewRow} onPress={() => setGroupChatOpen(true)}>
                {groupChat.imageUrl ? (
                  <Image source={authedSource(groupChat.imageUrl)} style={styles.previewPhoto} contentFit="cover" />
                ) : (
                  <View style={styles.previewPhotoPlaceholder} />
                )}
                <View style={styles.previewText}>
                  {/* Name and pin on one line. The name shrinks and truncates;
                      the pin never does, so it stays put however long the group
                      name is — the same arrangement as the message and its age
                      on the line below. */}
                  <View style={styles.nameRow}>
                    <Text
                      style={[styles.previewName, styles.groupName, groupChat.unread > 0 && styles.unread]}
                      numberOfLines={1}
                    >
                      {groupChat.groupName}
                    </Text>
                    <Pin size={13} color="#888" />
                  </View>
                  <View style={styles.previewMessageRow}>
                    <Text style={[styles.previewMessage, groupChat.unread > 0 && styles.unread]} numberOfLines={1}>
                      {groupChat.senderName ? `${groupChat.senderName}: ` : ''}
                      {groupChat.lastMessage ?? 'No messages yet'}
                    </Text>
                    {groupChat.lastMessageAt && (
                      <Text style={styles.previewAge} numberOfLines={1}>
                        {'· '}{formatRelativeTime(groupChat.lastMessageAt)}
                      </Text>
                    )}
                  </View>
                </View>
              </TouchableOpacity>
            </>
          )}

          {/* The gap above this is what separates the two parts now that the
              rule between them is the same grey as every other row. */}
          <Text style={[styles.sectionHeader, styles.matchesHeader]}>MATCHES</Text>
          {previews.length === 0 && (
            // Inline rather than taking over the screen: the room above is still
            // here, so an empty match list is a section with nothing in it, not
            // an empty tab.
            <Text style={styles.emptyRow}>No matches yet.</Text>
          )}
          {previews.map(preview => {
            // Unread collapses the row's three shades into one bold black, so
            // the whole row reads as new rather than just its name.
            const unread = isUnread(preview);
            return (
              <TouchableOpacity
                key={preview.otherGroupId}
                style={styles.previewRow}
                onPress={() => setSelected(preview)}
              >
                {preview.imageUrl ? (
                  <Image source={authedSource(preview.imageUrl)} style={styles.previewPhoto} contentFit="cover" />
                ) : (
                  <View style={styles.previewPhotoPlaceholder} />
                )}
                <View style={styles.previewText}>
                  <Text style={[styles.previewName, unread && styles.unread]} numberOfLines={1}>
                    {preview.otherGroupName}
                  </Text>
                  {/* Message and age on one line. The message shrinks and
                      truncates; the age never does, so it stays readable however
                      long the message is. */}
                  <View style={styles.previewMessageRow}>
                    {/* Sender and message share one Text so they truncate as a
                        unit — split across two, a long name would push the
                        message out entirely rather than both giving way. */}
                    <Text style={[styles.previewMessage, unread && styles.unread]} numberOfLines={1}>
                      {preview.senderName ? `${preview.senderName}: ` : ''}
                      {preview.lastMessage ?? 'No messages yet'}
                    </Text>
                    {preview.lastMessageAt && (
                      <Text style={styles.previewAge} numberOfLines={1}>
                        {'· '}{formatRelativeTime(preview.lastMessageAt)}
                      </Text>
                    )}
                  </View>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      <GroupChatSheet
        groupId={groupChatOpen && currentGroupId ? currentGroupId : null}
        groupName={groupChat?.groupName ?? ''}
        onClose={handleCloseGroupChat}
        onOpenImage={setViewerImage}
      />

      <SlideOver visible={selected !== null} onRequestClose={handleCloseThread}>
        {selected && currentGroupId && (
          <ChatThread
            myGroupId={currentGroupId}
            otherGroupId={selected.otherGroupId}
            otherGroupName={selected.otherGroupName}
            onClose={handleCloseThread}
            onOpenImage={setViewerImage}
          />
        )}
      </SlideOver>

      {/* Outside the SlideOver, so it covers the thread rather than living
          inside the panel whose swipe its pan would fight. */}
      <ImageViewer image={viewerImage} onClose={() => setViewerImage(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  // Page title — the same 44pt band at top: 60 the other tabs use.
  headerBand: {
    marginTop: HEADER_TOP,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    ...Type.title,
    color: '#000',
  },
  content: {
    // Smaller than the 26 it was: the first section header now supplies most
    // of the gap under the title band.
    paddingTop: 8,
    paddingBottom: 40,
  },
  // The group name beside its pin. Sized to the pair rather than stretched, so
  // the pin sits against the end of the name instead of out at the row's right
  // edge; the name still gives way first when it's too long to fit.
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '100%',
  },
  // Only inside nameRow: shrinking is what keeps a long group name from pushing
  // the pin off the end. Kept off previewName itself, which the match rows use
  // as a direct child of a column — flexShrink there would apply to height.
  groupName: {
    flexShrink: 1,
  },
  // What labels each part. Small, spaced caps in grey — quiet enough that the
  // rows stay the thing you read, explicit enough that the pinned row at top
  // isn't mistaken for a match.
  sectionHeader: {
    fontFamily: FontFamily.bold,
    fontSize: 12,
    letterSpacing: 1,
    color: '#999',
    paddingHorizontal: 20,
    // Generous above, tight below: the header belongs to the rows under it.
    marginTop: 22,
    marginBottom: 8,
  },
  // The second header carries the separation on its own. With the rule under
  // your group back to the same grey as every other row, whitespace is the only
  // thing left telling you the list has changed subject — so it needs to be
  // wide enough that it can't be read as the gap between two rows.
  matchesHeader: {
    marginTop: 48,
  },
  // The MATCHES section standing empty. Indented to the same left edge as a
  // row's text, so it reads as the section's contents rather than a caption.
  emptyRow: {
    ...Type.body,
    color: '#777',
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  // Taller than the two lines of text beside it, so the photo — not the text —
  // sets the row's height and fills most of it.
  // Circular: half of the 52 above. The placeholder below has to match, or an
  // image that hasn't loaded yet pops from square to round as it arrives.
  previewPhoto: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#eee',
  },
  previewPhotoPlaceholder: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#ddd',
  },
  // Name over message, both flush to the same left edge.
  previewText: {
    flex: 1,
    marginLeft: 14,
    alignItems: 'flex-start',
  },
  previewName: {
    // 16, matched by the message below so both lines share a size and only
    // weight and colour separate them.
    ...Type.bodyBold,
    // Softer than black, but still clearly ahead of the #777 message and age
    // below it, so the name stays the row's first read.
    color: '#444',
    // No gap: at this size the weight and colour separate the two lines well
    // enough, and closing it keeps the pair reading as one block.
    marginBottom: 0,
  },
  // Message beside its age. The row is what lets the message shrink around a
  // timestamp that keeps its full width.
  previewMessageRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    alignSelf: 'stretch',
  },
  // Type.body rather than Type.label: same 16 as the name above, so the two
  // lines share a size and only weight and colour separate them. It is already
  // the regular face, which is why neither needs a fontFamily of its own.
  previewMessage: {
    ...Type.body,
    color: '#777',
    flexShrink: 1,
  },
  previewAge: {
    ...Type.body,
    color: '#777',
    flexShrink: 0,
    // The gap lives here rather than in the ' · ' string, so it is one number
    // to change. A long message shrinks to make room for it instead of the two
    // running together.
    marginLeft: 20,
  },
  // Overlaid on the name and message of an unseen chat — only weight and
  // colour, so each keeps the size it has when read. The age is left out: it's
  // context, not part of what's new.
  unread: {
    fontFamily: FontFamily.bold,
    color: '#000',
  },

});
