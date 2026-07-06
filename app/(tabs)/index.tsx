import { StyleSheet, View, Text, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import GroupPost from '@/components/groupPost';
import { fetchAllGroupIds } from '@/lib/fetchAllGroupIds';
import { fetchAllGroupMembers, GroupMemberRow } from '@/lib/fetchAllGroupMembers';
import { fetchGroupSuggestions } from '@/lib/fetchGroupSuggestions';
import { fetchPerson } from '@/lib/fetchPerson';
import { useActiveGroup } from '@/hooks/use-active-group';
import { useSession } from '@/hooks/use-session';
import { supabase } from '@/supabaseClient';

interface FeedSuggestion {
  targetGroupId: string;
  suggestedByName: string;
}

export default function ExploreScreen() {

  const { session } = useSession();
  const { activeGroupId } = useActiveGroup();

  // State
  const [activeTab, setActiveTab] = useState<'Personal' | 'Group'>('Personal');
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [allMembers, setAllMembers] = useState<GroupMemberRow[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [suggestions, setSuggestions] = useState<FeedSuggestion[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch all group IDs and the full membership graph — on mount, and again
  // every time this tab is focused, so external changes aren't left stale.
  useFocusEffect(
    useCallback(() => {
      Promise.all([fetchAllGroupIds(), fetchAllGroupMembers()]).then(([ids, members]) => {
        setGroupIds(ids);
        setAllMembers(members);
        setLoading(false);
      });
    }, [])
  );

  // Load the active group's suggestions — needed both to filter the Personal
  // feed and to render the Group feed. Refetches on focus too, same reason.
  useFocusEffect(
    useCallback(() => {
      if (!activeGroupId) {
        setSuggestions([]);
        return;
      }
      fetchGroupSuggestions(activeGroupId).then(async rows => {
        const withNames = await Promise.all(rows.map(async row => {
          const person = await fetchPerson(row.suggestedBy);
          return { targetGroupId: row.targetGroupId, suggestedByName: person?.name ?? '...' };
        }));
        setSuggestions(withNames);
      });
    }, [activeGroupId])
  );

  // Groups a candidate should be hidden for: already suggested by my group,
  // or already shares a member with my group (this also hides my own group,
  // since its members are by definition 100% of "my group's members").
  const feedGroupIds = useMemo(() => {
    const myMemberIds = new Set(
      allMembers.filter(m => m.groupId === activeGroupId).map(m => m.personId)
    );
    const alreadySuggested = new Set(suggestions.map(s => s.targetGroupId));

    return groupIds.filter(id => {
      if (alreadySuggested.has(id)) return false;
      const candidateMemberIds = allMembers.filter(m => m.groupId === id).map(m => m.personId);
      return !candidateMemberIds.some(personId => myMemberIds.has(personId));
    });
  }, [groupIds, allMembers, suggestions, activeGroupId]);

  // Restart the deck whenever the active group changes — the filtered list means something different now.
  useEffect(() => {
    setCurrentIndex(0);
  }, [activeGroupId]);

  // Actions
  async function handleCheck() {
    const targetGroupId = feedGroupIds[currentIndex];
    setCurrentIndex(i => i + 1);

    if (!activeGroupId || !session?.user) return;
    await supabase.from('group_suggestions').insert({
      suggesting_group_id: activeGroupId,
      target_group_id: targetGroupId,
      suggested_by: session.user.id,
    });
  }

  function handleX() {
    setCurrentIndex(i => i + 1);
  }

  // Derived
  const done = currentIndex >= feedGroupIds.length;

  // Tab row (reused in both feeds)
  const tabRow = (
    <View style={styles.tabRow}>
      <TouchableOpacity
        style={[styles.tabButton, activeTab === 'Personal' && styles.tabButtonActive]}
        onPress={() => setActiveTab('Personal')}
      >
        <Text style={[styles.tabText, activeTab === 'Personal' && styles.tabTextActive]}>Personal</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.tabButton, activeTab === 'Group' && styles.tabButtonActive]}
        onPress={() => setActiveTab('Group')}
      >
        <Text style={[styles.tabText, activeTab === 'Group' && styles.tabTextActive]}>Group</Text>
      </TouchableOpacity>
    </View>
  );

  if (loading) {
    return <ActivityIndicator style={styles.loader} />;
  }

  return (
    <View style={styles.container}>

      {/* Personal feed */}
      {activeTab === 'Personal' && (
        <View style={styles.feedContainer}>

          {/* Personal / Group toggle */}
          {tabRow}

          {done ? (
            <View style={styles.doneContainer}>
              <Text style={styles.doneText}>You've seen all groups!</Text>
            </View>
          ) : (
            <>
              <GroupPost groupId={feedGroupIds[currentIndex]} />

              {/* Check / X buttons */}
              <View style={styles.buttonRow}>
                <TouchableOpacity style={styles.xButton} onPress={handleX}>
                  <Text style={styles.buttonText}>✕</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.checkButton} onPress={handleCheck}>
                  <Text style={styles.buttonText}>✓</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      )}

      {/* Group feed */}
      {activeTab === 'Group' && (
        <View style={styles.feedContainer}>
          {suggestions.length === 0 ? (
            <>
              {tabRow}
              <View style={styles.doneContainer}>
                <Text style={styles.doneText}>No checked groups yet.</Text>
              </View>
            </>
          ) : (
            <ScrollView>

              {/* Personal / Group toggle - scrolls off with content */}
              {tabRow}

              {suggestions.map((s, i) => (
                <View key={i}>
                  <GroupPost groupId={s.targetGroupId} />
                  <Text style={styles.recommendedText}>Recommended by {s.suggestedByName}</Text>
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      )}

    </View>
  );
}

const styles = StyleSheet.create({

  loader: {
    flex: 1,
    alignSelf: 'center',
    marginTop: 100,
  },

  // Page layout
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },

  // Personal / Group toggle
  tabRow: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 8,
  },

  tabButton: {
    paddingVertical: 7,
    paddingHorizontal: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#ccc',
  },

  tabButtonActive: {
    backgroundColor: '#000',
    borderColor: '#000',
  },

  tabText: {
    fontSize: 15,
    color: '#000',
  },

  tabTextActive: {
    color: '#fff',
  },

  feedContainer: {
    flex: 1,
    width: '100%',
  },

  doneContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  doneText: {
    fontSize: 18,
    color: '#555',
  },

  buttonRow: {
    position: 'absolute',
    bottom: 32,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 48,
  },

  xButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#e53935',
    alignItems: 'center',
    justifyContent: 'center',
  },

  checkButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#43a047',
    alignItems: 'center',
    justifyContent: 'center',
  },

  buttonText: {
    fontSize: 28,
    color: '#fff',
    fontWeight: 'bold',
  },

  recommendedText: {
    fontSize: 14,
    color: '#555',
    textAlign: 'center',
    marginBottom: 16,
  },

});
