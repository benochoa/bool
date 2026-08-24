import { Image } from 'expo-image';
import { authedSource } from '@/lib/storageAuth';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { runOnJS } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FontFamily, Type } from '@/constants/theme';
import { NotificationData } from '@/lib/notificationRouting';

// One in-app notification, already resolved to what the box shows. line2 is
// only ever a chat message's content; every other case is a single line.
export interface InAppNotification {
  id: number;
  pfpUrl: string | null;
  line1: string;
  line2: string | null;
  data: NotificationData;
}

// How long a banner stays before leaving on its own.
const SHOW_MS = 6000;
const ENTER = { duration: 260, easing: Easing.out(Easing.ease) };
const EXIT = { duration: 200, easing: Easing.in(Easing.ease) };
// Flicked up this fast, or dragged past half the box, the swipe is a dismissal.
const DISMISS_VELOCITY = -500;
// Every notification is this same box, whatever it holds: one line centers in
// it, a chat's two lines stack.
const HEIGHT = 68;
// Far enough above the screen to clear the tallest status bar plus the box.
const OFFSCREEN = -160;

interface Props {
  notification: InAppNotification;
  onDismiss: () => void;
  onPress: () => void;
}

// The provider remounts this per notification (keyed by id), so entering,
// timing out and leaving are all local to one banner's life.
export default function NotificationBanner({ notification, onDismiss, onPress }: Props) {
  const insets = useSafeAreaInsets();
  const y = useSharedValue(OFFSCREEN);

  useEffect(() => {
    y.value = withTiming(0, ENTER);
    const timer = setTimeout(() => {
      y.value = withTiming(OFFSCREEN, EXIT, done => {
        if (done) runOnJS(onDismiss)();
      });
    }, SHOW_MS);
    return () => clearTimeout(timer);
  }, [y, onDismiss]);

  // Upward drags only — the box follows the finger up but won't be pulled
  // down. A drag that doesn't commit snaps back and the timer still applies.
  const pan = Gesture.Pan()
    .activeOffsetY(-8)
    .failOffsetY(8)
    .onUpdate(e => {
      y.value = Math.min(0, e.translationY);
    })
    .onFinalize((e, success) => {
      const dismissed = success && (e.translationY < -HEIGHT / 2 || e.velocityY < DISMISS_VELOCITY);
      if (dismissed) {
        y.value = withTiming(OFFSCREEN, EXIT, done => {
          if (done) runOnJS(onDismiss)();
        });
      } else {
        y.value = withTiming(0, ENTER);
      }
    });

  const tap = Gesture.Tap().onEnd((_e, success) => {
    if (success) runOnJS(onPress)();
  });

  const slide = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));

  return (
    <GestureDetector gesture={Gesture.Race(pan, tap)}>
      <Animated.View style={[styles.banner, { top: insets.top + 6 }, slide]}>
        {notification.pfpUrl ? (
          <Image source={authedSource(notification.pfpUrl)} style={styles.pfp} contentFit="cover" />
        ) : (
          <View style={[styles.pfp, styles.pfpPlaceholder]} />
        )}
        <View style={styles.text}>
          <Text style={styles.line1} numberOfLines={1}>
            {notification.line1}
          </Text>
          {notification.line2 !== null && (
            <Text style={styles.line2} numberOfLines={1}>
              {notification.line2}
            </Text>
          )}
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    left: 12,
    right: 12,
    height: HEIGHT,
    // Over the SlideOver panels (zIndex 20), so a banner still lands while a
    // chat thread or detail panel is open.
    zIndex: 30,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  pfp: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#eee',
  },
  pfpPlaceholder: {
    backgroundColor: '#ddd',
  },
  // justifyContent is what centers a lone line in the fixed box.
  text: {
    flex: 1,
    marginLeft: 12,
    justifyContent: 'center',
  },
  line1: {
    ...Type.bodyBold,
    fontSize: 15,
    color: '#111',
  },
  line2: {
    ...Type.label,
    fontFamily: FontFamily.regular,
    color: '#555',
    marginTop: 1,
  },
});
