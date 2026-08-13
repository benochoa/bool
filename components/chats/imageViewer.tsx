import { useState } from 'react';
import { ActivityIndicator, Alert, Dimensions, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Directory, File, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import { XMark } from '@/assets/symbols/XMark';
import { Type } from '@/constants/theme';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const MIN_SCALE = 1;
const MAX_SCALE = 6;
// What a double tap jumps to, and back from.
const DOUBLE_TAP_SCALE = 2.5;

interface Props {
  // Null when closed.
  url: string | null;
  onClose: () => void;
}

// A chat photo at full size, over everything. Rendered by the screen rather
// than by the thread: panning a zoomed photo inside the thread's SlideOver
// would race that panel's swipe-to-dismiss, and closing the whole chat out from
// under the photo is not what a drag on a photo should do.
export default function ImageViewer({ url, onClose }: Props) {
  const [saving, setSaving] = useState(false);
  const [permission, requestPermission] = MediaLibrary.usePermissions();

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  function reset() {
    scale.value = withTiming(1);
    savedScale.value = 1;
    translateX.value = withTiming(0);
    translateY.value = withTiming(0);
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSave() {
    if (!url) return;
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
      const file = await File.downloadFileAsync(url, destination);

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

  // Only once zoomed in — at 1x there is nothing to pan to, and a drag that did
  // nothing visible would still swallow the tap that closes the viewer.
  const pan = Gesture.Pan()
    .onUpdate(e => {
      if (scale.value <= MIN_SCALE) return;
      translateX.value = savedTranslateX.value + e.translationX;
      translateY.value = savedTranslateY.value + e.translationY;
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
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

  const imageStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  if (!url) return null;

  return (
    <View style={styles.overlay}>
      <GestureDetector gesture={gesture}>
        <Animated.View style={styles.imageWrap}>
          <Animated.View style={imageStyle}>
            <Image
              source={{ uri: url }}
              style={styles.image}
              contentFit="contain"
            />
          </Animated.View>
        </Animated.View>
      </GestureDetector>

      <TouchableOpacity style={styles.closeButton} onPress={handleClose} hitSlop={12}>
        <XMark size={24} color="#fff" />
      </TouchableOpacity>

      <TouchableOpacity style={styles.saveButton} onPress={handleSave} disabled={saving}>
        {saving ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.saveText}>Save</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  // Above the thread and its panels, and opaque black so a contain-fitted photo
  // has something to sit on rather than showing the chat through its margins.
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
    zIndex: 30,
  },

  imageWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  image: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
  },

  closeButton: {
    position: 'absolute',
    top: 60,
    left: 20,
    height: 44,
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },

  saveButton: {
    position: 'absolute',
    top: 60,
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
