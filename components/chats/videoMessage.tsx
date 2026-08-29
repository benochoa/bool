import { useVideoPlayer, VideoView } from 'expo-video';
import { useRef, useState } from 'react';
import { Pressable, StyleProp, StyleSheet, ViewStyle } from 'react-native';

import { authedSource } from '@/lib/storageAuth';

// A video inside a bubble, and the same component again on the confirm screen
// before one is sent. Its own component rather than inline JSX because
// useVideoPlayer is a hook: a thread renders its messages in a map, and a hook
// cannot be called from inside one. Mounting a component per video gives each
// its own player and tears it down with the row.
//
// authedSource supplies the auth header for a stored URL and nothing for a
// local file:// still on its way to being sent — expo-video takes the same
// { uri, headers } shape expo-image does, so both work unchanged.
interface Props {
  url: string;
  // The clip's real shape, carried on the row so the bubble can size itself
  // before the file has loaded. Square is the fallback for older rows.
  aspectRatio: number | null;
  style?: StyleProp<ViewStyle>;
  contentFit?: 'cover' | 'contain';
  // Controls drawn over the video itself. Off in a thread, where a bubble is
  // meant to read as a still and a transport bar over every one of them is
  // clutter — there a tap opens the video instead. On for the confirm screen,
  // which exists precisely so a clip can be scrubbed before it is sent.
  controls?: boolean;
}

export default function VideoMessage({
  url,
  aspectRatio,
  style,
  contentFit = 'cover',
  controls = false,
}: Props) {
  const viewRef = useRef<VideoView>(null);
  const [fullscreen, setFullscreen] = useState(false);

  // Deliberately does not autoplay: a thread scrolled through half a dozen
  // videos would otherwise start all of them at once.
  const player = useVideoPlayer(authedSource(url), p => {
    p.loop = false;
  });

  // Fullscreen is the same view presented large, not a different one — so both
  // of the settings that keep a bubble clean have to come back off for it, or
  // it opens with no transport and, because it ignores touches, no way out
  // either. Not a thread bubble any more once it is filling the screen.
  const showControls = controls || fullscreen;

  const video = (
    <VideoView
      ref={viewRef}
      style={[styles.video, { aspectRatio: aspectRatio ?? 1 }, style]}
      player={player}
      contentFit={contentFit}
      nativeControls={showControls}
      allowsFullscreen
      // With its controls off the view still swallows touches, so the tap never
      // reaches the wrapper below. Ignoring them hands it straight through.
      pointerEvents={showControls ? 'auto' : 'none'}
      onFullscreenEnter={() => setFullscreen(true)}
      onFullscreenExit={() => {
        setFullscreen(false);
        // Leaving the video running behind the thread it was dismissed from is
        // the one thing nobody wants after swiping out of it.
        player.pause();
      }}
    />
  );

  if (controls) return video;

  return (
    <Pressable
      onPress={() => {
        // Flipped before the call, not after: entering first would present the
        // fullscreen player built from the props it has at that instant, which
        // are still the bare ones. The frame's wait is what lets the re-render
        // land before the presentation reads them.
        setFullscreen(true);
        player.play();
        requestAnimationFrame(() => viewRef.current?.enterFullscreen());
      }}
    >
      {video}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  video: {
    width: '100%',
    borderRadius: 12,
    backgroundColor: '#000',
  },
});
