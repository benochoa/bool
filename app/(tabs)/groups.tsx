import {
  StyleSheet, View, Text, TouchableOpacity, Modal,
  ActivityIndicator, ScrollView
} from 'react-native';
import { useState, useEffect, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import GroupPost from '@/components/posts/groupPost';
import { ZoomRoot } from '@/components/posts/zoomOverlay';
import GroupSwitcher from '@/components/groups/groupSwitcher';
import JoinGroup from '@/components/groups/joinGroup';
import { ChevronDown } from '@/assets/symbols/ChevronDown';
import { Palette, Type } from '@/constants/theme';
import { useCurrentGroup } from '@/hooks/use-current-group';
import { fetchGroupNames, GroupName } from '@/lib/fetchGroupNames';

export default function GroupsScreen() {

  const { myGroupIds, loadingGroups, currentGroupId, setCurrentGroupId, refreshGroups } = useCurrentGroup();

  // State
  const [creating, setCreating] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [groupNames, setGroupNames] = useState<GroupName[]>([]);
  const [joining, setJoining] = useState(false);

  // One query resolves every switcher name — the menu rows and the active
  // label both read from it.
  useEffect(() => {
    fetchGroupNames(myGroupIds).then(setGroupNames);
  }, [myGroupIds]);

  const currentGroupName = groupNames.find(g => g.id === currentGroupId)?.name ?? '';

  // Refetch "my groups" every time this tab is focused, so joins/leaves made
  // elsewhere (or directly in Supabase) don't stay stale on screen.
  useFocusEffect(
    useCallback(() => {
      refreshGroups();
    }, [refreshGroups])
  );

  return (
    <View style={styles.container}>

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
        onSelect={(id) => { setCurrentGroupId(id); setSwitcherOpen(false); }}
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
        <ScrollView style={styles.groupsList} contentContainerStyle={styles.groupsListContent}>
          {currentGroupId && <GroupPost groupId={currentGroupId} isMember onLeft={refreshGroups} onDissolved={refreshGroups} />}
        </ScrollView>
      )}

      {/* Join group modal */}
      <JoinGroup visible={joining} onClose={() => setJoining(false)} onJoined={refreshGroups} />

      {/* Create group modal */}
      <Modal visible={creating} animationType="slide" onRequestClose={() => setCreating(false)}>
        <ZoomRoot>
          <GroupPost editable={true} onClose={() => { setCreating(false); refreshGroups(); }} />
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

  groupsListContent: {
    // Clears the absolute +/switcher band (60–104pt) so the group name lands
    // at the same height as on the explore tab, for leaders and members alike.
    paddingTop: 100,
    paddingBottom: 40,
  },

});
