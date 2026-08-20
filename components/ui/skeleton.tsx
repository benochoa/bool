import { Animated, Dimensions, DimensionValue, StyleSheet, View } from 'react-native';

const { width } = Dimensions.get('window');

// Matches the card width every post and tile already uses.
const CARD_WIDTH = width - 40;
// The 200pt preview tile, from groupPostPreview.
const TILE_HEIGHT = 200;

// A step darker than the white cards these sit on, which is what makes a block
// read as "something goes here" rather than as a gap in the layout.
const SHADE = '#E4E4E8';

// One shared pulse, defined here rather than per block, so every placeholder on
// screen breathes in unison — a dozen independently started loops drift out of
// phase and turn a calm screen into a flicker. It runs on the native driver, so
// leaving it looping costs nothing while no skeleton is mounted.
const pulse = new Animated.Value(1);
Animated.loop(
  Animated.sequence([
    Animated.timing(pulse, { toValue: 0.45, duration: 900, useNativeDriver: true }),
    Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
  ])
).start();

interface BlockProps {
  width?: DimensionValue;
  height?: number;
  radius?: number;
  style?: object;
}

// One grey block. Everything below is these, arranged to the same numbers the
// real components use.
export function Skeleton({ width = '100%', height = 12, radius = 6, style }: BlockProps) {
  return (
    <Animated.View
      style={[{ width, height, borderRadius: radius, backgroundColor: SHADE, opacity: pulse }, style]}
    />
  );
}

// Repeats a block `count` times — the number is a guess at how many rows are
// coming, and deliberately reads as one: nobody takes four grey rows to mean
// there are exactly four chats.
export function SkeletonList({ count, children }: { count: number; children: (i: number) => React.ReactNode }) {
  return <>{Array.from({ length: count }, (_, i) => children(i))}</>;
}

// A chat row. The 52pt photo sets the height here exactly as it does on a real
// row, so the list doesn't resize when the messages land.
export function ChatRowSkeleton() {
  return (
    <View style={styles.chatRow}>
      <Skeleton width={52} height={52} radius={8} />
      <View style={styles.chatText}>
        <Skeleton width="45%" height={14} />
        <Skeleton width="70%" height={12} style={styles.chatSecondLine} />
      </View>
    </View>
  );
}

// The preview tile — Received, Pending, and History all deal the same one.
export function TileSkeleton() {
  return <Skeleton width={CARD_WIDTH} height={TILE_HEIGHT} radius={16} style={styles.tile} />;
}

// A section heading — short, and spaced off the rows the way a real one is.
export function HeadingSkeleton() {
  return <Skeleton width="30%" height={13} style={styles.heading} />;
}

// A name with a chevron after it: History's rows, and the two group rows in a
// chat's details. No photo, so the row is only as tall as its text and padding.
export function NameRowSkeleton({ width = '55%' }: { width?: DimensionValue }) {
  return (
    <View style={styles.nameRow}>
      <Skeleton width={width} height={15} />
      <Skeleton width={8} height={14} radius={2} />
    </View>
  );
}

// A blocked-person row: the 36pt circle and the name beside it.
export function PersonRowSkeleton() {
  return (
    <View style={styles.personRow}>
      <Skeleton width={36} height={36} radius={18} />
      <Skeleton width="55%" height={14} style={styles.personName} />
    </View>
  );
}

// A post — group or person. The photo's real height depends on the aspect ratio
// stored on the row, which isn't known yet, so this takes a square: close
// enough that the cards below it only shift a little when the real one lands.
export function PostSkeleton({ topInset }: { topInset?: number }) {
  return (
    <View style={[styles.post, topInset !== undefined && { paddingTop: topInset }]}>
      <Skeleton width={CARD_WIDTH} height={CARD_WIDTH} radius={8} />
      <Skeleton width="60%" height={22} style={styles.postName} />
      <Skeleton width={CARD_WIDTH} height={96} radius={8} style={styles.postCard} />
      <Skeleton width={CARD_WIDTH} height={96} radius={8} style={styles.postCard} />
    </View>
  );
}

// Chat bubbles, alternating sides at uneven widths — a column of identical bars
// reads as a list, not as a conversation.
const BUBBLE_WIDTHS: DimensionValue[] = ['55%', '38%', '68%', '45%', '60%'];

export function MessageSkeleton() {
  return (
    <View style={styles.messages}>
      {BUBBLE_WIDTHS.map((w, i) => (
        <View key={i} style={[styles.bubbleRow, i % 2 === 1 && styles.bubbleRowMine]}>
          <Skeleton width={w} height={36} radius={16} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  chatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },

  chatText: {
    flex: 1,
    marginLeft: 12,
  },

  chatSecondLine: {
    marginTop: 6,
  },

  tile: {
    marginBottom: 16,
  },

  heading: {
    marginBottom: 8,
  },

  nameRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },

  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },

  personName: {
    marginLeft: 12,
  },

  post: {
    alignItems: 'center',
  },

  postName: {
    alignSelf: 'flex-start',
    marginLeft: 20,
    marginTop: 16,
  },

  postCard: {
    marginTop: 16,
  },

  messages: {
    paddingHorizontal: 20,
  },

  bubbleRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    marginBottom: 12,
  },

  bubbleRowMine: {
    justifyContent: 'flex-end',
  },
});
