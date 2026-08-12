import { supabase } from '@/supabaseClient';
import { canonicalPair } from './canonicalPair';

// A photo or voice note rides along with the row rather than replacing its
// body: `body` stays the human-readable line ('Photo'), which is what the Chats
// preview shows for a message it can't render.
export interface MessageMedia {
  kind: 'image' | 'audio';
  url: string;
  aspectRatio: number | null;
}

interface SendOptions {
  media?: MessageMedia;
  // The message being answered, if this is a reply.
  replyToId?: number | null;
}

export async function sendMessage(
  groupIdA: string,
  groupIdB: string,
  senderGroupId: string,
  senderId: string,
  body: string,
  options: SendOptions = {}
): Promise<boolean> {
  const [g1, g2] = canonicalPair(groupIdA, groupIdB);

  const { error } = await supabase.from('messages').insert({
    group_1_id: g1,
    group_2_id: g2,
    sender_group_id: senderGroupId,
    sender_id: senderId,
    body,
    kind: options.media?.kind ?? 'text',
    media_url: options.media?.url ?? null,
    media_aspect_ratio: options.media?.aspectRatio ?? null,
    reply_to_id: options.replyToId ?? null,
  });
  return !error;
}
