import { StyleSheet, View, Text, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/supabaseClient';
import { useSession } from '@/hooks/use-session';
import { canonicalPair } from '@/lib/canonicalPair';
import { fetchMessages, Message } from '@/lib/fetchMessages';
import { fetchPerson } from '@/lib/fetchPerson';
import { sendMessage } from '@/lib/sendMessage';

interface Props {
  myGroupId: string;
  otherGroupId: string;
  otherGroupName: string;
  onClose: () => void;
}

export default function ChatThread({ myGroupId, otherGroupId, otherGroupName, onClose }: Props) {

  const { session } = useSession();

  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  const scrollViewRef = useRef<ScrollView>(null);
  const senderNames = useRef(new Map<string, string>());

  useEffect(() => {
    fetchMessages(myGroupId, otherGroupId).then(msgs => {
      msgs.forEach(m => senderNames.current.set(m.senderId, m.senderName));
      setMessages(msgs);
      setLoading(false);
    });
  }, [myGroupId, otherGroupId]);

  // Live delivery while the thread is open. postgres_changes filters only
  // support a single column=eq.value condition, so the pair is filtered by
  // group_1_id server-side and group_2_id is double-checked client-side.
  useEffect(() => {
    const [g1, g2] = canonicalPair(myGroupId, otherGroupId);

    const channel = supabase
      .channel(`messages-${g1}-${g2}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `group_1_id=eq.${g1}` },
        async payload => {
          const row = payload.new;
          if (row.group_2_id !== g2) return;

          let senderName = senderNames.current.get(row.sender_id);
          if (!senderName) {
            const person = await fetchPerson(row.sender_id);
            senderName = person?.name ?? '...';
            senderNames.current.set(row.sender_id, senderName);
          }

          setMessages(prev => [...prev, {
            id: row.id,
            senderGroupId: row.sender_group_id,
            senderId: row.sender_id,
            senderName,
            body: row.body,
            createdAt: row.created_at,
          }]);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [myGroupId, otherGroupId]);

  useEffect(() => {
    scrollViewRef.current?.scrollToEnd({ animated: true });
  }, [messages.length]);

  async function handleSend() {
    const trimmed = body.trim();
    if (!trimmed || !session?.user) return;
    setSending(true);
    const ok = await sendMessage(myGroupId, otherGroupId, myGroupId, session.user.id, trimmed);
    setSending(false);
    if (!ok) {
      Alert.alert('Send failed', 'Please try again.');
      return;
    }
    setBody('');
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>

      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={onClose}>
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{otherGroupName}</Text>
      </View>

      {loading ? (
        <ActivityIndicator style={styles.loader} />
      ) : (
        <ScrollView
          ref={scrollViewRef}
          style={styles.messageList}
          contentContainerStyle={styles.messageListContent}
          keyboardShouldPersistTaps="handled"
        >
          {messages.length === 0 ? (
            <Text style={styles.emptyText}>No messages yet — say hi!</Text>
          ) : (
            messages.map(m => {
              const isMine = m.senderId === session?.user.id;
              return (
                <View key={m.id} style={[styles.bubbleRow, isMine && styles.bubbleRowMine]}>
                  <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleTheirs]}>
                    <Text style={isMine ? styles.senderNameMine : styles.senderName}>{isMine ? 'You' : m.senderName}</Text>
                    <Text style={[styles.bubbleText, isMine && styles.bubbleTextMine]}>{m.body}</Text>
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>
      )}

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder="Message..."
          placeholderTextColor="#aaa"
          value={body}
          onChangeText={setBody}
          multiline
        />
        <TouchableOpacity
          style={[styles.sendButton, (!body.trim() || sending) && styles.sendButtonDisabled]}
          onPress={handleSend}
          disabled={!body.trim() || sending}
        >
          <Text style={styles.sendButtonText}>{sending ? '...' : '↑'}</Text>
        </TouchableOpacity>
      </View>

    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({

  container: {
    flex: 1,
    backgroundColor: '#fff',
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 60,
    paddingBottom: 16,
    paddingHorizontal: 20,
  },

  backButton: {
    marginRight: 16,
  },

  backArrow: {
    fontSize: 28,
    color: '#000',
  },

  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#000',
  },

  loader: {
    flex: 1,
    alignSelf: 'center',
    marginTop: 100,
  },

  messageList: {
    flex: 1,
  },

  messageListContent: {
    paddingHorizontal: 20,
    paddingBottom: 16,
  },

  emptyText: {
    fontSize: 16,
    color: '#555',
    textAlign: 'center',
    marginTop: 60,
  },

  bubbleRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    marginBottom: 12,
  },

  bubbleRowMine: {
    justifyContent: 'flex-end',
  },

  bubble: {
    maxWidth: '75%',
    borderRadius: 16,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },

  bubbleTheirs: {
    backgroundColor: '#f0f0f0',
  },

  bubbleMine: {
    backgroundColor: '#000',
  },

  senderName: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#777',
    marginBottom: 2,
  },

  senderNameMine: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#ccc',
    marginBottom: 2,
  },

  bubbleText: {
    fontSize: 16,
    color: '#000',
  },

  bubbleTextMine: {
    color: '#fff',
  },

  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },

  input: {
    flex: 1,
    fontSize: 16,
    color: '#000',
    maxHeight: 100,
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: '#f5f5f5',
    borderRadius: 20,
    marginRight: 8,
  },

  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#43a047',
    alignItems: 'center',
    justifyContent: 'center',
  },

  sendButtonDisabled: {
    backgroundColor: '#ccc',
  },

  sendButtonText: {
    fontSize: 18,
    color: '#fff',
    fontWeight: 'bold',
  },

});
