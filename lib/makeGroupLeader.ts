import { supabase } from '@/supabaseClient';

// Transfer leadership. groups.created_by is the single source of truth for who
// the leader is (crown, edit/dissolve affordances all key off it), so
// reassigning it hands the role to another member.
export async function makeGroupLeader(groupId: string, personId: string) {
  return supabase
    .from('groups')
    .update({ created_by: personId })
    .eq('id', groupId);
}