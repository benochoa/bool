import { IconSymbol } from '@/components/ui/icon-symbol';
import { FontFamily, Palette, Type } from '@/constants/theme';
import { supabase } from '@/supabaseClient';
import { Image } from 'expo-image';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
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
import { fetchPerson, PersonData } from '@/lib/fetchPerson';
import ZoomableImage from './zoomableImage';
import { snapToStandardAspect, DEFAULT_ASPECT } from '@/lib/aspectRatio';

const { width } = Dimensions.get('window');
const CARD_WIDTH = width - 40;

// Fixed top-to-bottom order of the stacked photo/Q&A cards (2 photos, 2 Q&As).
const CARD_ORDER: { type: 'photo' | 'qa'; index: number }[] = [
  { type: 'photo', index: 0 },
  { type: 'qa', index: 0 },
  { type: 'photo', index: 1 },
  { type: 'qa', index: 1 },
];

// Helpers (editable mode only)
const DEFAULT_QUESTIONS = [
  "What's your favorite way to spend a weekend?",
  "What's something you could talk about for hours?",
];

async function fetchRandomPersonQuestions(): Promise<string[]> {
  const { data } = await supabase
    .from('questions')
    .select('questions')
    .eq('category', 'individual')
    .single();
  const all: string[] = data?.questions ?? [];
  if (all.length < 2) return DEFAULT_QUESTIONS;
  return [...all].sort(() => Math.random() - 0.5).slice(0, 2);
}

interface Props {
  personId: string;
  // View mode renders straight from the fetched row, so your own profile looks
  // exactly like it does to a visitor; edit mode renders the form state.
  editMode?: boolean;
  // Set when nothing above this post provides top clearance (the member-profile
  // modal, which only has a floating back arrow).
  standalone?: boolean;
  onSave?: () => void;
  // Fired on the first edit of a session so the screen owning `editMode` knows
  // to confirm before discarding.
  onDirty?: () => void;
}

export default function IndividualPost({ personId, editMode = false, standalone = false, onSave, onDirty }: Props) {

  // State - read mode
  const [data, setData] = useState<PersonData | null>(null);
  const [loading, setLoading] = useState(true);
  // Each photo's own aspect ratio (snapped to a standard), indexed by photo
  // slot. Null until picked / first loaded.
  const [photoAspects, setPhotoAspects] = useState<(number | null)[]>([null, null]);

  // State - editable mode
  const [name, setName] = useState('');
  const [profilePic, setProfilePic] = useState<string | null>(null);
  const [photos, setPhotos] = useState<(string | null)[]>([null, null]);
  const [questions, setQuestions] = useState<string[]>(['', '']);
  const [answers, setAnswers] = useState<string[]>(['', '']);
  const [saving, setSaving] = useState(false);

  // Fetch person data, then pre-fill the form from it. `editMode` is
  // deliberately not a dependency: the pencil has to flip into edit mode
  // without a refetch, which would wipe any edits in progress.
  useEffect(() => {
    setPhotoAspects([null, null]);
    fetchPerson(personId).then(async result => {
      setData(result);
      if (result) prefillFromData(result);
      // No Q&A yet means a brand-new profile (the setup gate), which needs a
      // fresh random pair to answer.
      if (!result || result.qa.length === 0) {
        setQuestions(await fetchRandomPersonQuestions());
      }
      setLoading(false);
    });
  }, [personId]);

  // Pre-fill the edit form from fetched data; also re-run after a save so the
  // photos pick up their new ?v= URLs.
  function prefillFromData(d: PersonData) {
    setName(d.name ?? '');
    setProfilePic(d.profilePicUrl);
    // Place each photo in its slot by the imgN in its URL — the storage
    // listing collapses gaps, so positions alone can't be trusted.
    const slots: (string | null)[] = [null, null];
    for (const url of d.imageUrls) {
      const match = url.match(/img(\d)\.jpg/);
      const slot = match ? parseInt(match[1]) - 1 : -1;
      if (slot >= 0 && slot < 2) slots[slot] = url;
    }
    setPhotos(slots);
    if (d.qa.length > 0) {
      // Keep exactly two slots, so a legacy 3-Q&A profile trims cleanly.
      setQuestions([d.qa[0]?.question ?? '', d.qa[1]?.question ?? '']);
      setAnswers([d.qa[0]?.answer ?? '', d.qa[1]?.answer ?? '']);
    }
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
      // one, so the user can't leave a gap — slots map to img1/img2/img3 on save
      // and a gap persists across reloads. Replacing a filled slot stays put.
      const target = updated[index] ? index : updated.findIndex(p => !p);
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

  async function handleSave() {
    if (!name.trim()) {
      Alert.alert('Missing name', 'Please enter your name.');
      return;
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
        return;
      }
      profilePicUrl = supabase.storage.from('people').getPublicUrl(path).data.publicUrl + '?v=' + Date.now();
    }

    // Every slot's final URL is recorded on the row (image_urls), so reads
    // never have to ask Storage what exists. Untouched slots hold https URLs
    // and keep them; fresh uploads get a new ?v= so caches refetch.
    const imageUrls: string[] = [];
    for (let i = 0; i < photos.length; i++) {
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
        return;
      }
      imageUrls.push(supabase.storage.from('people').getPublicUrl(path).data.publicUrl + '?v=' + Date.now());
    }

    const qa = questions.map((q, i) => ({ question: q, answer: answers[i] }));
    const { error } = await supabase
      .from('profiles')
      .update({ name: name.trim(), qa, image_urls: imageUrls, profile_pic_url: profilePicUrl })
      .eq('id', personId);
    if (error) {
      setSaving(false);
      Alert.alert('Save failed', error.message);
      return;
    }

    // View mode reads from `data`, so it has to be re-pulled — otherwise
    // returning to it would show the pre-save row.
    const fresh = await fetchPerson(personId);
    setData(fresh);
    if (fresh) prefillFromData(fresh);
    setSaving(false);
    onSave?.();
  }

  if (loading) {
    return <ActivityIndicator style={styles.loader} />;
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, standalone && styles.contentStandalone]}
      keyboardShouldPersistTaps="handled"
    >

      {/* Header — circular profile picture, name to its right */}
      <View style={styles.headerRow}>
        <View style={styles.profilePicWrap}>
          {(editMode ? profilePic : data?.profilePicUrl) ? (
            <Image source={{ uri: (editMode ? profilePic : data?.profilePicUrl)! }} style={styles.profilePic} contentFit="cover" />
          ) : (
            <View style={styles.profilePicPlaceholder} />
          )}
          {editMode && (
            <TouchableOpacity style={styles.profilePicEditBadge} onPress={pickProfilePic}>
              <IconSymbol name="pencil" size={14} color="#000" weight="bold" />
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.nameWrap}>
          {editMode ? (
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

      {/* Photos & Q&A — a fixed vertical stack (CARD_ORDER). Each photo keeps
          its own snapped aspect ratio. View mode is inert and shows only what
          exists; edit mode marks every photo with a pencil badge and swaps the
          answers for always-mounted inputs, whose underline is the affordance. */}
      {CARD_ORDER.map(({ type, index }) => {
        if (type === 'photo') {
          const uri = editMode ? photos[index] : (data?.imageUrls[index] ?? null);
          if (!editMode && !uri) return null;
          return (
            <View key={`photo-${index}`} style={styles.photoCard}>
              {uri ? (
                <>
                  <ZoomableImage
                    uri={uri}
                    style={[styles.image, { aspectRatio: photoAspects[index] ?? DEFAULT_ASPECT }]}
                    onLoad={e => handlePhotoLoad(index, e)}
                    onPress={editMode ? () => pickPhoto(index) : undefined}
                  />
                  {/* Indicator only — the photo itself takes the tap, so this
                      must not intercept the pinch-to-zoom gesture under it. */}
                  {editMode && (
                    <View style={styles.photoEditBadge} pointerEvents="none">
                      <IconSymbol name="pencil" size={14} color="#000" weight="bold" />
                    </View>
                  )}
                </>
              ) : (
                <TouchableOpacity activeOpacity={0.7} onPress={() => pickPhoto(index)}>
                  <View style={[styles.photoPlaceholder, { aspectRatio: DEFAULT_ASPECT }]}>
                    <Text style={styles.photoPlaceholderText}>Tap to add photo</Text>
                  </View>
                </TouchableOpacity>
              )}
            </View>
          );
        }

        // Q&A card
        if (!editMode) {
          const item = data?.qa[index];
          if (!item) return null;
          return (
            <View key={`qa-${index}`} style={styles.qaCard}>
              <Text style={styles.question}>{item.question}</Text>
              <Text style={styles.answer}>{item.answer}</Text>
            </View>
          );
        }
        return (
          <View key={`qa-${index}`} style={styles.qaCard}>
            <Text style={styles.question}>{questions[index]}</Text>
            <TextInput
              style={styles.answerInput}
              placeholder="Your answer"
              placeholderTextColor="#aaa"
              value={answers[index]}
              onChangeText={text => {
                const updated = [...answers];
                updated[index] = text;
                setAnswers(updated);
                onDirty?.();
              }}
              multiline
            />
          </View>
        );
      })}

      {/* Save button (edit mode) — stays visible so edits can be re-saved */}
      {editMode && (
        <TouchableOpacity style={styles.saveButton} onPress={handleSave} disabled={saving}>
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.saveButtonText}>✓</Text>
          )}
        </TouchableOpacity>
      )}

    </ScrollView>
    </KeyboardAvoidingView>
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
    backgroundColor: Palette.background,
  },

  content: {
    alignItems: 'center',
    paddingBottom: 40,
  },

  // Only the standalone member-profile modal needs this — nothing else on
  // screen provides top clearance there. Home and the profile-setup gate
  // are embedded under a header that already accounts for the status bar.
  contentStandalone: {
    // Clears the modal's floating back arrow (top: 60) — the header row is
    // now a 64px circle + name, tall enough to collide with the arrow at 60.
    paddingTop: 100,
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

  // Header (profile picture + name)
  headerRow: {
    width: CARD_WIDTH,
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },

  profilePic: {
    width: 79,
    height: 79,
    borderRadius: 39.5,
  },

  profilePicPlaceholder: {
    width: 79,
    height: 79,
    borderRadius: 39.5,
    backgroundColor: '#ddd',
  },

  // Wraps the circle so the edit badge can anchor to it directly — same
  // 79px box as profilePic, no longer itself tappable.
  profilePicWrap: {
    width: 79,
    height: 79,
  },

  // Sits at 45° below the positive x-axis of the profile pic, centered on
  // its edge (half in, half out): offset = r*cos45 ≈ 27.9 from the pic's
  // own center, then inset by the badge's own radius.
  profilePicEditBadge: {
    position: 'absolute',
    top: 53.5,
    left: 53.5,
    width: 27,
    height: 27,
    borderRadius: 13.5,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },

  nameWrap: {
    flex: 1,
    marginLeft: 12,
    alignSelf: 'stretch',
    justifyContent: 'center',
  },

  // The view-mode text carries the input's box model with an invisible rule,
  // so toggling modes swaps the underline in without shifting the layout.
  name: {
    ...Type.title,
    color: '#000',
    textAlign: 'left',
    borderBottomWidth: 1,
    borderBottomColor: 'transparent',
    paddingVertical: 4,
  },

  nameInput: {
    ...Type.title,
    color: '#000',
    textAlign: 'left',
    borderBottomWidth: 1,
    borderBottomColor: '#ccc',
    paddingVertical: 4,
  },

  // Photos — each in its own card, no white box (image bleeds to card width).
  photoCard: {
    width: CARD_WIDTH,
    marginTop: 20,
  },

  // Edit-mode marker that a photo is tappable — bottom-right, matching the
  // profile picture's badge.
  photoEditBadge: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
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
