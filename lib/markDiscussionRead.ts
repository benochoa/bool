import { supabase } from '@/supabaseClient';

// Stamps this discussion as seen by this user, now. Returns the timestamp it
// wrote so the caller can drop it straight into local state, or null if the
// write failed — in which case the badge should stay up rather than lie.
export async function markDiscussionRead(
  userId: string,
  groupId: string,
  aboutGroupId: string
): Promise<string | null> {
  const lastReadAt = new Date().toISOString();

  const { error } = await supabase
    .from('discussion_reads')
    .upsert(
      { user_id: userId, group_id: groupId, about_group_id: aboutGroupId, last_read_at: lastReadAt },
      { onConflict: 'user_id,group_id,about_group_id' }
    );

  return error ? null : lastReadAt;
}
