import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ChevronLeft } from '@/assets/symbols/ChevronLeft';
import { Palette, Type } from '@/constants/theme';
import { useSession } from '@/hooks/use-session';
import { fetchGroupNames, GroupName } from '@/lib/fetchGroupNames';
import { fetchMyAllTimeGroupIds } from '@/lib/fetchMyAllTimeGroupIds';

interface Props {
  onClose: () => void;
}

export default function History({ onClose }: Props) {
  const { session } = useSession();
  const [groups, setGroups] = useState<GroupName[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session?.user) return;
    fetchMyAllTimeGroupIds(session.user.id).then(async ids => {
      setGroups(await fetchGroupNames(ids));
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
        <ActivityIndicator style={styles.loader} />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.sectionHeader}>Your past groups</Text>
          {groups.map(g => (
            <View key={g.id} style={styles.row}>
              <Text style={styles.rowText}>{g.name}</Text>
              <IconSymbol name="chevron.right" size={18} color="#999" />
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

  loader: {
    flex: 1,
    alignSelf: 'center',
  },

  content: {
    paddingHorizontal: 20,
    paddingBottom: 40,
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
