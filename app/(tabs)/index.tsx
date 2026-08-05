import { CheckMark } from '@/assets/symbols/CheckMark';
import { ChevronLeft } from '@/assets/symbols/ChevronLeft';
import { PaperPlane } from '@/assets/symbols/PaperPlane';
import { XMark } from '@/assets/symbols/XMark';
import GroupPost from '@/components/posts/groupPost';
import GroupPostPreview from '@/components/posts/groupPostPreview';
import PersonPanel from '@/components/posts/personPanel';
import SlideOver from '@/components/ui/slideOver';
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
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

// Leads the Discover deck when it qualifies, ahead of the id ordering the
// feed otherwise follows.
const PINNED_GROUP_ID = 'Group-7';

export default function ExploreScreen() {

  const { session } = useSession();
  const { currentGroupId, loadingGroups } = useCurrentGroup();

  // State
  const [activeTab, setActiveTab] = useState<'Discover' | 'Pending'>('Discover');
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [allMembers, setAllMembers] = useState<GroupMemberRow[]>([]);
  const [seenGroupIds, setSeenGroupIds] = useState<Set<string>>(new Set());
  const [suggestions, setSuggestions] = useState<GroupSuggestion[]>([]);
  const [detail, setDetail] = useState<GroupSuggestion | null>(null);
  // A member's profile, opened from either post's members card. It belongs to
  // the screen so it covers the detail panel's own back chevron.
  const [openPersonId, setOpenPersonId] = useState<string | null>(null);
  const [receivedGroupIds, setReceivedGroupIds] = useState<string[]>([]);
  const [matchedGroupIds, setMatchedGroupIds] = useState<string[]>([]);
  const [isLeader, setIsLeader] = useState(false);
  const [loading, setLoading] = useState(true);
  // Identifies the newest refresh, so a slower earlier one can't overwrite it.
  const refreshRun = useRef(0);

  // Pulls everything this screen needs fresh from Supabase. Called on focus
  // (leaving/returning to the Explore tab) and again whenever the Discover/
  // Group/Sent sub-tab changes, since switching between those never triggers
  // a focus event — the screen itself never unmounts. Received/matched data
  // is fetched here too even though it has no tab of its own on this screen —
  // it's only used to keep already-related groups out of the Discover feed.
  const refreshAll = useCallback(() => {
    // Nothing is worth fetching until it's known which group we're acting as:
    // a run started with no group would filter against nobody's membership and
    // clear `loading` with an empty exclusion set, painting a card the real
    // data then removes.
    if (loadingGroups) return;

    // Supersedes any run still in flight. Focus and the sub-tab effect both
    // fire on mount, so runs do overlap, and the older one resolving last
    // would otherwise clobber the newer result.
    const run = ++refreshRun.current;

    // Everything the deck filters on has to land in one go. Clearing `loading`
    // as soon as the candidate list arrives paints a card that the exclusions
    // still in flight would have removed — which is why a different group used
    // to flash before the real one settled.
    const scoped: Promise<[GroupSuggestion[], string[], string[]]> = currentGroupId
      ? Promise.all([
          fetchGroupSuggestions(currentGroupId),
          fetchReceivedGroupIds(currentGroupId),
          fetchMatchedGroupIds(currentGroupId),
        ])
      : Promise.resolve([[], [], []]);

    Promise.all([fetchActiveGroupIds(), fetchAllGroupMembers(), scoped]).then(
      ([ids, members, [nextSuggestions, nextReceived, nextMatched]]) => {
        if (run !== refreshRun.current) return;
        setGroupIds(ids);
        setAllMembers(members);
        setSuggestions(nextSuggestions);
        setReceivedGroupIds(nextReceived);
        setMatchedGroupIds(nextMatched);
        setLoading(false);
      }
    );

    // Only gates the leader-only buttons, so it can settle on its own.
    if (currentGroupId && session?.user) {
      fetchGroup(currentGroupId).then(g => setIsLeader(g?.created_by === session.user.id));
    } else {
      setIsLeader(false);
    }
  }, [currentGroupId, session, loadingGroups]);

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

  // Live updates for the Pending feed, so a member's swipe, a leader's send,
  // or the other group's approval shows up without leaving the tab. Only the
  // suggestions are refetched: the Pending sections and the Discover feed's
  // "already related" exclusions both read from them, and nothing else on this
  // screen changes in response to your own group's outgoing suggestions.
  useEffect(() => {
    if (!currentGroupId) return;

    const channel = supabase
      .channel(`pending-${currentGroupId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'group_suggestions',
          filter: `suggesting_group_id=eq.${currentGroupId}`,
        },
        () => { fetchGroupSuggestions(currentGroupId).then(setSuggestions); }
      )
      .subscribe(status => console.log('[realtime] pending channel:', status));

    return () => { supabase.removeChannel(channel); };
  }, [currentGroupId]);

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

    const eligible = groupIds.filter(id => {
      if (alreadyRelated.has(id)) return false;
      const candidateMemberIds = allMembers.filter(m => m.groupId === id).map(m => m.personId);
      return !candidateMemberIds.some(personId => myMemberIds.has(personId));
    });

    // Pinned to the front, but only if it got through the filters above — it is
    // dealt like any other card otherwise. Everything else keeps the id order
    // the fetcher returns.
    return [
      ...eligible.filter(id => id === PINNED_GROUP_ID),
      ...eligible.filter(id => id !== PINNED_GROUP_ID),
    ];
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
  // The Pending feed in funnel order, each stage under its own heading — the
  // tints alone (colour, B&W, green) don't say which stage a tile is at. The
  // headings name who the stage is waiting on, so none of them repeats the
  // "Pending" tab they sit under.
  const pendingSections = [
    { label: 'Waiting on your leader...', items: suggestions.filter(s => s.status === 'pending') },
    { label: 'Waiting on them...', items: suggestions.filter(s => s.status === 'sent') },
    { label: "It's a match!", items: suggestions.filter(s => s.status === 'matched') },
  ];

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

  // loadingGroups too: until the acting-as group is known, the feed would be
  // filtered against nobody's membership and could even offer your own group.
  if (loading || loadingGroups) {
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
              <GroupPost groupId={currentCardGroupId} onSelectMember={setOpenPersonId} />

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

      {/* Pending feed — suggested (color), then sent (B&W), then matched */}
      {activeTab === 'Pending' && (
        <View style={styles.feedContainer}>
          {pendingSections.every(section => section.items.length === 0) ? (
            <>
              {tabRow}
              <View style={styles.doneContainer}>
                <Text style={styles.doneText}>Nothing here yet.</Text>
              </View>
            </>
          ) : (
            <ScrollView contentContainerStyle={styles.previewList}>
              {tabRow}
              {/* A heading only where there's something under it. Fragments, so
                  the tiles stay one flat column rather than nesting per stage. */}
              {pendingSections.map(section => section.items.length === 0 ? null : (
                <Fragment key={section.label}>
                  <Text style={styles.sectionLabel}>{section.label}</Text>
                  {section.items.map(s => (
                    <GroupPostPreview
                      key={s.targetGroupId}
                      groupName={s.groupName}
                      firstImageUrl={s.firstImageUrl}
                      suggesterPicUrl={s.suggestedByPicUrl}
                      tint={s.status === 'sent' ? 'bw' : s.status === 'matched' ? 'green' : undefined}
                      onPress={() => setDetail(s)}
                    />
                  ))}
                </Fragment>
              ))}
            </ScrollView>
          )}
        </View>
      )}

      {/* Detail panel — full group, with leader Send/Remove for pending items */}
      <SlideOver visible={detail !== null} onRequestClose={() => setDetail(null)}>
        <View style={styles.detailModal}>
          <TouchableOpacity style={styles.detailBack} onPress={() => setDetail(null)}>
            <ChevronLeft size={28} color="#000" />
          </TouchableOpacity>
          {detail && <GroupPost groupId={detail.targetGroupId} onSelectMember={setOpenPersonId} />}
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
      </SlideOver>

      {/* Last, so a member's profile covers the post that opened it. */}
      <PersonPanel personId={openPersonId} onClose={() => setOpenPersonId(null)} />

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

  // Heading over each stage of the Pending feed. Stretched across the feed and
  // inset by the tiles' own 20pt, so a heading and its cards share a left edge.
  sectionLabel: {
    ...Type.bodyBold,
    alignSelf: 'stretch',
    paddingHorizontal: 20,
    color: '#777',
    // The gap between sections is this plus the tile's own 16 below it, so 32
    // here doubles the 24 that separated them. The 8 underneath stays put —
    // widening it too would float the heading off its own cards.
    marginTop: 32,
    marginBottom: 8,
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
