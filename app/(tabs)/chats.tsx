import { StyleSheet, View, Text, ScrollView, ActivityIndicator } from 'react-native';
import { useState, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import GroupPost from '@/components/groupPost';
import { useActiveGroup } from '@/hooks/use-active-group';
import { fetchMatchedGroupIds } from '@/lib/fetchMatchedGroupIds';

export default function ChatsScreen() {

  const { activeGroupId } = useActiveGroup();
  const [matchedGroupIds, setMatchedGroupIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      if (!activeGroupId) {
        setMatchedGroupIds([]);
        setLoading(false);
        return;
      }
      fetchMatchedGroupIds(activeGroupId).then(ids => {
        setMatchedGroupIds(ids);
        setLoading(false);
      });
    }, [activeGroupId])
  );

  if (loading) {
    return <ActivityIndicator style={styles.loader} />;
  }

  if (matchedGroupIds.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>No matches yet.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {matchedGroupIds.map(id => (
        <GroupPost key={id} groupId={id} />
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
    fontSize: 18,
    color: '#555',
  },
});