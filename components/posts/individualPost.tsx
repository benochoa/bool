import { Pencil } from '@/assets/symbols/Pencil';
import { FontFamily, Palette, Type } from '@/constants/theme';
import { useKeyboardAwareScroll } from '@/hooks/use-keyboard-aware-scroll';
import { DEFAULT_ASPECT, snapToStandardAspect } from '@/lib/aspectRatio';
import {
  CardSlot, DEFAULT_PERSON_CARD_ORDER, photoSlotsFromUrls, reconcileCardOrder,
  slotKey, toStoredCardOrder,
} from '@/lib/cardOrder';
import { fetchPerson, PersonData } from '@/lib/fetchPerson';
import {
  EMPTY_IDENTIFIERS,
  identifierColumns,
  Identifiers,
  missingIdentifiers,
} from '@/lib/identifiers';
import { PostSkeleton } from '@/components/ui/skeleton';
import { supabase } from '@/supabaseClient';
import { authedSource, authenticatedStorageUrl } from '@/lib/storageAuth';
import { Image } from 'expo-image';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { ReactNode, Ref, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  KeyboardAvoidingView, Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import CardReorder, { EDIT_CARD_HEIGHT, EDIT_CARD_WIDTH } from './cardReorder';
import { IdentifiersEdit, IdentifiersView } from './identifiersCard';
import ZoomableImage from './zoomableImage';
import { HEADER_TOP } from '@/constants/layout';

const { width } = Dimensions.get('window');
const CARD_WIDTH = width - 40;
const PHOTO_SLOTS = 2;


async function fetchRandomPersonQuestions(): Promise<string[]> {
  const { data } = await supabase
    .from('questions')
    .select('questions')
    .eq('category', 'individual')
    .single();
  const all: string[] = data?.questions ?? [];
  
  return [...all].sort(() => Math.random() - 0.5).slice(0, 2);
}

// Lets the screen that owns the edit pencil drive the save from its own menu.
export interface IndividualPostHandle {
  // Resolves true only if the profile actually saved.
  save: () => Promise<boolean>;
}

interface Props {
  personId: string;
  // First-time profile setup — permanently editing, with its own ✓ to save
  // since there is no pencil (and no saved profile to go back to).
  creating?: boolean;
  // View mode renders straight from the fetched row, so your own profile looks
  // exactly like it does to a visitor; edit mode renders the form state.
  editMode?: boolean;
  // Set when nothing above this post provides top clearance (the member-profile
  // modal, which only has a floating back arrow).
  standalone?: boolean;
  onSave?: () => void;
  // Fired on the first edit of a session so the screen owning `editMode` knows
  // to offer Save/Discard on the way out.
  onDirty?: () => void;
  // Passed only where the viewer may edit — its presence is what puts the
  // pencil beside the name, so Discover and the member-profile modal get none.
  onToggleEdit?: () => void;
  // Two instances of this post exist during the edit transition — a read copy
  // underneath and an edit copy sliding over it. The read one reports its row
  // up through `onLoaded`; the screen hands it back as `initialData`, so the
  // edit copy mounts from data already in memory rather than fetching again.
  onLoaded?: (data: PersonData | null) => void;
  initialData?: PersonData | null;
  // Controls belonging to the screen that are meant to scroll away with the
  // post rather than sit pinned above it — the profile tab's history and
  // settings icons, the member panel's dots. Drawn at the top right, where a
  // fixed header would put them.
  headerRight?: ReactNode;
  ref?: Ref<IndividualPostHandle>;
}

export default function IndividualPost({ personId, creating = false, editMode = false, standalone = false, onSave, onDirty, onToggleEdit, onLoaded, initialData, headerRight, ref }: Props) {

  const isEditMode = creating || editMode;

  // State - read mode
  const [data, setData] = useState<PersonData | null>(initialData ?? null);
  const [loading, setLoading] = useState(!initialData);
  // Each photo's own aspect ratio (snapped to a standard), indexed by photo
  // slot. Null until picked / first loaded.
  const [photoAspects, setPhotoAspects] = useState<(number | null)[]>([null, null]);

  // State - editable mode
  const [name, setName] = useState('');
  const [profilePic, setProfilePic] = useState<string | null>(null);
  const [photos, setPhotos] = useState<(string | null)[]>([null, null]);
  const [questions, setQuestions] = useState<string[]>(['', '']);
  const [answers, setAnswers] = useState<string[]>(['', '']);
  const [cardOrder, setCardOrder] = useState<CardSlot[]>(DEFAULT_PERSON_CARD_ORDER);
  const [identifiers, setIdentifiers] = useState<Identifiers>(EMPTY_IDENTIFIERS);
  const [saving, setSaving] = useState(false);

  // Keeps the Q&A card you tapped fully above the keyboard.
  const { scrollRef, onScroll, reveal, spacerHeight } = useKeyboardAwareScroll();
  const qaCards = useRef<Record<number, View | null>>({});
  const identifiersCardRef = useRef<View | null>(null);

  // Fetch person data, then pre-fill the form from it. `editMode` is
  // deliberately not a dependency: the pencil has to flip into edit mode
  // without a refetch, which would wipe any edits in progress. Neither is
  // `initialData` — it seeds the first render only.
  useEffect(() => {
    setPhotoAspects([null, null]);
    // Handed the row by whoever already fetched it (the edit overlay), so this
    // instance can mount fully formed instead of round-tripping again.
    if (initialData) {
      prefillFromData(initialData);
      if (initialData.qa.length === 0) fetchRandomPersonQuestions().then(setQuestions);
      return;
    }
    fetchPerson(personId).then(async result => {
      setData(result);
      if (result) prefillFromData(result);
      // No Q&A yet means a brand-new profile (the setup gate), which needs a
      // fresh random pair to answer.
      if (!result || result.qa.length === 0) {
        setQuestions(await fetchRandomPersonQuestions());
      }
      setLoading(false);
      onLoaded?.(result);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personId]);

  // Pre-fill the edit form from fetched data; also re-run after a save so the
  // photos pick up their new ?v= URLs.
  function prefillFromData(d: PersonData) {
    setName(d.name ?? '');
    setProfilePic(d.profilePicUrl);
    setPhotos(photoSlotsFromUrls(d.imageUrls, PHOTO_SLOTS));
    setCardOrder(reconcileCardOrder(d.cardOrder, DEFAULT_PERSON_CARD_ORDER));
    setIdentifiers(d.identifiers);
    if (d.qa.length > 0) {
      // Keep exactly two slots, so a legacy 3-Q&A profile trims cleanly.
      setQuestions([d.qa[0]?.question ?? '', d.qa[1]?.question ?? '']);
      setAnswers([d.qa[0]?.answer ?? '', d.qa[1]?.answer ?? '']);
    }
  }

  // Photo slots in the order their cards appear in the post.
  function photoSlotOrder(): number[] {
    return cardOrder.filter(s => s.type === 'photo').map(s => s.index);
  }

  function handleReorder(next: CardSlot[]) {
    setCardOrder(next);
    onDirty?.();
  }

  function setPhotoAspect(i: number, ratio: number) {
    setPhotoAspects(prev => { const next = [...prev]; next[i] = ratio; return next; });
  }

  // Existing photos carry no picked dimensions, so derive each one's aspect
  // from its natural size the first time it loads. Only fills a slot once.
  function handlePhotoLoad(i: number, e: { source?: { width?: number; height?: number } }) {
    if (photoAspects[i] != null) return;
    const w = e?.source?.width;
    const h = e?.source?.height;
    if (w && h) setPhotoAspect(i, snapToStandardAspect(w / h));
  }

  async function pickPhoto(index: number) {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      // No crop tool: we keep the photo's real shape so the first one can lock
      // the card to its (snapped) aspect ratio.
      allowsEditing: false,
      quality: 1,
    });
    if (!result.canceled) {
      // Downscale + JPEG-compress before upload: cards render at ~350px, so
      // full-resolution camera photos are wasted bytes for every viewer.
      const asset = result.assets[0];
      const rendered = await ImageManipulator.manipulate(asset.uri)
        .resize({ width: Math.min(asset.width, 1080) })
        .renderAsync();
      const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.7 });
      const updated = [...photos];
      // A brand-new photo dropped into a later slot bumps to the earliest empty
      // one, so the user can't leave a gap. "Earliest" is by card order, not by
      // slot number — cards can be rearranged, so slot 1 may well be the photo
      // shown first. Replacing a filled slot stays put.
      const target = updated[index] ? index : (photoSlotOrder().find(i => !updated[i]) ?? index);
      updated[target] = saved.uri;
      setPhotos(updated);
      onDirty?.();
      // Each photo keeps its own shape, snapped to a standard ratio.
      if (asset.width && asset.height) {
        setPhotoAspect(target, snapToStandardAspect(asset.width / asset.height));
      }
    }
  }

  async function pickProfilePic() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });
    if (!result.canceled) {
      // Rendered as a small circle, so far less resolution than card photos.
      const asset = result.assets[0];
      const rendered = await ImageManipulator.manipulate(asset.uri)
        .resize({ width: Math.min(asset.width, 400) })
        .renderAsync();
      const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.7 });
      setProfilePic(saved.uri);
      onDirty?.();
    }
  }

  // Reports success so the screen driving the pencil menu only leaves edit
  // mode once the profile is actually saved.
  useImperativeHandle(ref, () => ({ save: handleSave }));

  async function handleSave(): Promise<boolean> {
    if (!name.trim()) {
      Alert.alert('Missing name', 'Please enter your name.');
      return false;
    }
    // College is the one identifier that can be left blank.
    const missing = missingIdentifiers(identifiers);
    if (missing.length > 0) {
      Alert.alert('Missing info', `Please fill in your ${missing.join(', ')}.`);
      return false;
    }
    // The avatar is separate from the card photos and more widely seen — member
    // rows and the suggester's ring on a Pending tile both read it — so it's
    // required in its own right rather than covered by the check below.
    if (!profilePic) {
      Alert.alert('Missing profile picture', 'Please add a profile picture.');
      return false;
    }
    // A profile with no photo is a blank card to whoever opens it, and one with
    // no answers has nothing to read — so neither saves, on the way in or on
    // the way back through an edit that emptied them.
    if (!photos.some(uri => uri)) {
      Alert.alert('Missing photo', 'Please add at least one photo.');
      return false;
    }
    if (!questions.some((q, i) => q.trim() && answers[i]?.trim())) {
      Alert.alert('Missing answer', 'Please answer at least one question.');
      return false;
    }
    setSaving(true);

    // Same rule as the card photos: an https URI is already uploaded and kept;
    // a local URI is a fresh pick that gets uploaded now.
    let profilePicUrl = profilePic;
    if (profilePic && !profilePic.startsWith('http')) {
      const response = await fetch(profilePic);
      const arrayBuffer = await response.arrayBuffer();
      const path = `${personId}/profile.jpg`;
      const { error } = await supabase.storage
        .from('people')
        .upload(path, arrayBuffer, { contentType: 'image/jpeg', upsert: true });
      if (error) {
        setSaving(false);
        Alert.alert('Photo upload failed', error.message);
        return false;
      }
      profilePicUrl = authenticatedStorageUrl('people', path) + '?v=' + Date.now();
    }

    // Every slot's final URL is recorded on the row (image_urls), so reads
    // never have to ask Storage what exists. Untouched slots hold https URLs
    // and keep them; fresh uploads get a new ?v= so caches refetch.
    // Written in card order: view mode resolves photos by filename, so this
    // array's order only decides image_urls[0] — the tile thumbnail — which
    // should be whatever photo the post actually opens with.
    const imageUrls: string[] = [];
    for (const i of photoSlotOrder()) {
      const uri = photos[i];
      if (!uri) continue;
      if (uri.startsWith('http')) {
        imageUrls.push(uri);
        continue;
      }
      // arrayBuffer, not blob: RN blobs are native-side references that
      // supabase-js can't read, which silently uploads 0-byte files.
      const response = await fetch(uri);
      const arrayBuffer = await response.arrayBuffer();
      const path = `${personId}/img${i + 1}.jpg`;
      const { error } = await supabase.storage
        .from('people')
        .upload(path, arrayBuffer, { contentType: 'image/jpeg', upsert: true });
      if (error) {
        setSaving(false);
        Alert.alert('Photo upload failed', error.message);
        return false;
      }
      imageUrls.push(authenticatedStorageUrl('people', path) + '?v=' + Date.now());
    }

    const qa = questions.map((q, i) => ({ question: q, answer: answers[i] }));
    const { error } = await supabase
      .from('profiles')
      .update({
        name: name.trim(), qa, image_urls: imageUrls,
        profile_pic_url: profilePicUrl, card_order: toStoredCardOrder(cardOrder),
        ...identifierColumns(identifiers),
      })
      .eq('id', personId);
    if (error) {
      setSaving(false);
      Alert.alert('Save failed', error.message);
      return false;
    }

    // View mode reads from `data`, so it has to be re-pulled — otherwise
    // returning to it would show the pre-save row.
    const fresh = await fetchPerson(personId);
    setData(fresh);
    if (fresh) prefillFromData(fresh);
    setSaving(false);
    onSave?.();
    return true;
  }

  // View mode — full-width cards, straight from the fetched row, nothing
  // tappable. Photos resolve through their filename, exactly as edit mode does,
  // so a saved card order means the same thing to the owner and to visitors.
  function renderViewCard(slot: CardSlot) {
    const key = slotKey(slot);
    if (slot.type === 'photo') {
      const uri = viewPhotos[slot.index];
      if (!uri) return null;
      return (
        <View key={key} style={styles.photoCard}>
          <ZoomableImage
            uri={uri}
            style={[styles.image, { aspectRatio: photoAspects[slot.index] ?? DEFAULT_ASPECT }]}
            onLoad={e => handlePhotoLoad(slot.index, e)}
          />
        </View>
      );
    }
    if (slot.type === 'identifiers') {
      // Nothing to show on a profile saved before identifiers existed.
      if (!data || !data.identifiers.age) return null;
      return (
        <View key={key} style={styles.identifiersCard}>
          <IdentifiersView identifiers={data.identifiers} />
        </View>
      );
    }
    const item = data?.qa[slot.index];
    // A question nobody answered is a prompt, not content — it belongs in the
    // edit form, where it's still there to fill in, and nowhere else.
    if (!item?.answer?.trim()) return null;
    return (
      <View key={key} style={styles.qaCard}>
        <Text style={styles.question}>{item.question}</Text>
        <Text style={styles.answer}>{item.answer}</Text>
      </View>
    );
  }

  // Edit mode — the same cards drawn small enough to sit in a reorder slot.
  // Sized by layout rather than a transform, so text stays crisp and taps land
  // where they look like they should.
  function renderEditCard(slot: CardSlot) {
    if (slot.type === 'photo') {
      const uri = photos[slot.index];
      if (!uri) {
        return (
          <TouchableOpacity activeOpacity={0.7} onPress={() => pickPhoto(slot.index)}>
            <View style={styles.editPhotoPlaceholder}>
              <Text style={styles.photoPlaceholderText}>Tap to add photo</Text>
            </View>
          </TouchableOpacity>
        );
      }
      // Fit the photo in the slot without distorting it: cap the height, then
      // let the width follow from its own aspect ratio.
      const aspect = photoAspects[slot.index] ?? DEFAULT_ASPECT;
      const height = Math.min(EDIT_CARD_HEIGHT, EDIT_CARD_WIDTH / aspect);
      return (
        <ZoomableImage
          uri={uri}
          style={{ width: height * aspect, height, borderRadius: 8 }}
          onLoad={e => handlePhotoLoad(slot.index, e)}
          onPress={() => pickPhoto(slot.index)}
        />
      );
    }
    if (slot.type === 'identifiers') {
      return (
        <View style={styles.editIdentifiersCard} ref={node => { identifiersCardRef.current = node; }}>
          <IdentifiersEdit
            identifiers={identifiers}
            variant="person"
            onChange={next => { setIdentifiers(next); onDirty?.(); }}
            onFocusField={() => reveal(identifiersCardRef.current)}
          />
        </View>
      );
    }
    return (
      <View style={styles.editQaCard} ref={node => { qaCards.current[slot.index] = node; }}>
        <Text style={styles.question}>{questions[slot.index]}</Text>
        <TextInput
          style={styles.answerInput}
          placeholder="Your answer"
          placeholderTextColor="#aaa"
          value={answers[slot.index]}
          onChangeText={text => {
            const updated = [...answers];
            updated[slot.index] = text;
            setAnswers(updated);
            onDirty?.();
          }}
          onFocus={() => reveal(qaCards.current[slot.index])}
          multiline
        />
      </View>
    );
  }

  if (loading) {
    return <PostSkeleton />;
  }

  const viewPhotos = photoSlotsFromUrls(data?.imageUrls ?? [], PHOTO_SLOTS);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
    <ScrollView
      ref={scrollRef}
      onScroll={onScroll}
      scrollEventThrottle={16}
      style={styles.container}
      contentContainerStyle={[styles.content, standalone && styles.contentStandalone]}
      keyboardShouldPersistTaps="handled"
    >

      {/* Inside the scroll on purpose: these leave with the content instead of
          holding the top of the screen. Sized like the fixed header that used
          to carry them, so nothing moves at rest. */}
      {headerRight && (
        <View style={[styles.headerRight, !standalone && styles.headerRightInset]}>
          {headerRight}
        </View>
      )}

      {/* Header — circular profile picture stacked above the name, centered */}
      <View style={styles.headerRow}>
        <View style={styles.profilePicWrap}>
          {/* Like the card photos, the whole picture is the tap target in edit
              mode — the pencil beside it is the toggle, not the photo picker. */}
          <TouchableOpacity
            activeOpacity={0.7}
            disabled={!isEditMode}
            onPress={pickProfilePic}
          >
            {(isEditMode ? profilePic : data?.profilePicUrl) ? (
              <Image source={authedSource((isEditMode ? profilePic : data?.profilePicUrl)!)} style={styles.profilePic} contentFit="cover" />
            ) : (
              <View style={styles.profilePicPlaceholder} />
            )}
          </TouchableOpacity>
          {/* Only the way in — edit mode is left from the screen's own header
              (Done / back), so the pencil would be a third, redundant exit. */}
          {onToggleEdit && !editMode && (
            <TouchableOpacity style={styles.editButton} onPress={onToggleEdit}>
              <Pencil size={27.6} color="#000" />
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.nameWrap}>
          {isEditMode ? (
            <TextInput
              style={styles.nameInput}
              placeholder="Your name"
              placeholderTextColor="#aaa"
              value={name}
              onChangeText={text => { setName(text); onDirty?.(); }}
            />
          ) : (
            <Text style={styles.name}>{data?.name}</Text>
          )}
        </View>
      </View>

      {/* Photos & Q&A — a vertical stack in the post's saved card order. Each
          photo keeps its own snapped aspect ratio. View mode is inert and shows
          only what exists; edit mode drops each card into a drag-to-reorder
          slot, marks photos with a pencil badge, and swaps the answers for
          always-mounted inputs, whose underline is the affordance. */}
      {isEditMode ? (
        <CardReorder order={cardOrder} onReorder={handleReorder} renderCard={renderEditCard} />
      ) : (
        cardOrder.map(renderViewCard)
      )}

      {/* Save button — only for first-time setup, which has no pencil to save
          from. Everywhere else the pencil's menu owns Save/Discard. */}
      {creating && (
        <TouchableOpacity style={styles.saveButton} onPress={handleSave} disabled={saving}>
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.saveButtonText}>✓</Text>
          )}
        </TouchableOpacity>
      )}

      {/* Room for the focused card to rise above the keyboard. */}
      <View style={{ height: spacerHeight }} />

    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({

  container: {
    flex: 1,
    backgroundColor: Palette.background,
  },

  content: {
    alignItems: 'center',
    paddingBottom: 40,
  },

  // The row the top-right controls ride in. `content` centres its children, so
  // this claims the full width to push them back to the right edge.
  headerRight: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 16,
    paddingRight: 20,
  },

  // Standalone already pays for the status bar in `contentStandalone`. Anywhere
  // else this row is the top of the screen and owes that clearance itself —
  // which is what keeps the profile tab's layout where it was when its fixed
  // header carried the icons.
  headerRightInset: {
    paddingTop: HEADER_TOP,
  },

  // Only the standalone member-profile modal needs this — nothing else on
  // screen provides top clearance there. Home and the profile-setup gate
  // are embedded under a header that already accounts for the status bar.
  contentStandalone: {
    // Roughly where the profile tab's own header leaves off (60 top padding +
    // its 24pt icons), less a nudge — a modal has no header above it, so it
    // can sit a little higher. The floating back arrow is at the left, clear
    // of the centred picture, so it needs no vertical clearance.
    paddingTop: 68,
  },

  // Identifiers — an explicit width like every other card, since the post
  // centres its content: a card sized by its own contents would shrink to the
  // width of its padding.
  identifiersCard: {
    width: CARD_WIDTH,
    marginTop: 20,
  },

  editIdentifiersCard: {
    width: EDIT_CARD_WIDTH,
    height: EDIT_CARD_HEIGHT,
  },

  // Q&A — a roomy white card with its text block vertically centered.
  qaCard: {
    width: CARD_WIDTH,
    backgroundColor: '#fff',
    borderRadius: 8,
    marginTop: 20,
    padding: 16,
    minHeight: 240,
    justifyContent: 'center',
  },

  // Header — profile picture stacked above the name, both centered.
  headerRow: {
    width: CARD_WIDTH,
    marginTop: 16,
    alignItems: 'center',
  },

  profilePic: {
    width: 105,
    height: 105,
    borderRadius: 52.5,
  },

  profilePicPlaceholder: {
    width: 105,
    height: 105,
    borderRadius: 52.5,
    backgroundColor: '#ddd',
  },

  // Wraps the circle so the edit pencil can anchor to it directly — same
  // 105px box as profilePic.
  profilePicWrap: {
    width: 105,
    height: 105,
  },

  // Sits at 45° below the positive x-axis of the profile pic, centered on
  // its edge (half in, half out): offset = r*cos45 ≈ 37.1 from the pic's
  // own center (r = 52.5), then inset by the icon's own radius.
  editButton: {
    position: 'absolute',
    top: 75.8,
    left: 75.8,
    width: 27.6,
    height: 27.6,
    alignItems: 'center',
    justifyContent: 'center',
  },

  nameWrap: {
    marginTop: 6,
    alignSelf: 'stretch',
  },

  // The view-mode text carries the input's box model with an invisible rule,
  // so toggling modes swaps the underline in without shifting the layout.
  name: {
    ...Type.title,
    color: '#000',
    textAlign: 'center',
    borderBottomWidth: 1,
    borderBottomColor: 'transparent',
    paddingVertical: 4,
  },

  nameInput: {
    ...Type.title,
    color: '#000',
    textAlign: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#ccc',
    paddingVertical: 4,
  },

  // Photos — each in its own card, no white box (image bleeds to card width).
  photoCard: {
    width: CARD_WIDTH,
    marginTop: 20,
  },

  image: {
    width: CARD_WIDTH,
    borderRadius: 8,
  },

  photoPlaceholder: {
    width: CARD_WIDTH,
    borderRadius: 8,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Edit-mode variants, sized to the reorder slot rather than the full card.
  editPhotoPlaceholder: {
    width: EDIT_CARD_WIDTH,
    height: EDIT_CARD_HEIGHT,
    borderRadius: 8,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // A fixed height, not a minimum: the card has to fit its slot exactly, so a
  // long answer scrolls inside the input instead of pushing the card taller.
  editQaCard: {
    width: EDIT_CARD_WIDTH,
    height: EDIT_CARD_HEIGHT,
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 16,
    justifyContent: 'center',
  },

  photoPlaceholderText: {
    ...Type.body,
    color: '#aaa',
  },

  question: {
    ...Type.body,
    color: '#000',
  },

  answer: {
    fontFamily: FontFamily.bold,
    fontSize: 28,
    color: '#000',
    marginTop: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'transparent',
    paddingVertical: 4,
  },

  answerInput: {
    fontFamily: FontFamily.bold,
    fontSize: 28,
    color: '#000',
    borderBottomWidth: 1,
    borderBottomColor: '#ccc',
    marginTop: 8,
    paddingVertical: 4,
  },

  // Save button
  saveButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#43a047',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 44,
  },

  saveButtonText: {
    fontSize: 28,
    color: '#fff',
    fontWeight: 'bold',
  },

});
