import { supabase } from '@/supabaseClient';

export async function fetchMyGroupIds(personId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('group_members')
    .select('group_id')
    .eq('person_id', personId);
  if (error || !data) return [];
  return data.map(row => row.group_id);
}
