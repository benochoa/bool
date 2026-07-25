import { supabase } from '@/supabaseClient';

export interface GroupName {
  id: string;
  name: string;
  image_urls: string[] | null;
}

// Names for any number of groups in a single query.
export async function fetchGroupNames(groupIds: string[]): Promise<GroupName[]> {
  if (groupIds.length === 0) return [];
  const { data, error } = await supabase
    .from('groups')
    .select('id, name, image_urls')
    .in('id', groupIds);
  if (error || !data) return [];
  return data;
}