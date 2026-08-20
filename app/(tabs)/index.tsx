import { CheckMark } from '@/assets/symbols/CheckMark';
import { ChevronLeft } from '@/assets/symbols/ChevronLeft';
import { PaperPlane } from '@/assets/symbols/PaperPlane';
import { XMark } from '@/assets/symbols/XMark';
import GroupPost from '@/components/posts/groupPost';
import GroupPostPreview from '@/components/posts/groupPostPreview';
import PersonPanel from '@/components/posts/personPanel';
import ActionSheet from '@/components/ui/actionSheet';
import ReportSheet from '@/components/ui/reportSheet';
import { PostSkeleton, SkeletonList, TileSkeleton } from '@/components/ui/skeleton';
import SlideOver from '@/components/ui/slideOver';
import { useAppResume } from '@/hooks/use-app-resume';
import { useCurrentGroup } from '@/hooks/use-current-group';
import { useSession } from '@/hooks/use-session';
import { ActiveGroup, fetchActiveGroups } from '@/lib/fetchActiveGroups';
import { fetchAllGroupMembers, GroupMemberRow } from '@/lib/fetchAllGroupMembers';
import { fetchGroup, GroupData } from '@/lib/fetchGroup';
import { fetchGroupSuggestions, GroupSuggestion } from '@/lib/fetchGroupSuggestions';
import { fetchMatchedGroupIds } from '@/lib/fetchMatchedGroupIds';
import { fetchReceivedGroupIds } from '@/lib/fetchReceivedGroupIds';
import { ReportTarget } from '@/lib/submitReport';
import { supabase } from '@/supabaseClient';
import { FontFamily, Palette, Type } from '@/constants/theme';
import { useFocusEffect } from '@react-navigation/native';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

// Leads the For You deck when it qualifies, ahead of the id ordering the
// feed otherwise follows.
const PINNED_GROUP_ID = 'Group-7';

export default function ExploreScreen() {

  const { session } = useSession();
  const { currentGroupId, loadingGroups } = useCurrentGroup();

  // State
  const [activeTab, setActiveTab] = useState<'ForYou' | 'Pending'>('ForYou');
  const [activeGroups, setActiveGroups] = useState<ActiveGroup[]>([]);
  // The city of the group we're acting as — the deck only offers its own city.
  const [myCity, setMyCity] = useState<string | null>(null);
  const [allMembers, setAllMembers] = useState<GroupMemberRow[]>([]);
  const [seenGroupIds, setSeenGroupIds] = useState<Set<string>>(new Set());
  const [suggestions, setSuggestions] = useState<GroupSuggestion[]>([]);
  const [detail, setDetail] = useState<GroupSuggestion | null>(null);
  // A member's profile, opened from either post's members card. It belongs to
  // the screen so it covers the detail panel's own back chevron.
  const [openPersonId, setOpenPersonId] = useState<string | null>(null);
  const [reporting, setReporting] = useState<ReportTarget | null>(null);
  // The group whose dots were tapped — null when the sheet is closed. Shared by
  // both feeds, since only one post is ever on screen.
  const [actionsFor, setActionsFor] = useState<string | null>(null);
  const [receivedGroupIds, setReceivedGroupIds] = useState<string[]>([]);
  const [matchedGroupIds, setMatchedGroupIds] = useState<string[]>([]);
  const [isLeader, setIsLeader] = useState(false);
  const [loading, setLoading] = useState(true);
  // Identifies the newest refresh, so a slower earlier one can't overwrite it.
  const refreshRun = useRef(0);

  // Pulls everything this screen needs fresh from Supabase. Called on focus
  // (leaving/returning to the Explore tab) and again whenever the For You/
  // Pending sub-tab changes, since switching between those never triggers
  // a focus event — the screen itself never unmounts. Received/matched data
  // is fetched here too even though it has no tab of its own on this screen —
  // it's only used to keep already-related groups out of the For You feed.
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
    // My own group is fetched here rather than on its own now that the deck
    // filters on its city: settling separately would clear `loading` with no
    // city yet and paint a card from another town before the filter arrived.
    // The leader flag comes off the same row, so it costs no extra request.
    const scoped: Promise<[GroupSuggestion[], string[], string[], GroupData | null]> = currentGroupId
      ? Promise.all([
          fetchGroupSuggestions(currentGroupId),
          fetchReceivedGroupIds(currentGroupId),
          fetchMatchedGroupIds(currentGroupId),
          fetchGroup(currentGroupId),
        ])
      : Promise.resolve([[], [], [], null]);

    Promise.all([fetchActiveGroups(), fetchAllGroupMembers(), scoped]).then(
      ([groups, members, [nextSuggestions, nextReceived, nextMatched, myGroup]]) => {
        if (run !== refreshRun.current) return;
        setActiveGroups(groups);
        setAllMembers(members);
        setSuggestions(nextSuggestions);
        setReceivedGroupIds(nextReceived);
        setMatchedGroupIds(nextMatched);
        setMyCity(myGroup?.identifiers.city ?? null);
        setIsLeader(!!(session?.user && myGroup?.created_by === session.user.id));
        setLoading(false);
      }
    );
  }, [currentGroupId, session, loadingGroups]);

  // Refetch on focus (switching to Explore from another tab)...
  useFocusEffect(
    useCallback(() => {
      refreshAll();
    }, [refreshAll])
  );

  // ...and on resume, which focus never sees: the deck's exclusions come from
  // the channel, and anything it missed while backgrounded would leave a group
  // swipeable that a member has already acted on.
  useAppResume(refreshAll);

  // ...and again whenever the sub-tab changes, since that never triggers focus.
  useEffect(() => {
    refreshAll();
  }, [activeTab, refreshAll]);

  // Live updates for the Pending feed, so a member's swipe, a leader's send,
  // or the other group's approval shows up without leaving the tab. Both
  // directions are listened for, and a filter takes one condition, so each
  // needs its own listener — the outgoing rows drive Pending and the deck's
  // "already suggested" exclusion, the incoming ones drive its "already
  // reached me" exclusion.
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
      // Without this the deck kept offering a group that had just suggested to
      // us: Received and the tab badge both light up for the row, but the feed
      // only learned of it on the next focus — a wide enough window to swipe
      // back and create the reciprocal suggestion the exclusion exists to stop.
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'group_suggestions',
          filter: `target_group_id=eq.${currentGroupId}`,
        },
        () => { fetchReceivedGroupIds(currentGroupId).then(setReceivedGroupIds); }
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

    // Compared loosely, since rows saved before the city list was fixed can
    // still differ in case. A candidate with no city is out — it isn't known
    // to be here. My own group having none drops the filter entirely, though:
    // an older group shouldn't face an empty deck with nothing explaining it.
    const myCityKey = myCity?.trim().toLowerCase() ?? null;

    const eligible = activeGroups
      .filter(g => !myCityKey || g.city?.trim().toLowerCase() === myCityKey)
      .map(g => g.id)
      .filter(id => {
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
  }, [activeGroups, myCity, allMembers, suggestions, receivedGroupIds, matchedGroupIds, currentGroupId]);

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
  // tints alone (colour, B&W) don't say which stage a tile is at. The headings
  // name who the stage is waiting on, so neither repeats the "Pending" tab they
  // sit under. Matched suggestions have left this feed entirely — they live in
  // Chats now.
  const pendingSections = [
    {
      label: 'Waiting on your leader...',
      items: suggestions.filter(s => s.status === 'pending'),
      empty: 'No groups suggested by your friends',
    },
    {
      label: 'Waiting on them...',
      items: suggestions.filter(s => s.status === 'sent'),
      empty: 'No match requests sent yet',
    },
  ];

  // Tab row (reused in all three feeds)
  const tabRow = (
    <View style={styles.tabRow}>
      <TouchableOpacity
        style={styles.tabButton}
        onPress={() => setActiveTab('ForYou')}
      >
        <Text style={[styles.tabText, activeTab === 'ForYou' && styles.tabTextActive]}>For You</Text>
      </TouchableOpacity>

      <Text style={styles.tabDivider}>|</Text>

      <TouchableOpacity
        style={styles.tabButton}
        onPress={() => setActiveTab('Pending')}
      >
        {/* The badge hangs off the word, so it's anchored to a wrapper drawn
            tight around it rather than to the button's padded box. Read from
            the same list the Pending feed renders, so the two can't disagree. */}
        <View>
          <Text style={[styles.tabText, activeTab === 'Pending' && styles.tabTextActive]}>Pending</Text>
          {pendingSections[0].items.length > 0 && (
            <View style={styles.pendingBadge}>
              <Text style={styles.pendingBadgeText}>{pendingSections[0].items.length}</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    </View>
  );

  // loadingGroups too: until the acting-as group is known, the feed would be
  // filtered against nobody's membership and could even offer your own group.
  if (loading || loadingGroups) {
    return (
      <View style={styles.container}>
        <View style={styles.feedContainer}>
          {tabRow}
          {activeTab === 'ForYou' ? (
            <PostSkeleton topInset={10} />
          ) : (
            <View style={styles.previewList}>
              <SkeletonList count={3}>{i => <TileSkeleton key={i} />}</SkeletonList>
            </View>
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>

      {/* For You feed */}
      {activeTab === 'ForYou' && (
        <View style={styles.feedContainer}>

          {/* For You / Pending toggle */}
          {tabRow}

          {done ? (
            <View style={styles.doneContainer}>
              <Text style={styles.doneText}>You've seen all groups!</Text>
            </View>
          ) : (
            <>
              {/* 10 + the card's own 16 is the same 26 every tab leaves under
                  its header. */}
              <GroupPost groupId={currentCardGroupId} topInset={10} onSelectMember={setOpenPersonId} onOpenActions={setActionsFor} />

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

      {/* Pending feed — suggested (color), then sent (B&W) */}
      {activeTab === 'Pending' && (
        <View style={styles.feedContainer}>
          <ScrollView contentContainerStyle={styles.previewList}>
            {tabRow}
            {/* Both headings render even with nothing under them, so the two
                stages stay discoverable on an empty feed. Fragments, so the
                tiles stay one flat column rather than nesting per stage. */}
            {pendingSections.map((section, i) => (
              <Fragment key={section.label}>
                <Text style={[styles.sectionLabel, i > 0 && styles.sectionLabelStacked]}>{section.label}</Text>
                {section.items.length === 0 ? (
                  <Text style={styles.sectionEmpty}>{section.empty}</Text>
                ) : section.items.map(s => (
                  // The ring only reddens on the pile waiting on your leader —
                  // a sent one is off your hands, which the greying says too.
                  <GroupPostPreview
                    key={s.targetGroupId}
                    groupName={s.groupName}
                    firstImageUrl={s.firstImageUrl}
                    suggesterPicUrl={s.suggestedByPicUrl}
                    tint={s.status === 'sent' ? 'bw' : undefined}
                    alertRing={s.status === 'pending'}
                    onPress={() => setDetail(s)}
                  />
                ))}
              </Fragment>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Detail panel — full group, with leader Send/Remove for pending items */}
      <SlideOver visible={detail !== null} onRequestClose={() => setDetail(null)}>
        <View style={styles.detailModal}>
          <TouchableOpacity style={styles.detailBack} onPress={() => setDetail(null)}>
            <ChevronLeft size={28} color="#000" />
          </TouchableOpacity>
          {detail && <GroupPost groupId={detail.targetGroupId} onSelectMember={setOpenPersonId} onOpenActions={setActionsFor} />}
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

      {/* Screen level, so its tint covers the detail panel's own back chevron. */}
      <ActionSheet
        visible={actionsFor !== null}
        actions={[{
          label: 'Report group',
          onPress: () => {
            const groupId = actionsFor;
            setActionsFor(null);
            if (groupId) setReporting({ type: 'group', groupId });
          },
        }]}
        onClose={() => setActionsFor(null)}
      />

      <ReportSheet target={reporting} onClose={() => setReporting(null)} />

    </View>
  );
}

const styles = StyleSheet.create({

  // Page layout
  container: {
    flex: 1,
    backgroundColor: Palette.background,
  },

  // Discover / Pending toggle
  // Occupies the same 60 + 44 band the other tabs give their titles, so the
  // toggle sits at their height and the content under all four starts level.
  tabRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 60,
    height: 104,
  },

  previewList: {
    alignItems: 'center',
    paddingBottom: 40,
  },

  // Heading over each stage of the Pending feed. Stretched across the feed and
  // inset by the tiles' own 20pt, so a heading and its cards share a left edge.
  sectionLabel: {
    fontFamily: FontFamily.bold,
    fontSize: 20,
    alignSelf: 'stretch',
    paddingHorizontal: 20,
    color: '#000',
    // Only the first heading uses this — the stacked one below overrides it —
    // so it's the tab's header gap, the same 26 the other three now leave. The
    // 8 underneath stays put: widening it would float the heading off its own
    // cards.
    marginTop: 26,
    marginBottom: 8,
  },

  // Every heading but the first opens a stage that follows another one, so it
  // needs a bigger break above it than the first needs below the tab row.
  sectionLabelStacked: {
    marginTop: 64,
  },

  // Stands in for the tiles of an empty stage: smaller than the heading above
  // it, greyed and centred so it reads as an absence rather than another
  // heading. Kept to one compact line — reserving a full tile's height twice
  // over would push the second stage off-screen. The wide margin below keeps
  // the next heading from crowding it, since there's no tile in between.
  sectionEmpty: {
    fontFamily: FontFamily.regular,
    fontSize: 16,
    alignSelf: 'stretch',
    textAlign: 'center',
    color: '#777',
    // Split rather than shared: with the heading's own 8 above it, 44 here puts
    // 52 between the two — near double the 28 they sat at — so an empty stage
    // reads as a gap where tiles would be rather than as a subtitle. Below it
    // stays at the 20 it was, since the wide margin under that already spaces
    // the next heading.
    paddingTop: 44,
    paddingBottom: 20,
    marginBottom: 64,
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

  // Count of suggestions waiting on the leader, sitting just past the word's
  // last letter on its midline. Absolute rather than a row beside the text, so
  // the tab row doesn't jump sideways when the count appears or clears; the
  // half-height negative margin is what centres it against `top: 50%`.
  pendingBadge: {
    position: 'absolute',
    top: '50%',
    marginTop: -11,
    right: -28,
    height: 22,
    minWidth: 22,
    borderRadius: 11,
    paddingHorizontal: 5,
    backgroundColor: '#FF3B30',
    alignItems: 'center',
    justifyContent: 'center',
  },

  pendingBadgeText: {
    fontFamily: FontFamily.bold,
    fontSize: 13,
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
