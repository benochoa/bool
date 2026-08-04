import { useEffect, useState } from 'react';
import {
  ActivityIndicator, Dimensions, Modal, ScrollView, StyleSheet, Text,
  TouchableOpacity, View,
} from 'react-native';
import { ChevronLeft } from '@/assets/symbols/ChevronLeft';
import { ChevronRight } from '@/assets/symbols/ChevronRight';
import GroupPost from '@/components/posts/groupPost';
import IndividualPost from '@/components/posts/individualPost';
import MembersCard from '@/components/posts/membersCard';
import { ZoomRoot } from '@/components/posts/zoomOverlay';
import { Palette, Type } from '@/constants/theme';
import { fetchGroup, GroupData } from '@/lib/fetchGroup';

// Matches the members card beneath it, so names and cards share a left edge.
const CARD_WIDTH = Dimensions.get('window').width - 40;

interface Props {
  myGroupId: string;
  otherGroupId: string;
  onClose: () => void;
}

// Who's in this chat: both groups' rosters, each under its own name. Names open
// the group's post, rows open the member's profile — everything read-only, so
// editing stays on the tabs that own it.
export default function ChatDetails({ myGroupId, otherGroupId, onClose }: Props) {

  const [mine, setMine] = useState<GroupData | null>(null);
  const [theirs, setTheirs] = useState<GroupData | null>(null);
  const [loading, setLoading] = useState(true);
  // Whichever post is stacked on top of this modal, if any.
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const [openPersonId, setOpenPersonId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchGroup(myGroupId), fetchGroup(otherGroupId)]).then(([m, t]) => {
      setMine(m);
      setTheirs(t);
      setLoading(false);
    });
  }, [myGroupId, otherGroupId]);

  function groupSection(group: GroupData | null, groupId: string) {
    if (!group) return null;
    return (
      <>
        <TouchableOpacity style={styles.groupNameRow} onPress={() => setOpenGroupId(groupId)}>
          <Text style={styles.groupName} numberOfLines={1}>{group.name}</Text>
          <ChevronRight />
        </TouchableOpacity>
        <MembersCard
          members={group.members}
          leaderId={group.created_by}
          onSelectMember={setOpenPersonId}
        />
      </>
    );
  }

  return (
    <View style={styles.container}>

      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={onClose}>
          <ChevronLeft size={28} color="#000" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator style={styles.loader} />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>
            {theirs?.name ?? '...'} x {mine?.name ?? '...'}
          </Text>

          {groupSection(theirs, otherGroupId)}
          {groupSection(mine, myGroupId)}
        </ScrollView>
      )}

      {/* Group post — read-only, so no pencil and no leave/dissolve. */}
      <Modal visible={openGroupId !== null} animationType="slide" onRequestClose={() => setOpenGroupId(null)}>
        <ZoomRoot>
          <View style={styles.container}>
            <TouchableOpacity style={styles.floatingBack} onPress={() => setOpenGroupId(null)}>
              <ChevronLeft size={28} color="#000" />
            </TouchableOpacity>
            {openGroupId && <GroupPost groupId={openGroupId} topInset={100} />}
          </View>
        </ZoomRoot>
      </Modal>

      {/* Member profile */}
      <Modal visible={openPersonId !== null} animationType="slide" onRequestClose={() => setOpenPersonId(null)}>
        <ZoomRoot>
          <View style={styles.container}>
            <TouchableOpacity style={styles.floatingBack} onPress={() => setOpenPersonId(null)}>
              <ChevronLeft size={28} color="#000" />
            </TouchableOpacity>
            {openPersonId && <IndividualPost personId={openPersonId} standalone />}
          </View>
        </ZoomRoot>
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({

  container: {
    flex: 1,
    backgroundColor: Palette.background,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 20,
  },

  backButton: {
    height: 44,
    justifyContent: 'center',
  },

  // The stacked posts draw their own content from the top, so their back
  // button floats over it.
  floatingBack: {
    position: 'absolute',
    top: 60,
    left: 20,
    height: 44,
    justifyContent: 'center',
    zIndex: 2,
  },

  loader: {
    flex: 1,
    alignSelf: 'center',
  },

  content: {
    alignItems: 'center',
    paddingBottom: 40,
  },

  title: {
    ...Type.title,
    color: '#000',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 24,
    paddingHorizontal: 20,
  },

  // Sits above its own members card, aligned to the card's left edge.
  groupNameRow: {
    width: CARD_WIDTH,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 24,
  },

  groupName: {
    ...Type.header,
    color: '#000',
    flexShrink: 1,
  },

});
