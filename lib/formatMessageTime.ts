// The time separator that sits above a message in a thread, or null when the
// message follows closely enough on the last one that marking it would just be
// noise. A rapid back-and-forth gets one heading, not one per bubble.
//
// Clock and date formats come from the device's locale, so 12- and 24-hour
// phones each read the way their owner expects without a setting here.

// Long enough that a conversation reads as one stretch, short enough that
// picking it up after lunch is plainly a new one.
const GAP_MS = 30 * 60 * 1000;

// Calendar days between two moments, ignoring the time of day — 11:59pm and
// 12:01am are one day apart, not two minutes. Rounded, so the 23- and 25-hour
// days either side of a daylight-saving change don't come out fractional.
function daysApart(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

function clock(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// The per-message time held off the right edge of the thread, revealed by
// dragging the list to the left. Only the clock: the separators above already
// establish which day everything under them belongs to.
export function messageClock(iso: string): string {
  return clock(new Date(iso));
}

// How to name the day a message landed on, from the most familiar form down.
function dayLabel(date: Date, now: Date): string {
  const days = daysApart(date, now);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  // Inside the last week the weekday alone places it, and can't be confused
  // with this week's — seven days back is already a date.
  if (days < 7) return date.toLocaleDateString(undefined, { weekday: 'long' });
  return date.toLocaleDateString(
    undefined,
    // The year only when it isn't the current one; carrying it always would put
    // "2026" over most of the thread for nothing.
    date.getFullYear() === now.getFullYear()
      ? { month: 'long', day: 'numeric' }
      : { month: 'long', day: 'numeric', year: 'numeric' }
  );
}

export function messageSeparator(iso: string, previousIso: string | null): string | null {
  const date = new Date(iso);
  const previous = previousIso ? new Date(previousIso) : null;

  // Same day as the message above: a heading only once the conversation has
  // actually paused, and the day is already established further up, so the
  // clock alone says everything new.
  if (previous && daysApart(previous, date) === 0) {
    return date.getTime() - previous.getTime() < GAP_MS ? null : clock(date);
  }

  // A new day always gets marked, however close the two messages are — and so
  // does the first message in the thread, which has no previous to compare to.
  return `${dayLabel(date, new Date())} ${clock(date)}`;
}
