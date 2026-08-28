import { CheckMark } from '@/assets/symbols/CheckMark';
import { ChevronLeft } from '@/assets/symbols/ChevronLeft';
import { XMark } from '@/assets/symbols/XMark';
import DiscussionSheet from '@/components/chats/discussionSheet';
import ImageViewer, { ViewerImage } from '@/components/chats/imageViewer';
import GroupPost from '@/components/posts/groupPost';
import GroupPostPreview from '@/components/posts/groupPostPreview';
import PersonPanel from '@/components/posts/personPanel';
import ActionSheet from '@/components/ui/actionSheet';
import ReportSheet from '@/components/ui/reportSheet';
import { SkeletonList, TileSkeleton } from '@/components/ui/skeleton';
import SlideOver from '@/components/ui/slideOver';
import { FontFamily, Palette, Type } from '@/constants/theme';
import { useAppResume } from '@/hooks/use-app-resume';
import { useCurrentGroup } from '@/hooks/use-current-group';
import { useSession } from '@/hooks/use-session';
import { fetchDiscussionUnreadCounts } from '@/lib/fetchDiscussionUnreadCounts';
import { fetchGroup } from '@/lib/fetchGroup';
import { fetchReceivedGroups, ReceivedGroup } from '@/lib/fetchReceivedGroups';
import { ReportTarget } from '@/lib/submitReport';
import { supabase } from '@/supabaseClient';
import { useFocusEffect } from '@react-navigation/native';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { FLOATING_TOP, HEADER_TOP, LEADER_ROW_BOTTOM } from '@/constants/layout';

export default function ReceivedScreen() {

  const { session } = useSession();
  const { currentGroupId } = useCurrentGroup();

  const [received, setReceived] = useState<ReceivedGroup[]>([]);
  const [detail, setDetail] = useState<ReceivedGroup | null>(null);
  // A member's profile, opened from the post's members card. It belongs to the
  // screen so it covers the detail panel's own back chevron.
  const [openPersonId, setOpenPersonId] = useState<string | null>(null);
  const [reporting, setReporting] = useState<ReportTarget | null>(null);
  // The group whose dots were tapped — null when the sheet is closed.
  const [actionsFor, setActionsFor] = useState<string | null>(null);
  const [isLeader, setIsLeader] = useState(false);
  const [loading, setLoading] = useState(true);
  // The group whose discussion is open, and the unread count behind each tile's
  // badge, keyed by the group being discussed.
  const [discussing, setDiscussing] = useState<ReceivedGroup | null>(null);
  const [unread, setUnread] = useState<Map<string, number>>(new Map());
  // A photo opened from inside a discussion, shown over everything.
  const [viewerImage, setViewerImage] = useState<ViewerImage | null>(null);

  const refresh = useCallback(() => {
    if (!currentGroupId) {
      setReceived([]);
      setIsLeader(false);
      setUnread(new Map());
      setLoading(false);
      return;
    }
    fetchReceivedGroups(currentGroupId).then(items => {
      setReceived(items);
      setLoading(false);
    });
    fetchDiscussionUnreadCounts(currentGroupId).then(setUnread);
    if (session?.user) {
      fetchGroup(currentGroupId).then(g => setIsLeader(g?.created_by === session.user.id));
    }
  }, [currentGroupId, session]);

  useFocusEffect(refresh);

  // A suggestion that arrived while the socket was down is one nothing will
  // announce — no channel event left to deliver, and no notification to fall
  // back on.
  useAppResume(refresh);

  // Live updates, so sitting on this tab is enough to see a suggestion arrive
  // or leave once it's answered — same channel/subscribe shape the chat thread uses.
  // The payload is a bare group_suggestions row (no group name, no photo), so
  // an event re-runs the fetcher that joins those in rather than patching the
  // list from it.
  useEffect(() => {
    if (!currentGroupId) return;

    const channel = supabase
      .channel(`received-${currentGroupId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'group_suggestions',
          filter: `target_group_id=eq.${currentGroupId}`,
        },
        () => { fetchReceivedGroups(currentGroupId).then(setReceived); }
      )
      // Discussion badges, live. Filtered to this group's own discussions, so a
      // message in someone else's is not even delivered. The count differs per
      // tile and per person, so an event refetches the map rather than trying
      // to work out from the row which badge to bump.
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'discussion_messages',
          filter: `group_id=eq.${currentGroupId}`,
        },
        () => { fetchDiscussionUnreadCounts(currentGroupId).then(setUnread); }
      )
      .subscribe(status => console.log('[realtime] received channel:', status));

    return () => { supabase.removeChannel(channel); };
  }, [currentGroupId]);

  // A notification tap: the discussion to open rides in as a param, consumed
  // once the list has arrived. If that suggestion has since been answered the
  // tile is gone — the param is still cleared and this screen is where you land.
  const { openDiscussion } = useLocalSearchParams<{ openDiscussion?: string }>();
  useEffect(() => {
    if (!openDiscussion || loading) return;
    const match = received.find(r => r.suggestingGroupId === openDiscussion);
    if (match) setDiscussing(match);
    router.setParams({ openDiscussion: undefined });
  }, [openDiscussion, received, loading]);

  async function handleApprove(suggestingGroupId: string) {
    if (!currentGroupId) return;
    const { error } = await supabase
      .from('group_suggestions')
      // Stamped here rather than derived from created_at, which is when the
      // suggestion was swiped: History cuts a past group's matches off at the
      // date you left, and that needs the moment the match actually happened.
      .update({ status: 'matched', matched_at: new Date().toISOString() })
      .eq('suggesting_group_id', suggestingGroupId)
      .eq('target_group_id', currentGroupId);
    if (!error) {
      // Answered, so it leaves this screen — the match lives in Chats now.
      setReceived(prev => prev.filter(r => r.suggestingGroupId !== suggestingGroupId));
    }
  }

  async function handleReject(suggestingGroupId: string) {
    if (!currentGroupId) return;
    const { error } = await supabase
      .from('group_suggestions')
      .delete()
      .eq('suggesting_group_id', suggestingGroupId)
      .eq('target_group_id', currentGroupId);
    if (!error) {
      setReceived(prev => prev.filter(r => r.suggestingGroupId !== suggestingGroupId));
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerBand}>
        <Text style={styles.headerTitle}>Received</Text>
      </View>

      {loading ? (
        <View style={styles.previewList}>
          <SkeletonList count={3}>{i => <TileSkeleton key={i} />}</SkeletonList>
        </View>
      ) : received.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>Nothing here yet.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.previewList}>
          {/* One flat column — everything here is at the same stage: incoming,
              awaiting your leader's answer. */}
          {received.map(r => (
            <GroupPostPreview
              key={r.suggestingGroupId}
              groupName={r.groupName}
              firstImageUrl={r.firstImageUrl}
              suggesterPicUrl={null}
              hideSuggesterPic
              onPress={() => setDetail(r)}
              onOpenDiscussion={() => setDiscussing(r)}
              discussionUnread={unread.get(r.suggestingGroupId) ?? 0}
            />
          ))}
        </ScrollView>
      )}

      {/* Detail panel — full group, with leader Approve/Reject for incoming items */}
      <SlideOver visible={detail !== null} onRequestClose={() => setDetail(null)}>
        <View style={styles.detailModal}>
          <TouchableOpacity style={styles.detailBack} onPress={() => setDetail(null)}>
            <ChevronLeft size={28} color="#000" />
          </TouchableOpacity>
          {detail && <GroupPost groupId={detail.suggestingGroupId} onSelectMember={setOpenPersonId} onOpenActions={setActionsFor} />}
          {detail && isLeader && (
            <View style={styles.modalLeaderRow}>
              <TouchableOpacity style={styles.xButton} onPress={() => { handleReject(detail.suggestingGroupId); setDetail(null); }}>
                <XMark />
              </TouchableOpacity>
              <TouchableOpacity style={styles.checkButton} onPress={() => { handleApprove(detail.suggestingGroupId); setDetail(null); }}>
                <CheckMark />
              </TouchableOpacity>
            </View>
          )}
        </View>
      </SlideOver>

      {/* Your own group's back-room about this one. Closing refreshes the
          badges: what you just read is no longer unread. */}
      {currentGroupId && (
        <DiscussionSheet
          aboutGroupId={discussing?.suggestingGroupId ?? null}
          aboutGroupName={discussing?.groupName ?? ''}
          myGroupId={currentGroupId}
          onClose={() => {
            setDiscussing(null);
            fetchDiscussionUnreadCounts(currentGroupId).then(setUnread);
          }}
          onOpenImage={setViewerImage}
          onSelectMember={setOpenPersonId}
        />
      )}

      {/* Outside the panel, so it covers the discussion rather than living
          inside the panel whose swipe its pan would fight. */}
      <ImageViewer image={viewerImage} onClose={() => setViewerImage(null)} />

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
  container: {
    flex: 1,
    backgroundColor: Palette.background,
  },

  // Page title — the same 44pt band at top: 60 the other tabs use.
  headerBand: {
    marginTop: HEADER_TOP,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },

  headerTitle: {
    ...Type.title,
    color: '#000',
  },

  previewList: {
    alignItems: 'center',
    paddingTop: 26,
    paddingBottom: 40,
  },

  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Palette.background,
  },

  emptyText: {
    ...Type.header,
    fontFamily: FontFamily.regular,
    color: '#555',
  },

  // Detail modal (opened by tapping a preview)
  detailModal: {
    flex: 1,
    backgroundColor: Palette.background,
    paddingTop: FLOATING_TOP,
  },

  detailBack: {
    position: 'absolute',
    top: HEADER_TOP,
    left: 20,
    zIndex: 10,
  },

  // Leader-only Approve/Reject, floating at the bottom of the detail modal.
  // The modal's SlideOver hides the tab bar, so this really is the screen's
  // bottom edge — hence the inset-aware constant rather than a literal.
  modalLeaderRow: {
    position: 'absolute',
    bottom: LEADER_ROW_BOTTOM,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 24,
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
});
