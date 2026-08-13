import { supabase } from '@/supabaseClient';

// `before` cuts the list off at a moment in time — History passes the date a
// membership ended, so a past group shows only the matches you were there for.
// Omitted everywhere else, which means every match regardless of when.
export async function fetchMatchedGroupIds(myGroupId: string, before?: string): Promise<string[]> {
  let query = supabase
    .from('group_suggestions')
    .select('suggesting_group_id, target_group_id')
    .eq('status', 'matched')
    .or(`suggesting_group_id.eq.${myGroupId},target_group_id.eq.${myGroupId}`);
  if (before) query = query.lte('matched_at', before);
  const { data, error } = await query;
  if (error || !data) return [];
  return data.map(row => (row.suggesting_group_id === myGroupId ? row.target_group_id : row.suggesting_group_id));
}