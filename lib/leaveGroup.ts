import { supabase } from '@/supabaseClient';

// Mark a membership as 'left' (soft delete — the row stays for History and so a
// later rejoin can reactivate it). status_at records when it happened.
export async function leaveGroup(personId: string, groupId: string) {
  return supabase
    .from('memberships')
    .update({ status: 'left', status_at: new Date().toISOString() })
    .eq('person_id', personId)
    .eq('group_id', groupId);
}