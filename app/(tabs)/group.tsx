import {
  StyleSheet, View, Text, TouchableOpacity, Modal, TextInput,
  ActivityIndicator, ScrollView
} from 'react-native';
import { useState, useEffect, useCallback } from 'react';
import GroupPost from '@/components/groupPost';
import { supabase } from '@/supabaseClient';
import { useSession } from '@/hooks/use-session';
import { fetchMyGroupIds } from '@/lib/fetchMyGroupIds';

export default function GroupScreen() {

  const { session, loading: sessionLoading } = useSession();

  // State
  const [menuOpen, setMenuOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [myGroupIds, setMyGroupIds] = useState<string[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(true);
  const [joining, setJoining] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joinLoading, setJoinLoading] = useState(false);

  const refreshGroups = useCallback(() => {
    if (sessionLoading) return;
    if (!session?.user) {
      setMyGroupIds([]);
      setLoadingGroups(false);
      return;
    }
    fetchMyGroupIds(session.user.id).then(ids => {
      setMyGroupIds(ids);
      setLoadingGroups(false);
    });
  }, [session, sessionLoading]);

  useEffect(() => {
    refreshGroups();
  }, [refreshGroups]);

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

      {/* Green circle button */}
      <TouchableOpacity style={styles.addButton} onPress={() => setMenuOpen(o => !o)}>
        <Text style={styles.addButtonText}>+</Text>
      </TouchableOpacity>

      {/* Dropdown menu */}
      {menuOpen && (
        <View style={styles.menu}>
          <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuOpen(false); setJoinError(null); setJoining(true); }}>
            <Text style={styles.menuText}>Join a group</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuOpen(false); setCreating(true); }}>
            <Text style={styles.menuText}>Create a group</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* My groups */}
      {loadingGroups ? (
        <ActivityIndicator style={styles.loader} />
      ) : myGroupIds.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>You are not in any groups yet. Create one or join your friends!</Text>
        </View>
      ) : (
        <ScrollView style={styles.groupsList} contentContainerStyle={styles.groupsListContent}>
          {myGroupIds.map(id => (
            <GroupPost key={id} groupId={id} />
          ))}
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
    backgroundColor: '#fff',
  },

  loader: {
    flex: 1,
    alignSelf: 'center',
  },

  // Green circle
  addButton: {
    position: 'absolute',
    top: 60,
    left: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#43a047',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },

  addButtonText: {
    fontSize: 28,
    color: '#fff',
    lineHeight: 32,
  },

  // Dropdown
  menu: {
    position: 'absolute',
    top: 112,
    left: 20,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
    zIndex: 2,
  },

  menuItem: {
    paddingVertical: 12,
    paddingHorizontal: 20,
  },

  menuText: {
    fontSize: 16,
    color: '#000',
  },

  // Empty state
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  emptyText: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#000',
    textAlign: 'center',
    paddingHorizontal: 40,
  },

  // Groups list
  groupsList: {
    flex: 1,
  },

  groupsListContent: {
    paddingTop: 60,
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
    fontSize: 18,
    fontWeight: 'bold',
    color: '#000',
    textAlign: 'center',
  },

  joinInput: {
    fontSize: 18,
    color: '#000',
    textAlign: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#ccc',
    marginTop: 16,
    paddingVertical: 6,
  },

  joinError: {
    fontSize: 14,
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
    fontSize: 16,
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
    fontSize: 16,
    color: '#fff',
    fontWeight: 'bold',
  },

});
