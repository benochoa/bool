import { Image } from 'expo-image';
import { authedSource } from '@/lib/storageAuth';
import { createContext, ReactNode, useContext, useState } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  SharedValue, useAnimatedStyle, useSharedValue,
} from 'react-native-reanimated';

// A single, app-root overlay that a pinched photo animates into — so it can
// grow past its clipped carousel and float above everything, while staying in
// the same gesture-handler root (a Modal would be a separate window and would
// interrupt the in-progress pinch). Only one photo zooms at a time.
interface ZoomValues {
  originX: SharedValue<number>;
  originY: SharedValue<number>;
  width: SharedValue<number>;
  height: SharedValue<number>;
  scale: SharedValue<number>;
  translateX: SharedValue<number>;
  translateY: SharedValue<number>;
  show: (uri: string) => void;
  hide: () => void;
}

const ZoomContext = createContext<ZoomValues | null>(null);

export function useZoomOverlay() {
  const ctx = useContext(ZoomContext);
  if (!ctx) throw new Error('useZoomOverlay must be used within ZoomOverlayProvider');
  return ctx;
}

// Gesture root + overlay, together. Used once, at the app root: every post now
// shows in an ordinary view (a screen or a SlideOver panel), so they all sit
// under this root. A Modal would be a separate window and would need its own.
export function ZoomRoot({ children }: { children: ReactNode }) {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ZoomOverlayProvider>{children}</ZoomOverlayProvider>
    </GestureHandlerRootView>
  );
}

const MAX_TINT = 0.5; // slight dark tint, still readable

function ZoomOverlayProvider({ children }: { children: ReactNode }) {
  const originX = useSharedValue(0);
  const originY = useSharedValue(0);
  const width = useSharedValue(0);
  const height = useSharedValue(0);
  const scale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);

  const [uri, setUri] = useState<string | null>(null);

  const value: ZoomValues = {
    originX, originY, width, height, scale, translateX, translateY,
    show: setUri,
    hide: () => setUri(null),
  };

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: Math.min((scale.value - 1) * 0.6, MAX_TINT),
  }));

  // Scale from center; the photo follows the two fingers via translate.
  const cloneStyle = useAnimatedStyle(() => ({
    left: originX.value,
    top: originY.value,
    width: width.value,
    height: height.value,
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <ZoomContext.Provider value={value}>
      {children}
      {/* pointerEvents none: even if this somehow stays mounted, it can never
          capture touches or block the tab bar. */}
      {uri && (
        <Animated.View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]} />
          <Animated.View style={[styles.clone, cloneStyle]}>
            <Image source={authedSource(uri)} style={styles.cloneImage} contentFit="cover" />
          </Animated.View>
        </Animated.View>
      )}
    </ZoomContext.Provider>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: '#000',
  },

  clone: {
    position: 'absolute',
    borderRadius: 8,
    overflow: 'hidden',
  },

  cloneImage: {
    width: '100%',
    height: '100%',
  },
});