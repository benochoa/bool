import { ReactNode, useEffect, useRef, useState } from 'react';
import { BackHandler, StyleSheet, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing, useAnimatedStyle, useSharedValue, withTiming,
} from 'react-native-reanimated';
import { runOnJS } from 'react-native-worklets';
import { Palette } from '@/constants/theme';
import { useHideTabBar } from '@/hooks/use-hide-tab-bar';

// A full-screen panel over whatever opened it, with the same motion as the
// profile and groups edit screens: in from the right, out the same way. It
// leaves by its own back chevron, by Android's back button, or by a swipe to
// the right. An ordinary view rather than a Modal, so it shares the app's one
// gesture root and zoom overlay instead of needing its own in a second window.
const EASE = Easing.inOut(Easing.ease);
const ENTER = { duration: 280, easing: EASE };
const EXIT = { duration: 240, easing: EASE };
const SNAP_BACK = { duration: 180, easing: EASE };

// Dragged this far across, or thrown this fast, the swipe is a dismissal.
const DISMISS_FRACTION = 0.3;
const DISMISS_VELOCITY = 800;

interface Props {
  visible: boolean;
  // Called the moment a swipe commits, so it has to actually close the panel:
  // the slide-out is driven by `visible` going false, not by the gesture. A
  // caller that wants to confirm first should keep its own animation (the edit
  // screens do) rather than refuse from here.
  onRequestClose: () => void;
  children: ReactNode;
}

export default function SlideOver({ visible, onRequestClose, children }: Props) {
  const { width } = useWindowDimensions();
  const x = useSharedValue(width);
  // Stays mounted through the slide-out, so the panel is still there to watch
  // leave; `visible` alone would tear it off screen instantly.
  const [mounted, setMounted] = useState(false);

  // The children are usually drawn from the same state `visible` reads, so
  // they're already gone by the time the panel starts leaving. Holding the last
  // set keeps the panel's contents on screen the whole way out.
  const held = useRef<ReactNode>(null);
  useEffect(() => { if (visible) held.current = children; });

  useEffect(() => {
    if (visible) {
      setMounted(true);
      x.value = withTiming(0, ENTER);
    } else {
      x.value = withTiming(width, EXIT, done => {
        if (done) runOnJS(setMounted)(false);
      });
    }
  }, [visible, width, x]);

  // Android's back button, which the Modal this replaces handled for free.
  // Called through a ref so the subscription outlives re-renders: resubscribing
  // would put this panel back on top of the stack and hand it presses meant for
  // whatever opened over it.
  const close = useRef(onRequestClose);
  close.current = onRequestClose;
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      close.current();
      return true;
    });
    return () => sub.remove();
  }, [visible]);

  useHideTabBar(mounted);

  const pan = Gesture.Pan()
    // Only a deliberate drag to the right; anything vertical belongs to
    // whatever is scrolling underneath.
    .activeOffsetX(12)
    .failOffsetY([-12, 12])
    .onUpdate(e => {
      x.value = Math.max(0, e.translationX);
    })
    // onFinalize, not onEnd — a cancelled drag has to resolve too, or the panel
    // would stay stuck at an offset.
    .onFinalize((e, success) => {
      const dismissed = success
        && (e.translationX > width * DISMISS_FRACTION || e.velocityX > DISMISS_VELOCITY);
      if (dismissed) runOnJS(onRequestClose)();
      else x.value = withTiming(0, SNAP_BACK);
    });

  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  if (!mounted) return null;

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.panel, slide]}>
        {visible ? children : held.current}
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  // Above the floating chrome a screen puts over its own content — a back
  // chevron or the groups switcher would otherwise paint through the panel.
  panel: {
    zIndex: 20,
    backgroundColor: Palette.background,
  },
});
