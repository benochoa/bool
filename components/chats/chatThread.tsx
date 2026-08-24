import { StyleSheet, View, Text, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, Keyboard, LayoutAnimation, Dimensions, Platform, Alert } from 'react-native';
import { authedSource } from '@/lib/storageAuth';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image } from 'expo-image';
import { supabase } from '@/supabaseClient';
import { Camera } from '@/assets/symbols/Camera';
import { ChevronLeft } from '@/assets/symbols/ChevronLeft';
import { ChevronRight } from '@/assets/symbols/ChevronRight';
import { Microphone } from '@/assets/symbols/Microphone';
import { PaperPlane } from '@/assets/symbols/PaperPlane';
import { PictureFrame } from '@/assets/symbols/PictureFrame';
import { XMark } from '@/assets/symbols/XMark';
import MessageActions, { BubbleRect } from '@/components/chats/messageActions';
import { ViewerImage } from '@/components/chats/imageViewer';
import LiveWaveform from '@/components/chats/liveWaveform';
import ReactionRow from '@/components/chats/reactionRow';
import SwipeToReply from '@/components/chats/swipeToReply';
import VoiceMessage from '@/components/chats/voiceMessage';
import PersonPanel from '@/components/posts/personPanel';
import ReportSheet from '@/components/ui/reportSheet';
import { MessageSkeleton } from '@/components/ui/skeleton';
import SlideOver from '@/components/ui/slideOver';
import ChatDetails from './chatDetails';
import * as Clipboard from 'expo-clipboard';
import { FontFamily, Palette, Type } from '@/constants/theme';
import { useAppResume } from '@/hooks/use-app-resume';
import { useBlockedPeople } from '@/hooks/use-blocked-people';
import { useSession } from '@/hooks/use-session';
import { canonicalPair } from '@/lib/canonicalPair';
import { fetchMessageReactions, MessageReaction } from '@/lib/fetchMessageReactions';
import { fetchMessages, Message } from '@/lib/fetchMessages';
import { fetchPerson } from '@/lib/fetchPerson';
import { setMessageReaction } from '@/lib/setMessageReaction';
import { sendMessage } from '@/lib/sendMessage';
import { ReportTarget } from '@/lib/submitReport';
import { buildWaveform } from '@/lib/waveform';
import { uploadChatAudio } from '@/lib/uploadChatAudio';
import { uploadChatPhoto } from '@/lib/uploadChatPhoto';
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

// How long the composer takes to follow the keyboard, for the events that don't
// carry a duration of their own. Raise it for a slower settle — past the
// keyboard's own ~250ms the bar starts trailing it rather than moving with it.
const KEYBOARD_SETTLE_MS = 250;
// How often the loudness is read while recording. Fast enough that a one-second
// message still has ten bars' worth of shape to draw from.
const METER_INTERVAL_MS = 100;

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
  // Tapping a photo message. Raised to the screen rather than handled here: the
  // viewer pans a zoomed photo, and inside this thread's SlideOver that drag
  // would race the panel's own swipe-to-dismiss.
  onOpenImage: (image: ViewerImage) => void;
}

export default function ChatThread({ myGroupId, otherGroupId, otherGroupName, onClose, onOpenImage }: Props) {

  const { session } = useSession();

  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [openPersonId, setOpenPersonId] = useState<string | null>(null);
  // A photo taken or picked but not sent yet — its presence is what puts the
  // confirm screen up.
  const [pending, setPending] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [sendingPhoto, setSendingPhoto] = useState(false);
  const [sendingVoice, setSendingVoice] = useState(false);
  // The message whose actions are open, with where its bubble sat when pressed.
  const [actionTarget, setActionTarget] = useState<{ message: Message; rect: BubbleRect } | null>(null);
  const [reporting, setReporting] = useState<ReportTarget | null>(null);
  // One entry per drawn bubble, so a long-press can measure the right one.
  const bubbleRefs = useRef(new Map<number, View | null>());
  const [reactions, setReactions] = useState<MessageReaction[]>([]);
  // Anyone whose messages should read as a tombstone rather than as content.
  // The set covers both directions, but only one of them can reach here: the
  // select policy withholds messages from people who blocked *me*, so a sender
  // in this set is always someone I blocked — which is the case that gets a
  // placeholder. Theirs stay invisible to them, so nothing tells them why.
  const { blockedIds } = useBlockedPeople();
  const messageIds = useRef(new Set<number>());
  // The message being answered, once Reply is picked and until it's sent.
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  // Where each row sits in the scroll content, recorded on layout so tapping a
  // quote can jump back to the original.
  const messageOffsets = useRef(new Map<number, number>());

  // Metering is off in the preset and has to be asked for: it's what the
  // waveform under a sent voice note is built from, and it can only be
  // collected while recording — the finished .m4a can't be read back for it.
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const recorderState = useAudioRecorderState(recorder);
  // Whether the mic is still held down. A ref, not state: the async start path
  // reads it after awaiting, and a re-render is not what it's waiting for.
  const holding = useRef(false);
  // Loudness readings taken while the mic is held, and the timer taking them.
  // Both refs: this samples five times faster than recorderState polls, and
  // putting it in state would re-render the whole thread — every message in it
  // — ten times a second for the length of the recording.
  const meterSamples = useRef<number[]>([]);
  const meterTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopMetering() {
    if (meterTimer.current === null) return;
    clearInterval(meterTimer.current);
    meterTimer.current = null;
  }

  // Nothing else clears the timer if the thread closes mid-recording.
  useEffect(() => stopMetering, []);

  const scrollViewRef = useRef<ScrollView>(null);
  // Sender details already seen, so a live message doesn't refetch the person
  // just to label and picture it.
  const senders = useRef(new Map<string, { name: string; profilePicUrl: string | null }>());

  const loadThread = useCallback(() => {
    fetchMessages(myGroupId, otherGroupId).then(msgs => {
      msgs.forEach(m => senders.current.set(m.senderId, { name: m.senderName, profilePicUrl: m.senderProfilePicUrl }));
      setMessages(msgs);
      setLoading(false);
    });
    fetchMessageReactions(myGroupId, otherGroupId).then(setReactions);
  }, [myGroupId, otherGroupId]);

  useEffect(() => {
    loadThread();
  }, [loadThread]);

  // How far the keyboard covers the screen, which is what lifts the composer.
  // KeyboardAvoidingView used to do this, but it never let go after a drag
  // dismissal — the gesture doesn't end in the frame event it waits for, so the
  // keyboard left and the composer stayed up at its height. Reading the frame
  // directly follows the drag instead, and keyboardDidHide is the backstop for
  // whatever the frame events did on the way out.
  const [keyboardInset, setKeyboardInset] = useState(0);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;

    // Every path animates, on the keyboard's own curve and its own duration
    // where it reports one. Missing this on any of them is what made the drop
    // read as a flash: one handler moved the bar over 250ms, another teleported
    // it the rest of the way.
    const settle = (duration?: number) => {
      LayoutAnimation.configureNext({
        duration: duration || KEYBOARD_SETTLE_MS,
        update: { type: LayoutAnimation.Types.keyboard },
      });
    };

    const onFrame = Keyboard.addListener('keyboardWillChangeFrame', e => {
      settle(e.duration);
      setKeyboardInset(Math.max(Dimensions.get('window').height - e.endCoordinates.screenY, 0));
    });
    // Fires before the drop rather than after it, so the bar leaves with the
    // keyboard instead of catching up once it's gone.
    const onWillHide = Keyboard.addListener('keyboardWillHide', e => {
      settle(e.duration);
      setKeyboardInset(0);
    });
    // Backstop only — by now the two above have normally settled it already.
    const onHide = Keyboard.addListener('keyboardDidHide', () => {
      settle();
      setKeyboardInset(0);
    });

    return () => { onFrame.remove(); onWillHide.remove(); onHide.remove(); };
  }, []);

  // The thread is the one screen with no focus refetch to fall back on — it
  // isn't a tab, and it stays mounted while the phone is locked. So messages
  // sent during a background arrive nowhere: the channel can't replay them and
  // nothing else refetches, leaving a hole mid-conversation that only closing
  // and reopening the thread would fill. Reloading on resume closes it.
  useAppResume(loadThread);

  // Reactions, keyed by the message they're on — the map is rebuilt rather than
  // mutated so a reaction landing re-renders the message it belongs to.
  const reactionsByMessage = useMemo(() => {
    const map = new Map<number, MessageReaction[]>();
    for (const r of reactions) {
      const list = map.get(r.messageId);
      if (list) list.push(r);
      else map.set(r.messageId, [r]);
    }
    return map;
  }, [reactions]);

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
            waveform: row.media_waveform,
            deletedAt: row.deleted_at,
            replyToId: row.reply_to_id,
            createdAt: row.created_at,
          }]);
        }
      )
      // Rows are edited, not removed, when a message is deleted — so the other
      // side learns about it through an update rather than a delete.
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter: `group_1_id=eq.${g1}` },
        payload => {
          const row = payload.new;
          if (row.group_2_id !== g2) return;
          setMessages(prev => prev.map(m => m.id === row.id ? {
            ...m,
            body: row.body,
            mediaUrl: row.media_url,
            mediaAspectRatio: row.media_aspect_ratio,
            deletedAt: row.deleted_at,
          } : m));
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [myGroupId, otherGroupId]);

  // Reactions live on their own channel, and unfiltered: a postgres_changes
  // filter takes one column=value condition, and nothing on message_reactions
  // identifies the chat — that's on the message it points at. So every event
  // arrives and the ones for messages this thread isn't showing are dropped
  // here. An event refetches rather than patching, since a delete's payload
  // carries only the key.
  useEffect(() => {
    const [g1, g2] = canonicalPair(myGroupId, otherGroupId);

    const channel = supabase
      .channel(`reactions-${g1}-${g2}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'message_reactions' },
        payload => {
          const messageId = (payload.new as any)?.message_id ?? (payload.old as any)?.message_id;
          if (!messageIds.current.has(messageId)) return;
          fetchMessageReactions(myGroupId, otherGroupId).then(setReactions);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [myGroupId, otherGroupId]);

  // Which messages are on screen, for the reaction channel to filter against.
  // A ref, so the subscription doesn't have to be torn down and rebuilt every
  // time a message arrives.
  useEffect(() => {
    messageIds.current = new Set(messages.map(m => m.id));
  }, [messages]);

  useEffect(() => {
    scrollViewRef.current?.scrollToEnd({ animated: true });
  }, [messages.length]);

  // Which half of the composer is showing.
  const typing = body.length > 0;

  // The camera sends straight away — iOS already ends the capture with Retake
  // or Use Photo, so a confirm screen after it asked the same question twice.
  // The library returns the moment a thumbnail is tapped, with nothing to back
  // out of, so it keeps the confirm screen as its only chance to change tack.
  async function handleTakePhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Camera access needed', 'Allow camera access to take a photo.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 1 });
    if (!result.canceled) sendPhoto(result.assets[0]);
  }

  async function handlePickPhoto() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (!result.canceled) setPending(result.assets[0]);
  }

  async function sendPhoto(asset: ImagePicker.ImagePickerAsset) {
    if (!session?.user) return;
    setSendingPhoto(true);

    const url = await uploadChatPhoto(myGroupId, otherGroupId, asset.uri, asset.width);
    const ok = url && await sendMessage(
      myGroupId, otherGroupId, myGroupId, session.user.id,
      // The body every count and preview reads, since neither can show a photo.
      'Photo',
      {
        media: {
          kind: 'image',
          url,
          // Kept as the photo's real shape rather than snapped like the post
          // cards: a message isn't sharing a carousel with anything, so nothing
          // needs it to agree with a neighbour.
          aspectRatio: asset.width && asset.height ? asset.width / asset.height : null,
        },
        replyToId: replyTo?.id ?? null,
      }
    );

    setSendingPhoto(false);
    if (!ok) {
      Alert.alert('Send failed', 'Please try again.');
      return;
    }
    setPending(null);
    setReplyTo(null);
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

    // iOS can refuse the audio session outright — something else holding the
    // mic (a call, a screen recording), or playback still running. Unguarded
    // that surfaces as an unhandled rejection and the mic just does nothing,
    // which reads as the button being broken.
    try {
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      await recorder.prepareToRecordAsync();
    } catch {
      holding.current = false;
      stopMetering();
      // Put the session back, or playback stays routed to the earpiece.
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).catch(() => {});
      Alert.alert(
        'Can’t record',
        'The microphone is unavailable right now. Close anything else using it — a call or a screen recording — and try again.'
      );
      return;
    }

    // Let go while that was running — start nothing.
    if (!holding.current) return;
    recorder.record();

    // getStatus() is synchronous, so this reads the live level without going
    // through the hook that would re-render on every reading.
    meterSamples.current = [];
    stopMetering();
    meterTimer.current = setInterval(() => {
      const status = recorder.getStatus();
      if (!status.isRecording) return;
      // Optional in RecorderState, and absent on the first tick or two while
      // the mic spins up.
      if (typeof status.metering === 'number') meterSamples.current.push(status.metering);
    }, METER_INTERVAL_MS);
  }

  async function handleRecordEnd() {
    const wasHolding = holding.current;
    holding.current = false;
    // Before the early return: a start that never became a recording still left
    // a timer running.
    stopMetering();
    if (!wasHolding || !recorder.isRecording) return;

    const heldFor = recorderState.durationMillis;
    await recorder.stop();
    // Recording mode routes playback through the earpiece on iOS, so it goes
    // back off the moment the recording ends.
    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });

    const uri = recorder.uri;
    // Anything this short was a tap on the mic, not a message.
    if (!uri || heldFor < 1000 || !session?.user) return;

    const waveform = buildWaveform(meterSamples.current);

    setSendingVoice(true);
    const url = await uploadChatAudio(myGroupId, otherGroupId, uri);
    const ok = url && await sendMessage(
      myGroupId, otherGroupId, myGroupId, session.user.id,
      'Voice message',
      {
        // Empty when metering gave nothing back, which the player reads the
        // same as an old recording: a plain bar rather than an empty row.
        media: { kind: 'audio', url, aspectRatio: null, waveform: waveform.length ? waveform : null },
        replyToId: replyTo?.id ?? null,
      }
    );
    setSendingVoice(false);

    if (!ok) Alert.alert('Send failed', 'Please try again.');
    else setReplyTo(null);
  }

  // One line standing in for a message wherever it's being referred to rather
  // than shown: in the quote inside a reply, and in the composer's reply bar.
  function messageSnippet(m: Message): string {
    if (blockedIds.has(m.senderId)) return 'Message from blocked user';
    if (m.deletedAt) return 'Deleted message';
    if (m.kind === 'image') return 'Photo';
    if (m.kind === 'audio') return 'Voice message';
    return m.body;
  }

  // Puts the original back on screen when its quote is tapped. Rows record
  // where they land as they lay out, so this is a lookup rather than a measure.
  function scrollToMessage(id: number) {
    const y = messageOffsets.current.get(id);
    if (y === undefined) return;
    scrollViewRef.current?.scrollTo({ y: Math.max(0, y - 80), animated: true });
  }

  // What goes inside a bubble. Shared with the long-press overlay, which draws
  // the pressed message again on top of the blur — the copy has to be the same
  // bubble, not an approximation of it.
  function messageBubbleContent(m: Message, isMine: boolean) {
    // Before every other case, including deletion: the bubble marks that they
    // said something without saying what, and without their name or photo.
    if (blockedIds.has(m.senderId)) {
      return <Text style={styles.deletedText}>Message from blocked user</Text>;
    }
    if (m.deletedAt) {
      return (
        <Text style={[styles.deletedText, isMine && styles.deletedTextMine]}>
          {isMine ? 'You' : m.senderName} deleted this message
        </Text>
      );
    }
    const quoted = m.replyToId != null
      ? messages.find(other => other.id === m.replyToId)
      : undefined;

    return (
      <>
        {/* The message being answered, above the answer itself. Tapping it goes
            back to the original. A thread loads whole and a hard delete nulls
            reply_to_id, so a quote that can't be resolved is one the block
            filter withheld — said plainly, and with nothing to scroll to. */}
        {m.replyToId != null && (quoted ? (
          <TouchableOpacity
            style={[styles.quote, isMine ? styles.quoteMine : styles.quoteTheirs]}
            onPress={() => scrollToMessage(quoted.id)}
            activeOpacity={0.7}
          >
            <Text style={[styles.quoteName, isMine && styles.quoteTextMine]} numberOfLines={1}>
              {quoted.senderId === session?.user.id ? 'You' : quoted.senderName}
            </Text>
            <Text style={[styles.quoteBody, isMine && styles.quoteTextMine]} numberOfLines={1}>
              {messageSnippet(quoted)}
            </Text>
          </TouchableOpacity>
        ) : (
          <View style={[styles.quote, isMine ? styles.quoteMine : styles.quoteTheirs]}>
            <Text style={[styles.quoteBody, isMine && styles.quoteTextMine]} numberOfLines={1}>
              Message unavailable
            </Text>
          </View>
        ))}
        {!isMine && <Text style={styles.senderName}>{m.senderName}</Text>}
        {m.kind === 'image' && m.mediaUrl ? (
          <Image
            source={authedSource(m.mediaUrl)}
            style={[styles.messagePhoto, { aspectRatio: m.mediaAspectRatio ?? 1 }]}
            contentFit="cover"
          />
        ) : m.kind === 'audio' && m.mediaUrl ? (
          <VoiceMessage url={m.mediaUrl} mine={isMine} waveform={m.waveform} />
        ) : (
          <Text style={[styles.bubbleText, isMine && styles.bubbleTextMine]}>{m.body}</Text>
        )}
      </>
    );
  }

  // Long-press opens the actions over the bubble, which means knowing where on
  // screen that bubble is — hence the measure before anything is shown.
  // The photo grows out of where it sits in the thread, so opening it starts
  // with measuring that. The bubble is the photo for an image message, which is
  // why this can reuse the same refs the long-press menu measures.
  function openImage(message: Message) {
    if (!message.mediaUrl) return;
    const node = bubbleRefs.current.get(message.id);
    if (!node) return;
    const url = message.mediaUrl;
    node.measureInWindow((x, y, width, height) => {
      onOpenImage({
        url,
        rect: { x, y, width, height },
        aspectRatio: message.mediaAspectRatio,
      });
    });
  }

  function openActions(message: Message) {
    if (message.deletedAt) return;
    const node = bubbleRefs.current.get(message.id);
    if (!node) return;
    node.measureInWindow((x, y, width, height) => {
      setActionTarget({ message, rect: { x, y, width, height } });
    });
  }

  // Setting the emoji you already have takes it off — the bar and the pills
  // under a message both route through here, so they behave identically.
  async function toggleReaction(messageId: number, emoji: string) {
    if (!session?.user) return;
    const userId = session.user.id;
    const mine = reactionsByMessage.get(messageId)?.find(r => r.userId === userId);
    const next = mine?.emoji === emoji ? null : emoji;

    // Applied straight away: a tapback that waits on a round trip feels broken.
    setReactions(prev => {
      const others = prev.filter(r => !(r.messageId === messageId && r.userId === userId));
      return next ? [...others, { messageId, userId, emoji: next }] : others;
    });

    const ok = await setMessageReaction(messageId, userId, next);
    // Put the truth back if the write didn't land.
    if (!ok) fetchMessageReactions(myGroupId, otherGroupId).then(setReactions);
  }

  async function handleCopy() {
    if (!actionTarget) return;
    await Clipboard.setStringAsync(actionTarget.message.body);
    setActionTarget(null);
  }

  async function handleDelete() {
    if (!actionTarget) return;
    const id = actionTarget.message.id;
    setActionTarget(null);

    // The row survives; its contents don't. Blanking body matters beyond this
    // screen — the Chats preview reads it straight out, so leaving the text
    // there would keep showing a message its sender had deleted.
    const deletedAt = new Date().toISOString();
    const { error } = await supabase
      .from('messages')
      .update({ deleted_at: deletedAt, body: 'Deleted message', media_url: null, media_aspect_ratio: null })
      .eq('id', id);
    if (error) {
      Alert.alert('Delete failed', 'Please try again.');
      return;
    }
    setMessages(prev => prev.map(m => m.id === id
      ? { ...m, deletedAt, body: 'Deleted message', mediaUrl: null, mediaAspectRatio: null }
      : m));
  }

  async function handleSend() {
    const trimmed = body.trim();
    if (!trimmed || !session?.user) return;
    setSending(true);
    const ok = await sendMessage(
      myGroupId, otherGroupId, myGroupId, session.user.id, trimmed,
      { replyToId: replyTo?.id ?? null }
    );
    setSending(false);
    if (!ok) {
      Alert.alert('Send failed', 'Please try again.');
      return;
    }
    setBody('');
    setReplyTo(null);
  }

  return (
    <View style={[styles.container, { paddingBottom: keyboardInset }]}>

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
        <View style={styles.messageListContent}>
          <MessageSkeleton />
        </View>
      ) : (
        <ScrollView
          ref={scrollViewRef}
          style={styles.messageList}
          contentContainerStyle={styles.messageListContent}
          keyboardShouldPersistTaps="handled"
          // Scrolling back through history dismisses the keyboard, rather than
          // costing a separate tap to get it out of the way. Not 'interactive':
          // iOS moves the keyboard with the thumb there but sends no frame
          // events until the gesture ends, so the composer couldn't follow and
          // the two came apart mid-drag. Going at once keeps them together.
          keyboardDismissMode="on-drag"
        >
          {messages.length === 0 ? (
            <Text style={styles.emptyText}>No messages yet — say hi!</Text>
          ) : (
            messages.map(m => {
              const isMine = m.senderId === session?.user.id;
              // Nothing of theirs is drawn: not the photo beside the bubble,
              // not the image inside it, not the tap that would open it.
              const isBlocked = blockedIds.has(m.senderId);
              return (
                <View
                  key={m.id}
                  style={[styles.bubbleRow, isMine && styles.bubbleRowMine]}
                  onLayout={e => { messageOffsets.current.set(m.id, e.nativeEvent.layout.y); }}
                >
                  {/* Theirs is labelled by picture and name; yours needs
                      neither — being on the right says who sent it. */}
                  {!isMine && (
                    isBlocked ? (
                      <View style={styles.senderPic} />
                    ) : (
                      <TouchableOpacity activeOpacity={0.7} onPress={() => setOpenPersonId(m.senderId)}>
                        {m.senderProfilePicUrl ? (
                          <Image source={authedSource(m.senderProfilePicUrl)} style={styles.senderPic} contentFit="cover" />
                        ) : (
                          <View style={styles.senderPic} />
                        )}
                      </TouchableOpacity>
                    )
                  )}
                  {/* Bubble and its tapbacks share a column, so the pills sit
                      under the message on the same side as it. The column is
                      what slides for a reply swipe, leaving the sender's
                      picture anchored where it is. */}
                  <SwipeToReply style={styles.swipeWrap} onReply={() => setReplyTo(m)}>
                    <View style={[styles.bubbleColumn, isMine && styles.bubbleColumnMine]}>
                      <TouchableOpacity
                        activeOpacity={1}
                        onPress={() => {
                          // Only a photo opens; a deleted one, or one from
                          // someone blocked, is a tombstone with nothing
                          // behind it.
                          if (m.kind === 'image' && m.mediaUrl && !m.deletedAt && !isBlocked) openImage(m);
                        }}
                        onLongPress={() => openActions(m)}
                        ref={node => { bubbleRefs.current.set(m.id, node as unknown as View | null); }}
                        style={[
                          styles.bubble,
                          isMine ? styles.bubbleMine : styles.bubbleTheirs,
                          m.kind === 'image' && !m.deletedAt && !isBlocked && styles.bubblePhoto,
                        ]}
                      >
                        {messageBubbleContent(m, isMine)}
                      </TouchableOpacity>

                      {(reactionsByMessage.get(m.id)?.length ?? 0) > 0 && (
                        <ReactionRow
                          reactions={reactionsByMessage.get(m.id) ?? []}
                          myUserId={session?.user.id}
                          onToggle={emoji => toggleReaction(m.id, emoji)}
                        />
                      )}
                    </View>
                  </SwipeToReply>
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
      {/* What you're answering, above the composer until it's sent or dropped. */}
      {replyTo && (
        <View style={styles.replyBar}>
          <View style={styles.replyAccent} />
          <View style={styles.replyTextBlock}>
            <Text style={styles.replyName} numberOfLines={1}>
              Replying to {replyTo.senderId === session?.user.id ? 'yourself' : replyTo.senderName}
            </Text>
            <Text style={styles.replyBody} numberOfLines={1}>{messageSnippet(replyTo)}</Text>
          </View>
          <TouchableOpacity style={styles.replyCancel} onPress={() => setReplyTo(null)}>
            <XMark size={16} color="#888" />
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.inputRow}>
        {!typing && !recorderState.isRecording && (
          // No confirm screen to spin on any more, so the button carries it.
          <TouchableOpacity
            style={styles.mediaButton}
            onPress={handleTakePhoto}
            disabled={sendingPhoto}
          >
            {sendingPhoto ? (
              <ActivityIndicator color={MEDIA_ICON_COLOR} />
            ) : (
              <Camera size={MEDIA_ICON_SIZE} color={MEDIA_ICON_COLOR} />
            )}
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
            {/* Takes the width the "Release to send" hint used to have. It
                redraws ten times a second and owns that ticking itself, so the
                thread behind it re-renders no more than it did before. */}
            <LiveWaveform samples={meterSamples} color={RECORDING_COLOR} />
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

      {/* Long-press actions. The bubble is drawn again here, over the blur, at
          the spot it was measured at — so it looks lifted rather than moved. */}
      {actionTarget && (
        <MessageActions
          rect={actionTarget.rect}
          mine={actionTarget.message.senderId === session?.user.id}
          canCopy={actionTarget.message.kind === 'text'}
          myReaction={
            reactionsByMessage.get(actionTarget.message.id)
              ?.find(r => r.userId === session?.user.id)?.emoji ?? null
          }
          onReact={emoji => {
            toggleReaction(actionTarget.message.id, emoji);
            setActionTarget(null);
          }}
          onReply={() => {
            setReplyTo(actionTarget.message);
            setActionTarget(null);
          }}
          onCopy={handleCopy}
          onDelete={handleDelete}
          onReport={() => {
            // The body is captured now rather than looked up on submit: the
            // sender can delete it while the sheet is open, and the report
            // would then carry nothing.
            setReporting({
              type: 'message',
              messageId: actionTarget.message.id,
              body: actionTarget.message.body,
            });
            setActionTarget(null);
          }}
          onClose={() => setActionTarget(null)}
        >
          <View style={[
            styles.bubble,
            styles.bubbleLifted,
            actionTarget.message.senderId === session?.user.id ? styles.bubbleMine : styles.bubbleTheirs,
            actionTarget.message.kind === 'image' && styles.bubblePhoto,
          ]}>
            {messageBubbleContent(
              actionTarget.message,
              actionTarget.message.senderId === session?.user.id
            )}
          </View>
        </MessageActions>
      )}

      {/* Confirm screen for a photo that hasn't been sent yet. Over everything,
          on black, so the photo is all there is to look at — and the only ways
          out are Cancel and Send. */}
      {pending && (
        <View style={styles.confirmOverlay}>
          <Image source={authedSource(pending.uri)} style={styles.confirmPhoto} contentFit="contain" />
          <View style={styles.confirmRow}>
            <TouchableOpacity onPress={() => setPending(null)} disabled={sendingPhoto}>
              <Text style={styles.confirmCancel}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => sendPhoto(pending)} disabled={sendingPhoto}>
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

      {/* Reporting a message, from its long-press menu. */}
      <ReportSheet target={reporting} onClose={() => setReporting(null)} />

    </View>
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

  // Holds the bubble and anything hanging off it. The 75% cap moves here from
  // the bubble so a long message and its tapbacks stay within the same width.
  // The 75% cap lives on the swipe wrapper above this now: it's the flex child
  // of the row, so a percentage here would measure against it rather than
  // against the row and compound to roughly half the screen.
  swipeWrap: {
    maxWidth: '75%',
  },

  bubbleColumn: {
    alignItems: 'flex-start',
  },

  bubbleColumnMine: {
    alignItems: 'flex-end',
  },

  bubble: {
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

  // The lifted copy fills the width it was measured at, so its text wraps
  // exactly where the original did.
  bubbleLifted: {
    width: '100%',
  },

  // The quoted message inside a reply. An indented block with a rule down its
  // left edge, the way a quotation reads anywhere else.
  quote: {
    borderLeftWidth: 2,
    paddingLeft: 8,
    marginBottom: 6,
    maxWidth: '100%',
  },

  quoteTheirs: {
    borderLeftColor: '#bbb',
  },

  quoteMine: {
    borderLeftColor: 'rgba(255,255,255,0.5)',
  },

  quoteName: {
    ...Type.caption,
    fontFamily: FontFamily.semiBold,
    color: '#666',
  },

  quoteBody: {
    ...Type.caption,
    color: '#666',
  },

  quoteTextMine: {
    color: 'rgba(255,255,255,0.7)',
  },

  bubbleText: {
    ...Type.body,
    color: '#000',
  },

  // Tombstone left where a deleted message was. Italic and washed out, so it
  // reads as an absence rather than as something someone wrote.
  deletedText: {
    ...Type.body,
    fontStyle: 'italic',
    color: '#888',
  },

  deletedTextMine: {
    color: '#bbb',
  },

  bubbleTextMine: {
    color: '#fff',
  },

  // Sits on the composer's own top rule, so the two read as one block.
  replyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 8,
    backgroundColor: '#f5f5f5',
  },

  replyAccent: {
    width: 2,
    alignSelf: 'stretch',
    borderRadius: 1,
    backgroundColor: Palette.confirm,
  },

  replyTextBlock: {
    flex: 1,
  },

  replyName: {
    ...Type.caption,
    fontFamily: FontFamily.semiBold,
    color: Palette.confirm,
  },

  replyBody: {
    ...Type.caption,
    color: '#666',
  },

  replyCancel: {
    padding: 4,
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
