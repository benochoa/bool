import { supabase } from '@/supabaseClient';

export interface GroupSuggestion {
  targetGroupId: string;
  suggestedByName: string;
  status: 'pending' | 'sent' | 'matched';
}

export async function fetchGroupSuggestions(suggestingGroupId: string): Promise<GroupSuggestion[]> {
  // profiles:suggested_by follows the suggested_by FK to profiles, so the
  // suggester's name arrives in the same round trip as the suggestions.
  const { data, error } = await supabase
    .from('group_suggestions')
    .select('target_group_id, status, profiles:suggested_by(name)')
    .eq('suggesting_group_id', suggestingGroupId)
    .order('created_at', { ascending: false });
  if (error || !data) return [];
  return data.map(row => {
    // suggested_by -> profiles.id is many-to-one, so PostgREST embeds
    // profiles as a single object — the inferred array type here is wrong
    // (this client has no generated schema to tell it the cardinality).
    const profile = row.profiles as unknown as { name: string } | null;
    return { targetGroupId: row.target_group_id, suggestedByName: profile?.name ?? '...', status: row.status };
  });
}