import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, {
  Easing, useAnimatedStyle, useSharedValue, withTiming,
} from 'react-native-reanimated';
import { runOnJS } from 'react-native-worklets';
import { FontFamily, Type } from '@/constants/theme';

const EASE = Easing.inOut(Easing.ease);
const ENTER = { duration: 220, easing: EASE };
const EXIT = { duration: 180, easing: EASE };

// Tall enough to clear the home indicator and to carry the panel off screen
// whatever it's holding — the sheet is measured, so this only has to be an
// over-estimate of how far down to start.
const OFFSET = 400;

export interface SheetAction {
  label: string;
  // Reads in the alarm colour. Blocking qualifies — it changes what you can see
  // from here on. Reporting doesn't: it's a thing you do about someone else,
  // not a change to your own standing.
  destructive?: boolean;
  onPress: () => void;
}

interface Props {
  visible: boolean;
  actions: SheetAction[];
  onClose: () => void;
}

// Actions on the thing you're looking at, from a dots button. The tint lands at
// once — it's what says the screen behind is inert — while the panel itself
// slides up from the bottom. Tapping the tint is the only way out; there's no
// Cancel row, since the whole backdrop is already one.
export default function ActionSheet({ visible, actions, onClose }: Props) {
  const y = useSharedValue(OFFSET);
  // Stays mounted through the slide-out, so the panel is still there to watch
  // leave; `visible` alone would tear it off screen instantly.
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      y.value = withTiming(0, ENTER);
    } else {
      y.value = withTiming(OFFSET, EXIT, done => {
        if (done) runOnJS(setMounted)(false);
      });
    }
  }, [visible, y]);

  const slide = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));

  if (!mounted) return null;

  return (
    <View style={styles.overlay}>
      <Pressable style={[StyleSheet.absoluteFill, styles.scrim]} onPress={onClose} />

      <Animated.View style={[styles.sheet, slide]}>
        {actions.map((action, i) => (
          <TouchableOpacity
            key={action.label}
            style={[styles.action, i > 0 && styles.actionDivided]}
            onPress={action.onPress}
          >
            <Text style={[styles.actionText, action.destructive && styles.actionTextDestructive]}>
              {action.label}
            </Text>
          </TouchableOpacity>
        ))}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Above the floating chrome of whatever screen owns it — a back chevron would
  // otherwise paint through the tint and still take taps.
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 30,
    justifyContent: 'flex-end',
  },

  // Slight, not opaque: the post underneath should still read as the thing
  // these actions are about.
  scrim: {
    backgroundColor: 'rgba(0,0,0,0.35)',
  },

  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    overflow: 'hidden',
    // Keeps the last row off the home indicator without matching its full
    // height — at 34 a one-row sheet reads as mostly empty white.
    paddingBottom: 12,
  },

  action: {
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },

  actionDivided: {
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },

  actionText: {
    ...Type.body,
    color: '#000',
  },

  actionTextDestructive: {
    fontFamily: FontFamily.semiBold,
    color: '#FF3B30',
  },
});
