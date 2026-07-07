import { supabase } from '@/supabaseClient';
import { canonicalPair } from './canonicalPair';

export async function sendMessage(
  groupIdA: string,
  groupIdB: string,
  senderGroupId: string,
  senderId: string,
  body: string
): Promise<boolean> {
  const [g1, g2] = canonicalPair(groupIdA, groupIdB);

  const { error } = await supabase.from('messages').insert({
    group_1_id: g1,
    group_2_id: g2,
    sender_group_id: senderGroupId,
    sender_id: senderId,
    body,
  });
  return !error;
}
