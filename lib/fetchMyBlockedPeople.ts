import { supabase } from '@/supabaseClient';

export interface BlockedPerson {
  id: string;
  name: string;
  profilePicUrl: string | null;
}

// The people I blocked, for the Settings list that unblocks them. Only my own
// blocks — unlike fetchBlockedPersonIds, which also covers people who blocked
// me: those aren't mine to undo, and listing them would say who they are.
//
// blocked_people has two FKs into profiles, so the embed names the column it
// travels (a bare profiles(...) is ambiguous and errors).
export async function fetchMyBlockedPeople(myUserId: string): Promise<BlockedPerson[]> {
  const { data, error } = await supabase
    .from('blocked_people')
    .select('blocked_id, person:profiles!blocked_id(name, profile_pic_url)')
    .eq('blocker_id', myUserId)
    .order('created_at', { ascending: false });
  if (error || !data) return [];
  return data.map(row => {
    // Many-to-one embed: PostgREST returns one object, but the inferred type
    // says array (no generated schema tells it the cardinality).
    const person = row.person as unknown as { name: string; profile_pic_url: string | null } | null;
    return {
      id: row.blocked_id,
      name: person?.name ?? '...',
      profilePicUrl: person?.profile_pic_url ?? null,
    };
  });
}
