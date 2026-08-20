import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ChevronLeft } from '@/assets/symbols/ChevronLeft';
import PastGroup from '@/components/profile/pastGroup';
import { HeadingSkeleton, NameRowSkeleton, SkeletonList } from '@/components/ui/skeleton';
import SlideOver from '@/components/ui/slideOver';
import { FontFamily, Palette, Type } from '@/constants/theme';
import { useSession } from '@/hooks/use-session';
import { fetchGroupSummaries, GroupSummary } from '@/lib/fetchGroupSummaries';
import { fetchMyPastGroups, PastMembershipStatus } from '@/lib/fetchMyPastGroups';

interface Props {
  onClose: () => void;
}

// A past group: the group itself, plus your membership's record of how and when
// it ended — which is both the section it belongs in and the cutoff its detail
// panel uses.
interface Row extends GroupSummary {
  status: PastMembershipStatus;
  statusAt: string;
}

// Dissolved first: it's the one nobody chose. Then the two ways a person leaves
// a group, in that order.
const SECTIONS: { status: PastMembershipStatus; heading: string }[] = [
  { status: 'group_dissolved', heading: 'Groups dissolved…' },
  { status: 'left', heading: 'Groups you left…' },
  { status: 'kicked', heading: 'Groups you were removed from…' },
];

export default function History({ onClose }: Props) {
  const { session } = useSession();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<Row | null>(null);

  useEffect(() => {
    if (!session?.user) return;
    fetchMyPastGroups(session.user.id).then(async past => {
      const summaries = await fetchGroupSummaries(past.map(p => p.groupId));
      // Built from `past` rather than from `summaries`: the membership rows
      // carry the newest-exit-first order, and the id lookup doesn't preserve it.
      const byId = new Map(summaries.map(s => [s.id, s]));
      setRows(past.flatMap(p => {
        const group = byId.get(p.groupId);
        return group ? [{ ...group, status: p.status, statusAt: p.statusAt }] : [];
      }));
      setLoading(false);
    });
  }, [session]);

  return (
    <View style={styles.container}>

      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={onClose}>
          <ChevronLeft size={28} color="#000" />
        </TouchableOpacity>
        <Text style={styles.title}>History</Text>
      </View>

      {loading ? (
        <View style={styles.content}>
          <HeadingSkeleton />
          <SkeletonList count={4}>{i => <NameRowSkeleton key={i} />}</SkeletonList>
        </View>
      ) : rows.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>Nothing here yet.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {SECTIONS.map(section => {
            const groups = rows.filter(r => r.status === section.status);
            // A heading with nothing under it says less than no heading does.
            if (groups.length === 0) return null;
            return (
              <View key={section.status} style={styles.section}>
                <Text style={styles.sectionHeader}>{section.heading}</Text>
                {groups.map(g => (
                  <TouchableOpacity key={g.id} style={styles.row} onPress={() => setDetail(g)}>
                    <Text style={styles.rowText}>{g.name}</Text>
                    <IconSymbol name="chevron.right" size={18} color="#999" />
                  </TouchableOpacity>
                ))}
              </View>
            );
          })}
        </ScrollView>
      )}

      <SlideOver visible={detail !== null} onRequestClose={() => setDetail(null)}>
        {detail && (
          <PastGroup
            groupId={detail.id}
            groupName={detail.name}
            firstImageUrl={detail.image_urls?.[0] ?? null}
            statusAt={detail.statusAt}
            onClose={() => setDetail(null)}
          />
        )}
      </SlideOver>

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
    paddingBottom: 16,
    paddingHorizontal: 20,
  },

  backButton: {
    marginRight: 16,
  },

  title: {
    ...Type.header,
    color: '#000',
  },

  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  emptyText: {
    ...Type.header,
    fontFamily: FontFamily.regular,
    color: '#555',
  },

  content: {
    paddingHorizontal: 20,
    // Sets the first heading well clear of the title, so "History" reads as the
    // page rather than as another section label.
    paddingTop: 24,
    paddingBottom: 40,
  },

  // Enough that the next heading reads as a new group of rows rather than
  // another row.
  section: {
    marginBottom: 36,
  },

  sectionHeader: {
    ...Type.label,
    color: '#555',
    marginBottom: 8,
  },

  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },

  rowText: {
    ...Type.body,
    color: '#000',
  },
});
