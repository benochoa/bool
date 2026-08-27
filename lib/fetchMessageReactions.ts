import { canonicalPair } from '@/lib/canonicalPair';
import { supabase } from '@/supabaseClient';

export interface MessageReaction {
  messageId: number;
  userId: string;
  emoji: string;
  // Who reacted, carried on the reaction itself rather than looked up against
  // the thread's sender cache: that cache is built from messages, and reacting
  // to one doesn't require having ever sent any.
  name: string;
  profilePicUrl: string | null;
  createdAt: string;
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
    // profiles is reached explicitly through user_id, for the same reason
    // fetchMessages names sender_id: this table points at both messages and
    // profiles, so an unqualified embed has two possible paths and is rejected.
    .from('message_reactions')
    .select('message_id, user_id, emoji, created_at, messages!inner(group_1_id, group_2_id), profiles!user_id(name, profile_pic_url)')
    .eq('messages.group_1_id', g1)
    .eq('messages.group_2_id', g2)
    // Oldest first, which is the order the sheet lists people in — and it keeps
    // the pills under a message from reshuffling between fetches.
    .order('created_at', { ascending: true });
  if (error) console.error('[fetchMessageReactions]', error.message);
  if (error || !data) return [];

  return data.map(row => {
    // message_reactions.user_id -> profiles.id is many-to-one, so PostgREST
    // embeds profiles as a single object — the inferred array type here is
    // wrong (this client has no generated schema to tell it the cardinality).
    const profile = row.profiles as unknown as { name: string; profile_pic_url: string | null } | null;
    return {
      messageId: row.message_id,
      userId: row.user_id,
      emoji: row.emoji,
      name: profile?.name ?? '...',
      profilePicUrl: profile?.profile_pic_url ?? null,
      createdAt: row.created_at,
    };
  });
}
