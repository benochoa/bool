import { Image } from 'expo-image';
import { ReactNode, useEffect, useState } from 'react';
import { Dimensions, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { runOnJS } from 'react-native-worklets';
import { Type } from '@/constants/theme';
import { GroupSummary } from '@/lib/fetchGroupSummaries';
import { Key } from '@/assets/symbols/Key';
import { Plus } from '@/assets/symbols/Plus';

const { width, height } = Dimensions.get('window');
const GRID_WIDTH = width - 40;
const GAP = 12;
// Floored, so two tiles plus the gap can never round past the grid's width and
// drop the second column onto a row of its own.
const TILE_WIDTH = Math.floor((GRID_WIDTH - GAP) / 2);
// The band the pill sits in.
const HANDLE_HEIGHT = 28;
const PAD_TOP = 8;
// Clears the home indicator — with the sheet sized to its contents, there is no
// slack left under the bottom row.
const PAD_BOTTOM = 34;
// As tall as the sheet is allowed to get. Nothing here scrolls, so this is a
// budget the tiles are fitted into rather than a window onto more of them.
const MAX_SHEET_HEIGHT = height * 0.85;

const EASE = Easing.inOut(Easing.ease);
const ENTER = { duration: 250, easing: EASE };
const EXIT = { duration: 200, easing: EASE };
const SNAP_BACK = { duration: 180, easing: EASE };

// Dragged this far down, or thrown this fast, the swipe is a dismissal.
const DISMISS_FRACTION = 0.3;
const DISMISS_VELOCITY = 800;

// Tiles are a fixed half-width, so the grid's shape follows from how many there
// are — no measuring pass, and a member of one group doesn't get a sheet sized
// for six. Square until squares would overrun the budget, after which they give
// up height: a shorter card still shows its photo and its name, where an
// overflowing row would just be gone.
function layoutFor(tileCount: number) {
  const rows = Math.ceil(tileCount / 2);
  const chrome = HANDLE_HEIGHT + PAD_TOP + PAD_BOTTOM + (rows - 1) * GAP;
  const tile = Math.min(TILE_WIDTH, Math.floor((MAX_SHEET_HEIGHT - chrome) / rows));
  return { tile, height: chrome + rows * tile };
}

// Every tile is the same square with its name across the bottom. A group fills
// it with its photo, and takes the pending/received tiles' white-over-photo
// name with it; an action leaves the grey showing and centers an icon on it.
function Tile({ label, height, imageUrl, onPress, children }: {
  label: string;
  // Set by the grid, which is the only thing that knows how much room there is.
  height: number;
  imageUrl?: string | null;
  onPress: () => void;
  children?: ReactNode;
}) {
  return (
    <TouchableOpacity style={[styles.tile, { height }]} onPress={onPress}>
      {imageUrl ? <Image source={{ uri: imageUrl }} style={styles.photo} contentFit="cover" /> : children}
      <Text style={[styles.tileLabel, imageUrl ? styles.tileLabelOnPhoto : null]} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );
}

interface Props {
  visible: boolean;
  groups: GroupSummary[];
  onSelect: (id: string) => void;
  onCreate: () => void;
  onJoin: () => void;
  onClose: () => void;
  // Fires once the sheet has finished sliding out and this modal is really
  // gone. Anything that opens a modal of its own has to wait for it: iOS drops
  // a presentation requested while another modal is still on screen.
  onClosed?: () => void;
}

export default function GroupSwitcher({ visible, groups, onSelect, onCreate, onJoin, onClose, onClosed }: Props) {

  // Modal's own "slide" animates the tint along with the sheet. Driving the
  // sheet here instead lets the tint be instant in both directions — which
  // means staying mounted until the closing slide has finished.
  const [mounted, setMounted] = useState(visible);
  // 0 open, 1 resting offscreen. Animating in these units rather than in pixels
  // keeps the resting place from going stale: the sheet is pushed down by
  // exactly its own height, and that height moves with the group count.
  const y = useSharedValue(1);
  // The two action tiles are always there, so they count toward the layout.
  const { tile, height: sheetHeight } = layoutFor(groups.length + 2);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      y.value = withTiming(0, ENTER);
    } else {
      // Picks up wherever a swipe left the sheet, so a dismissal carries on
      // down from the finger rather than jumping back to full height first.
      y.value = withTiming(1, EXIT, done => {
        if (done) {
          runOnJS(setMounted)(false);
          if (onClosed) runOnJS(onClosed)();
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, y]);

  // Drag down anywhere on the sheet to dismiss. Since the grid always fits,
  // there is no scroll underneath to compete for the same drag — the pill just
  // advertises what the whole sheet already does.
  const pan = Gesture.Pan()
    .activeOffsetY(8)
    .onUpdate(e => {
      // Down only: there is nothing above the sheet to pull it up into.
      y.value = Math.max(0, e.translationY) / sheetHeight;
    })
    // onFinalize, not onEnd — a cancelled drag has to resolve too, or the sheet
    // would stay stuck at an offset.
    .onFinalize((e, success) => {
      const dismissed = success
        && (e.translationY > sheetHeight * DISMISS_FRACTION || e.velocityY > DISMISS_VELOCITY);
      // Closing is the caller's to do: the slide-out is driven by `visible`
      // going false, the same as every other way out of this sheet.
      if (dismissed) runOnJS(onClose)();
      else y.value = withTiming(0, SNAP_BACK);
    });

  const slide = useAnimatedStyle(() => ({ transform: [{ translateY: y.value * sheetHeight }] }));

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
      {/* A Modal is a native view hierarchy of its own, which the app's gesture
          root at the top of the tree doesn't reach into — so anything dragged in
          here needs a root of its own. */}
      <GestureHandlerRootView style={styles.root}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
          <GestureDetector gesture={pan}>
            <Animated.View
              style={[styles.sheet, { height: sheetHeight }, slide]}
              onStartShouldSetResponder={() => true}
            >
              <View style={styles.handle}>
                <View style={styles.pill} />
              </View>

              <View style={styles.grid}>
                {groups.map(group => (
                  <Tile
                    key={group.id}
                    label={group.name}
                    height={tile}
                    imageUrl={group.image_urls?.[0]}
                    onPress={() => onSelect(group.id)}
                  />
                ))}

                {/* Actions — last, so they fill in after the real groups. */}
                <Tile label="Create a group" height={tile} onPress={onCreate}>
                  <Plus size={36} color="#000" />
                </Tile>
                <Tile label="Join a group" height={tile} onPress={onJoin}>
                  <Key size={36} color="#000" />
                </Tile>
              </View>
            </Animated.View>
          </GestureDetector>
        </TouchableOpacity>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },

  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },

  // Height is set per render — see layoutFor.
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
  },

  handle: {
    height: HANDLE_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },

  pill: {
    width: 40,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#ccc',
  },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GAP,
    paddingHorizontal: 20,
    paddingTop: PAD_TOP,
    paddingBottom: PAD_BOTTOM,
  },

  // The grey is both the icon tiles' backdrop and a photo's placeholder. Height
  // comes from the grid.
  tile: {
    width: TILE_WIDTH,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#eee',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },

  photo: {
    ...StyleSheet.absoluteFillObject,
  },

  // The pending/received tiles' name, scaled for a tile half their width.
  tileLabel: {
    ...Type.title,
    fontSize: 16,
    position: 'absolute',
    bottom: 10,
    left: 12,
    right: 12,
    color: '#000',
  },

  // Over a photo the name has to survive whatever is behind it, so it takes the
  // same white and soft shadow those tiles use rather than a bar to sit on.
  tileLabelOnPhoto: {
    color: '#fff',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
});
