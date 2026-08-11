import { canonicalPair } from '@/lib/canonicalPair';
import { supabase } from '@/supabaseClient';

// Stamps this chat as seen by this user, now. Returns the timestamp it wrote so
// the caller can drop it straight into local state, or null if the write failed
// — in which case the row should stay unread rather than lie about it.
export async function markChatRead(
  userId: string,
  myGroupId: string,
  otherGroupId: string
): Promise<string | null> {
  const [group_1_id, group_2_id] = canonicalPair(myGroupId, otherGroupId);
  const lastReadAt = new Date().toISOString();

  const { error } = await supabase
    .from('chat_reads')
    .upsert(
      { user_id: userId, group_1_id, group_2_id, last_read_at: lastReadAt },
      { onConflict: 'user_id,group_1_id,group_2_id' }
    );

  return error ? null : lastReadAt;
}