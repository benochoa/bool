import { supabase } from '@/supabaseClient';

// Groups the person is currently an active member of — drives the switcher and
// the current-group context. Left/kicked memberships are excluded.
export async function fetchMyActiveGroupIds(personId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('memberships')
    .select('group_id')
    .eq('person_id', personId)
    .eq('status', 'active');
  if (error || !data) return [];
  return data.map(row => row.group_id);
}
