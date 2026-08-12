import { StyleSheet, View, Text, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { useEffect, useRef, useState } from 'react';
import { Image } from 'expo-image';
import { supabase } from '@/supabaseClient';
import { Camera } from '@/assets/symbols/Camera';
import { ChevronLeft } from '@/assets/symbols/ChevronLeft';
import { ChevronRight } from '@/assets/symbols/ChevronRight';
import { Microphone } from '@/assets/symbols/Microphone';
import { PaperPlane } from '@/assets/symbols/PaperPlane';
import { PictureFrame } from '@/assets/symbols/PictureFrame';
import PersonPanel from '@/components/posts/personPanel';
import SlideOver from '@/components/ui/slideOver';
import ChatDetails from './chatDetails';
import { FontFamily, Palette, Type } from '@/constants/theme';
import { useSession } from '@/hooks/use-session';
import { canonicalPair } from '@/lib/canonicalPair';
import { fetchMessages, Message } from '@/lib/fetchMessages';
import { fetchPerson } from '@/lib/fetchPerson';
import { sendMessage } from '@/lib/sendMessage';
import { uploadChatAudio } from '@/lib/uploadChatAudio';
import { uploadChatPhoto } from '@/lib/uploadChatPhoto';
import VoiceMessage from '@/components/chats/voiceMessage';
import {
  AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState,
} from 'expo-audio';
import * as ImagePicker from 'expo-image-picker';

// The three composer icons are drawn at one size and one colour — they're a set,
// and the row only reads as one control if they match.
const MEDIA_ICON_SIZE = 26;
const MEDIA_ICON_COLOR = '#555';
// The mic and the pulse beside the timer, while a recording is running.
const RECORDING_COLOR = '#FF3B30';

// m:ss from the recorder's milliseconds.
function formatRecordingTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

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
  // A photo taken or picked but not sent yet — its presence is what puts the
  // confirm screen up.
  const [pending, setPending] = useState<{ uri: string; width: number; aspectRatio: number | null } | null>(null);
  const [sendingPhoto, setSendingPhoto] = useState(false);
  const [sendingVoice, setSendingVoice] = useState(false);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);
  // Whether the mic is still held down. A ref, not state: the async start path
  // reads it after awaiting, and a re-render is not what it's waiting for.
  const holding = useRef(false);

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
            kind: row.kind,
            mediaUrl: row.media_url,
            mediaAspectRatio: row.media_aspect_ratio,
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

  // Which half of the composer is showing.
  const typing = body.length > 0;

  // Both routes to a photo end in the same confirm screen, so they only differ
  // in which picker they open.
  async function handleTakePhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Camera access needed', 'Allow camera access to take a photo.');
      return;
    }
    stagePhoto(await ImagePicker.launchCameraAsync({ quality: 1 }));
  }

  async function handlePickPhoto() {
    stagePhoto(await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 }));
  }

  function stagePhoto(result: ImagePicker.ImagePickerResult) {
    if (result.canceled) return;
    const asset = result.assets[0];
    setPending({
      uri: asset.uri,
      width: asset.width,
      // Kept as the photo's real shape rather than snapped like the post cards:
      // a message isn't sharing a carousel with anything, so nothing needs it
      // to agree with a neighbour.
      aspectRatio: asset.width && asset.height ? asset.width / asset.height : null,
    });
  }

  async function handleSendPhoto() {
    if (!pending || !session?.user) return;
    setSendingPhoto(true);

    const url = await uploadChatPhoto(myGroupId, otherGroupId, pending.uri, pending.width);
    const ok = url && await sendMessage(
      myGroupId, otherGroupId, myGroupId, session.user.id,
      // The body every count and preview reads, since neither can show a photo.
      'Photo',
      { kind: 'image', url, aspectRatio: pending.aspectRatio }
    );

    setSendingPhoto(false);
    if (!ok) {
      Alert.alert('Send failed', 'Please try again.');
      return;
    }
    setPending(null);
  }

  // Hold the mic to record, release to send. The two handlers are a pair, and
  // the ref is what keeps them honest: permissions and prepare are async, so a
  // quick tap can release before recording has even started.
  async function handleRecordStart() {
    holding.current = true;

    const permission = await AudioModule.requestRecordingPermissionsAsync();
    if (!permission.granted) {
      holding.current = false;
      Alert.alert('Microphone access needed', 'Allow microphone access to send a voice message.');
      return;
    }

    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
    await recorder.prepareToRecordAsync();

    // Let go while that was running — start nothing.
    if (!holding.current) return;
    recorder.record();
  }

  async function handleRecordEnd() {
    const wasHolding = holding.current;
    holding.current = false;
    if (!wasHolding || !recorder.isRecording) return;

    const heldFor = recorderState.durationMillis;
    await recorder.stop();
    // Recording mode routes playback through the earpiece on iOS, so it goes
    // back off the moment the recording ends.
    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });

    const uri = recorder.uri;
    // Anything this short was a tap on the mic, not a message.
    if (!uri || heldFor < 1000 || !session?.user) return;

    setSendingVoice(true);
    const url = await uploadChatAudio(myGroupId, otherGroupId, uri);
    const ok = url && await sendMessage(
      myGroupId, otherGroupId, myGroupId, session.user.id,
      'Voice message',
      { kind: 'audio', url, aspectRatio: null }
    );
    setSendingVoice(false);

    if (!ok) Alert.alert('Send failed', 'Please try again.');
  }

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
                  <View style={[
                    styles.bubble,
                    isMine ? styles.bubbleMine : styles.bubbleTheirs,
                    m.kind === 'image' && styles.bubblePhoto,
                  ]}>
                    {!isMine && <Text style={styles.senderName}>{m.senderName}</Text>}
                    {m.kind === 'image' && m.mediaUrl ? (
                      <Image
                        source={{ uri: m.mediaUrl }}
                        style={[styles.messagePhoto, { aspectRatio: m.mediaAspectRatio ?? 1 }]}
                        contentFit="cover"
                      />
                    ) : m.kind === 'audio' && m.mediaUrl ? (
                      <VoiceMessage url={m.mediaUrl} mine={isMine} />
                    ) : (
                      <Text style={[styles.bubbleText, isMine && styles.bubbleTextMine]}>{m.body}</Text>
                    )}
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>
      )}

      {/* Composer. Empty, it offers the three ways to send something that isn't
          typed; from the first character on, those give way to the send button
          — the row never holds both. Keyed off the raw text rather than its
          trimmed form, so a leading space still counts as having started. */}
      <View style={styles.inputRow}>
        {!typing && !recorderState.isRecording && (
          <TouchableOpacity style={styles.mediaButton} onPress={handleTakePhoto}>
            <Camera size={MEDIA_ICON_SIZE} color={MEDIA_ICON_COLOR} />
          </TouchableOpacity>
        )}

        {recorderState.isRecording ? (
          // Takes the field's place while the mic is held, so the row keeps its
          // shape and the only thing that changes is what it's telling you.
          <View style={styles.recordingPill}>
            <View style={styles.recordingDot} />
            <Text style={styles.recordingTime}>
              {formatRecordingTime(recorderState.durationMillis)}
            </Text>
            <Text style={styles.recordingHint}>Release to send</Text>
          </View>
        ) : (
          <TextInput
            style={styles.input}
            placeholder="Message..."
            placeholderTextColor="#aaa"
            value={body}
            onChangeText={setBody}
            multiline
          />
        )}

        {typing ? (
          <TouchableOpacity
            style={[styles.sendButton, (!body.trim() || sending) && styles.sendButtonDisabled]}
            onPress={handleSend}
            disabled={!body.trim() || sending}
          >
            <PaperPlane size={22} color="#fff" />
          </TouchableOpacity>
        ) : (
          <>
            <TouchableOpacity
              style={styles.mediaButton}
              onPressIn={handleRecordStart}
              onPressOut={handleRecordEnd}
              disabled={sendingVoice}
            >
              {sendingVoice ? (
                <ActivityIndicator color={MEDIA_ICON_COLOR} />
              ) : (
                <Microphone
                  size={MEDIA_ICON_SIZE}
                  color={recorderState.isRecording ? RECORDING_COLOR : MEDIA_ICON_COLOR}
                />
              )}
            </TouchableOpacity>
            {!recorderState.isRecording && (
              <TouchableOpacity style={styles.mediaButton} onPress={handlePickPhoto}>
                <PictureFrame size={MEDIA_ICON_SIZE} color={MEDIA_ICON_COLOR} />
              </TouchableOpacity>
            )}
          </>
        )}
      </View>

      {/* Confirm screen for a photo that hasn't been sent yet. Over everything,
          on black, so the photo is all there is to look at — and the only ways
          out are Cancel and Send. */}
      {pending && (
        <View style={styles.confirmOverlay}>
          <Image source={{ uri: pending.uri }} style={styles.confirmPhoto} contentFit="contain" />
          <View style={styles.confirmRow}>
            <TouchableOpacity onPress={() => setPending(null)} disabled={sendingPhoto}>
              <Text style={styles.confirmCancel}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleSendPhoto} disabled={sendingPhoto}>
              {sendingPhoto ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.confirmSend}>Send</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Panels come last so they cover the thread rather than sliding in
          underneath it. */}
      <SlideOver visible={detailsOpen} onRequestClose={() => setDetailsOpen(false)}>
        <ChatDetails
          myGroupId={myGroupId}
          otherGroupId={otherGroupId}
          onClose={() => setDetailsOpen(false)}
        />
      </SlideOver>

      {/* Sender's profile, opened from their picture beside a message. */}
      <PersonPanel personId={openPersonId} onClose={() => setOpenPersonId(null)} />

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

  // A photo fills its bubble, so the bubble becomes a thin frame around it
  // rather than the padded box a line of text needs.
  bubblePhoto: {
    padding: 5,
  },

  messagePhoto: {
    width: 220,
    borderRadius: 12,
    backgroundColor: '#e5e5e5',
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
    gap: 6,
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
  },

  // Stands in for the text field while the mic is held: same height and radius,
  // so nothing in the row moves when it appears.
  recordingPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 38,
    paddingHorizontal: 14,
    backgroundColor: '#f5f5f5',
    borderRadius: 20,
  },

  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: RECORDING_COLOR,
  },

  recordingTime: {
    ...Type.body,
    color: '#000',
  },

  recordingHint: {
    ...Type.label,
    fontFamily: FontFamily.regular,
    color: '#888',
  },

  // Bare icon, no chrome — the send button is the only filled control in the
  // row, which is what marks it as the one that commits.
  mediaButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },

  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Palette.confirm,
    alignItems: 'center',
    justifyContent: 'center',
  },

  sendButtonDisabled: {
    backgroundColor: '#ccc',
  },

  // Photo confirm screen
  confirmOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
    zIndex: 5,
  },

  confirmPhoto: {
    flex: 1,
  },

  confirmRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingTop: 20,
    paddingBottom: 48,
  },

  confirmCancel: {
    ...Type.header,
    color: '#fff',
  },

  confirmSend: {
    ...Type.header,
    fontFamily: FontFamily.bold,
    color: '#fff',
  },

});
