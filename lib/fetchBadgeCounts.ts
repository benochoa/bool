import { supabase } from '@/supabaseClient';

export interface BadgeCounts {
  // Suggestions my group's leader hasn't sent on yet — the "Waiting on your
  // leader..." pile, the same number for every member.
  pending: number;
  // Suggestions aimed at my group, still awaiting our decision. Also the same
  // for every member.
  received: number;
  // Chats holding messages I personally haven't read — one per chat however
  // many messages are waiting in it. Mine alone: it's measured against my own
  // chat_reads rows.
  unread: number;
}

export const EMPTY_BADGE_COUNTS: BadgeCounts = { pending: 0, received: 0, unread: 0 };

export async function fetchBadgeCounts(myGroupId: string): Promise<BadgeCounts> {
  // head: true asks for the count and no rows — the numbers are all the tab bar
  // needs. The unread chats are an RPC because the cutoff differs per chat, and
  // it reads the user from auth.uid() rather than a parameter.
  const [pending, received, unread] = await Promise.all([
    supabase
      .from('group_suggestions')
      .select('*', { count: 'exact', head: true })
      .eq('suggesting_group_id', myGroupId)
      .eq('status', 'pending'),
    supabase
      .from('group_suggestions')
      .select('*', { count: 'exact', head: true })
      .eq('target_group_id', myGroupId)
      .eq('status', 'sent'),
    supabase.rpc('get_unread_chat_count', { my_group_id: myGroupId }),
  ]);

  return {
    pending: pending.count ?? 0,
    received: received.count ?? 0,
    unread: (unread.data as number | null) ?? 0,
  };
}