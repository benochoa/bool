import { supabase } from '@/supabaseClient';

// Dissolving is a multi-table operation (flip every membership to
// 'group_dissolved', drop non-matched suggestions, mark the group dissolved),
// so it runs atomically in the dissolve_group RPC. This is the thin client
// entry point — mirrors leaveGroup.
export async function dissolveGroup(groupId: string) {
  return supabase.rpc('dissolve_group', { p_group_id: groupId });
}