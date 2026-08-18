import { supabase } from '@/supabaseClient';

export interface GroupSummary {
  id: string;
  name: string;
  image_urls: string[] | null;
  // Lets the groups screen tell whether you lead the current group — and so
  // whether to offer the edit pencil — without waiting on GroupPost's fetch.
  created_by: string | null;
}

// Enough of any number of groups to list them, in a single query.
export async function fetchGroupSummaries(groupIds: string[]): Promise<GroupSummary[]> {
  if (groupIds.length === 0) return [];
  const { data, error } = await supabase
    .from('groups')
    .select('id, name, image_urls, created_by')
    .in('id', groupIds);
  if (error || !data) return [];
  return data;
}
