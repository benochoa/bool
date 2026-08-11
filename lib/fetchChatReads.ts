import { canonicalPair } from '@/lib/canonicalPair';
import { supabase } from '@/supabaseClient';

// A chat keyed by its canonical pair — the same ordering `messages` uses, so
// one chat is one key however you're looking at it.
export function chatReadKey(a: string, b: string): string {
  const [g1, g2] = canonicalPair(a, b);
  return `${g1}|${g2}`;
}

// When this user last closed each chat they've opened, keyed by chatReadKey.
// A chat that's never been opened simply has no row — which is what makes it
// unread the first time round, with nothing to pre-populate on a new match.
export async function fetchChatReads(userId: string): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from('chat_reads')
    .select('group_1_id, group_2_id, last_read_at')
    .eq('user_id', userId);
  if (error || !data) return new Map();
  // Rows are stored canonically, so the key is the pair as it comes back.
  return new Map(data.map(row => [`${row.group_1_id}|${row.group_2_id}`, row.last_read_at as string]));
}
