import {
  StyleSheet, View, Text, ScrollView, Dimensions,
  TouchableOpacity, Modal, ActivityIndicator, TextInput, Alert,
  KeyboardAvoidingView, Platform, Share
} from 'react-native';
import { Ref, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Image } from 'expo-image';
import FontAwesome6 from '@expo/vector-icons/FontAwesome6';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '@/supabaseClient';
import { Pencil } from '@/assets/symbols/Pencil';
import { FontFamily, Palette, Type } from '@/constants/theme';
import { useSession } from '@/hooks/use-session';
import { useKeyboardAwareScroll } from '@/hooks/use-keyboard-aware-scroll';
import { fetchGroup, GroupData } from '@/lib/fetchGroup';
import { leaveGroup } from '@/lib/leaveGroup';
import { dissolveGroup } from '@/lib/dissolveGroup';
import { removeMember } from '@/lib/removeMember';
import { makeGroupLeader } from '@/lib/makeGroupLeader';
import IndividualPost from './individualPost';
import MemberManagement, { MemberRect } from './memberManagement';
import ZoomableImage from './zoomableImage';
import CardReorder, { EDIT_CARD_HEIGHT, EDIT_CARD_WIDTH } from './cardReorder';
import { ZoomRoot } from './zoomOverlay';
import { snapToStandardAspect, DEFAULT_ASPECT } from '@/lib/aspectRatio';
import {
  CardSlot, DEFAULT_GROUP_CARD_ORDER, photoSlotsFromUrls, reconcileCardOrder,
  slotKey, toStoredCardOrder,
} from '@/lib/cardOrder';

const { width } = Dimensions.get('window');
const CARD_WIDTH = width - 40;
const PHOTO_SLOTS = 3;

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
        <View style={styles.crownWrap}>
          <FontAwesome6 name="crown" size={14} color="#000" solid />
        </View>
      )}
    </TouchableOpacity>
  );
}

// Lets the screen that owns the edit pencil drive the save from its own menu.
export interface GroupPostHandle {
  // Resolves true only if the group actually saved.
  save: () => Promise<boolean>;
}

interface Props {
  groupId?: string;
  // The creation flow — no group row yet, so it is permanently in edit mode.
  creating?: boolean;
  // The leader's view/edit toggle on an existing group. View mode renders
  // straight from the fetched row, so the leader sees what everyone else sees.
  editMode?: boolean;
  onClose?: () => void;
  // Set when the viewer is a member of this group (i.e. viewed from the groups
  // tab, not explore) — surfaces Leave (non-leaders) or Dissolve (the leader).
  isMember?: boolean;
  onLeft?: () => void;
  onDissolved?: () => void;
  // Fired on the first edit of a session so the screen owning `editMode` knows
  // to offer Save/Discard on the way out.
  onDirty?: () => void;
  // Passed only where the viewer may edit — its presence is what puts the
  // pencil beside the name, so Discover never shows one.
  onToggleEdit?: () => void;
  // Top clearance for a screen whose own header floats over this post (the
  // groups tab's switcher band). It belongs to the scrolled content, so the
  // post keeps scrolling under that header — and the post keeps owning its
  // scroll view, which is what lets it scroll a focused card into view.
  topInset?: number;
  ref?: Ref<GroupPostHandle>;
}

export default function GroupPost({ groupId, creating = false, editMode = false, onClose, isMember = false, onLeft, onDissolved, onDirty, onToggleEdit, topInset, ref }: Props) {

  const { session } = useSession();

  // State - read mode
  const [data, setData] = useState<GroupData | null>(null);
  const [loading, setLoading] = useState(!creating);
  const [selectedMember, setSelectedMember] = useState<string | null>(null);
  // Leader-only member popover (opened by long-pressing a member row).
  const [managedMember, setManagedMember] = useState<{ id: string; name: string; profilePicUrl: string | null } | null>(null);
  const [manageRect, setManageRect] = useState<MemberRect | null>(null);
  // Each photo's own aspect ratio (snapped to a standard), indexed by photo
  // slot. Null until picked / first loaded.
  const [photoAspects, setPhotoAspects] = useState<(number | null)[]>([null, null, null]);

  // State - editable mode
  const [groupName, setGroupName] = useState('');
  const [photos, setPhotos] = useState<(string | null)[]>([null, null, null]);
  const [questions, setQuestions] = useState<string[]>(['', '', '']);
  const [answers, setAnswers] = useState<string[]>(['', '', '']);
  const [cardOrder, setCardOrder] = useState<CardSlot[]>(DEFAULT_GROUP_CARD_ORDER);
  const [saving, setSaving] = useState(false);

  // Keeps the Q&A card you tapped fully above the keyboard.
  const { scrollRef, onScroll, reveal, spacerHeight } = useKeyboardAwareScroll();
  const qaCards = useRef<Record<number, View | null>>({});
  const [saved, setSaved] = useState(false);

  // Creation is always editing; on a saved group, only the leader can turn edit
  // mode on — and `isLeader` is the authority, so a stale `editMode` from the
  // screen above can never grant rights the viewer doesn't have.
  const isLeader = !!(session?.user && data?.created_by && data.created_by === session.user.id);
  const isEditMode = creating || (isLeader && editMode);
  // A member who didn't create the group can leave it; the leader dissolves it
  // instead. Exactly one of these shows, since a viewer is leader XOR not.
  const canLeave = isMember && !isLeader && !!data;
  const canDissolve = isMember && isLeader && !!data;

  // Fetch data (existing group) or questions (creation). `editMode` is
  // deliberately not a dependency: toggling it must not refetch, which would
  // wipe any edits in progress.
  useEffect(() => {
    if (creating) {
      fetchRandomGroupQuestions().then(qs => setQuestions(qs));
    } else if (groupId) {
      // The same instance can be reused for another group (explore feed), so
      // clear the previous group's data — which would otherwise flash on
      // screen until the fetch lands — before loading the next.
      setData(null);
      setLoading(true);
      setPhotoAspects([null, null, null]);
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
  }, [groupId, creating, session]);

  // Pre-fill the edit form from fetched data; also used by Cancel to discard edits.
  function prefillFromData(d: GroupData) {
    setGroupName(d.name);
    setPhotos(photoSlotsFromUrls(d.imageUrls, PHOTO_SLOTS));
    setCardOrder(reconcileCardOrder(d.cardOrder, DEFAULT_GROUP_CARD_ORDER));
    setQuestions(d.qa.map(item => item.question));
    setAnswers(d.qa.map(item => item.answer));
  }

  // Photo slots in the order their cards appear in the post.
  function photoSlotOrder(): number[] {
    return cardOrder.filter(s => s.type === 'photo').map(s => s.index);
  }

  function handleReorder(next: CardSlot[]) {
    setCardOrder(next);
    onDirty?.();
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
      // slot number — cards can be rearranged, so slot 2 may well be the photo
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

  // Reports success so the screen driving the pencil menu only leaves edit
  // mode once the group is actually saved.
  useImperativeHandle(ref, () => ({ save: handleSave }));

  async function handleSave(): Promise<boolean> {
    if (!groupName.trim()) {
      Alert.alert('Missing name', 'Please enter a group name.');
      return false;
    }
    setSaving(true);
    const qa = questions.map((q, i) => ({ question: q, answer: answers[i] }));

    // Leader editing an existing group
    if (isLeader && groupId) {
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
        const response = await fetch(uri);
        const arrayBuffer = await response.arrayBuffer();
        const path = `${groupId}/img${i + 1}.jpg`;
        const { error } = await supabase.storage
          .from('groups')
          .upload(path, arrayBuffer, { contentType: 'image/jpeg', upsert: true });
        if (error) {
          setSaving(false);
          Alert.alert('Photo upload failed', error.message);
          return false;
        }
        imageUrls.push(supabase.storage.from('groups').getPublicUrl(path).data.publicUrl + '?v=' + Date.now());
      }

      const { error } = await supabase
        .from('groups')
        .update({
          name: groupName.trim(), qa, image_urls: imageUrls,
          card_order: toStoredCardOrder(cardOrder),
        })
        .eq('id', groupId);
      if (error) {
        setSaving(false);
        Alert.alert('Save failed', error.message);
        return false;
      }

      // Re-prefill so saved photos pick up their new ?v= URLs — and so view
      // mode, which reads `data`, doesn't show the pre-save row.
      const fresh = await fetchGroup(groupId);
      setData(fresh);
      if (fresh) prefillFromData(fresh);
      setSaving(false);
      return true;
    }

    // Creation
    const newGroupId = await getNextGroupId();

    const imageUrls: string[] = [];
    for (const i of photoSlotOrder()) {
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
      card_order: toStoredCardOrder(cardOrder),
      status: 'active',
    });
    if (error) {
      setSaving(false);
      Alert.alert('Save failed', error.message);
      return false;
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
    return true;
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

  // View mode — full-width cards, straight from the fetched row, nothing
  // tappable. Photos resolve through their filename, exactly as edit mode does,
  // so a saved card order means the same thing to the leader and to visitors.
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
    const item = data?.qa[slot.index];
    if (!item) return null;
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
    return <ActivityIndicator style={styles.loader} />;
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
      contentContainerStyle={[
        styles.content,
        creating && onClose && styles.contentWithBackButton,
        topInset !== undefined && { paddingTop: topInset },
      ]}
      keyboardShouldPersistTaps="handled"
    >

      {/* Back arrow (creation flow) */}
      {creating && onClose && (
        <TouchableOpacity style={styles.backButton} onPress={onClose}>
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
      )}

      {/* Name — no card box */}
      <View style={styles.nameContainer}>
        {isEditMode ? (
          <TextInput
            style={styles.nameInput}
            placeholder="Group name"
            placeholderTextColor="#aaa"
            value={groupName}
            onChangeText={text => { setGroupName(text); onDirty?.(); }}
          />
        ) : (
          <Text style={styles.name}>{data?.name}</Text>
        )}
        {onToggleEdit && isLeader && (
          // The ✓ is gone in edit mode, so the spinner is the only sign a save
          // is running.
          saving ? (
            <ActivityIndicator size={24} color="#43a047" style={styles.editButton} />
          ) : (
            <TouchableOpacity style={styles.editButton} onPress={onToggleEdit}>
              <Pencil size={27.6} color={editMode ? '#43a047' : '#000'} />
            </TouchableOpacity>
          )
        )}
      </View>

      {/* Photos & Q&A — a vertical stack in the group's saved card order. Each
          photo keeps its own snapped aspect ratio. View mode is inert and shows
          only what exists; edit mode drops each card into a drag-to-reorder
          slot, marks photos with a pencil badge, and swaps the answers for
          always-mounted inputs, whose underline is the affordance. */}
      {isEditMode ? (
        <CardReorder order={cardOrder} onReorder={handleReorder} renderCard={renderEditCard} />
      ) : (
        cardOrder.map(renderViewCard)
      )}

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
                  // Managing members is an edit, so it lives in edit mode —
                  // and never on yourself.
                  if (!isEditMode || !session?.user || m.id === session.user.id) return;
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

      {/* Save button — only for creation, which has no pencil to save from.
          When editing an existing group the pencil's menu owns Save/Discard. */}
      {creating && !saved && (
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
        <ZoomRoot>
        <View style={styles.modalContainer}>
          <TouchableOpacity style={styles.backButton} onPress={() => setSelectedMember(null)}>
            <Text style={styles.backArrow}>←</Text>
          </TouchableOpacity>
          {selectedMember && <IndividualPost personId={selectedMember} standalone />}
        </View>
        </ZoomRoot>
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

      {/* Room for the focused card to rise above the keyboard. */}
      <View style={{ height: spacerHeight }} />

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

  // Members card box — rows carry their own horizontal padding, so the crown
  // can sit flush at the card edge without the box clipping it.
  card: {
    width: CARD_WIDTH,
    backgroundColor: '#fff',
    borderRadius: 8,
    marginTop: 16,
    overflow: 'hidden',
    paddingVertical: 16,
  },

  // Extra gap above the members card (beyond the shared card's 20) so it sits
  // clearly apart from the Q&A card above it.
  membersCard: {
    marginTop: 32,
  },

  // Name — left-aligned, with the pencil on its right.
  nameContainer: {
    width: CARD_WIDTH,
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  // The view-mode text carries the input's box model with an invisible rule,
  // so toggling modes swaps the underline in without shifting the layout.
  name: {
    ...Type.title,
    color: '#000',
    flex: 1,
    textAlign: 'left',
    borderBottomWidth: 1,
    borderBottomColor: 'transparent',
    paddingVertical: 4,
  },

  nameInput: {
    ...Type.title,
    color: '#000',
    flex: 1,
    textAlign: 'left',
    borderBottomWidth: 1,
    borderBottomColor: '#ccc',
    paddingVertical: 4,
  },

  // Pinned to the far right of the row, so it lines up with the cards' right
  // edge. Sized to the icon (27.6 grows to 30.4 with the disc's padding) so the
  // disc sits flush and layout doesn't depend on edit state.
  editButton: {
    width: 30.4,
    height: 30.4,
    alignItems: 'center',
    justifyContent: 'center',
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

  // Leader crown — pinned to the row's right edge, in line with the name.
  crownWrap: {
    position: 'absolute',
    right: 18,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
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