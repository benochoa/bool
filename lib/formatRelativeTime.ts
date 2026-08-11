// How long ago, in the shortest form that still reads: now, 2m, 4h, 7d, 3w, 1y.
// Computed at render — nothing re-renders on a clock, so a row's "2m" only
// becomes "3m" once the list refetches. That's deliberate: the age of the last
// message is context, not something worth a timer per row.
export function formatRelativeTime(iso: string): string {
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000;
  if (seconds < 60) return 'now';

  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.floor(minutes)}m`;

  const hours = minutes / 60;
  if (hours < 24) return `${Math.floor(hours)}h`;

  const days = hours / 24;
  if (days < 7) return `${Math.floor(days)}d`;

  const weeks = days / 7;
  // Rolls straight from weeks to years — a "13mo" step would need calendar
  // months, and nothing here is precise enough to be worth that.
  if (days < 365) return `${Math.floor(weeks)}w`;

  return `${Math.floor(days / 365)}y`;
}