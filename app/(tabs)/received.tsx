import { CheckMark } from '@/assets/symbols/CheckMark';
import { XMark } from '@/assets/symbols/XMark';
import GroupPost from '@/components/posts/groupPost';
import { ZoomRoot } from '@/components/posts/zoomOverlay';
import GroupPostPreview from '@/components/posts/groupPostPreview';
import { FontFamily, Palette, Type } from '@/constants/theme';
import { useCurrentGroup } from '@/hooks/use-current-group';
import { useSession } from '@/hooks/use-session';
import { fetchGroup } from '@/lib/fetchGroup';
import { fetchReceivedGroups, ReceivedGroup } from '@/lib/fetchReceivedGroups';
import { supabase } from '@/supabaseClient';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export default function ReceivedScreen() {

  const { session } = useSession();
  const { currentGroupId } = useCurrentGroup();

  const [received, setReceived] = useState<ReceivedGroup[]>([]);
  const [detail, setDetail] = useState<ReceivedGroup | null>(null);
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

  if (loading) {
    return <ActivityIndicator style={styles.loader} />;
  }

  if (received.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>Nothing received yet.</Text>
      </View>
    );
  }

  // Incoming (awaiting approval) on top, matched (green) below.
  const incomingItems = received.filter(r => r.status === 'sent');
  const matchedItems = received.filter(r => r.status === 'matched');

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.previewList}>
        {[...incomingItems, ...matchedItems].map(r => (
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
      </ScrollView>

      {/* Detail modal — full group, with leader Approve/Reject for incoming items */}
      <Modal visible={detail !== null} animationType="slide" onRequestClose={() => setDetail(null)}>
        <ZoomRoot>
        <View style={styles.detailModal}>
          <TouchableOpacity style={styles.detailBack} onPress={() => setDetail(null)}>
            <Text style={styles.detailBackArrow}>←</Text>
          </TouchableOpacity>
          {detail && <GroupPost groupId={detail.suggestingGroupId} />}
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
        </ZoomRoot>
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

  container: {
    flex: 1,
    backgroundColor: Palette.background,
  },

  previewList: {
    alignItems: 'center',
    paddingTop: 60,
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
