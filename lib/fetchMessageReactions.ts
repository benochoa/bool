import { canonicalPair } from '@/lib/canonicalPair';
import { supabase } from '@/supabaseClient';

export interface MessageReaction {
  messageId: number;
  userId: string;
  emoji: string;
}

// Every reaction in one chat, in one round trip. The !inner embed turns the
// join into a filter — reactions whose message belongs to this pair — so this
// never has to send a list of message ids the thread happens to be holding.
export async function fetchMessageReactions(
  groupIdA: string,
  groupIdB: string
): Promise<MessageReaction[]> {
  const [g1, g2] = canonicalPair(groupIdA, groupIdB);

  const { data, error } = await supabase
    .from('message_reactions')
    .select('message_id, user_id, emoji, messages!inner(group_1_id, group_2_id)')
    .eq('messages.group_1_id', g1)
    .eq('messages.group_2_id', g2);
  if (error) console.error('[fetchMessageReactions]', error.message);
  if (error || !data) return [];

  return data.map(row => ({
    messageId: row.message_id,
    userId: row.user_id,
    emoji: row.emoji,
  }));
}
