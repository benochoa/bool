import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ChevronLeft } from '@/assets/symbols/ChevronLeft';
import GroupPost from '@/components/posts/groupPost';
import GroupPostPreview from '@/components/posts/groupPostPreview';
import PersonPanel from '@/components/posts/personPanel';
import SlideOver from '@/components/ui/slideOver';
import { Palette, Type } from '@/constants/theme';
import { fetchGroupSummaries, GroupSummary } from '@/lib/fetchGroupSummaries';
import { fetchMatchedGroupIds } from '@/lib/fetchMatchedGroupIds';

interface Props {
  groupId: string;
  groupName: string;
  firstImageUrl: string | null;
  // When your membership ended. Everything the group matched with up to this
  // moment is yours to look back on; anything after it happened without you.
  statusAt: string;
  onClose: () => void;
}

// One group you used to be in: the group itself, and everyone it matched with
// while you were there. Both are tiles that open the real post, so a group in
// History reads exactly like a group anywhere else — current photos, current
// members, members tappable. Read-only falls out of the props left unpassed:
// with no isMember there is no Leave or Dissolve, and no onToggleEdit means no
// pencil even on a group you founded.
export default function PastGroup({ groupId, groupName, firstImageUrl, statusAt, onClose }: Props) {
  const [matched, setMatched] = useState<GroupSummary[]>([]);
  const [loading, setLoading] = useState(true);
  // The expanded post, and a member's profile opened from its card. Both belong
  // to this panel rather than to the post, so each covers the chevron below it.
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const [openPersonId, setOpenPersonId] = useState<string | null>(null);

  useEffect(() => {
    fetchMatchedGroupIds(groupId, statusAt).then(async ids => {
      setMatched(await fetchGroupSummaries(ids));
      setLoading(false);
    });
  }, [groupId, statusAt]);

  return (
    <View style={styles.container}>

      <TouchableOpacity style={styles.backButton} onPress={onClose}>
        <ChevronLeft size={28} color="#000" />
      </TouchableOpacity>

      {/* The whole body waits, not just the matches. This group's tile needs no
          fetch, but letting it land first assembles the panel in two steps —
          and only on a slow connection, since a fast one beats the slide-in.
          One spinner, then the finished panel, every time. */}
      {loading ? (
        <ActivityIndicator style={styles.loader} />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>

          <Text style={styles.sectionHeader}>This group…</Text>
          <GroupPostPreview
            groupName={groupName}
            firstImageUrl={firstImageUrl}
            suggesterPicUrl={null}
            hideSuggesterPic
            onPress={() => setOpenGroupId(groupId)}
          />

          {matched.length > 0 && (
            <>
              <Text style={styles.sectionHeader}>Groups you matched with…</Text>
              {matched.map(g => (
                <GroupPostPreview
                  key={g.id}
                  groupName={g.name}
                  firstImageUrl={g.image_urls?.[0] ?? null}
                  suggesterPicUrl={null}
                  hideSuggesterPic
                  onPress={() => setOpenGroupId(g.id)}
                />
              ))}
            </>
          )}

        </ScrollView>
      )}

      {/* The full post, over the tile that opened it. */}
      <SlideOver visible={openGroupId !== null} onRequestClose={() => setOpenGroupId(null)}>
        <View style={styles.postPanel}>
          <TouchableOpacity style={styles.backButton} onPress={() => setOpenGroupId(null)}>
            <ChevronLeft size={28} color="#000" />
          </TouchableOpacity>
          {openGroupId && <GroupPost groupId={openGroupId} onSelectMember={setOpenPersonId} />}
        </View>
      </SlideOver>

      {/* Last, so a member's profile covers the post that opened it. */}
      <PersonPanel personId={openPersonId} onClose={() => setOpenPersonId(null)} />

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Palette.background,
  },

  // The content scrolls under it, so it floats rather than taking a row.
  backButton: {
    position: 'absolute',
    top: 60,
    left: 20,
    zIndex: 2,
  },

  // Clears the floating chevron, with room to spare so the first heading isn't
  // sitting on it. The tiles are already screen-width less 40, so the same 20
  // either side lines the headings up with their edges.
  content: {
    paddingTop: 132,
    paddingHorizontal: 20,
    paddingBottom: 40,
  },

  // A step up the scale from History's own section labels: there are only two
  // of them here and they title a card each, rather than a list of rows.
  sectionHeader: {
    ...Type.header,
    color: '#555',
    marginBottom: 10,
  },

  loader: {
    flex: 1,
    alignSelf: 'center',
  },

  // Opaque and drawn from the top, like every other post panel — the chevron
  // floats over it.
  postPanel: {
    flex: 1,
    backgroundColor: Palette.background,
    paddingTop: 100,
  },
});
