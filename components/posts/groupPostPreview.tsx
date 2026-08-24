import { Image } from 'expo-image';
import { authedSource } from '@/lib/storageAuth';
import { Dimensions, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Defs, FeColorMatrix, Filter, Image as SvgImage } from 'react-native-svg';
import { Type } from '@/constants/theme';

const { width } = Dimensions.get('window');
const CARD_WIDTH = width - 40;
const CARD_HEIGHT = 200;

// The same red as the tab badges, so the ring reads as the same "waiting on
// you" mark they do rather than as its own signal.
const RING_ALERT = '#FF3B30';

interface Props {
  groupName: string;
  firstImageUrl: string | null;
  suggesterPicUrl: string | null;
  tint?: 'bw';
  onPress: () => void;
  hideSuggesterPic?: boolean;
  // Rings the suggester in the notification red rather than white — Pending
  // only, where the tile is something still waiting on someone.
  alertRing?: boolean;
}

export default function GroupPostPreview({ groupName, firstImageUrl, suggesterPicUrl, tint, onPress, hideSuggesterPic, alertRing }: Props) {
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.9}>

      {/* Photo layer */}
      {!firstImageUrl ? (
        <View style={styles.placeholder} />
      ) : tint === 'bw' ? (
        // Desaturated to black & white via an SVG color matrix — RN has no
        // native grayscale filter, and react-native-svg is already a dep.
        <Svg width={CARD_WIDTH} height={CARD_HEIGHT}>
          <Defs>
            <Filter id="grayscale">
              <FeColorMatrix type="saturate" values="0" />
            </Filter>
          </Defs>
          <SvgImage
            // Same token the plain <Image> below carries — the bucket is
            // private, and this path is easy to miss because it's an SVG
            // image with an href rather than a source.
            href={authedSource(firstImageUrl)}
            width={CARD_WIDTH}
            height={CARD_HEIGHT}
            preserveAspectRatio="xMidYMid slice"
            filter="url(#grayscale)"
          />
        </Svg>
      ) : (
        <Image source={authedSource(firstImageUrl)} style={styles.photo} contentFit="cover" />
      )}

      {/* Suggester profile pic — top-right, stays in color even on greyed-out tiles.
          Suppressed entirely on screens with no suggester to attribute (Received). */}
      {hideSuggesterPic ? null : suggesterPicUrl ? (
        <Image
          source={authedSource(suggesterPicUrl)}
          style={[styles.suggesterPic, alertRing && styles.suggesterRingAlert]}
          contentFit="cover"
        />
      ) : (
        <View style={[styles.suggesterPicPlaceholder, alertRing && styles.suggesterRingAlert]} />
      )}

      {/* Group name — bottom-left, over the photo */}
      <Text style={styles.name} numberOfLines={1}>{groupName}</Text>

    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 16,
    backgroundColor: '#eee',
  },

  photo: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
  },

  placeholder: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    backgroundColor: '#ddd',
  },

  suggesterPic: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: '#fff',
  },

  suggesterPicPlaceholder: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: '#fff',
    backgroundColor: '#bbb',
  },

  suggesterRingAlert: {
    borderColor: RING_ALERT,
  },

  name: {
    ...Type.title,
    position: 'absolute',
    bottom: 12,
    left: 16,
    right: 16,
    color: '#fff',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
});