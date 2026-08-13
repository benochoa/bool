import { supabase } from '@/supabaseClient';

// How a membership ended. 'active' is deliberately not here — a group you're
// still in belongs to Groups, not History.
export type PastMembershipStatus = 'group_dissolved' | 'left' | 'kicked';

export interface PastMembership {
  groupId: string;
  status: PastMembershipStatus;
  // When the membership ended, whatever ended it: the leave, the kick, or the
  // dissolution. Doubles as the cutoff for which of the group's matches you
  // were around for.
  statusAt: string;
}

// Every group the person used to be in and no longer is. Ordered newest exit
// first; the unique (group_id, person_id) constraint means one row per group,
// so no de-duping is needed.
export async function fetchMyPastGroups(personId: string): Promise<PastMembership[]> {
  const { data, error } = await supabase
    .from('memberships')
    .select('group_id, status, status_at')
    .eq('person_id', personId)
    .neq('status', 'active')
    .order('status_at', { ascending: false });
  if (error || !data) return [];
  return data.map(row => ({
    groupId: row.group_id,
    status: row.status as PastMembershipStatus,
    statusAt: row.status_at,
  }));
}
