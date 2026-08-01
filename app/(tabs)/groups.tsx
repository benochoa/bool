import {
  StyleSheet, View, Text, TouchableOpacity, Modal,
  ActivityIndicator, Alert, Animated, Dimensions
} from 'react-native';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigation } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import GroupPost, { GroupPostHandle } from '@/components/posts/groupPost';
import { GroupData } from '@/lib/fetchGroup';
import { ZoomRoot } from '@/components/posts/zoomOverlay';
import GroupSwitcher from '@/components/groups/groupSwitcher';
import JoinGroup from '@/components/groups/joinGroup';
import { ChevronDown } from '@/assets/symbols/ChevronDown';
import { ChevronLeft } from '@/assets/symbols/ChevronLeft';
import { Palette, Type } from '@/constants/theme';
import { useCurrentGroup } from '@/hooks/use-current-group';
import { useSession } from '@/hooks/use-session';
import { fetchGroupNames, GroupName } from '@/lib/fetchGroupNames';

// How far offscreen the editor rests — a full screen width to the right.
const WIDTH = Dimensions.get('window').width;

export default function GroupsScreen() {

  const { myGroupIds, loadingGroups, currentGroupId, setCurrentGroupId, refreshGroups } = useCurrentGroup();
  const { session } = useSession();

  // State
  const [creating, setCreating] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [groupNames, setGroupNames] = useState<GroupName[]>([]);
  const [joining, setJoining] = useState(false);
  const [editMode, setEditMode] = useState(false);
  // Set by the post on its first edit; leaving edit mode re-reads the saved
  // row, so anything unsaved is dropped unless it's saved on the way out.
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const postRef = useRef<GroupPostHandle>(null);
  // The row the read copy fetched, handed to the edit copy so it mounts
  // instantly instead of fetching the same group a second time.
  const [snapshot, setSnapshot] = useState<GroupData | null>(null);
  // Bumped after a save so the read copy underneath re-reads what was written.
  const [readKey, setReadKey] = useState(0);
  // Stays true through the slide-out, so the edit copy is still there to watch
  // leave; `editMode` alone would unmount it mid-animation.
  const [editorMounted, setEditorMounted] = useState(false);
  const slide = useRef(new Animated.Value(WIDTH)).current;

  useEffect(() => {
    if (editMode) setEditorMounted(true);
    Animated.timing(slide, {
      toValue: editMode ? 0 : WIDTH,
      duration: editMode ? 280 : 240,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && !editMode) setEditorMounted(false);
    });
  }, [editMode, slide]);

  // Editing takes over the whole screen: with the bar hidden there's no way to
  // leave the tab mid-edit, so unsaved work can't be stranded behind a switch.
  const navigation = useNavigation();
  useEffect(() => {
    navigation.setOptions({ tabBarStyle: editMode ? { display: 'none' } : undefined });
  }, [navigation, editMode]);

  // One query resolves every switcher name — the menu rows and the active
  // label both read from it.
  useEffect(() => {
    fetchGroupNames(myGroupIds).then(setGroupNames);
  }, [myGroupIds]);

  const currentGroup = groupNames.find(g => g.id === currentGroupId);
  const currentGroupName = currentGroup?.name ?? '';
  // Only the leader can edit, so only the leader gets a pencil. Reading it off
  // the switcher's data means no extra query and no wait on GroupPost's fetch.
  const isLeader = !!(session?.user && currentGroup?.created_by === session.user.id);

  async function handleSave() {
    setSaving(true);
    const saved = await postRef.current?.save();
    setSaving(false);
    // A failed save has already shown its own alert — stay in edit mode so the
    // edits aren't lost.
    if (saved) {
      setDirty(false);
      setEditMode(false);
      // The read copy underneath still holds the pre-save row, and it's about
      // to be the only thing on screen.
      setReadKey(k => k + 1);
      refreshGroups();
    }
  }

  function enterEditMode() {
    setDirty(false);
    setEditMode(true);
  }

  // Only reachable with unsaved edits — Done is inert until then, so there is
  // never a confirmation with nothing to confirm.
  function handleDone() {
    Alert.alert('Save changes?', undefined, [
      { text: 'Continue editing', style: 'cancel' },
      { text: 'Confirm', onPress: handleSave },
    ]);
  }

  function handleBack() {
    // Nothing to lose, so leave straight away.
    if (!dirty) { setEditMode(false); return; }
    Alert.alert('Discard changes?', undefined, [
      { text: 'Continue editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => { setDirty(false); setEditMode(false); } },
    ]);
  }

  // Refetch "my groups" every time this tab is focused, so joins/leaves made
  // elsewhere (or directly in Supabase) don't stay stale on screen.
  useFocusEffect(
    useCallback(() => {
      refreshGroups();
    }, [refreshGroups])
  );

  return (
    <View style={styles.container}>

      {/* Editing takes over the band entirely: the switcher would be a way out
          of the group mid-edit, and the name is editable in the post anyway. */}
      {editMode ? (
        <View style={styles.editBand}>
          <TouchableOpacity onPress={handleBack} hitSlop={8}>
            <ChevronLeft size={26} color="#000" />
          </TouchableOpacity>
          {saving ? (
            <ActivityIndicator size={24} color={Palette.confirm} />
          ) : (
            // Inert until there is something to save, which is what the grey
            // says — so Done never opens a confirmation over no changes.
            <TouchableOpacity onPress={handleDone} disabled={!dirty}>
              <Text style={[styles.doneText, !dirty && styles.doneTextIdle]}>Done</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        /* Current group switcher */
        <View style={styles.switcherWrap} pointerEvents="box-none">
          <TouchableOpacity style={styles.switcherButton} onPress={() => setSwitcherOpen(o => !o)}>
            <Text style={styles.switcherButtonText} numberOfLines={1}>{currentGroupName || 'Select a group'}</Text>
            <ChevronDown size={16} color="#000" />
          </TouchableOpacity>
        </View>
      )}

      <GroupSwitcher
        visible={switcherOpen}
        groups={groupNames}
        // Edit mode belongs to the group you were editing, so switching leaves it.
        onSelect={(id) => { setCurrentGroupId(id); setSwitcherOpen(false); setEditMode(false); setDirty(false); }}
        onCreate={() => { setSwitcherOpen(false); setCreating(true); }}
        onJoin={() => { setSwitcherOpen(false); setJoining(true); }}
        onClose={() => setSwitcherOpen(false)}
      />

      {/* My groups */}
      {loadingGroups ? (
        <ActivityIndicator style={styles.loader} />
      ) : myGroupIds.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>You are not in any groups yet. Create one or join your friends!</Text>
        </View>
      ) : (
        // The post owns the scrolling — wrapping it in a ScrollView of its own
        // would leave its inner one with nothing to scroll, and with no way to
        // bring a keyboard-covered card into view.
        <View style={styles.groupsList}>
          {/* The read copy stays mounted underneath, so the editor has
              something to slide over — and it's the one that fetches. */}
          {currentGroupId && (
            <GroupPost
              key={`${currentGroupId}-${readKey}`}
              groupId={currentGroupId}
              isMember
              topInset={100}
              onLoaded={setSnapshot}
              // Only the leader gets a pencil, so only the leader gets the toggle.
              onToggleEdit={isLeader ? enterEditMode : undefined}
              onLeft={() => { setEditMode(false); refreshGroups(); }}
              onDissolved={() => { setEditMode(false); refreshGroups(); }}
            />
          )}

          {editorMounted && currentGroupId && (
            <Animated.View
              style={[StyleSheet.absoluteFill, styles.editor, { transform: [{ translateX: slide }] }]}
            >
              <GroupPost
                ref={postRef}
                groupId={currentGroupId}
                isMember
                topInset={100}
                editMode
                initialData={snapshot}
                onDirty={() => setDirty(true)}
                onLeft={() => { setEditMode(false); refreshGroups(); }}
                onDissolved={() => { setEditMode(false); refreshGroups(); }}
              />
            </Animated.View>
          )}
        </View>
      )}

      {/* Join group modal */}
      <JoinGroup visible={joining} onClose={() => setJoining(false)} onJoined={refreshGroups} />

      {/* Create group modal */}
      <Modal visible={creating} animationType="slide" onRequestClose={() => setCreating(false)}>
        <ZoomRoot>
          <GroupPost creating onClose={() => { setCreating(false); refreshGroups(); }} />
        </ZoomRoot>
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({

  container: {
    flex: 1,
    backgroundColor: Palette.background,
  },

  loader: {
    flex: 1,
    alignSelf: 'center',
  },

  // Edit controls — the same 44pt band the switcher occupies, so nothing below
  // shifts when one replaces the other.
  editBand: {
    position: 'absolute',
    top: 60,
    left: 20,
    right: 20,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 3,
  },

  doneText: {
    ...Type.bodyBold,
    color: Palette.confirm,
  },

  doneTextIdle: {
    color: Palette.muted,
  },

  // Current group switcher
  switcherWrap: {
    position: 'absolute',
    top: 60,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 2,
  },

  switcherButton: {
    maxWidth: '80%',
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },

  switcherButtonText: {
    ...Type.title,
    color: '#000',
    flexShrink: 1,
  },

  // Empty state
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  emptyText: {
    ...Type.title,
    color: '#000',
    textAlign: 'center',
    paddingHorizontal: 40,
  },

  // Groups list
  groupsList: {
    flex: 1,
  },

  // Opaque, or the read copy underneath would show through it.
  editor: {
    backgroundColor: Palette.background,
  },

});
