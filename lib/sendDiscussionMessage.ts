import { supabase } from '@/supabaseClient';
import { MessageMedia } from './sendMessage';

interface SendOptions {
  media?: MessageMedia;
  // The message being answered, if this is a reply.
  replyToId?: number | null;
}

// Posts into your own group's discussion about `aboutGroupId`. No sender group
// column: a discussion has exactly one side, and `group_id` already names it.
export async function sendDiscussionMessage(
  groupId: string,
  aboutGroupId: string,
  senderId: string,
  body: string,
  options: SendOptions = {}
): Promise<boolean> {
  const { error } = await supabase.from('discussion_messages').insert({
    group_id: groupId,
    about_group_id: aboutGroupId,
    sender_id: senderId,
    body,
    kind: options.media?.kind ?? 'text',
    media_url: options.media?.url ?? null,
    media_aspect_ratio: options.media?.aspectRatio ?? null,
    media_waveform: options.media?.waveform ?? null,
    reply_to_id: options.replyToId ?? null,
  });
  return !error;
}
