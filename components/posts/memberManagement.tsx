import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { Dimensions, Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Type } from '@/constants/theme';

const { height: WINDOW_HEIGHT } = Dimensions.get('window');

// Leader-only member popover. The whole screen behind is blurred, except the
// long-pressed row: we redraw a sharp copy of it at its measured on-screen rect
// (over the blur), and float the actions directly above it.
export interface MemberRect {
  x: number; y: number; width: number; height: number;
}

interface Props {
  visible: boolean;
  member: { name: string; profilePicUrl: string | null } | null;
  rect: MemberRect | null;
  onRemove: () => void;
  onMakeLeader: () => void;
  onClose: () => void;
}

export default function MemberManagement({ visible, member, rect, onRemove, onMakeLeader, onClose }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.fill} onPress={onClose}>
        <BlurView intensity={50} tint="dark" style={StyleSheet.absoluteFill} />
        {/* Extra dark scrim so the clear (white) row pops; Android blur tint
            alone reads faint. Rendered under the row/popover, so those stay sharp. */}
        <View style={styles.scrim} />

        {member && rect && (
          <>
            {/* Sharp copy of the selected row, drawn over the blur */}
            <View style={[styles.clearRow, { top: rect.y, left: rect.x, width: rect.width, height: rect.height }]}>
              {member.profilePicUrl ? (
                <Image source={{ uri: member.profilePicUrl }} style={styles.memberCircle} contentFit="cover" />
              ) : (
                <View style={styles.memberCircle} />
              )}
              <Text style={styles.memberName}>{member.name}</Text>
            </View>

            {/* Actions, anchored just above the row */}
            <View
              style={[styles.card, { bottom: WINDOW_HEIGHT - rect.y + 8, left: rect.x }]}
              onStartShouldSetResponder={() => true}
            >
              <TouchableOpacity style={styles.button} onPress={onMakeLeader}>
                <Text style={styles.buttonText}>Make group leader</Text>
              </TouchableOpacity>
              <View style={styles.divider} />
              <TouchableOpacity style={styles.button} onPress={onRemove}>
                <Text style={[styles.buttonText, styles.removeText]}>Remove member</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },

  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },

  // Matches the members card background + row layout so the copy reads as the
  // real (unblurred) row.
  clearRow: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
  },

  memberCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#ccc',
    marginRight: 12,
  },

  memberName: {
    ...Type.body,
    color: '#000',
  },

  card: {
    position: 'absolute',
    width: 220,
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },

  button: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },

  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#e0e0e0',
  },

  buttonText: {
    ...Type.body,
    color: '#000',
  },

  removeText: {
    color: '#e53935',
  },
});