import { supabase } from '@/supabaseClient';

// Every group the person has ever been a member of — active, kicked, or left.
// Used by History; the unique (group_id, person_id) constraint means one row
// per group, so no de-duping is needed.
export async function fetchMyAllTimeGroupIds(personId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('memberships')
    .select('group_id')
    .eq('person_id', personId)
    .order('status_at', { ascending: false });
  if (error || !data) return [];
  return data.map(row => row.group_id);
}
