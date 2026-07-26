import { CheckMark } from '@/assets/symbols/CheckMark';
import { PaperPlane } from '@/assets/symbols/PaperPlane';
import { XMark } from '@/assets/symbols/XMark';
import GroupPost from '@/components/posts/groupPost';
import GroupPostPreview from '@/components/posts/groupPostPreview';
import { useCurrentGroup } from '@/hooks/use-current-group';
import { useSession } from '@/hooks/use-session';
import { fetchActiveGroupIds } from '@/lib/fetchActiveGroupIds';
import { fetchAllGroupMembers, GroupMemberRow } from '@/lib/fetchAllGroupMembers';
import { fetchGroup } from '@/lib/fetchGroup';
import { fetchGroupSuggestions, GroupSuggestion } from '@/lib/fetchGroupSuggestions';
import { fetchMatchedGroupIds } from '@/lib/fetchMatchedGroupIds';
import { fetchReceivedGroupIds } from '@/lib/fetchReceivedGroupIds';
import { supabase } from '@/supabaseClient';
import { FontFamily, Palette, Type } from '@/constants/theme';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export default function ExploreScreen() {

  const { session } = useSession();
  const { currentGroupId } = useCurrentGroup();

  // State
  const [activeTab, setActiveTab] = useState<'Discover' | 'Pending'>('Discover');
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [allMembers, setAllMembers] = useState<GroupMemberRow[]>([]);
  const [seenGroupIds, setSeenGroupIds] = useState<Set<string>>(new Set());
  const [suggestions, setSuggestions] = useState<GroupSuggestion[]>([]);
  const [detail, setDetail] = useState<GroupSuggestion | null>(null);
  const [receivedGroupIds, setReceivedGroupIds] = useState<string[]>([]);
  const [matchedGroupIds, setMatchedGroupIds] = useState<string[]>([]);
  const [isLeader, setIsLeader] = useState(false);
  const [loading, setLoading] = useState(true);

  // Pulls everything this screen needs fresh from Supabase. Called on focus
  // (leaving/returning to the Explore tab) and again whenever the Discover/
  // Group/Sent sub-tab changes, since switching between those never triggers
  // a focus event — the screen itself never unmounts. Received/matched data
  // is fetched here too even though it has no tab of its own on this screen —
  // it's only used to keep already-related groups out of the Discover feed.
  const refreshAll = useCallback(() => {
    Promise.all([fetchActiveGroupIds(), fetchAllGroupMembers()]).then(([ids, members]) => {
      setGroupIds(ids);
      setAllMembers(members);
      setLoading(false);
    });

    if (!currentGroupId) {
      setSuggestions([]);
      setReceivedGroupIds([]);
      setMatchedGroupIds([]);
      setIsLeader(false);
      return;
    }

    fetchGroupSuggestions(currentGroupId).then(setSuggestions);

    fetchReceivedGroupIds(currentGroupId).then(setReceivedGroupIds);
    fetchMatchedGroupIds(currentGroupId).then(setMatchedGroupIds);

    if (session?.user) {
      fetchGroup(currentGroupId).then(g => setIsLeader(g?.created_by === session.user.id));
    }
  }, [currentGroupId, session]);

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
      allMembers.filter(m => m.groupId === currentGroupId).map(m => m.personId)
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
  }, [groupIds, allMembers, suggestions, receivedGroupIds, matchedGroupIds, currentGroupId]);

  // Cards already acted on this session (checked or X'd) but not yet reflected
  // in feedGroupIds (a background refetch is what actually removes a checked
  // card from feedGroupIds — this local set keeps the deck from re-showing or
  // skipping past cards in the meantime, since it's keyed by group id rather
  // than a position that shifts whenever feedGroupIds is recomputed).
  const remainingGroupIds = useMemo(
    () => feedGroupIds.filter(id => !seenGroupIds.has(id)),
    [feedGroupIds, seenGroupIds]
  );
  const currentCardGroupId = remainingGroupIds[0];

  // Restart the deck whenever the current group changes — the filtered list means something different now.
  useEffect(() => {
    setSeenGroupIds(new Set());
  }, [currentGroupId]);

  // Actions
  async function handleCheck() {
    const targetGroupId = currentCardGroupId;
    setSeenGroupIds(prev => new Set(prev).add(targetGroupId));

    if (!currentGroupId || !session?.user) return;
    await supabase.from('group_suggestions').insert({
      suggesting_group_id: currentGroupId,
      target_group_id: targetGroupId,
      suggested_by: session.user.id,
    });
  }

  function handleX() {
    setSeenGroupIds(prev => new Set(prev).add(currentCardGroupId));
  }

  // Leader-only actions on a Group-feed card
  async function handleLeaderSend(targetGroupId: string) {
    if (!currentGroupId) return;
    const { error } = await supabase
      .from('group_suggestions')
      .update({ status: 'sent' })
      .eq('suggesting_group_id', currentGroupId)
      .eq('target_group_id', targetGroupId);
    if (!error) {
      setSuggestions(prev => prev.map(s => s.targetGroupId === targetGroupId ? { ...s, status: 'sent' } : s));
      // The target group may already have a stale, still-pending suggestion
      // of us sitting in their own Group feed — this just made that redundant.
      await supabase
        .from('group_suggestions')
        .delete()
        .eq('suggesting_group_id', targetGroupId)
        .eq('target_group_id', currentGroupId)
        .eq('status', 'pending');
    }
  }

  async function handleLeaderRemove(targetGroupId: string) {
    if (!currentGroupId) return;
    const { error } = await supabase
      .from('group_suggestions')
      .delete()
      .eq('suggesting_group_id', currentGroupId)
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
        style={styles.tabButton}
        onPress={() => setActiveTab('Discover')}
      >
        <Text style={[styles.tabText, activeTab === 'Discover' && styles.tabTextActive]}>Discover</Text>
      </TouchableOpacity>

      <Text style={styles.tabDivider}>|</Text>

      <TouchableOpacity
        style={styles.tabButton}
        onPress={() => setActiveTab('Pending')}
      >
        <Text style={[styles.tabText, activeTab === 'Pending' && styles.tabTextActive]}>Pending</Text>
      </TouchableOpacity>
    </View>
  );

  if (loading) {
    return <ActivityIndicator style={styles.loader} />;
  }

  return (
    <View style={styles.container}>

      {/* Discover feed */}
      {activeTab === 'Discover' && (
        <View style={styles.feedContainer}>

          {/* Discover / Pending toggle */}
          {tabRow}

          {done ? (
            <View style={styles.doneContainer}>
              <Text style={styles.doneText}>You've seen all groups!</Text>
            </View>
          ) : (
            <>
              <GroupPost groupId={currentCardGroupId} />

              {/* Check / X buttons */}
              <View style={styles.buttonRow}>
                <TouchableOpacity style={styles.xButton} onPress={handleX}>
                  <XMark />
                </TouchableOpacity>
                <TouchableOpacity style={styles.checkButton} onPress={handleCheck}>
                  <CheckMark />
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      )}

      {/* Pending feed — suggested (color) on top, sent (B&W) below */}
      {activeTab === 'Pending' && (
        <View style={styles.feedContainer}>
          {groupFeedItems.length === 0 && sentFeedItems.length === 0 ? (
            <>
              {tabRow}
              <View style={styles.doneContainer}>
                <Text style={styles.doneText}>Nothing here yet.</Text>
              </View>
            </>
          ) : (
            <ScrollView contentContainerStyle={styles.previewList}>
              {tabRow}
              {[...groupFeedItems, ...sentFeedItems].map(s => (
                <GroupPostPreview
                  key={s.targetGroupId}
                  groupName={s.groupName}
                  firstImageUrl={s.firstImageUrl}
                  suggesterPicUrl={s.suggestedByPicUrl}
                  sent={s.status === 'sent'}
                  onPress={() => setDetail(s)}
                />
              ))}
            </ScrollView>
          )}
        </View>
      )}

      {/* Detail modal — full group, with leader Send/Remove for pending items */}
      <Modal visible={detail !== null} animationType="slide" onRequestClose={() => setDetail(null)}>
        <View style={styles.detailModal}>
          <TouchableOpacity style={styles.detailBack} onPress={() => setDetail(null)}>
            <Text style={styles.detailBackArrow}>←</Text>
          </TouchableOpacity>
          {detail && <GroupPost groupId={detail.targetGroupId} />}
          {detail?.status === 'pending' && isLeader && (
            <View style={styles.modalLeaderRow}>
              <TouchableOpacity style={styles.xButton} onPress={() => { handleLeaderRemove(detail.targetGroupId); setDetail(null); }}>
                <XMark />
              </TouchableOpacity>
              <TouchableOpacity style={styles.checkButton} onPress={() => { handleLeaderSend(detail.targetGroupId); setDetail(null); }}>
                <PaperPlane />
              </TouchableOpacity>
            </View>
          )}
        </View>
      </Modal>

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
    backgroundColor: Palette.background,
  },

  // Discover / Pending toggle
  tabRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 8,
  },

  previewList: {
    alignItems: 'center',
    paddingBottom: 40,
  },

  tabButton: {
    paddingVertical: 7,
    paddingHorizontal: 20,
  },

  // Just the words — the active tab is heavily bold, the other is regular.
  tabText: {
    fontFamily: FontFamily.regular,
    fontSize: 24,
    color: '#000',
  },

  tabTextActive: {
    fontFamily: FontFamily.bold,
  },

  tabDivider: {
    fontFamily: FontFamily.regular,
    fontSize: 24,
    color: '#ccc',
    alignSelf: 'center',
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
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },

  checkButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },

  // Detail modal (opened by tapping a preview)
  detailModal: {
    flex: 1,
    backgroundColor: Palette.background,
    paddingTop: 100,
  },

  detailBack: {
    position: 'absolute',
    top: 60,
    left: 20,
    zIndex: 10,
  },

  detailBackArrow: {
    fontSize: 28,
    color: '#000',
  },

  // Leader-only Send/Remove, floating at the bottom of the detail modal
  modalLeaderRow: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 24,
  },

});
