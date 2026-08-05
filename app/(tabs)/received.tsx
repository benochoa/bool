import { CheckMark } from '@/assets/symbols/CheckMark';
import { ChevronLeft } from '@/assets/symbols/ChevronLeft';
import { XMark } from '@/assets/symbols/XMark';
import GroupPost from '@/components/posts/groupPost';
import GroupPostPreview from '@/components/posts/groupPostPreview';
import PersonPanel from '@/components/posts/personPanel';
import SlideOver from '@/components/ui/slideOver';
import { FontFamily, Palette, Type } from '@/constants/theme';
import { useCurrentGroup } from '@/hooks/use-current-group';
import { useSession } from '@/hooks/use-session';
import { fetchGroup } from '@/lib/fetchGroup';
import { fetchReceivedGroups, ReceivedGroup } from '@/lib/fetchReceivedGroups';
import { supabase } from '@/supabaseClient';
import { useFocusEffect } from '@react-navigation/native';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export default function ReceivedScreen() {

  const { session } = useSession();
  const { currentGroupId } = useCurrentGroup();

  const [received, setReceived] = useState<ReceivedGroup[]>([]);
  const [detail, setDetail] = useState<ReceivedGroup | null>(null);
  // A member's profile, opened from the post's members card. It belongs to the
  // screen so it covers the detail panel's own back chevron.
  const [openPersonId, setOpenPersonId] = useState<string | null>(null);
  const [isLeader, setIsLeader] = useState(false);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      if (!currentGroupId) {
        setReceived([]);
        setIsLeader(false);
        setLoading(false);
        return;
      }
      fetchReceivedGroups(currentGroupId).then(items => {
        setReceived(items);
        setLoading(false);
      });
      if (session?.user) {
        fetchGroup(currentGroupId).then(g => setIsLeader(g?.created_by === session.user.id));
      }
    }, [currentGroupId, session])
  );

  // Live updates, so sitting on this tab is enough to see a suggestion arrive
  // or turn into a match — same channel/subscribe shape the chat thread uses.
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
      .subscribe(status => console.log('[realtime] received channel:', status));

    return () => { supabase.removeChannel(channel); };
  }, [currentGroupId]);

  async function handleApprove(suggestingGroupId: string) {
    if (!currentGroupId) return;
    const { error } = await supabase
      .from('group_suggestions')
      .update({ status: 'matched' })
      .eq('suggesting_group_id', suggestingGroupId)
      .eq('target_group_id', currentGroupId);
    if (!error) {
      // Keep the tile — flip it to matched so it turns green and drops to the bottom.
      setReceived(prev => prev.map(r => r.suggestingGroupId === suggestingGroupId ? { ...r, status: 'matched' } : r));
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

  // Each stage under its own heading: awaiting your approval on top, matched
  // below. The first is stored as `sent` — the sender's word for it; from this
  // side of the funnel it's waiting on your leader.
  const sections = [
    { label: 'Waiting on your leader...', items: received.filter(r => r.status === 'sent') },
    { label: "It's a match!", items: received.filter(r => r.status === 'matched') },
  ];

  return (
    <View style={styles.container}>
      <View style={styles.headerBand}>
        <Text style={styles.headerTitle}>Received</Text>
      </View>

      {loading ? (
        <ActivityIndicator style={styles.loader} />
      ) : received.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>Nothing received yet.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.previewList}>
          {/* A heading only where there's something under it. Fragments, so the
              tiles stay one flat column rather than nesting per stage. */}
          {sections.map(section => section.items.length === 0 ? null : (
            <Fragment key={section.label}>
              <Text style={styles.sectionLabel}>{section.label}</Text>
              {section.items.map(r => (
                <GroupPostPreview
                  key={r.suggestingGroupId}
                  groupName={r.groupName}
                  firstImageUrl={r.firstImageUrl}
                  suggesterPicUrl={null}
                  hideSuggesterPic
                  tint={r.status === 'matched' ? 'green' : undefined}
                  onPress={() => setDetail(r)}
                />
              ))}
            </Fragment>
          ))}
        </ScrollView>
      )}

      {/* Detail panel — full group, with leader Approve/Reject for incoming items */}
      <SlideOver visible={detail !== null} onRequestClose={() => setDetail(null)}>
        <View style={styles.detailModal}>
          <TouchableOpacity style={styles.detailBack} onPress={() => setDetail(null)}>
            <ChevronLeft size={28} color="#000" />
          </TouchableOpacity>
          {detail && <GroupPost groupId={detail.suggestingGroupId} onSelectMember={setOpenPersonId} />}
          {detail?.status === 'sent' && isLeader && (
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

      {/* Last, so a member's profile covers the post that opened it. */}
      <PersonPanel personId={openPersonId} onClose={() => setOpenPersonId(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  loader: {
    flex: 1,
    alignSelf: 'center',
  },

  container: {
    flex: 1,
    backgroundColor: Palette.background,
  },

  // Page title — the same 44pt band at top: 60 the other tabs use.
  headerBand: {
    marginTop: 60,
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
    paddingTop: 16,
    paddingBottom: 40,
  },

  // Heading over each stage of the feed. Stretched across the list and inset by
  // the tiles' own 20pt, so a heading and its cards share a left edge.
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
    paddingTop: 100,
  },

  detailBack: {
    position: 'absolute',
    top: 60,
    left: 20,
    zIndex: 10,
  },

  // Leader-only Approve/Reject, floating at the bottom of the detail modal
  modalLeaderRow: {
    position: 'absolute',
    bottom: 40,
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
