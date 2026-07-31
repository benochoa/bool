import {
  StyleSheet, View, Text, TouchableOpacity, Modal,
  ActivityIndicator, Alert
} from 'react-native';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import GroupPost, { GroupPostHandle } from '@/components/posts/groupPost';
import { ZoomRoot } from '@/components/posts/zoomOverlay';
import GroupSwitcher from '@/components/groups/groupSwitcher';
import JoinGroup from '@/components/groups/joinGroup';
import { ChevronDown } from '@/assets/symbols/ChevronDown';
import { Palette, Type } from '@/constants/theme';
import { useCurrentGroup } from '@/hooks/use-current-group';
import { useSession } from '@/hooks/use-session';
import { fetchGroupNames, GroupName } from '@/lib/fetchGroupNames';

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
  const postRef = useRef<GroupPostHandle>(null);

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
    // The post shows its own spinner in place of the pencil while this runs.
    const saved = await postRef.current?.save();
    // A failed save has already shown its own alert — stay in edit mode so the
    // edits aren't lost.
    if (saved) { setDirty(false); setEditMode(false); }
  }

  function toggleEditMode() {
    if (!editMode) { setDirty(false); setEditMode(true); return; }
    // Nothing to save, so no need to ask.
    if (!dirty) { setEditMode(false); return; }
    Alert.alert('Done editing?', undefined, [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Save changes', onPress: handleSave },
      { text: 'Discard changes', style: 'destructive', onPress: () => { setDirty(false); setEditMode(false); } },
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

      {/* The edit pencil lives beside the name inside the post, so it scrolls
          away with the content rather than sitting in this band. */}

      {/* Current group switcher */}
      <View style={styles.switcherWrap} pointerEvents="box-none">
        <TouchableOpacity style={styles.switcherButton} onPress={() => setSwitcherOpen(o => !o)}>
          <Text style={styles.switcherButtonText} numberOfLines={1}>{currentGroupName || 'Select a group'}</Text>
          <ChevronDown size={16} color="#000" />
        </TouchableOpacity>
      </View>

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
          {currentGroupId && (
            <GroupPost
              ref={postRef}
              groupId={currentGroupId}
              isMember
              topInset={100}
              editMode={editMode}
              onDirty={() => setDirty(true)}
              // Only the leader gets a pencil, so only the leader gets the toggle.
              onToggleEdit={isLeader ? toggleEditMode : undefined}
              onLeft={() => { setEditMode(false); refreshGroups(); }}
              onDissolved={() => { setEditMode(false); refreshGroups(); }}
            />
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

});
