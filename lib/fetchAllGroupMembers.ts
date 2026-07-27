import { supabase } from '@/supabaseClient';

export interface GroupMemberRow {
  groupId: string;
  personId: string;
}

export async function fetchAllGroupMembers(): Promise<GroupMemberRow[]> {
  const { data, error } = await supabase.from('memberships').select('group_id, person_id').eq('status', 'active');
  if (error || !data) return [];
  return data.map(row => ({ groupId: row.group_id, personId: row.person_id }));
}
