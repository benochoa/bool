import { useEffect, useState } from 'react';
import { authedSource, storageHeaders } from '@/lib/storageAuth';
import { ActivityIndicator, Alert, Dimensions, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing, useAnimatedStyle, useSharedValue, withTiming,
} from 'react-native-reanimated';
import { runOnJS } from 'react-native-worklets';
import { Directory, File, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import { XMark } from '@/assets/symbols/XMark';
import { Type } from '@/constants/theme';
import { HEADER_TOP } from '@/constants/layout';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const MIN_SCALE = 1;
const MAX_SCALE = 6;
// What a double tap jumps to, and back from.
const DOUBLE_TAP_SCALE = 2.5;

const EASE = Easing.out(Easing.ease);
const OPEN = { duration: 260, easing: EASE };
const CLOSE = { duration: 200, easing: EASE };
const SNAP_BACK = { duration: 180, easing: EASE };

// Dragging the photo this far, or throwing it this fast, closes the viewer.
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 800;
// How far it shrinks at the point of release, so the pull reads as taking the
// photo away rather than sliding it around.
const DISMISS_SHRINK = 0.25;
// How much of the black is pulled away with it, letting the thread show through.
const DISMISS_FADE = 0.7;

// Where the photo sits in the thread, so the viewer can grow out of it rather
// than appear over it.
export interface ViewerImage {
  url: string;
  rect: { x: number; y: number; width: number; height: number };
  // From the message row. Null for older rows that predate the column, in which
  // case the shape it occupies in the thread is the best guess available.
  aspectRatio: number | null;
}

interface Props {
  // Null when closed. The last one is held through the closing animation.
  image: ViewerImage | null;
  onClose: () => void;
}

// A chat photo at full size, over everything. Rendered by the screen rather
// than by the thread: panning a zoomed photo inside the thread's SlideOver
// would race that panel's swipe-to-dismiss, and closing the whole chat out from
// under the photo is not what a drag on a photo should do.
export default function ImageViewer({ image, onClose }: Props) {
  const [saving, setSaving] = useState(false);
  const [permission, requestPermission] = MediaLibrary.usePermissions();
  // Outlives `image` by one animation: the photo has to still be on screen to
  // be watched shrinking back into the thread.
  const [shown, setShown] = useState<ViewerImage | null>(null);

  // 0 = sitting in the thread at its original size, 1 = open full screen.
  const progress = useSharedValue(0);

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  // Kept apart from the zoom pan above: that one moves the photo within the
  // frame, this one carries the whole thing off screen. Sharing values would
  // mean a half-finished dismiss leaving the zoom offset somewhere odd.
  const dismissX = useSharedValue(0);
  const dismissY = useSharedValue(0);

  useEffect(() => {
    if (image) {
      setShown(image);
      // Reset before growing, so a second photo doesn't inherit the zoom left
      // on the last one.
      scale.value = 1;
      savedScale.value = 1;
      translateX.value = 0;
      translateY.value = 0;
      savedTranslateX.value = 0;
      savedTranslateY.value = 0;
      dismissX.value = 0;
      dismissY.value = 0;
      progress.value = 0;
      progress.value = withTiming(1, OPEN);
    } else {
      // Any zoom is undone on the way out, so it shrinks back to the shape of
      // the bubble it came from rather than to a crop of it. The dismiss drag
      // unwinds too, so a photo flung halfway across the screen still lands
      // back on its own thumbnail instead of shrinking where it was let go.
      scale.value = withTiming(1, CLOSE);
      translateX.value = withTiming(0, CLOSE);
      translateY.value = withTiming(0, CLOSE);
      dismissX.value = withTiming(0, CLOSE);
      dismissY.value = withTiming(0, CLOSE);
      progress.value = withTiming(0, CLOSE, done => {
        if (done) runOnJS(setShown)(null);
      });
    }
  }, [image, progress, scale, savedScale, translateX, translateY, savedTranslateX, savedTranslateY, dismissX, dismissY]);

  async function handleSave() {
    if (!shown) return;
    setSaving(true);
    try {
      // Ask only when we don't already hold it: on iOS this is the add-only
      // prompt, which is all saveToLibraryAsync needs.
      if (!permission?.granted) {
        const next = await requestPermission();
        if (!next.granted) {
          setSaving(false);
          Alert.alert(
            'Permission needed',
            'Allow photo access in Settings to save pictures to your device.'
          );
          return;
        }
      }

      // saveToLibraryAsync only takes a local file, so the remote photo is
      // pulled into the cache directory first. Cache, not documents: once it is
      // in the photo library this copy is disposable.
      const destination = new Directory(Paths.cache, 'saved-photos');
      if (!destination.exists) destination.create();
      // The bucket is private, so this fetch needs the same token the <Image>
      // above carries — without it the download comes back 401.
      const file = await File.downloadFileAsync(shown.url, destination, {
        headers: await storageHeaders(),
      });

      await MediaLibrary.saveToLibraryAsync(file.uri);
      // The cached copy has done its job; the photo library owns it now.
      file.delete();

      setSaving(false);
      Alert.alert('Saved', 'The photo is in your library.');
    } catch {
      setSaving(false);
      Alert.alert('Save failed', 'The photo could not be saved.');
    }
  }

  const pinch = Gesture.Pinch()
    .onUpdate(e => {
      const next = savedScale.value * e.scale;
      scale.value = Math.min(Math.max(next, MIN_SCALE), MAX_SCALE);
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      // Pinching back out re-centres, so the photo can't be left zoomed to 1x
      // and pushed off to one side with no way to bring it back.
      if (scale.value <= MIN_SCALE) {
        translateX.value = withTiming(0);
        translateY.value = withTiming(0);
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
      }
    });

  // One drag, two meanings, decided by whether the photo is zoomed. Zoomed in
  // it moves the photo inside the frame, because there is more of it than fits.
  // At 1x the whole photo is already visible, so a drag can only mean taking it
  // away — which is the Apple Photos gesture: pull it in any direction, the
  // black fades with you, let go and it goes home.
  const pan = Gesture.Pan()
    .onUpdate(e => {
      if (scale.value > MIN_SCALE) {
        translateX.value = savedTranslateX.value + e.translationX;
        translateY.value = savedTranslateY.value + e.translationY;
        return;
      }
      dismissX.value = e.translationX;
      dismissY.value = e.translationY;
    })
    .onEnd(e => {
      if (scale.value > MIN_SCALE) {
        savedTranslateX.value = translateX.value;
        savedTranslateY.value = translateY.value;
        return;
      }
      const distance = Math.sqrt(dismissX.value ** 2 + dismissY.value ** 2);
      const speed = Math.sqrt(e.velocityX ** 2 + e.velocityY ** 2);
      if (distance > DISMISS_DISTANCE || speed > DISMISS_VELOCITY) {
        // Handing it to the parent rather than closing here: clearing `image`
        // is what runs the shrink-back-to-thumbnail animation above.
        runOnJS(onClose)();
        return;
      }
      dismissX.value = withTiming(0, SNAP_BACK);
      dismissY.value = withTiming(0, SNAP_BACK);
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      const zoomedIn = scale.value > MIN_SCALE;
      scale.value = withTiming(zoomedIn ? MIN_SCALE : DOUBLE_TAP_SCALE);
      savedScale.value = zoomedIn ? MIN_SCALE : DOUBLE_TAP_SCALE;
      if (zoomedIn) {
        translateX.value = withTiming(0);
        translateY.value = withTiming(0);
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
      }
    });

  // Pinch and pan run together; the double tap has to lose to a real pinch,
  // which Exclusive gives it by only firing when the others don't.
  const gesture = Gesture.Exclusive(Gesture.Simultaneous(pinch, pan), doubleTap);

  // Where it lands: the largest rect of the photo's own shape that fits the
  // screen, centred. Matching the shape means the same cover fit reads as a
  // contain fit once it arrives, so nothing crops or jumps at the end.
  const from = shown?.rect ?? { x: 0, y: 0, width: 0, height: 0 };
  const aspect = shown?.aspectRatio ?? (from.height > 0 ? from.width / from.height : 1);
  let toWidth = SCREEN_WIDTH;
  let toHeight = SCREEN_WIDTH / aspect;
  if (toHeight > SCREEN_HEIGHT) {
    toHeight = SCREEN_HEIGHT;
    toWidth = SCREEN_HEIGHT * aspect;
  }
  const toX = (SCREEN_WIDTH - toWidth) / 2;
  const toY = (SCREEN_HEIGHT - toHeight) / 2;

  // Grows from the thumbnail's place on screen to that rect. Laid out with
  // left/top/width/height rather than a scale, so the photo's shape is correct
  // at every frame instead of only at the two ends.
  const frameStyle = useAnimatedStyle(() => {
    const p = progress.value;
    // How far through a dismissing drag we are, 0 to 1.
    const drag = Math.min(
      Math.sqrt(dismissX.value ** 2 + dismissY.value ** 2) / DISMISS_DISTANCE,
      1
    );
    return {
      left: from.x + (toX - from.x) * p,
      top: from.y + (toY - from.y) * p,
      width: from.width + (toWidth - from.width) * p,
      height: from.height + (toHeight - from.height) * p,
      // Ends square, having started at the bubble's rounding.
      borderRadius: 12 * (1 - p),
      transform: [
        { translateX: translateX.value + dismissX.value },
        { translateY: translateY.value + dismissY.value },
        { scale: scale.value * (1 - DISMISS_SHRINK * drag) },
      ],
    };
  });

  // Thins out as the photo is pulled away, so the thread underneath comes back
  // into view and the drag shows what letting go would do.
  const backdropStyle = useAnimatedStyle(() => {
    const drag = Math.min(
      Math.sqrt(dismissX.value ** 2 + dismissY.value ** 2) / DISMISS_DISTANCE,
      1
    );
    return { opacity: progress.value * (1 - DISMISS_FADE * drag) };
  });

  if (!shown) return null;

  return (
    <View style={styles.overlay}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]} />

      <GestureDetector gesture={gesture}>
        <Animated.View style={[styles.frame, frameStyle]}>
          <Image source={authedSource(shown.url)} style={styles.image} contentFit="cover" />
        </Animated.View>
      </GestureDetector>

      {/* Fade in with the backdrop — buttons at full strength over a photo
          still in the middle of growing look like they belong to the thread. */}
      <Animated.View style={[styles.controls, backdropStyle]} pointerEvents="box-none">
        <TouchableOpacity style={styles.closeButton} onPress={onClose} hitSlop={12}>
          <XMark size={24} color="#fff" />
        </TouchableOpacity>

        <TouchableOpacity style={styles.saveButton} onPress={handleSave} disabled={saving}>
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.saveText}>Save</Text>
          )}
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Above the thread and its panels. Transparent itself — the black is the
  // backdrop below, which fades rather than appearing with the first frame.
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 30,
  },

  backdrop: {
    backgroundColor: '#000',
  },

  frame: {
    position: 'absolute',
    overflow: 'hidden',
  },

  image: {
    width: '100%',
    height: '100%',
  },

  controls: {
    ...StyleSheet.absoluteFillObject,
  },

  closeButton: {
    position: 'absolute',
    top: HEADER_TOP,
    left: 20,
    height: 44,
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },

  saveButton: {
    position: 'absolute',
    top: HEADER_TOP,
    right: 20,
    height: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },

  saveText: {
    ...Type.bodyBold,
    color: '#fff',
  },
});
