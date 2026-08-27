import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import {
  Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing, useAnimatedStyle, useSharedValue, withTiming,
} from 'react-native-reanimated';
import { runOnJS } from 'react-native-worklets';
import { Type } from '@/constants/theme';
import { MessageReaction } from '@/lib/fetchMessageReactions';
import { authedSource } from '@/lib/storageAuth';

// Everyone who reacted to one message. Held on a pill under the bubble, so the
// list is the whole message's reactions rather than just the pill that opened
// it — which pill you held says nothing about who you wanted to see.
//
// An ordinary view rather than a Modal, for the reason SlideOver gives: it
// shares the app's one gesture root instead of needing a second window.
const EASE = Easing.inOut(Easing.ease);
const ENTER = { duration: 260, easing: EASE };
const EXIT = { duration: 220, easing: EASE };
const SNAP_BACK = { duration: 180, easing: EASE };

// Dragged this far down the sheet, or thrown this fast, the swipe dismisses.
const DISMISS_FRACTION = 0.25;
const DISMISS_VELOCITY = 800;

interface Props {
  visible: boolean;
  reactions: MessageReaction[];
  // Closes the sheet and opens that person, the way tapping a sender's picture
  // in the thread already does.
  onSelectPerson: (userId: string) => void;
  onClose: () => void;
}

export default function ReactionsSheet({ visible, reactions, onSelectPerson, onClose }: Props) {
  const { height } = useWindowDimensions();
  const sheetHeight = height * (2 / 3);

  const y = useSharedValue(sheetHeight);
  // Stays mounted through the slide-out, so there is still a sheet to watch
  // leave; `visible` alone would tear it off screen instantly.
  const [mounted, setMounted] = useState(false);

  // The caller clears its target as it closes, so `reactions` is empty by the
  // time the sheet starts leaving. Holding the last set keeps the list on
  // screen the whole way out.
  const held = useRef<MessageReaction[]>([]);
  useEffect(() => { if (visible) held.current = reactions; });
  const list = visible ? reactions : held.current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      y.value = withTiming(0, ENTER);
    } else {
      y.value = withTiming(sheetHeight, EXIT, done => {
        if (done) runOnJS(setMounted)(false);
      });
    }
  }, [visible, sheetHeight, y]);

  // Only the header drags. A pan over the list would have to fight the
  // ScrollView for every vertical gesture; the title bar is the handle.
  const pan = Gesture.Pan()
    .onUpdate(e => {
      y.value = Math.max(0, e.translationY);
    })
    // onFinalize, not onEnd — a cancelled drag has to resolve too, or the sheet
    // would stay stuck at an offset.
    .onFinalize((e, success) => {
      const dismissed = success
        && (e.translationY > sheetHeight * DISMISS_FRACTION || e.velocityY > DISMISS_VELOCITY);
      if (dismissed) runOnJS(onClose)();
      else y.value = withTiming(0, SNAP_BACK);
    });

  const slide = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));

  if (!mounted) return null;

  return (
    <View style={styles.overlay} pointerEvents={visible ? 'auto' : 'none'}>
      {/* The whole screen goes soft, not just the third the sheet leaves
          uncovered: dragging the sheet down reveals what is behind it, and a
          blur that stopped at the sheet's resting edge would leave a hard seam
          across the middle of the screen for the length of the drag. A press
          anywhere the sheet isn't closes. */}
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose}>
        <BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFill} />
      </Pressable>

      <Animated.View style={[styles.sheet, { height: sheetHeight }, slide]}>
        <GestureDetector gesture={pan}>
          <View style={styles.header}>
            <Text style={styles.title}>Reactions</Text>
          </View>
        </GestureDetector>

        <ScrollView contentContainerStyle={styles.list}>
          {list.map(r => (
            <TouchableOpacity
              key={r.userId}
              style={styles.row}
              activeOpacity={0.7}
              onPress={() => onSelectPerson(r.userId)}
            >
              {r.profilePicUrl ? (
                <Image source={authedSource(r.profilePicUrl)} style={styles.pic} contentFit="cover" />
              ) : (
                <View style={styles.pic} />
              )}
              <Text style={styles.name} numberOfLines={1}>{r.name}</Text>
              <Text style={styles.emoji}>{r.emoji}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
  },

  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
  },

  // Title centred, with the rule that closes the header off sitting directly
  // under it — the list starts below the line.
  header: {
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },

  title: {
    ...Type.header,
    color: '#000',
    textAlign: 'center',
  },

  list: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 40,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },

  pic: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
    backgroundColor: '#e2e2e2',
  },

  // Takes the space between the picture and the emoji, so the emoji is pinned
  // to the right edge however long the name is.
  name: {
    ...Type.body,
    color: '#000',
    flex: 1,
  },

  emoji: {
    fontSize: 22,
    marginLeft: 12,
  },
});
