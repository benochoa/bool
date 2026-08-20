import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { ChevronLeft } from '@/assets/symbols/ChevronLeft';
import { PersonRowSkeleton, SkeletonList } from '@/components/ui/skeleton';
import { Palette, Type } from '@/constants/theme';
import { useBlockedPeople } from '@/hooks/use-blocked-people';
import { useSession } from '@/hooks/use-session';
import { BlockedPerson, fetchMyBlockedPeople } from '@/lib/fetchMyBlockedPeople';
import { setPersonBlock } from '@/lib/setPersonBlock';

interface Props {
  onClose: () => void;
}

// The only way back from a block: a blocked person's members card row is inert,
// so their profile — and the Block button that turns into nothing — can't be
// reached again from there.
//
// Lists only the people you blocked, never the people who blocked you: those
// aren't yours to undo, and naming them would tell you who they are.
export default function BlockedPeople({ onClose }: Props) {
  const { session } = useSession();
  const { refreshBlocked } = useBlockedPeople();
  const [people, setPeople] = useState<BlockedPerson[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    if (!session?.user) return;
    fetchMyBlockedPeople(session.user.id).then(rows => {
      setPeople(rows);
      setLoading(false);
    });
  }, [session]);

  useEffect(() => { load(); }, [load]);

  async function handleUnblock(personId: string) {
    if (!session?.user) return;
    // Dropped from the list first: the row is the only thing that changes, and
    // waiting on the round trip makes the button feel broken.
    setPeople(prev => prev.filter(p => p.id !== personId));
    await setPersonBlock(session.user.id, personId, false);
    refreshBlocked();
  }

  return (
    <View style={styles.container}>

      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={onClose}>
          <ChevronLeft size={28} color="#000" />
        </TouchableOpacity>
        <Text style={styles.title}>Blocked</Text>
      </View>

      {loading ? (
        <View style={styles.content}>
          <SkeletonList count={5}>{i => <PersonRowSkeleton key={i} />}</SkeletonList>
        </View>
      ) : people.length === 0 ? (
        <Text style={styles.empty}>You haven&apos;t blocked anyone.</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {people.map(person => (
            <View key={person.id} style={styles.row}>
              {person.profilePicUrl ? (
                <Image source={{ uri: person.profilePicUrl }} style={styles.circle} contentFit="cover" />
              ) : (
                <View style={styles.circle} />
              )}
              <Text style={styles.name}>{person.name}</Text>
              <TouchableOpacity onPress={() => handleUnblock(person.id)}>
                <Text style={styles.unblock}>Unblock</Text>
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}

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

  content: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },

  empty: {
    ...Type.body,
    color: Palette.muted,
    textAlign: 'center',
    marginTop: 40,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },

  circle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#ccc',
    marginRight: 12,
  },

  // Takes the slack so Unblock sits against the right edge.
  name: {
    ...Type.body,
    color: '#000',
    flex: 1,
  },

  unblock: {
    ...Type.bodyBold,
    color: Palette.confirm,
  },
});
