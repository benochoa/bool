import { Image } from 'expo-image';
import { Dimensions, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Type } from '@/constants/theme';
import { GroupName } from '@/lib/fetchGroupNames';
import { Key } from '@/assets/symbols/Key';
import { Plus } from '@/assets/symbols/Plus';

const { width } = Dimensions.get('window');
const CARD_WIDTH = width - 40;

interface Props {
  visible: boolean;
  groups: GroupName[];
  onSelect: (id: string) => void;
  onCreate: () => void;
  onJoin: () => void;
  onClose: () => void;
}

export default function GroupSwitcher({ visible, groups, onSelect, onCreate, onJoin, onClose }: Props) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <View style={styles.sheet} onStartShouldSetResponder={() => true}>
          <View style={styles.card}>
            <ScrollView showsVerticalScrollIndicator={false}>
            {groups.map((group, i) => (
              <TouchableOpacity
                key={group.id}
                style={[styles.row, i > 0 && styles.rowDivider]}
                onPress={() => onSelect(group.id)}
              >
                {group.image_urls?.[0] ? (
                  <Image source={{ uri: group.image_urls[0] }} style={styles.photo} contentFit="cover" />
                ) : (
                  <View style={styles.photoPlaceholder} />
                )}
                <Text style={styles.name} numberOfLines={1}>{group.name}</Text>
              </TouchableOpacity>
            ))}

            {/* Actions — always below the real groups */}
            <TouchableOpacity style={[styles.row, groups.length > 0 && styles.rowDivider]} onPress={onCreate}>
              <View style={styles.iconTile}>
                <Plus size={24} color="#000" />
              </View>
              <Text style={styles.name} numberOfLines={1}>Create a group</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.row, styles.rowDivider]} onPress={onJoin}>
              <View style={styles.iconTile}>
                <Key size={24} color="#000" />
              </View>
              <Text style={styles.name} numberOfLines={1}>Join a group</Text>
            </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },

  sheet: {
    height: '35%',
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 20,
    alignItems: 'center',
  },

  card: {
    width: CARD_WIDTH,
    flexShrink: 1,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#ddd',
    overflow: 'hidden',
    backgroundColor: '#fff',
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 9,
  },

  rowDivider: {
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },

  photo: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: '#eee',
  },

  photoPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: '#ddd',
  },

  iconTile: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: '#ddd',
    alignItems: 'center',
    justifyContent: 'center',
  },

  name: {
    ...Type.body,
    color: '#000',
    marginLeft: 14,
    flexShrink: 1,
  },
});