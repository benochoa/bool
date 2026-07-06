import { supabase } from '@/supabaseClient';

export async function fetchMatchedGroupIds(myGroupId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('group_suggestions')
    .select('suggesting_group_id, target_group_id')
    .eq('status', 'matched')
    .or(`suggesting_group_id.eq.${myGroupId},target_group_id.eq.${myGroupId}`);
  if (error || !data) return [];
  return data.map(row => (row.suggesting_group_id === myGroupId ? row.target_group_id : row.suggesting_group_id));
}