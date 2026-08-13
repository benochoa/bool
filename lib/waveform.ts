// Turns the recorder's metering samples into the bars drawn under a voice
// message. Pure — the samples are collected in the chat thread while recording,
// since nothing can read them back out of the finished .m4a.

// Metering is dBFS: 0 is as loud as the format goes, and it falls away fast.
// Everything below this counts as silence. The main tuning knob — too low and
// every bar maxes out, too high and they're all stubs.
const FLOOR_DB = -50;

// Bars in a full-length waveform. A shorter recording yields fewer and the row
// stretches them, rather than padding out to a fixed count with silence.
const DEFAULT_BUCKETS = 40;

// One metering reading, as a height between 0 and 1. Shared with the live meter
// in the composer so the bars you watch while recording are drawn to the same
// scale as the ones that end up saved on the message.
export function normalizeLevel(db: number): number {
  const clamped = Math.min(0, Math.max(FLOOR_DB, db));
  return (clamped - FLOOR_DB) / -FLOOR_DB;
}

export function buildWaveform(samples: number[], buckets = DEFAULT_BUCKETS): number[] {
  // Metering is optional in RecorderState, and the first tick or two can land
  // before the mic is really running.
  const usable = samples.filter(s => Number.isFinite(s));
  if (usable.length === 0) return [];

  const levels = usable.map(normalizeLevel);

  const count = Math.min(buckets, levels.length);
  const perBucket = levels.length / count;

  const bars: number[] = [];
  for (let i = 0; i < count; i++) {
    const start = Math.floor(i * perBucket);
    const end = Math.max(start + 1, Math.floor((i + 1) * perBucket));

    // Peak rather than mean: speech is mostly gaps, and averaging flattens it
    // into a uniform smear that reads as noise instead of talking.
    let peak = 0;
    for (let j = start; j < end && j < levels.length; j++) {
      if (levels[j] > peak) peak = levels[j];
    }
    // Two decimals is far finer than a 20px bar can show, and keeps the whole
    // array around 200 bytes on the row.
    bars.push(Math.round(peak * 100) / 100);
  }
  return bars;
}
