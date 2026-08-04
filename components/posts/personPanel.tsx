import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { ChevronLeft } from '@/assets/symbols/ChevronLeft';
import IndividualPost from '@/components/posts/individualPost';
import SlideOver from '@/components/ui/slideOver';
import { Palette } from '@/constants/theme';

// Someone's profile, read-only, over whatever opened it — a members card, a
// message's picture. A panel can only cover its own screen, so this belongs to
// the screen rather than to the card that opens it: nested inside a post it
// would draw under that screen's floating back chevron.
interface Props {
  // Null when closed — the panel keeps showing the last person on the way out.
  personId: string | null;
  onClose: () => void;
}

export default function PersonPanel({ personId, onClose }: Props) {
  return (
    <SlideOver visible={personId !== null} onRequestClose={onClose}>
      <View style={styles.container}>
        <TouchableOpacity style={styles.backButton} onPress={onClose}>
          <ChevronLeft size={28} color="#000" />
        </TouchableOpacity>
        {personId && <IndividualPost personId={personId} standalone />}
      </View>
    </SlideOver>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Palette.background,
  },

  // The post draws its own content from the top, so the back button floats
  // over it.
  backButton: {
    position: 'absolute',
    top: 60,
    left: 20,
    height: 44,
    justifyContent: 'center',
    zIndex: 2,
  },
});
