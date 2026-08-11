import { supabase } from '@/supabaseClient';

export interface ReceivedGroup {
  suggestingGroupId: string;
  groupName: string;
  firstImageUrl: string | null;
}

export async function fetchReceivedGroups(myGroupId: string): Promise<ReceivedGroup[]> {
  // Mirror of fetchGroupSuggestions, pivoted the other way: the suggestions
  // aimed at me, with the suggesting group's name + photos embedded via the
  // suggesting_group_id FK (the !hint disambiguates it from target_group_id,
  // the other groups FK on this table). One round trip, no storage.list().
  // 'sent' is the only status this screen shows: incoming, awaiting my
  // approval. Approving makes it 'matched', which belongs to Chats from then on.
  const { data, error } = await supabase
    .from('group_suggestions')
    .select('suggesting_group_id, suggester:groups!suggesting_group_id(name, image_urls)')
    .eq('target_group_id', myGroupId)
    .eq('status', 'sent')
    .order('created_at', { ascending: false });
  if (error || !data) return [];
  return data.map(row => {
    // Many-to-one embed, so PostgREST returns a single object — the inferred
    // array type is wrong (no generated schema tells it the cardinality).
    const suggester = row.suggester as unknown as { name: string; image_urls: string[] | null } | null;
    return {
      suggestingGroupId: row.suggesting_group_id,
      groupName: suggester?.name ?? '...',
      firstImageUrl: suggester?.image_urls?.[0] ?? null,
    };
  });
}
