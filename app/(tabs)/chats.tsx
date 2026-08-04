import { StyleSheet, View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Modal } from 'react-native';
import { Image } from 'expo-image';
import { useState, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import ChatThread from '@/components/chats/chatThread';
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

      <Modal
        visible={selected !== null}
        animationType="slide"
        onRequestClose={() => setSelected(null)}
      >
        {selected && currentGroupId && (
          <ChatThread
            myGroupId={currentGroupId}
            otherGroupId={selected.otherGroupId}
            otherGroupName={selected.otherGroupName}
            onClose={() => setSelected(null)}
          />
        )}
      </Modal>
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
