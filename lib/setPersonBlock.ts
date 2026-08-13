import { supabase } from '@/supabaseClient';

// Blocking hides the two of you from each other inside chats, and nothing more:
// their group stays in the feed, and a match with it can still happen. Passing
// false unblocks.
export async function setPersonBlock(
  blockerId: string,
  personId: string,
  blocked: boolean
): Promise<boolean> {
  if (!blocked) {
    const { error } = await supabase
      .from('blocked_people')
      .delete()
      .eq('blocker_id', blockerId)
      .eq('blocked_id', personId);
    return !error;
  }

  const { error } = await supabase
    .from('blocked_people')
    .upsert({ blocker_id: blockerId, blocked_id: personId }, { onConflict: 'blocker_id,blocked_id' });
  return !error;
}
