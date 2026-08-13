import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { normalizeLevel } from '@/lib/waveform';

// How often the drawn bars catch up with the samples being collected.
const REFRESH_MS = 100;
// Bars kept on screen. Once past this the row scrolls: newest at the right,
// oldest falling off the left, so a long recording stays legible instead of
// squeezing sixty seconds into the width of the composer.
const MAX_BARS = 34;

const MIN_BAR = 3;
const MAX_BAR = 20;

interface Props {
  // The same array the thread is filling while the mic is held. Read rather
  // than subscribed to: this is the only thing that needs to redraw at speed,
  // so the ticking lives here instead of in the thread, where it would re-render
  // every message in the conversation ten times a second.
  samples: { current: number[] };
  color: string;
}

// The meter in the composer while a message is being recorded.
export default function LiveWaveform({ samples, color }: Props) {
  const [bars, setBars] = useState<number[]>([]);

  useEffect(() => {
    const id = setInterval(() => {
      setBars(samples.current.slice(-MAX_BARS).map(normalizeLevel));
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [samples]);

  return (
    <View style={styles.row}>
      {bars.map((level, i) => (
        <View
          key={i}
          style={[
            styles.bar,
            { height: MIN_BAR + level * (MAX_BAR - MIN_BAR), backgroundColor: color },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // Fills from the right, so the newest bar is always in the same place rather
  // than the whole row growing out of the middle.
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    height: MAX_BAR,
    gap: 2,
  },

  // Fixed width, unlike the saved waveform's flexed bars: these arrive one at a
  // time, and bars that reflowed on every tick would shimmer.
  bar: {
    width: 3,
    borderRadius: 1.5,
  },
});
