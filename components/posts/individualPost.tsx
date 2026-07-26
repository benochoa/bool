import { IconSymbol } from '@/components/ui/icon-symbol';
import { Palette, Type } from '@/constants/theme';
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

const { width } = Dimensions.get('window');
const CARD_WIDTH = width - 40;

// Helpers (editable mode only)
const DEFAULT_QUESTIONS = [
  "What's your favorite way to spend a weekend?",
  "What's something you could talk about for hours?",
  "What's the best meal you've ever had?",
];

async function fetchRandomPersonQuestions(): Promise<string[]> {
  const { data } = await supabase
    .from('questions')
    .select('questions')
    .eq('category', 'individual')
    .single();
  const all: string[] = data?.questions ?? [];
  if (all.length < 3) return DEFAULT_QUESTIONS;
  return [...all].sort(() => Math.random() - 0.5).slice(0, 3);
}

interface Props {
  personId: string;
  editable?: boolean;
  onSave?: () => void;
}

export default function IndividualPost({ personId, editable = false, onSave }: Props) {

  // State - read mode
  const [data, setData] = useState<PersonData | null>(null);
  const [loading, setLoading] = useState(true);

  // State - editable mode
  const [name, setName] = useState('');
  const [profilePic, setProfilePic] = useState<string | null>(null);
  const [photos, setPhotos] = useState<(string | null)[]>([null, null, null]);
  const [questions, setQuestions] = useState<string[]>(['', '', '']);
  const [answers, setAnswers] = useState<string[]>(['', '', '']);
  const [editingName, setEditingName] = useState(false);
  const [editingAnswerIndex, setEditingAnswerIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  // Fetch person data; in editable mode, pre-fill the form with it
  useEffect(() => {
    fetchPerson(personId).then(async result => {
      if (!editable) {
        setData(result);
        setLoading(false);
        return;
      }

      if (result) {
        setName(result.name ?? '');
        setProfilePic(result.profilePicUrl);
        // Place each photo in its slot by the imgN in its URL — the storage
        // listing collapses gaps, so positions alone can't be trusted.
        const slots: (string | null)[] = [null, null, null];
        for (const url of result.imageUrls) {
          const match = url.match(/img(\d)\.jpg/);
          const slot = match ? parseInt(match[1]) - 1 : -1;
          if (slot >= 0 && slot < 3) slots[slot] = url;
        }
        setPhotos(slots);
      }

      if (result && result.qa.length > 0) {
        setQuestions(result.qa.map(item => item.question));
        setAnswers(result.qa.map(item => item.answer));
      } else {
        setQuestions(await fetchRandomPersonQuestions());
      }
      setLoading(false);
    });
  }, [personId, editable]);

  async function pickPhoto(index: number) {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
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
      updated[index] = saved.uri;
      setPhotos(updated);
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
    setSaving(false);
    if (error) {
      Alert.alert('Save failed', error.message);
      return;
    }
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
      contentContainerStyle={[styles.content, !editable && styles.contentStandalone]}
      keyboardShouldPersistTaps="handled"
    >

      {/* Header — circular profile picture, name to its right */}
      <View style={styles.headerRow}>
        <View style={styles.profilePicWrap}>
          {editable ? (
            profilePic ? (
              <Image source={{ uri: profilePic }} style={styles.profilePic} contentFit="cover" />
            ) : (
              <View style={styles.profilePicPlaceholder} />
            )
          ) : data?.profilePicUrl ? (
            <Image source={{ uri: data.profilePicUrl }} style={styles.profilePic} contentFit="cover" />
          ) : (
            <View style={styles.profilePicPlaceholder} />
          )}
          {editable && (
            <TouchableOpacity style={styles.profilePicEditBadge} onPress={pickProfilePic}>
              <IconSymbol name="pencil" size={14} color="#000" weight="bold" />
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.nameWrap}>
          {editable && (
            <View style={styles.optionsWrapName}>
              <TouchableOpacity style={styles.optionsButton} onPress={() => setEditingName(e => !e)}>
                <Text style={styles.optionsDots}>···</Text>
              </TouchableOpacity>
            </View>
          )}
          {editable && editingName ? (
            <TextInput
              style={styles.nameInput}
              placeholder="Your name"
              placeholderTextColor="#aaa"
              value={name}
              onChangeText={setName}
              autoFocus
            />
          ) : (
            <Text style={[styles.name, editable && !name && styles.placeholder]}>
              {editable ? (name || 'Your name') : data?.name}
            </Text>
          )}
        </View>
      </View>

      {/* Photos — no card box, image bleeds to the same outer width as the cards below */}
      <View style={styles.photoContainer}>
        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {editable ? (
            photos.map((uri, i) => (
              <View key={i} style={styles.photoSlot}>
                <TouchableOpacity style={[styles.optionsButton, styles.optionsPhotos]} onPress={() => pickPhoto(i)}>
                  <Text style={styles.optionsDots}>···</Text>
                </TouchableOpacity>
                {uri ? (
                  <Image source={{ uri }} style={styles.image} contentFit="cover" />
                ) : (
                  <View style={styles.photoPlaceholder}>
                    <Text style={styles.photoPlaceholderText}>Tap to add photo</Text>
                  </View>
                )}
              </View>
            ))
          ) : (
            data?.imageUrls.map((url, i) => (
              <Image key={i} source={{ uri: url }} style={styles.image} contentFit="cover" />
            ))
          )}
        </ScrollView>
      </View>

      {/* Q&A — static header above the box, never editable */}
      <Text style={styles.qaHeader}>Talk to me...</Text>
      <View style={styles.card}>
        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {editable ? (
            questions.map((q, i) => (
              <View key={i} style={styles.qaItem}>
                <TouchableOpacity style={[styles.optionsButton, styles.optionsQa]} onPress={() => setEditingAnswerIndex(editingAnswerIndex === i ? null : i)}>
                  <Text style={styles.optionsDots}>···</Text>
                </TouchableOpacity>
                <Text style={styles.question}>{q}</Text>
                {editingAnswerIndex === i ? (
                  <TextInput
                    style={styles.answerInput}
                    placeholder="Your answer"
                    placeholderTextColor="#aaa"
                    value={answers[i]}
                    onChangeText={text => {
                      const updated = [...answers];
                      updated[i] = text;
                      setAnswers(updated);
                    }}
                    multiline
                    autoFocus
                  />
                ) : (
                  <Text style={[styles.answer, !answers[i] && styles.placeholder]}>
                    {answers[i] || 'Tap to answer'}
                  </Text>
                )}
              </View>
            ))
          ) : (
            data?.qa.map((item, i) => (
              <View key={i} style={styles.qaItem}>
                <Text style={styles.question}>{item.question}</Text>
                <Text style={styles.answer}>{item.answer}</Text>
              </View>
            ))
          )}
        </ScrollView>
      </View>

      {/* Save button (editable mode) — stays visible so edits can be re-saved */}
      {editable && (
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

  // Shared card box
  card: {
    width: CARD_WIDTH,
    backgroundColor: '#fff',
    borderRadius: 8,
    marginTop: 16,
    overflow: 'hidden',
    // Horizontal padding lives on qaItem instead, so the "..." can sit flush
    // at the card edge — aligned with the name/photo dots — without the
    // scroll view clipping it.
    paddingVertical: 16,
  },

  // "..." options pill — replaces the old pencil affordance
  optionsButton: {
    // Invisible tap target — no fill, no border, just the dots.
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },

  optionsDots: {
    color: '#333',
    fontSize: 24,
    fontWeight: '700',
    // Middle dots (·) sit at the em-box center (periods rest on the baseline),
    // so "···" is vertically centered in the pill with no offset needed.
    includeFontPadding: false,
  },

  // Name: full-height wrapper that flex-centers the pill against the name line.
  optionsWrapName: {
    position: 'absolute',
    right: 8,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    zIndex: 1,
  },

  // Photos: same y as the old pencil.
  optionsPhotos: {
    position: 'absolute',
    top: 8,
    right: 8,
    zIndex: 1,
  },

  // Q&A: nudged up from 8, still inside the card padding.
  optionsQa: {
    position: 'absolute',
    top: 2,
    // qaItem is now full CARD_WIDTH (same box as headerRow/photoContainer),
    // so the same right offset lands on the same edge as name/photo.
    right: 8,
    zIndex: 1,
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

  name: {
    ...Type.title,
    color: '#000',
    textAlign: 'left',
  },

  nameInput: {
    ...Type.title,
    color: '#000',
    textAlign: 'left',
    borderBottomWidth: 1,
    borderBottomColor: '#ccc',
    paddingVertical: 4,
  },

  placeholder: {
    color: '#aaa',
  },

  // Photos
  photoContainer: {
    width: CARD_WIDTH,
    marginTop: 16,
  },

  photoSlot: {
    width: CARD_WIDTH,
  },

  image: {
    width: CARD_WIDTH,
    height: 300,
    borderRadius: 8,
  },

  photoPlaceholder: {
    width: CARD_WIDTH,
    height: 300,
    borderRadius: 8,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
    justifyContent: 'center',
  },

  photoPlaceholderText: {
    ...Type.body,
    color: '#aaa',
  },

  // Q&A
  qaHeader: {
    ...Type.header,
    width: CARD_WIDTH,
    color: '#000',
    textAlign: 'left',
    // Ample breathing room between the photo above and this section label;
    // the card below adds its own 16 on top of the label.
    marginTop: 32,
  },

  qaItem: {
    width: CARD_WIDTH,
    paddingHorizontal: 16,
  },

  question: {
    ...Type.bodyBold,
    color: '#000',
  },

  answer: {
    ...Type.body,
    color: '#000',
    marginTop: 4,
  },

  answerInput: {
    ...Type.body,
    color: '#000',
    borderBottomWidth: 1,
    borderBottomColor: '#ccc',
    marginTop: 4,
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
    marginTop: 32,
  },

  saveButtonText: {
    fontSize: 28,
    color: '#fff',
    fontWeight: 'bold',
  },

});
