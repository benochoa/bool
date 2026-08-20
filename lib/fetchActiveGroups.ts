import { supabase } from '@/supabaseClient';

export interface ActiveGroup {
  id: string;
  // Picked from a fixed list, so two groups in the same place hold the same
  // string. Null only on rows saved before a city was required.
  city: string | null;
}

// Every joinable group for the Discover feed. Dissolved groups are excluded —
// only active groups should ever be recommended. Ordered by id, which is the
// order the deck deals them in: the screen's filters remove entries but never
// reorder what's left.
//
// City rides along rather than being filtered server-side so this stays in the
// same parallel batch as the rest of the feed's data. Filtering in the query
// would mean learning my own city first and waiting on that round trip before
// asking for candidates at all.
export async function fetchActiveGroups(): Promise<ActiveGroup[]> {
  const { data, error } = await supabase
    .from('groups')
    .select('id, city')
    .eq('status', 'active')
    .order('id');
  if (error || !data) return [];
  return data.map(row => ({ id: row.id, city: row.city ?? null }));
}
