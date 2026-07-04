import { supabase } from '@/supabaseClient';

export interface GroupData {
  name: string;
  qa: { question: string; answer: string }[];
  members: string[];
  imageUrls: string[];
  created_by: string | null;
  invite_code: string | null;
}

export async function fetchGroup(groupId: string): Promise<GroupData | null> {

  // Fetch text data from Postgres
  const { data, error } = await supabase
    .from('groups')
    .select('name, qa, created_by, invite_code')
    .eq('id', groupId)
    .single();
  if (error || !data) return null;

  const { data: memberRows } = await supabase
    .from('group_members')
    .select('person_id')
    .eq('group_id', groupId);
  const members = (memberRows ?? []).map(row => row.person_id);

  // List images from Storage.
  // '?v=' makes the URL change whenever the file changes, so caches
  // (CDN, phone image cache) don't keep showing an overwritten photo.
  const { data: files } = await supabase.storage.from('groups').list(groupId);
  const imageUrls = (files ?? []).map(
    file => supabase.storage.from('groups').getPublicUrl(`${groupId}/${file.name}`).data.publicUrl + '?v=' + file.updated_at
  );

  return {
    name: data.name,
    qa: data.qa,
    members,
    imageUrls,
    created_by: data.created_by,
    invite_code: data.invite_code,
  };
}
