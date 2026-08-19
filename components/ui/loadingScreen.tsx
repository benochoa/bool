import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

// The GIF's own ratio (1175x555), so it is never squashed. Width is a share of
// the screen rather than a fixed size so the mark stays large on every device;
// at 1175px the source is pixel-sharp out to ~390pt on a 3x screen, which 88%
// stays under on any phone.
const WIDTH = '88%';
const RATIO = 1175 / 555;

// Padding under the centred mark, which lifts it off true centre. Dead-centre
// reads as slightly low, since the eye takes the middle of a screen to be a
// little above the real one.
const RISE = 56;

interface Props {
  // Fired once the animation is actually on screen, which is the moment the
  // native splash can be torn down without a blank frame in between.
  onShown: () => void;
}

// What covers the screen while the session and the fonts load. The white matches
// the native splash's background (app.json), so the handoff from one to the
// other only swaps the mark, never the backdrop. It lies *over* the app rather
// than replacing it, so everything underneath mounts and fetches while it plays.
export default function LoadingScreen({ onShown }: Props) {
  return (
    <View style={styles.container}>
      <Image
        source={require('@/assets/animations/loading.gif')}
        style={styles.animation}
        contentFit="contain"
        onDisplay={onShown}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: RISE,
    backgroundColor: '#fff',
  },

  animation: {
    width: WIDTH,
    aspectRatio: RATIO,
  },
});
