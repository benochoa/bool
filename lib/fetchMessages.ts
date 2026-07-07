import { supabase } from '@/supabaseClient';
import { canonicalPair } from './canonicalPair';

export interface Message {
  id: number;
  senderGroupId: string;
  senderId: string;
  senderName: string;
  body: string;
  createdAt: string;
}

export async function fetchMessages(groupIdA: string, groupIdB: string): Promise<Message[]> {
  const [g1, g2] = canonicalPair(groupIdA, groupIdB);

  const { data, error } = await supabase
    .from('messages')
    .select('id, sender_group_id, sender_id, body, created_at, profiles(name)')
    .eq('group_1_id', g1)
    .eq('group_2_id', g2)
    .order('created_at', { ascending: true });
  if (error || !data) return [];

  return data.map(row => {
    // messages.sender_id -> profiles.id is many-to-one, so PostgREST embeds
    // profiles as a single object — the inferred array type here is wrong
    // (this client has no generated schema to tell it the real cardinality).
    const profile = row.profiles as unknown as { name: string } | null;
    return {
      id: row.id,
      senderGroupId: row.sender_group_id,
      senderId: row.sender_id,
      senderName: profile?.name ?? '...',
      body: row.body,
      createdAt: row.created_at,
    };
  });
}
