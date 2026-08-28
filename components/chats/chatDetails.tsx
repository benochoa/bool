import { useEffect, useState } from 'react';
import {
  Dimensions, ScrollView, StyleSheet, Text,
  TouchableOpacity, View,
} from 'react-native';
import { ChevronLeft } from '@/assets/symbols/ChevronLeft';
import { ChevronRight } from '@/assets/symbols/ChevronRight';
import GroupPost from '@/components/posts/groupPost';
import { NameRowSkeleton, Skeleton } from '@/components/ui/skeleton';
import MembersCard from '@/components/posts/membersCard';
import PersonPanel from '@/components/posts/personPanel';
import SlideOver from '@/components/ui/slideOver';
import { Palette, Type } from '@/constants/theme';
import { fetchGroup, GroupData } from '@/lib/fetchGroup';
import { HEADER_TOP } from '@/constants/layout';

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
        <View style={styles.content}>
          <View style={styles.titleBlock}>
            <Skeleton width={160} height={26} />
            <Skeleton width={20} height={26} style={styles.skeletonPlus} />
            <Skeleton width={140} height={26} />
          </View>
          <View style={styles.skeletonSections}>
            <NameRowSkeleton />
            <Skeleton height={110} radius={8} style={styles.skeletonMembers} />
            <NameRowSkeleton width="45%" />
            <Skeleton height={110} radius={8} style={styles.skeletonMembers} />
          </View>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {/* Three lines rather than one: a long pair of names used to wrap
              wherever it happened to run out of room. */}
          <View style={styles.titleBlock}>
            <Text style={styles.title}>{theirs?.name ?? '...'}</Text>
            <Text style={styles.title}>+</Text>
            <Text style={styles.title}>{mine?.name ?? '...'}</Text>
          </View>

          {groupSection(theirs, otherGroupId)}
          {groupSection(mine, myGroupId)}
        </ScrollView>
      )}

      {/* Group post — read-only, so no pencil and no leave/dissolve. */}
      <SlideOver visible={openGroupId !== null} onRequestClose={() => setOpenGroupId(null)}>
        <View style={styles.container}>
          <TouchableOpacity style={styles.floatingBack} onPress={() => setOpenGroupId(null)}>
            <ChevronLeft size={28} color="#000" />
          </TouchableOpacity>
          {openGroupId && (
            <GroupPost groupId={openGroupId} topInset={100} onSelectMember={setOpenPersonId} />
          )}
        </View>
      </SlideOver>

      {/* Member profile — last, so it covers the group post above too. */}
      <PersonPanel personId={openPersonId} onClose={() => setOpenPersonId(null)} />

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
    paddingTop: HEADER_TOP,
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
    top: HEADER_TOP,
    left: 20,
    height: 44,
    justifyContent: 'center',
    zIndex: 2,
  },

  content: {
    alignItems: 'center',
    paddingBottom: 40,
  },

  // The margins live on the block so the three lines stack tight against each
  // other and only the pair as a whole is spaced off its surroundings.
  // Placeholder spacing only — the real lines carry their own line height.
  skeletonPlus: {
    marginVertical: 6,
  },

  skeletonSections: {
    alignSelf: 'stretch',
    paddingHorizontal: 20,
  },

  skeletonMembers: {
    marginTop: 12,
    marginBottom: 24,
  },

  titleBlock: {
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 24,
    paddingHorizontal: 20,
  },

  title: {
    ...Type.title,
    color: '#000',
    textAlign: 'center',
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
