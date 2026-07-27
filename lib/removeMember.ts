import { supabase } from '@/supabaseClient';

// Kick a member (leader action). Like leaveGroup it's a soft delete — the row
// stays for history, status flips to 'kicked'. fetchGroup filters to active,
// so the member drops out of the group on the next fetch.
export async function removeMember(groupId: string, personId: string) {
  return supabase
    .from('memberships')
    .update({ status: 'kicked', status_at: new Date().toISOString() })
    .eq('group_id', groupId)
    .eq('person_id', personId);
}