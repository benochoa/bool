import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Type } from '@/constants/theme';
import { GroupName } from '@/lib/fetchGroupNames';
import { Key } from '@/assets/symbols/Key';
import { Plus } from '@/assets/symbols/Plus';

const { width, height } = Dimensions.get('window');
const CARD_WIDTH = width - 40;
// Matches styles.sheet's 35% height — the sheet's offscreen resting place.
const SHEET_HEIGHT = height * 0.35;

interface Props {
  visible: boolean;
  groups: GroupName[];
  onSelect: (id: string) => void;
  onCreate: () => void;
  onJoin: () => void;
  onClose: () => void;
  // Fires once the sheet has finished sliding out and this modal is really
  // gone. Anything that opens a modal of its own has to wait for it: iOS drops
  // a presentation requested while another modal is still on screen.
  onClosed?: () => void;
}

export default function GroupSwitcher({ visible, groups, onSelect, onCreate, onJoin, onClose, onClosed }: Props) {

  // Modal's own "slide" animates the tint along with the sheet. Driving the
  // sheet here instead lets the tint be instant in both directions — which
  // means staying mounted until the closing slide has finished.
  const [mounted, setMounted] = useState(visible);
  const translateY = useRef(new Animated.Value(SHEET_HEIGHT)).current;

  useEffect(() => {
    if (visible) setMounted(true);
    Animated.timing(translateY, {
      toValue: visible ? 0 : SHEET_HEIGHT,
      duration: visible ? 250 : 200,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && !visible) {
        setMounted(false);
        onClosed?.();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, translateY]);

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <Animated.View
          style={[styles.sheet, { transform: [{ translateY }] }]}
          onStartShouldSetResponder={() => true}
        >
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
        </Animated.View>
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