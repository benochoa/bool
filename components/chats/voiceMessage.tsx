import { Pause } from '@/assets/symbols/Pause';
import { Play } from '@/assets/symbols/Play';
import { FontFamily } from '@/constants/theme';
import { authedSource } from '@/lib/storageAuth';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

// Bar heights, in points. The floor keeps a silent stretch visible as a row of
// dots rather than a gap, so the waveform still reads as one shape.
const MIN_BAR = 3;
const MAX_BAR = 22;

// m:ss — voice notes are short enough that hours never come up.
function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

// One message's recording: a play/pause button, the waveform and a clock.
// A component rather than part of the bubble's render, because each recording
// needs a player of its own and hooks can't be called inside the message map.
export default function VoiceMessage(
  { url, mine, waveform }: { url: string; mine: boolean; waveform?: number[] | null }
) {
  // The recording lives in a private bucket, so the player has to carry the
  // viewer's token the same way an <Image> does.
  const player = useAudioPlayer(authedSource(url));
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
      {waveform && waveform.length > 0 ? (
        <View style={styles.waveform}>
          {waveform.map((level, i) => (
            <View
              key={i}
              style={[
                styles.bar,
                {
                  height: MIN_BAR + level * (MAX_BAR - MIN_BAR),
                  // A bar is played once the playhead has reached its share of
                  // the row, which is the same fraction the solid fill used.
                  backgroundColor: i / waveform.length <= progress ? color : trackColor,
                },
              ]}
            />
          ))}
        </View>
      ) : (
        // Recorded before waveforms existed, or metering returned nothing.
        <View style={[styles.track, { backgroundColor: trackColor }]}>
          <View style={[styles.fill, { backgroundColor: color, width: `${progress * 100}%` }]} />
        </View>
      )}
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

  // Bars are centred on one line and share the width the track used to take, so
  // a short recording's handful of bars stretches to fill the same row.
  waveform: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    height: MAX_BAR,
    gap: 2,
  },

  bar: {
    flex: 1,
    borderRadius: 1.5,
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