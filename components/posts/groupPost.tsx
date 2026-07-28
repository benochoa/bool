import {
  StyleSheet, View, Text, ScrollView, Dimensions,
  TouchableOpacity, Modal, ActivityIndicator, TextInput, Alert,
  KeyboardAvoidingView, Platform, Share
} from 'react-native';
import { useEffect, useRef, useState } from 'react';
import { Image } from 'expo-image';
import FontAwesome6 from '@expo/vector-icons/FontAwesome6';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '@/supabaseClient';
import { FontFamily, Palette, Type } from '@/constants/theme';
import { useSession } from '@/hooks/use-session';
import { fetchGroup, GroupData } from '@/lib/fetchGroup';
import { leaveGroup } from '@/lib/leaveGroup';
import { dissolveGroup } from '@/lib/dissolveGroup';
import { removeMember } from '@/lib/removeMember';
import { makeGroupLeader } from '@/lib/makeGroupLeader';
import IndividualPost from './individualPost';
import MemberManagement, { MemberRect } from './memberManagement';
import CarouselDots from './carouselDots';

const { width } = Dimensions.get('window');
const CARD_WIDTH = width - 40;

// Helpers (editable mode only)
async function getNextGroupId(): Promise<string> {
  const { data } = await supabase.from('groups').select('id');
  const nums = (data ?? [])
    .map(row => row.id as string)
    .filter(id => /^Group-\d+$/.test(id))
    .map(id => parseInt(id.split('-')[1]));
  const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
  return `Group-${next}`;
}

// No 0/O, 1/I/L: avoids ambiguous characters when codes are shared aloud.
const INVITE_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateInviteCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) code += INVITE_CODE_CHARS[Math.floor(Math.random() * INVITE_CODE_CHARS.length)];
  return code;
}

async function getUniqueInviteCode(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateInviteCode();
    const { data } = await supabase.from('groups').select('id').eq('invite_code', code).maybeSingle();
    if (!data) return code;
  }
  // The unique constraint on groups.invite_code catches the leftover race.
  return generateInviteCode();
}

async function fetchRandomGroupQuestions(): Promise<string[]> {
  const { data } = await supabase
    .from('questions')
    .select('questions')
    .eq('category', 'group')
    .single();
  const all: string[] = data?.questions ?? [];
  return [...all].sort(() => Math.random() - 0.5).slice(0, 3);
}

// Member row subcomponent — name arrives with the group fetch, no fetching here.
function MemberRow({ name, profilePicUrl, isGroupLeader, onPress, onLongPress }: {
  name: string; profilePicUrl: string | null; isGroupLeader: boolean;
  onPress: () => void; onLongPress?: (rect: MemberRect) => void;
}) {
  const rowRef = useRef<React.ComponentRef<typeof TouchableOpacity>>(null);
  return (
    <TouchableOpacity
      ref={rowRef}
      style={styles.memberRow}
      onPress={onPress}
      onLongPress={() => rowRef.current?.measureInWindow((x, y, width, height) => onLongPress?.({ x, y, width, height }))}
    >
      {profilePicUrl ? (
        <Image source={{ uri: profilePicUrl }} style={styles.memberCircle} contentFit="cover" />
      ) : (
        <View style={styles.memberCircle} />
      )}
      <Text style={styles.memberName}>{name}</Text>
      {isGroupLeader && (
        <View style={styles.optionsWrapName}>
          <View style={styles.optionsButton}>
            <FontAwesome6 name="crown" size={14} color="#000" solid />
          </View>
        </View>
      )}
    </TouchableOpacity>
  );
}

interface Props {
  groupId?: string;
  editable?: boolean;
  onClose?: () => void;
  // Set when the viewer is a member of this group (i.e. viewed from the groups
  // tab, not explore) — surfaces Leave (non-leaders) or Dissolve (the leader).
  isMember?: boolean;
  onLeft?: () => void;
  onDissolved?: () => void;
}

export default function GroupPost({ groupId, editable = false, onClose, isMember = false, onLeft, onDissolved }: Props) {

  const { session } = useSession();

  // State - read mode
  const [data, setData] = useState<GroupData | null>(null);
  const [loading, setLoading] = useState(!editable);
  const [selectedMember, setSelectedMember] = useState<string | null>(null);
  // Leader-only member popover (opened by long-pressing a member row).
  const [managedMember, setManagedMember] = useState<{ id: string; name: string; profilePicUrl: string | null } | null>(null);
  const [manageRect, setManageRect] = useState<MemberRect | null>(null);
  // Active page of each carousel, for the dot indicators.
  const [photoPage, setPhotoPage] = useState(0);
  const [qaPage, setQaPage] = useState(0);

  // State - editable mode
  const [groupName, setGroupName] = useState('');
  const [photos, setPhotos] = useState<(string | null)[]>([null, null, null]);
  const [questions, setQuestions] = useState<string[]>(['', '', '']);
  const [answers, setAnswers] = useState<string[]>(['', '', '']);
  const [editingName, setEditingName] = useState(false);
  const [editingAnswerIndex, setEditingAnswerIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // editable = creation flow; isLeader = editing your own saved group in place
  const isLeader = !!(session?.user && data?.created_by && data.created_by === session.user.id);
  const isEditMode = editable || isLeader;
  // A member who didn't create the group can leave it; the leader dissolves it
  // instead. Exactly one of these shows, since a viewer is leader XOR not.
  const canLeave = isMember && !isLeader && !!data;
  const canDissolve = isMember && isLeader && !!data;

  // Fetch data (read mode) or questions (editable mode)
  useEffect(() => {
    if (editable) {
      fetchRandomGroupQuestions().then(qs => setQuestions(qs));
    } else if (groupId) {
      // The same instance can be reused for another group (explore feed), so
      // clear the previous group's data — which would otherwise flash on
      // screen until the fetch lands — before loading the next.
      setData(null);
      setLoading(true);
      setPhotoPage(0);
      setQaPage(0);
      fetchGroup(groupId).then(result => {
        setData(result);
        // Leaders edit in place (pencils always live), so prefill the form
        // from the fetched data the moment it arrives.
        if (result && session?.user && result.created_by === session.user.id) {
          prefillFromData(result);
        }
        setLoading(false);
      });
    }
  }, [groupId, editable, session]);

  // Pre-fill the edit form from fetched data; also used by Cancel to discard edits.
  function prefillFromData(d: GroupData) {
    setGroupName(d.name);
    // Place each photo in its slot by the imgN in its URL — the storage
    // listing collapses gaps, so positions alone can't be trusted.
    const slots: (string | null)[] = [null, null, null];
    for (const url of d.imageUrls) {
      const match = url.match(/img(\d)\.jpg/);
      const slot = match ? parseInt(match[1]) - 1 : -1;
      if (slot >= 0 && slot < 3) slots[slot] = url;
    }
    setPhotos(slots);
    setQuestions(d.qa.map(item => item.question));
    setAnswers(d.qa.map(item => item.answer));
  }

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
      // A brand-new photo dropped into a later slot bumps to the earliest empty
      // one, so the user can't leave a gap — slots map to img1/img2/img3 on save
      // and a gap persists across reloads. Replacing a filled slot stays put.
      const target = updated[index] ? index : updated.findIndex(p => !p);
      updated[target] = saved.uri;
      setPhotos(updated);
    }
  }

  async function handleSave() {
    if (!groupName.trim()) {
      Alert.alert('Missing name', 'Please enter a group name.');
      return;
    }
    setSaving(true);
    const qa = questions.map((q, i) => ({ question: q, answer: answers[i] }));

    // Leader editing an existing group
    if (isLeader && groupId) {
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
        const response = await fetch(uri);
        const arrayBuffer = await response.arrayBuffer();
        const path = `${groupId}/img${i + 1}.jpg`;
        const { error } = await supabase.storage
          .from('groups')
          .upload(path, arrayBuffer, { contentType: 'image/jpeg', upsert: true });
        if (error) {
          setSaving(false);
          Alert.alert('Photo upload failed', error.message);
          return;
        }
        imageUrls.push(supabase.storage.from('groups').getPublicUrl(path).data.publicUrl + '?v=' + Date.now());
      }

      const { error } = await supabase
        .from('groups')
        .update({ name: groupName.trim(), qa, image_urls: imageUrls })
        .eq('id', groupId);
      if (error) {
        setSaving(false);
        Alert.alert('Save failed', error.message);
        return;
      }

      // Stay in edit mode; re-prefill so saved photos pick up their new ?v= URLs.
      const fresh = await fetchGroup(groupId);
      setData(fresh);
      if (fresh) prefillFromData(fresh);
      setSaving(false);
      return;
    }

    // Creation
    const newGroupId = await getNextGroupId();

    const imageUrls: string[] = [];
    for (let i = 0; i < photos.length; i++) {
      const uri = photos[i];
      if (!uri) continue;
      // arrayBuffer, not blob: RN blobs are native-side references that
      // supabase-js can't read, which silently uploads 0-byte files.
      const response = await fetch(uri);
      const arrayBuffer = await response.arrayBuffer();
      const path = `${newGroupId}/img${i + 1}.jpg`;
      await supabase.storage
        .from('groups')
        .upload(path, arrayBuffer, { contentType: 'image/jpeg' });
      imageUrls.push(supabase.storage.from('groups').getPublicUrl(path).data.publicUrl + '?v=' + Date.now());
    }

    const { error } = await supabase.from('groups').insert({
      id: newGroupId,
      name: groupName.trim(),
      qa,
      created_by: session?.user.id ?? null,
      invite_code: await getUniqueInviteCode(),
      image_urls: imageUrls,
      status: 'active',
    });
    if (error) {
      setSaving(false);
      Alert.alert('Save failed', error.message);
      return;
    }

    // The creator is the group's first member.
    if (session?.user) {
      await supabase.from('memberships').insert({
        group_id: newGroupId,
        person_id: session.user.id,
        status: 'active',
        status_at: new Date().toISOString(),
      });
    }

    setSaving(false);
    setSaved(true);
  }

  function handleLeave() {
    if (!session?.user || !groupId) return;
    Alert.alert(
      'Leave group',
      `Are you sure you want to leave ${data?.name ?? 'this group'}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            const { error } = await leaveGroup(session.user.id, groupId);
            if (error) {
              Alert.alert('Could not leave', error.message);
              return;
            }
            onLeft?.();
          },
        },
      ]
    );
  }

  function handleDissolve() {
    if (!groupId) return;
    Alert.alert(
      'Dissolve group',
      `This permanently dissolves ${data?.name ?? 'this group'} for everyone and can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Dissolve',
          style: 'destructive',
          onPress: async () => {
            const { error } = await dissolveGroup(groupId);
            if (error) {
              Alert.alert('Could not dissolve', error.message);
              return;
            }
            onDissolved?.();
          },
        },
      ]
    );
  }

  // Re-pull the group after a membership change so the list, crown, and
  // leader-only affordances all reflect the new state in place.
  async function refetchGroup() {
    if (!groupId) return;
    setData(await fetchGroup(groupId));
  }

  function handleRemoveMember() {
    const member = managedMember;
    if (!groupId || !member) return;
    Alert.alert(
      'Remove member',
      `Remove ${member.name} from the group?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            const { error } = await removeMember(groupId, member.id);
            if (error) {
              Alert.alert('Could not remove', error.message);
              return;
            }
            setManagedMember(null);
            refetchGroup();
          },
        },
      ]
    );
  }

  function handleMakeLeader() {
    const member = managedMember;
    if (!groupId || !member) return;
    Alert.alert(
      'Make group leader',
      `Make ${member.name} the group leader? You'll no longer be the leader.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Make leader',
          onPress: async () => {
            const { error } = await makeGroupLeader(groupId, member.id);
            if (error) {
              Alert.alert('Could not update', error.message);
              return;
            }
            setManagedMember(null);
            refetchGroup();
          },
        },
      ]
    );
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
      contentContainerStyle={[styles.content, editable && onClose && styles.contentWithBackButton]}
      keyboardShouldPersistTaps="handled"
    >

      {/* Back arrow (editable mode) */}
      {editable && onClose && (
        <TouchableOpacity style={styles.backButton} onPress={onClose}>
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
      )}

      {/* Name — no card box */}
      <View style={styles.nameContainer}>
        {isEditMode && (
          <View style={styles.optionsWrapName}>
            <TouchableOpacity style={styles.optionsButton} onPress={() => setEditingName(e => !e)}>
              <Text style={styles.optionsDots}>···</Text>
            </TouchableOpacity>
          </View>
        )}
        {isEditMode && editingName ? (
          <TextInput
            style={styles.nameInput}
            placeholder="Group name"
            placeholderTextColor="#aaa"
            value={groupName}
            onChangeText={setGroupName}
            autoFocus
          />
        ) : (
          <Text style={[styles.name, isEditMode && !groupName && styles.placeholder]}>
            {isEditMode ? (groupName || 'Group name') : data?.name}
          </Text>
        )}
      </View>

      {/* Photos — no card box, image bleeds to the same outer width as the cards below */}
      <View style={styles.photoContainer}>
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          onMomentumScrollEnd={e => setPhotoPage(Math.round(e.nativeEvent.contentOffset.x / CARD_WIDTH))}
        >
          {isEditMode ? (
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

      <CarouselDots count={isEditMode ? photos.length : (data?.imageUrls.length ?? 0)} active={photoPage} />

      {/* Q&A — static header above the box, never editable */}
      <Text style={styles.qaHeader}>Talk to me...</Text>
      <View style={styles.card}>
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          onMomentumScrollEnd={e => setQaPage(Math.round(e.nativeEvent.contentOffset.x / CARD_WIDTH))}
        >
          {isEditMode ? (
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

      <CarouselDots count={isEditMode ? questions.length : (data?.qa.length ?? 0)} active={qaPage} />

      {/* Members card — unlike Q&A, this has no per-item padding, so it
          needs the card's horizontal inset restored directly. */}
      <View style={[styles.card, styles.membersCard]}>
        {data ? (
          <>
            {data.members.map(m => (
              <MemberRow
                key={m.id}
                name={m.name}
                profilePicUrl={m.profilePicUrl}
                isGroupLeader={m.id === data.created_by}
                onPress={() => setSelectedMember(m.id)}
                onLongPress={(rect) => {
                  // Leader-only, and not on themselves.
                  if (!isLeader || !session?.user || m.id === session.user.id) return;
                  // Force the clear band to the full members-card width (card is
                  // centered at CARD_WIDTH), keeping only the measured vertical.
                  setManageRect({ x: (width - CARD_WIDTH) / 2, y: rect.y, width: CARD_WIDTH, height: rect.height });
                  setManagedMember({ id: m.id, name: m.name, profilePicUrl: m.profilePicUrl });
                }}
              />
            ))}
            {isLeader && data.invite_code && (
              <View style={styles.inviteRow}>
                <Text style={styles.inviteLabel}>Invite code: {data.invite_code}</Text>
                <TouchableOpacity onPress={() => Share.share({ message: `Join my group on bool — use invite code ${data.invite_code}` })}>
                  <Text style={styles.shareText}>Share</Text>
                </TouchableOpacity>
              </View>
            )}
          </>
        ) : (
          <Text style={styles.membersPlaceholder}>Members — coming soon</Text>
        )}
      </View>

      {/* Leave group (non-leader members only) */}
      {canLeave && (
        <TouchableOpacity style={styles.leaveButton} onPress={handleLeave}>
          <Text style={styles.leaveText}>Leave group</Text>
        </TouchableOpacity>
      )}

      {/* Dissolve group (leader only) */}
      {canDissolve && (
        <TouchableOpacity style={styles.leaveButton} onPress={handleDissolve}>
          <Text style={styles.leaveText}>Dissolve group</Text>
        </TouchableOpacity>
      )}

      {/* Save button (edit mode) */}
      {isEditMode && !saved && (
        <TouchableOpacity style={styles.saveButton} onPress={handleSave} disabled={saving}>
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.saveButtonText}>✓</Text>
          )}
        </TouchableOpacity>
      )}

      {/* Member profile modal */}
      <Modal
        visible={selectedMember !== null}
        animationType="slide"
        onRequestClose={() => setSelectedMember(null)}
      >
        <View style={styles.modalContainer}>
          <TouchableOpacity style={styles.backButton} onPress={() => setSelectedMember(null)}>
            <Text style={styles.backArrow}>←</Text>
          </TouchableOpacity>
          {selectedMember && <IndividualPost personId={selectedMember} />}
        </View>
      </Modal>

      {/* Leader-only member management popover */}
      <MemberManagement
        visible={managedMember !== null}
        member={managedMember}
        rect={manageRect}
        onMakeLeader={handleMakeLeader}
        onRemove={handleRemoveMember}
        onClose={() => setManagedMember(null)}
      />

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
    paddingBottom: 100,
  },

  // Only the standalone creation flow needs this — it clears the absolutely
  // positioned back button, since nothing else on screen provides top
  // clearance there. Every other usage is embedded under a screen (tab row,
  // list header) that already accounts for the status bar.
  contentWithBackButton: {
    paddingTop: 60,
  },

  // Shared card
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

  // Extra gap above the members card (beyond the shared card's 16) so it sits
  // clearly apart from the Q&A card above it.
  membersCard: {
    marginTop: 28,
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

  // Name
  nameContainer: {
    width: CARD_WIDTH,
    marginTop: 16,
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
    marginTop: 44,
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

  // Members — per-row padding (not card-level) so the crown below can sit
  // flush at right: 8 from the row's own border box, aligned with the
  // "..." buttons elsewhere on the card.
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    paddingHorizontal: 16,
  },

  memberCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#ccc',
    marginRight: 12,
  },

  memberName: {
    ...Type.body,
    color: '#000',
  },

  membersPlaceholder: {
    ...Type.label,
    fontFamily: FontFamily.regular,
    color: '#aaa',
    textAlign: 'center',
  },

  inviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
    paddingHorizontal: 16,
  },

  inviteLabel: {
    ...Type.label,
    color: '#555',
  },

  shareText: {
    ...Type.label,
    fontFamily: FontFamily.bold,
    color: '#43a047',
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

  // Leave group
  leaveButton: {
    marginTop: 32,
    alignSelf: 'center',
  },

  leaveText: {
    ...Type.bodyBold,
    color: '#e53935',
  },

  // Modal / back
  modalContainer: {
    flex: 1,
    backgroundColor: Palette.background,
  },

  backButton: {
    position: 'absolute',
    top: 60,
    left: 20,
    zIndex: 10,
  },

  backArrow: {
    fontSize: 28,
    color: '#000',
  },

});