import { supabase } from '@/supabaseClient';

export interface GroupSuggestion {
  targetGroupId: string;
  groupName: string;
  firstImageUrl: string | null;
  suggestedByName: string;
  suggestedByPicUrl: string | null;
  status: 'pending' | 'sent' | 'matched';
}

export async function fetchGroupSuggestions(suggestingGroupId: string): Promise<GroupSuggestion[]> {
  // One round trip: the suggestion rows, the suggester's name + pic (via the
  // suggested_by FK), and the target group's name + photos (via the
  // target_group_id FK — the !hint disambiguates it from suggesting_group_id,
  // the other groups FK on this table).
  const { data, error } = await supabase
    .from('group_suggestions')
    .select('target_group_id, status, profiles:suggested_by(name, profile_pic_url), target:groups!target_group_id(name, image_urls)')
    .eq('suggesting_group_id', suggestingGroupId)
    .order('created_at', { ascending: false });
  if (error || !data) return [];
  return data.map(row => {
    // Both embeds are many-to-one, so PostgREST returns single objects — the
    // inferred array type is wrong (no generated schema tells it the cardinality).
    const profile = row.profiles as unknown as { name: string; profile_pic_url: string | null } | null;
    const target = row.target as unknown as { name: string; image_urls: string[] | null } | null;
    return {
      targetGroupId: row.target_group_id,
      groupName: target?.name ?? '...',
      firstImageUrl: target?.image_urls?.[0] ?? null,
      suggestedByName: profile?.name ?? '...',
      suggestedByPicUrl: profile?.profile_pic_url ?? null,
      status: row.status,
    };
  });
}
