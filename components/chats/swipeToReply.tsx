import { ReactNode } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { runOnJS } from 'react-native-worklets';
import * as Haptics from 'expo-haptics';
import { ReplyArrow } from '@/assets/symbols/ReplyArrow';

// Beats the 12 that SlideOver's swipe-to-dismiss waits for, so dragging a
// message wins that race and the chat doesn't slide away underneath it. Both
// gestures answer to a rightward drag, and only the first to activate keeps it.
const ACTIVATE_X = 8;
// Vertical wins outright past this — the thread still has to scroll.
const FAIL_Y = 10;
// How far to pull before letting go actually replies.
const TRIGGER = 56;
// Nothing moves past here, so a long drag doesn't carry the bubble off screen.
const MAX_DRAG = 80;

interface Props {
  onReply: () => void;
  // This sits between the message row and the bubble column, so any width cap
  // the column used to take from the row has to land here instead — a
  // percentage resolves against the parent, and that parent is now this.
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}

// Instagram's reply gesture: drag a message to the right, an arrow appears
// behind it, let go past the threshold to answer that message.
export default function SwipeToReply({ onReply, style, children }: Props) {
  const translateX = useSharedValue(0);
  // Tracks whether the drag is currently far enough to fire, so the haptic taps
  // once on the way past rather than on every frame beyond it.
  const armed = useSharedValue(false);

  function tap() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  const pan = Gesture.Pan()
    .activeOffsetX(ACTIVATE_X)
    .failOffsetY([-FAIL_Y, FAIL_Y])
    .onUpdate(e => {
      // Rightward only, and never past MAX_DRAG.
      translateX.value = Math.max(0, Math.min(e.translationX, MAX_DRAG));
      const past = translateX.value >= TRIGGER;
      if (past !== armed.value) {
        armed.value = past;
        if (past) runOnJS(tap)();
      }
    })
    .onEnd(() => {
      if (armed.value) runOnJS(onReply)();
      armed.value = false;
      translateX.value = withTiming(0, { duration: 180 });
    });

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  // Fades and grows in as the drag approaches the threshold, so the gesture
  // shows how far it has to go rather than only what it did.
  const arrowStyle = useAnimatedStyle(() => {
    const progress = Math.min(translateX.value / TRIGGER, 1);
    return {
      opacity: progress,
      transform: [{ scale: 0.6 + progress * 0.4 }],
    };
  });

  return (
    <View style={[styles.container, style]}>
      <Animated.View style={[styles.arrow, arrowStyle]}>
        <ReplyArrow />
      </Animated.View>
      <GestureDetector gesture={pan}>
        <Animated.View style={rowStyle}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
  },

  // Behind the message, at the edge it's dragged away from — revealed by the
  // move rather than pushed along with it.
  arrow: {
    position: 'absolute',
    left: 0,
    justifyContent: 'center',
  },
});
