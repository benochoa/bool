import { supabase } from '@/supabaseClient';

export interface GroupSuggestion {
  targetGroupId: string;
  suggestedBy: string;
  status: 'pending' | 'sent' | 'matched';
}

export async function fetchGroupSuggestions(suggestingGroupId: string): Promise<GroupSuggestion[]> {
  const { data, error } = await supabase
    .from('group_suggestions')
    .select('target_group_id, suggested_by, status')
    .eq('suggesting_group_id', suggestingGroupId)
    .order('created_at', { ascending: false });
  if (error || !data) return [];
  return data.map(row => ({ targetGroupId: row.target_group_id, suggestedBy: row.suggested_by, status: row.status }));
}