import { supabase } from '@/supabaseClient';

// Every joinable group for the Discover feed. Dissolved groups are excluded —
// only active groups should ever be recommended. Ordered by id, which is the
// order the deck deals them in: the screen's filters remove entries but never
// reorder what's left.
export async function fetchActiveGroupIds(): Promise<string[]> {
  const { data, error } = await supabase
    .from('groups')
    .select('id')
    .eq('status', 'active')
    .order('id');
  if (error || !data) return [];
  return data.map(row => row.id);
}