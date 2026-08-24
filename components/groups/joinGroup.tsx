import {
  ActivityIndicator, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View
} from 'react-native';
import { useState } from 'react';
import { FontFamily, Type } from '@/constants/theme';
import { supabase } from '@/supabaseClient';
import { useSession } from '@/hooks/use-session';

interface Props {
  visible: boolean;
  onClose: () => void;
  // The group just joined, so the caller can switch to it.
  onJoined: (groupId: string) => void;
}

export default function JoinGroup({ visible, onClose, onJoined }: Props) {
  const { session } = useSession();

  const [codeInput, setCodeInput] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joinLoading, setJoinLoading] = useState(false);

  function close() {
    setCodeInput('');
    setJoinError(null);
    onClose();
  }

  async function handleJoin() {
    const code = codeInput.trim().toUpperCase();
    if (!code || !session?.user) return;
    setJoinLoading(true);
    setJoinError(null);

    // Looking the group up by code and joining it are one server-side step now.
    // Matching on the column needs permission to read it, and a code any client
    // can read is one every client can harvest — so neither half happens here.
    // The function still upserts rather than inserts, so redeeming a code for a
    // group you left reactivates that row: leaving isn't a one-way door.
    const { data: joinedGroupId, error } = await supabase.rpc('join_group_by_code', {
      p_code: code,
    });
    setJoinLoading(false);
    if (error || !joinedGroupId) {
      setJoinError('Invalid code');
      return;
    }

    setCodeInput('');
    onJoined(joinedGroupId as string);
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
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
            <TouchableOpacity style={styles.joinCancelButton} onPress={close}>
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
  );
}

const styles = StyleSheet.create({
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