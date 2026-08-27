import { ReactNode } from 'react';
import { LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native';
import Animated, { SharedValue, useAnimatedStyle } from 'react-native-reanimated';

interface Props {
  // One value drives every row in the thread, so a single drag moves the whole
  // list as one sheet rather than each message separately.
  revealX: SharedValue<number>;
  style?: StyleProp<ViewStyle>;
  onLayout?: (event: LayoutChangeEvent) => void;
  children: ReactNode;
}

// A message row that slides with the thread's reveal drag. It exists only to
// own the useAnimatedStyle: the rows are produced by a map, and a hook can't be
// called from inside a loop — while one animated style shared between several
// components is not something Reanimated supports either. A component per row
// gives each its own, from the same shared value.
export default function RevealRow({ revealX, style, onLayout, children }: Props) {
  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: revealX.value }] }));

  return (
    <Animated.View style={[style, slide]} onLayout={onLayout}>
      {children}
    </Animated.View>
  );
}
