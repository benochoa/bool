import GroupPost from '@/components/groupPost';
import { useActiveGroup } from '@/hooks/use-active-group';
import { useSession } from '@/hooks/use-session';
import { fetchAllGroupIds } from '@/lib/fetchAllGroupIds';
import { fetchAllGroupMembers, GroupMemberRow } from '@/lib/fetchAllGroupMembers';
import { fetchGroup } from '@/lib/fetchGroup';
import { fetchGroupSuggestions } from '@/lib/fetchGroupSuggestions';
import { fetchMatchedGroupIds } from '@/lib/fetchMatchedGroupIds';
import { fetchReceivedGroupIds } from '@/lib/fetchReceivedGroupIds';
import { supabase } from '@/supabaseClient';
import { FontFamily, Type } from '@/constants/theme';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface FeedSuggestion {
  targetGroupId: string;
  suggestedByName: string;
  status: 'pending' | 'sent' | 'matched';
}

export default function ExploreScreen() {

  const { session } = useSession();
  const { activeGroupId } = useActiveGroup();

  // State
  const [activeTab, setActiveTab] = useState<'Personal' | 'Group' | 'Sent'>('Personal');
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [allMembers, setAllMembers] = useState<GroupMemberRow[]>([]);
  const [seenGroupIds, setSeenGroupIds] = useState<Set<string>>(new Set());
  const [suggestions, setSuggestions] = useState<FeedSuggestion[]>([]);
  const [receivedGroupIds, setReceivedGroupIds] = useState<string[]>([]);
  const [matchedGroupIds, setMatchedGroupIds] = useState<string[]>([]);
  const [isLeader, setIsLeader] = useState(false);
  const [loading, setLoading] = useState(true);

  // Pulls everything this screen needs fresh from Supabase. Called on focus
  // (leaving/returning to the Explore tab) and again whenever the Personal/
  // Group/Sent sub-tab changes, since switching between those never triggers
  // a focus event — the screen itself never unmounts. Received/matched data
  // is fetched here too even though it has no tab of its own on this screen —
  // it's only used to keep already-related groups out of the Personal feed.
  const refreshAll = useCallback(() => {
    Promise.all([fetchAllGroupIds(), fetchAllGroupMembers()]).then(([ids, members]) => {
      setGroupIds(ids);
      setAllMembers(members);
      setLoading(false);
    });

    if (!activeGroupId) {
      setSuggestions([]);
      setReceivedGroupIds([]);
      setMatchedGroupIds([]);
      setIsLeader(false);
      return;
    }

    fetchGroupSuggestions(activeGroupId).then(setSuggestions);

    fetchReceivedGroupIds(activeGroupId).then(setReceivedGroupIds);
    fetchMatchedGroupIds(activeGroupId).then(setMatchedGroupIds);

    if (session?.user) {
      fetchGroup(activeGroupId).then(g => setIsLeader(g?.created_by === session.user.id));
    }
  }, [activeGroupId, session]);

  // Refetch on focus (switching to Explore from another tab)...
  useFocusEffect(
    useCallback(() => {
      refreshAll();
    }, [refreshAll])
  );

  // ...and again whenever the sub-tab changes, since that never triggers focus.
  useEffect(() => {
    refreshAll();
  }, [activeTab, refreshAll]);

  // Groups a candidate should be hidden for: already suggested by my group,
  // already shares a member with my group (this also hides my own group,
  // since its members are by definition 100% of "my group's members"),
  // already reached me (Received), or already matched with me.
  const feedGroupIds = useMemo(() => {
    const myMemberIds = new Set(
      allMembers.filter(m => m.groupId === activeGroupId).map(m => m.personId)
    );
    const alreadyRelated = new Set([
      ...suggestions.map(s => s.targetGroupId),
      ...receivedGroupIds,
      ...matchedGroupIds,
    ]);

    return groupIds.filter(id => {
      if (alreadyRelated.has(id)) return false;
      const candidateMemberIds = allMembers.filter(m => m.groupId === id).map(m => m.personId);
      return !candidateMemberIds.some(personId => myMemberIds.has(personId));
    });
  }, [groupIds, allMembers, suggestions, receivedGroupIds, matchedGroupIds, activeGroupId]);

  // Cards already acted on this session (checked or X'd) but not yet reflected
  // in feedGroupIds (a background refetch is what actually removes a checked
  // card from feedGroupIds — this local set keeps the deck from re-showing or
  // skipping past cards in the meantime, since it's keyed by group id rather
  // than a position that shifts whenever feedGroupIds is recomputed).
  const remainingGroupIds = useMemo(
    () => feedGroupIds.filter(id => !seenGroupIds.has(id)),
    [feedGroupIds, seenGroupIds]
  );
  const currentGroupId = remainingGroupIds[0];

  // Restart the deck whenever the active group changes — the filtered list means something different now.
  useEffect(() => {
    setSeenGroupIds(new Set());
  }, [activeGroupId]);

  // Actions
  async function handleCheck() {
    const targetGroupId = currentGroupId;
    setSeenGroupIds(prev => new Set(prev).add(targetGroupId));

    if (!activeGroupId || !session?.user) return;
    await supabase.from('group_suggestions').insert({
      suggesting_group_id: activeGroupId,
      target_group_id: targetGroupId,
      suggested_by: session.user.id,
    });
  }

  function handleX() {
    setSeenGroupIds(prev => new Set(prev).add(currentGroupId));
  }

  // Leader-only actions on a Group-feed card
  async function handleLeaderSend(targetGroupId: string) {
    if (!activeGroupId) return;
    const { error } = await supabase
      .from('group_suggestions')
      .update({ status: 'sent' })
      .eq('suggesting_group_id', activeGroupId)
      .eq('target_group_id', targetGroupId);
    if (!error) {
      setSuggestions(prev => prev.map(s => s.targetGroupId === targetGroupId ? { ...s, status: 'sent' } : s));
      // The target group may already have a stale, still-pending suggestion
      // of us sitting in their own Group feed — this just made that redundant.
      await supabase
        .from('group_suggestions')
        .delete()
        .eq('suggesting_group_id', targetGroupId)
        .eq('target_group_id', activeGroupId)
        .eq('status', 'pending');
    }
  }

  async function handleLeaderRemove(targetGroupId: string) {
    if (!activeGroupId) return;
    const { error } = await supabase
      .from('group_suggestions')
      .delete()
      .eq('suggesting_group_id', activeGroupId)
      .eq('target_group_id', targetGroupId);
    if (!error) {
      setSuggestions(prev => prev.filter(s => s.targetGroupId !== targetGroupId));
    }
  }

  // Derived
  const done = remainingGroupIds.length === 0;
  const groupFeedItems = suggestions.filter(s => s.status === 'pending');
  const sentFeedItems = suggestions.filter(s => s.status === 'sent');

  // Tab row (reused in all three feeds)
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

      <TouchableOpacity
        style={[styles.tabButton, activeTab === 'Sent' && styles.tabButtonActive]}
        onPress={() => setActiveTab('Sent')}
      >
        <Text style={[styles.tabText, activeTab === 'Sent' && styles.tabTextActive]}>Sent</Text>
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
              <GroupPost groupId={currentGroupId} />

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
          {groupFeedItems.length === 0 ? (
            <>
              {tabRow}
              <View style={styles.doneContainer}>
                <Text style={styles.doneText}>No checked groups yet.</Text>
              </View>
            </>
          ) : (
            <ScrollView>

              {/* Personal / Group / Sent toggle - scrolls off with content */}
              {tabRow}

              {groupFeedItems.map((s, i) => (
                <View key={i}>
                  <GroupPost groupId={s.targetGroupId} />
                  <Text style={styles.recommendedText}>Recommended by {s.suggestedByName}</Text>
                  {isLeader && (
                    <View style={styles.leaderButtonRow}>
                      <TouchableOpacity style={styles.leaderXButton} onPress={() => handleLeaderRemove(s.targetGroupId)}>
                        <Text style={styles.buttonText}>✕</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.leaderCheckButton} onPress={() => handleLeaderSend(s.targetGroupId)}>
                        <Text style={styles.buttonText}>✓</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      )}

      {/* Sent feed — view only, for everyone */}
      {activeTab === 'Sent' && (
        <View style={styles.feedContainer}>
          {sentFeedItems.length === 0 ? (
            <>
              {tabRow}
              <View style={styles.doneContainer}>
                <Text style={styles.doneText}>Nothing sent yet.</Text>
              </View>
            </>
          ) : (
            <ScrollView>

              {/* Personal / Group / Sent toggle - scrolls off with content */}
              {tabRow}

              {sentFeedItems.map((s, i) => (
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
    ...Type.label,
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
    ...Type.header,
    fontFamily: FontFamily.regular,
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
    ...Type.label,
    color: '#555',
    textAlign: 'center',
    marginBottom: 16,
  },

  // Leader-only check/X on a Group-feed card
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

});
