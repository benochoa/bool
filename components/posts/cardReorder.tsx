import { ReactNode } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  SharedValue, useAnimatedStyle, useSharedValue, withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import * as Haptics from 'expo-haptics';
import { CardSlot, slotKey } from '@/lib/cardOrder';

const { width } = Dimensions.get('window');
const CARD_WIDTH = width - 40;

// Every slot is the same height whatever the card's real shape, which is what
// keeps the drag arithmetic to one rounded division. 240 is the Q&A card's own
// height, so Q&A cards sit here unscaled and stay comfortable to type into;
// only photos shrink.
const SLOT_HEIGHT = 240;
const SLOT_GAP = 20;
const PITCH = SLOT_HEIGHT + SLOT_GAP;
const HANDLE_WIDTH = 44;
const CARD_INSET = 8;

// What a card actually gets to draw in, once the handle column and the slot's
// own inset are taken out.
export const EDIT_CARD_WIDTH = CARD_WIDTH - HANDLE_WIDTH - CARD_INSET * 2;
export const EDIT_CARD_HEIGHT = SLOT_HEIGHT - CARD_INSET * 2;

interface Props {
  order: CardSlot[];
  onReorder: (next: CardSlot[]) => void;
  renderCard: (slot: CardSlot) => ReactNode;
}

// Edit-mode stack: each card sits in a fixed-size bordered slot with a drag
// handle, and holding the handle lets you drag the card to a new position.
export default function CardReorder({ order, onReorder, renderCard }: Props) {
  // -1 whenever nothing is being dragged.
  const draggingIndex = useSharedValue(-1);
  const dragY = useSharedValue(0);

  function commit(from: number, to: number) {
    if (from === to) return;
    const next = [...order];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onReorder(next);
  }

  // Runs after commit (both are queued from the gesture in order), so the
  // offsets clear in the same JS tick that re-renders the new order — otherwise
  // the dragged card would flash back to where it started for a frame.
  function reset() {
    draggingIndex.value = -1;
    dragY.value = 0;
  }

  return (
    <View>
      {order.map((slot, i) => (
        <Slot
          key={slotKey(slot)}
          index={i}
          count={order.length}
          draggingIndex={draggingIndex}
          dragY={dragY}
          onCommit={commit}
          onReset={reset}
        >
          {renderCard(slot)}
        </Slot>
      ))}
    </View>
  );
}

function targetIndex(from: number, offset: number, count: number) {
  'worklet';
  const moved = from + Math.round(offset / PITCH);
  return Math.min(count - 1, Math.max(0, moved));
}

// Fired from the drag worklet through scheduleOnRN — haptics are a JS-thread call.
function tap() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

function Slot({ index, count, draggingIndex, dragY, onCommit, onReset, children }: {
  index: number;
  count: number;
  draggingIndex: SharedValue<number>;
  dragY: SharedValue<number>;
  onCommit: (from: number, to: number) => void;
  onReset: () => void;
  children: ReactNode;
}) {
  // activateAfterLongPress is what lets this live inside a ScrollView: a plain
  // swipe scrolls as usual, and only a deliberate hold starts a drag.
  const pan = Gesture.Pan()
    .activateAfterLongPress(250)
    .onStart(() => {
      draggingIndex.value = index;
      dragY.value = 0;
      scheduleOnRN(tap);
    })
    .onUpdate(e => {
      dragY.value = e.translationY;
    })
    .onEnd(() => {
      scheduleOnRN(onCommit, index, targetIndex(index, dragY.value, count));
    })
    // onFinalize, not onEnd — a cancelled drag has to clear itself too, or the
    // card would stay stuck at an offset.
    .onFinalize(() => {
      scheduleOnRN(onReset);
    });

  // elevation alongside zIndex — on Android zIndex alone doesn't reliably lift
  // the dragged card above the ones it passes over.
  const animatedStyle = useAnimatedStyle(() => {
    const from = draggingIndex.value;
    if (from === -1) return { transform: [{ translateY: 0 }], zIndex: 0, elevation: 0 };
    // The card under the finger follows it, above everything else.
    if (from === index) {
      return { transform: [{ translateY: dragY.value }], zIndex: 10, elevation: 10 };
    }
    // Cards the dragged one has passed slide one slot the other way, opening
    // the gap it would land in.
    const to = targetIndex(from, dragY.value, count);
    let shift = 0;
    if (from < index && to >= index) shift = -PITCH;
    else if (from > index && to <= index) shift = PITCH;
    return { transform: [{ translateY: withTiming(shift, { duration: 150 }) }], zIndex: 0, elevation: 0 };
  });

  return (
    <Animated.View style={[styles.slot, animatedStyle]}>
      <GestureDetector gesture={pan}>
        <View style={styles.handle}>
          <View style={styles.handleLine} />
          <View style={styles.handleLine} />
          <View style={styles.handleLine} />
        </View>
      </GestureDetector>
      <View style={styles.cardArea}>{children}</View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({

  // The border marks the slot the card occupies in the running order — the
  // card itself is drawn smaller inside it.
  slot: {
    width: CARD_WIDTH,
    height: SLOT_HEIGHT,
    marginTop: SLOT_GAP,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
  },

  handle: {
    width: HANDLE_WIDTH,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },

  handleLine: {
    width: 18,
    height: 2,
    borderRadius: 1,
    backgroundColor: '#999',
  },

  cardArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

});
