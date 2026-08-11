import { Image } from 'expo-image';
import { Dimensions, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Defs, FeColorMatrix, Filter, Image as SvgImage } from 'react-native-svg';
import { Type } from '@/constants/theme';

const { width } = Dimensions.get('window');
const CARD_WIDTH = width - 40;
const CARD_HEIGHT = 200;

interface Props {
  groupName: string;
  firstImageUrl: string | null;
  suggesterPicUrl: string | null;
  tint?: 'bw';
  onPress: () => void;
  hideSuggesterPic?: boolean;
}

export default function GroupPostPreview({ groupName, firstImageUrl, suggesterPicUrl, tint, onPress, hideSuggesterPic }: Props) {
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
            href={{ uri: firstImageUrl }}
            width={CARD_WIDTH}
            height={CARD_HEIGHT}
            preserveAspectRatio="xMidYMid slice"
            filter="url(#grayscale)"
          />
        </Svg>
      ) : (
        <Image source={{ uri: firstImageUrl }} style={styles.photo} contentFit="cover" />
      )}

      {/* Suggester profile pic — top-right, stays in color even on greyed-out tiles.
          Suppressed entirely on screens with no suggester to attribute (Received). */}
      {hideSuggesterPic ? null : suggesterPicUrl ? (
        <Image source={{ uri: suggesterPicUrl }} style={styles.suggesterPic} contentFit="cover" />
      ) : (
        <View style={styles.suggesterPicPlaceholder} />
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
    borderWidth: 2,
    borderColor: '#fff',
  },

  suggesterPicPlaceholder: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: '#fff',
    backgroundColor: '#bbb',
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