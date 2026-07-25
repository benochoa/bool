import {
  StyleSheet, View, Text, TouchableOpacity, Modal, TextInput,
  ActivityIndicator, ScrollView
} from 'react-native';
import { useState, useEffect, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import GroupPost from '@/components/groupPost';
import GroupSwitcher from '@/components/groupSwitcher';
import { ChevronDown } from '@/assets/symbols/ChevronDown';
import { FontFamily, Palette, Type } from '@/constants/theme';
import { supabase } from '@/supabaseClient';
import { useSession } from '@/hooks/use-session';
import { useCurrentGroup } from '@/hooks/use-current-group';
import { fetchGroupNames, GroupName } from '@/lib/fetchGroupNames';

export default function GroupsScreen() {

  const { session } = useSession();
  const { myGroupIds, loadingGroups, currentGroupId, setCurrentGroupId, refreshGroups } = useCurrentGroup();

  // State
  const [creating, setCreating] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [groupNames, setGroupNames] = useState<GroupName[]>([]);
  const [joining, setJoining] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joinLoading, setJoinLoading] = useState(false);

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

  async function handleJoin() {
    const code = codeInput.trim().toUpperCase();
    if (!code || !session?.user) return;
    setJoinLoading(true);
    setJoinError(null);

    const { data, error } = await supabase
      .from('groups')
      .select('id')
      .eq('invite_code', code)
      .maybeSingle();
    if (error || !data) {
      setJoinLoading(false);
      setJoinError('Invalid code');
      return;
    }

    // ignoreDuplicates: redeeming a code for a group you're already in is a no-op.
    const { error: joinErr } = await supabase
      .from('group_members')
      .upsert(
        { group_id: data.id, person_id: session.user.id },
        { onConflict: 'group_id,person_id', ignoreDuplicates: true }
      );
    setJoinLoading(false);
    if (joinErr) {
      setJoinError('Could not join, try again');
      return;
    }

    setJoining(false);
    setCodeInput('');
    refreshGroups();
  }

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
        onJoin={() => { setSwitcherOpen(false); setJoinError(null); setJoining(true); }}
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
          {currentGroupId && <GroupPost groupId={currentGroupId} />}
        </ScrollView>
      )}

      {/* Join group modal */}
      <Modal visible={joining} transparent animationType="fade" onRequestClose={() => setJoining(false)}>
        <View style={styles.joinOverlay}>
          <View style={styles.joinCard}>
            <Text style={styles.joinTitle}>Join a group</Text>
            <TextInput
              style={styles.joinInput}
              placeholder="Invite code"
              placeholderTextColor="#aaa"
              value={codeInput}
              onChangeText={setCodeInput}
              autoCapitalize="characters"
              autoCorrect={false}
              autoFocus
            />
            {joinError && <Text style={styles.joinError}>{joinError}</Text>}
            <View style={styles.joinButtonRow}>
              <TouchableOpacity style={styles.joinCancelButton} onPress={() => { setJoining(false); setCodeInput(''); }}>
                <Text style={styles.joinCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.joinButton} onPress={handleJoin} disabled={joinLoading}>
                {joinLoading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.joinButtonText}>Join</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Create group modal */}
      <Modal visible={creating} animationType="slide" onRequestClose={() => setCreating(false)}>
        <GroupPost editable={true} onClose={() => { setCreating(false); refreshGroups(); }} />
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

  // Join modal
  joinOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  joinCard: {
    width: '80%',
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#ddd',
    padding: 20,
  },

  joinTitle: {
    ...Type.header,
    color: '#000',
    textAlign: 'center',
  },

  joinInput: {
    ...Type.header,
    fontFamily: FontFamily.regular,
    color: '#000',
    textAlign: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#ccc',
    marginTop: 16,
    paddingVertical: 6,
  },

  joinError: {
    ...Type.label,
    fontFamily: FontFamily.regular,
    color: '#e53935',
    textAlign: 'center',
    marginTop: 8,
  },

  joinButtonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 20,
  },

  joinCancelButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
  },

  joinCancelText: {
    ...Type.body,
    color: '#555',
  },

  joinButton: {
    minWidth: 80,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 20,
    backgroundColor: '#43a047',
    alignItems: 'center',
  },

  joinButtonText: {
    ...Type.bodyBold,
    color: '#fff',
  },

});
