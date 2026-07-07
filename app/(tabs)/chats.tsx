import { StyleSheet, View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Modal } from 'react-native';
import { useState, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import ChatThread from '@/components/chatThread';
import { fetchChatPreviews, ChatPreview } from '@/lib/fetchChatPreviews';
import { useActiveGroup } from '@/hooks/use-active-group';

export default function ChatsScreen() {

  const { activeGroupId } = useActiveGroup();
  const [previews, setPreviews] = useState<ChatPreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ChatPreview | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!activeGroupId) {
        setPreviews([]);
        setLoading(false);
        return;
      }
      fetchChatPreviews(activeGroupId).then(rows => {
        setPreviews(rows);
        setLoading(false);
      });
    }, [activeGroupId])
  );

  if (loading) {
    return <ActivityIndicator style={styles.loader} />;
  }

  if (previews.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>No matches yet.</Text>
      </View>
    );
  }

  return (
    <>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {previews.map(preview => (
          <TouchableOpacity
            key={preview.otherGroupId}
            style={styles.previewRow}
            onPress={() => setSelected(preview)}
          >
            <Text style={styles.previewName}>{preview.otherGroupName}</Text>
            <Text style={styles.previewMessage} numberOfLines={1}>
              {preview.lastMessage ?? 'No messages yet'}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <Modal
        visible={selected !== null}
        animationType="slide"
        onRequestClose={() => setSelected(null)}
      >
        {selected && activeGroupId && (
          <ChatThread
            myGroupId={activeGroupId}
            otherGroupId={selected.otherGroupId}
            otherGroupName={selected.otherGroupName}
            onClose={() => setSelected(null)}
          />
        )}
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  loader: {
    flex: 1,
    alignSelf: 'center',
    marginTop: 100,
  },
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    paddingTop: 60,
    paddingBottom: 40,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  emptyText: {
    fontSize: 18,
    color: '#555',
  },
  previewRow: {
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  previewName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#000',
    marginBottom: 4,
  },
  previewMessage: {
    fontSize: 15,
    color: '#777',
  },
});
