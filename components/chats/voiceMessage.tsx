import { Pause } from '@/assets/symbols/Pause';
import { Play } from '@/assets/symbols/Play';
import { FontFamily } from '@/constants/theme';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

// m:ss — voice notes are short enough that hours never come up.
function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

// One message's recording: a play/pause button, a progress track and a clock.
// A component rather than part of the bubble's render, because each recording
// needs a player of its own and hooks can't be called inside the message map.
export default function VoiceMessage({ url, mine }: { url: string; mine: boolean }) {
  const player = useAudioPlayer(url);
  const status = useAudioPlayerStatus(player);

  // Reads against the bubble it sits in — mine is black, theirs is light grey.
  const color = mine ? '#fff' : '#000';
  const trackColor = mine ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.15)';

  const progress = status.duration > 0 ? Math.min(1, status.currentTime / status.duration) : 0;
  // The clock counts up while playing and shows the full length at rest, so a
  // message that hasn't been opened still says how long it is.
  const shown = status.playing ? status.currentTime : status.duration;

  function toggle() {
    if (status.playing) {
      player.pause();
      return;
    }
    // Playing a finished recording restarts it rather than doing nothing.
    if (status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration)) {
      player.seekTo(0);
    }
    player.play();
  }

  return (
    <TouchableOpacity style={styles.row} onPress={toggle} activeOpacity={0.7}>
      {status.playing ? <Pause size={18} color={color} /> : <Play size={18} color={color} />}
      <View style={[styles.track, { backgroundColor: trackColor }]}>
        <View style={[styles.fill, { backgroundColor: color, width: `${progress * 100}%` }]} />
      </View>
      <Text style={[styles.time, { color }]}>
        {status.isLoaded ? formatDuration(shown) : '--:--'}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    // Wide enough that the track is worth having, narrow enough to stay inside
    // the bubble's own 75% cap.
    width: 180,
    paddingVertical: 2,
  },

  track: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    overflow: 'hidden',
  },

  fill: {
    height: 3,
    borderRadius: 2,
  },

  time: {
    fontFamily: FontFamily.regular,
    fontSize: 12,
    // Fixed, so the row doesn't shuffle as the digits tick over.
    width: 34,
    textAlign: 'right',
  },
});