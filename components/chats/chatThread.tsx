import { StyleSheet, View, Text, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Alert } from 'react-native';
import { useEffect, useRef, useState } from 'react';
import { Image } from 'expo-image';
import { supabase } from '@/supabaseClient';
import { ChevronLeft } from '@/assets/symbols/ChevronLeft';
import { ChevronRight } from '@/assets/symbols/ChevronRight';
import IndividualPost from '@/components/posts/individualPost';
import { ZoomRoot } from '@/components/posts/zoomOverlay';
import ChatDetails from './chatDetails';
import { FontFamily, Type } from '@/constants/theme';
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
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [openPersonId, setOpenPersonId] = useState<string | null>(null);

  const scrollViewRef = useRef<ScrollView>(null);
  // Sender details already seen, so a live message doesn't refetch the person
  // just to label and picture it.
  const senders = useRef(new Map<string, { name: string; profilePicUrl: string | null }>());

  useEffect(() => {
    fetchMessages(myGroupId, otherGroupId).then(msgs => {
      msgs.forEach(m => senders.current.set(m.senderId, { name: m.senderName, profilePicUrl: m.senderProfilePicUrl }));
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

          let sender = senders.current.get(row.sender_id);
          if (!sender) {
            const person = await fetchPerson(row.sender_id);
            sender = { name: person?.name ?? '...', profilePicUrl: person?.profilePicUrl ?? null };
            senders.current.set(row.sender_id, sender);
          }

          setMessages(prev => [...prev, {
            id: row.id,
            senderGroupId: row.sender_group_id,
            senderId: row.sender_id,
            senderName: sender.name,
            senderProfilePicUrl: sender.profilePicUrl,
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
          <ChevronLeft size={28} color="#000" />
        </TouchableOpacity>
        {/* Name and chevron are one target — both open who's in the chat. */}
        <TouchableOpacity style={styles.titleRow} onPress={() => setDetailsOpen(true)}>
          <Text style={styles.title} numberOfLines={1}>{otherGroupName}</Text>
          <ChevronRight />
        </TouchableOpacity>
      </View>

      <Modal visible={detailsOpen} animationType="slide" onRequestClose={() => setDetailsOpen(false)}>
        <ChatDetails
          myGroupId={myGroupId}
          otherGroupId={otherGroupId}
          onClose={() => setDetailsOpen(false)}
        />
      </Modal>

      {/* Sender's profile, opened from their picture beside a message. */}
      <Modal visible={openPersonId !== null} animationType="slide" onRequestClose={() => setOpenPersonId(null)}>
        <ZoomRoot>
          <View style={styles.container}>
            <TouchableOpacity style={styles.floatingBack} onPress={() => setOpenPersonId(null)}>
              <ChevronLeft size={28} color="#000" />
            </TouchableOpacity>
            {openPersonId && <IndividualPost personId={openPersonId} standalone />}
          </View>
        </ZoomRoot>
      </Modal>

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
                  {/* Theirs is labelled by picture and name; yours needs
                      neither — being on the right says who sent it. */}
                  {!isMine && (
                    <TouchableOpacity activeOpacity={0.7} onPress={() => setOpenPersonId(m.senderId)}>
                      {m.senderProfilePicUrl ? (
                        <Image source={{ uri: m.senderProfilePicUrl }} style={styles.senderPic} contentFit="cover" />
                      ) : (
                        <View style={styles.senderPic} />
                      )}
                    </TouchableOpacity>
                  )}
                  <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleTheirs]}>
                    {!isMine && <Text style={styles.senderName}>{m.senderName}</Text>}
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

  // Shrinks rather than pushing the chevron off the row on a long name.
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },

  title: {
    ...Type.header,
    color: '#000',
    flexShrink: 1,
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
    ...Type.body,
    color: '#555',
    textAlign: 'center',
    marginTop: 60,
  },

  bubbleRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    // Centred against the bubble, so the picture stays on its midline however
    // many lines the message runs to.
    alignItems: 'center',
    marginBottom: 12,
  },

  // The profile modal draws from the top, so its back button floats over it.
  floatingBack: {
    position: 'absolute',
    top: 60,
    left: 20,
    height: 44,
    justifyContent: 'center',
    zIndex: 2,
  },

  senderPic: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#ddd',
    marginRight: 8,
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
    ...Type.caption,
    fontFamily: FontFamily.semiBold,
    color: '#777',
    marginBottom: 2,
  },

  bubbleText: {
    ...Type.body,
    color: '#000',
  },

  bubbleTextMine: {
    color: '#fff',
  },

  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 20,
    paddingTop: 12,
    // Lifts the composer clear of the bottom edge — the padding sits below the
    // border, so the rule stays tight to the row rather than floating.
    paddingBottom: 44,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },

  input: {
    ...Type.body,
    flex: 1,
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
