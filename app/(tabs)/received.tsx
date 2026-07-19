import { StyleSheet, View, Text, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { useState, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import GroupPost from '@/components/groupPost';
import { fetchGroup } from '@/lib/fetchGroup';
import { fetchReceivedGroupIds } from '@/lib/fetchReceivedGroupIds';
import { FontFamily, Type } from '@/constants/theme';
import { useActiveGroup } from '@/hooks/use-active-group';
import { useSession } from '@/hooks/use-session';
import { supabase } from '@/supabaseClient';

export default function ReceivedScreen() {

  const { session } = useSession();
  const { activeGroupId } = useActiveGroup();

  const [receivedGroupIds, setReceivedGroupIds] = useState<string[]>([]);
  const [isLeader, setIsLeader] = useState(false);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      if (!activeGroupId) {
        setReceivedGroupIds([]);
        setIsLeader(false);
        setLoading(false);
        return;
      }
      fetchReceivedGroupIds(activeGroupId).then(ids => {
        setReceivedGroupIds(ids);
        setLoading(false);
      });
      if (session?.user) {
        fetchGroup(activeGroupId).then(g => setIsLeader(g?.created_by === session.user.id));
      }
    }, [activeGroupId, session])
  );

  async function handleApprove(suggestingGroupId: string) {
    if (!activeGroupId) return;
    const { error } = await supabase
      .from('group_suggestions')
      .update({ status: 'matched' })
      .eq('suggesting_group_id', suggestingGroupId)
      .eq('target_group_id', activeGroupId);
    if (!error) {
      setReceivedGroupIds(prev => prev.filter(id => id !== suggestingGroupId));
    }
  }

  async function handleReject(suggestingGroupId: string) {
    if (!activeGroupId) return;
    const { error } = await supabase
      .from('group_suggestions')
      .delete()
      .eq('suggesting_group_id', suggestingGroupId)
      .eq('target_group_id', activeGroupId);
    if (!error) {
      setReceivedGroupIds(prev => prev.filter(id => id !== suggestingGroupId));
    }
  }

  if (loading) {
    return <ActivityIndicator style={styles.loader} />;
  }

  if (receivedGroupIds.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>Nothing received yet.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {receivedGroupIds.map(id => (
        <View key={id}>
          <GroupPost groupId={id} />
          {isLeader && (
            <View style={styles.leaderButtonRow}>
              <TouchableOpacity style={styles.leaderXButton} onPress={() => handleReject(id)}>
                <Text style={styles.buttonText}>✕</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.leaderCheckButton} onPress={() => handleApprove(id)}>
                <Text style={styles.buttonText}>✓</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      ))}
    </ScrollView>
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
    backgroundColor: '#fff',
  },
  content: {
    paddingTop: 60,
    paddingBottom: 40,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  emptyText: {
    ...Type.header,
    fontFamily: FontFamily.regular,
    color: '#555',
  },
  leaderButtonRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 24,
    marginBottom: 24,
  },
  leaderXButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#e53935',
    alignItems: 'center',
    justifyContent: 'center',
  },
  leaderCheckButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#43a047',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    fontSize: 28,
    color: '#fff',
    fontWeight: 'bold',
  },
});