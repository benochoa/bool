import { Image, ImageProps } from 'expo-image';
import { useState } from 'react';
import { ImageStyle, StyleProp, StyleSheet } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  measure, useAnimatedRef, useSharedValue, withTiming,
} from 'react-native-reanimated';
import { runOnJS } from 'react-native-worklets';
import { useZoomOverlay } from './zoomOverlay';

// Drop-in replacement for a carousel <Image> that adds two-finger pinch-to-zoom.
// The photo animates into the app-root ZoomOverlay (so it grows past its box),
// then springs back on release. All gestures are two-finger, so one-finger
// horizontal swipes still page the carousel.
interface Props {
  uri: string;
  style?: StyleProp<ImageStyle>;
  onLoad?: ImageProps['onLoad'];
}

const SPRING_BACK = { duration: 180 };

export default function ZoomableImage({ uri, style, onLoad }: Props) {
  const z = useZoomOverlay();
  const aref = useAnimatedRef<Animated.View>();

  // While this photo is lifted into the overlay, hide the in-place original so
  // there's no duplicate behind the floating clone.
  const [zooming, setZooming] = useState(false);
  const begin = () => { setZooming(true); z.show(uri); };
  const finish = () => { setZooming(false); z.hide(); };

  // Finger-midpoint at gesture start; translation follows its movement 1:1.
  const startFocalX = useSharedValue(0);
  const startFocalY = useSharedValue(0);

  const gesture = Gesture.Pinch()
    .onStart((e) => {
      const m = measure(aref);
      if (m) {
        z.originX.value = m.pageX;
        z.originY.value = m.pageY;
        z.width.value = m.width;
        z.height.value = m.height;
      }
      z.scale.value = 1;
      z.translateX.value = 0;
      z.translateY.value = 0;
      startFocalX.value = e.focalX;
      startFocalY.value = e.focalY;
      runOnJS(begin)();
    })
    .onUpdate((e) => {
      z.scale.value = Math.max(1, e.scale);
      // Follow the two fingers' midpoint so the photo drags freely anywhere.
      z.translateX.value = e.focalX - startFocalX.value;
      z.translateY.value = e.focalY - startFocalY.value;
    })
    // onFinalize (not onEnd) fires whether the gesture ends OR is cancelled —
    // so the overlay always tears down and can never get stuck covering the UI.
    .onFinalize(() => {
      z.scale.value = withTiming(1, SPRING_BACK);
      z.translateX.value = withTiming(0, SPRING_BACK);
      z.translateY.value = withTiming(0, SPRING_BACK, (done) => {
        if (done) runOnJS(finish)();
      });
    });

  return (
    <GestureDetector gesture={gesture}>
      {/* The wrapper carries the display size (like edit mode's photoSlot) so
          it's a solid, measurable box whether it's nested or a direct
          ScrollView child. */}
      <Animated.View
        ref={aref}
        collapsable={false}
        style={[style, styles.wrapper, { opacity: zooming ? 0 : 1 }]}
      >
        <Image source={{ uri }} style={styles.fill} contentFit="cover" onLoad={onLoad} />
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    overflow: 'hidden',
  },
  fill: {
    width: '100%',
    height: '100%',
  },
});