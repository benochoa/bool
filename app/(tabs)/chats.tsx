import { StyleSheet, View, Text, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { useState, useCallback, useEffect } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '@/supabaseClient';
import ChatThread from '@/components/chats/chatThread';
import ImageViewer, { ViewerImage } from '@/components/chats/imageViewer';
import SlideOver from '@/components/ui/slideOver';
import { FontFamily, Type } from '@/constants/theme';
import { fetchChatPreviews, ChatPreview } from '@/lib/fetchChatPreviews';
import { fetchChatReads, chatReadKey } from '@/lib/fetchChatReads';
import { formatRelativeTime } from '@/lib/formatRelativeTime';
import { markChatRead } from '@/lib/markChatRead';
import { useAppResume } from '@/hooks/use-app-resume';
import { useCurrentGroup } from '@/hooks/use-current-group';
import { useSession } from '@/hooks/use-session';
import { useTabBadges } from '@/hooks/use-tab-badges';

export default function ChatsScreen() {

  const { currentGroupId } = useCurrentGroup();
  const { session } = useSession();
  const { refreshBadges } = useTabBadges();
  const [previews, setPreviews] = useState<ChatPreview[]>([]);
  // When this user last closed each chat, keyed by chatReadKey. A row whose
  // newest message is younger than its entry here — or that has no entry at
  // all — hasn't been seen yet.
  const [reads, setReads] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ChatPreview | null>(null);
  const [viewerImage, setViewerImage] = useState<ViewerImage | null>(null);

  const userId = session?.user.id;

  const refresh = useCallback(() => {
    if (!currentGroupId || !userId) {
      setPreviews([]);
      setLoading(false);
      return;
    }
    // Both together: a preview painted before its read timestamp lands would
    // show every chat bold for a frame.
    Promise.all([fetchChatPreviews(currentGroupId), fetchChatReads(userId)]).then(
      ([rows, nextReads]) => {
        setPreviews(rows);
        setReads(nextReads);
        setLoading(false);
      }
    );
  }, [currentGroupId, userId]);

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
      .subscribe(status => console.log('[realtime] chat previews channel:', status));

    return () => { supabase.removeChannel(channel); };
  }, [currentGroupId]);

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
        <ActivityIndicator style={styles.loader} />
      ) : previews.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>No matches yet.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
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
                  <Image source={{ uri: preview.imageUrl }} style={styles.previewPhoto} contentFit="cover" />
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
                    <Text style={[styles.previewMessage, unread && styles.unread]} numberOfLines={1}>
                      {preview.lastMessage ?? 'No messages yet'}
                    </Text>
                    {preview.lastMessageAt && (
                      <Text style={styles.previewAge} numberOfLines={1}>
                        {' · '}{formatRelativeTime(preview.lastMessageAt)}
                      </Text>
                    )}
                  </View>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

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
  loader: {
    flex: 1,
    alignSelf: 'center',
  },
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  // Page title — the same 44pt band at top: 60 the other tabs use.
  headerBand: {
    marginTop: 60,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    ...Type.title,
    color: '#000',
  },
  content: {
    paddingTop: 26,
    paddingBottom: 40,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  emptyText: {
    ...Type.header,
    fontFamily: FontFamily.regular,
    color: '#555',
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
  previewPhoto: {
    width: 52,
    height: 52,
    borderRadius: 8,
    backgroundColor: '#eee',
  },
  previewPhotoPlaceholder: {
    width: 52,
    height: 52,
    borderRadius: 8,
    backgroundColor: '#ddd',
  },
  // Name over message, both flush to the same left edge.
  previewText: {
    flex: 1,
    marginLeft: 14,
    alignItems: 'flex-start',
  },
  previewName: {
    ...Type.bodyBold,
    // Softer than black, but still clearly ahead of the #777 message and age
    // below it, so the name stays the row's first read.
    color: '#444',
    marginBottom: 3,
  },
  // Message beside its age. The row is what lets the message shrink around a
  // timestamp that keeps its full width.
  previewMessageRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    alignSelf: 'stretch',
  },
  previewMessage: {
    ...Type.label,
    fontFamily: FontFamily.regular,
    color: '#777',
    flexShrink: 1,
  },
  previewAge: {
    ...Type.label,
    fontFamily: FontFamily.regular,
    color: '#777',
    flexShrink: 0,
  },
  // Overlaid on the name and message of an unseen chat — only weight and
  // colour, so each keeps the size it has when read. The age is left out: it's
  // context, not part of what's new.
  unread: {
    fontFamily: FontFamily.bold,
    color: '#000',
  },

});
