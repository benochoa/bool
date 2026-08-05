import { StyleSheet, View, Text, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { useState, useCallback, useEffect } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '@/supabaseClient';
import ChatThread from '@/components/chats/chatThread';
import SlideOver from '@/components/ui/slideOver';
import { FontFamily, Type } from '@/constants/theme';
import { fetchChatPreviews, ChatPreview } from '@/lib/fetchChatPreviews';
import { useCurrentGroup } from '@/hooks/use-current-group';

export default function ChatsScreen() {

  const { currentGroupId } = useCurrentGroup();
  const [previews, setPreviews] = useState<ChatPreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ChatPreview | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!currentGroupId) {
        setPreviews([]);
        setLoading(false);
        return;
      }
      fetchChatPreviews(currentGroupId).then(rows => {
        setPreviews(rows);
        setLoading(false);
      });
    }, [currentGroupId])
  );

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
          {previews.map(preview => (
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
                <Text style={styles.previewName} numberOfLines={1}>{preview.otherGroupName}</Text>
                <Text style={styles.previewMessage} numberOfLines={1}>
                  {preview.lastMessage ?? 'No messages yet'}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      <SlideOver visible={selected !== null} onRequestClose={() => setSelected(null)}>
        {selected && currentGroupId && (
          <ChatThread
            myGroupId={currentGroupId}
            otherGroupId={selected.otherGroupId}
            otherGroupName={selected.otherGroupName}
            onClose={() => setSelected(null)}
          />
        )}
      </SlideOver>
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
    paddingTop: 16,
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
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  // Taller than the two lines of text beside it, so the photo — not the text —
  // sets the row's height and fills most of it.
  previewPhoto: {
    width: 60,
    height: 60,
    borderRadius: 8,
    backgroundColor: '#eee',
  },
  previewPhotoPlaceholder: {
    width: 60,
    height: 60,
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
    ...Type.header,
    color: '#000',
    marginBottom: 4,
  },
  previewMessage: {
    ...Type.label,
    fontFamily: FontFamily.regular,
    color: '#777',
  },
});
