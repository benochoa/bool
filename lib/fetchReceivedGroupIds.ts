import { supabase } from '@/supabaseClient';

export async function fetchReceivedGroupIds(myGroupId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('group_suggestions')
    .select('suggesting_group_id')
    .eq('target_group_id', myGroupId)
    .eq('status', 'sent');
  if (error || !data) return [];
  return data.map(row => row.suggesting_group_id);
}