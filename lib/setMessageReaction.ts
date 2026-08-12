import { supabase } from '@/supabaseClient';

// One reaction per person per message, so this is a set rather than an add:
// passing an emoji replaces whatever they had, passing null takes it away. The
// primary key on (message_id, user_id) is what makes the upsert a replacement.
export async function setMessageReaction(
  messageId: number,
  userId: string,
  emoji: string | null
): Promise<boolean> {
  if (emoji === null) {
    const { error } = await supabase
      .from('message_reactions')
      .delete()
      .eq('message_id', messageId)
      .eq('user_id', userId);
    return !error;
  }

  const { error } = await supabase
    .from('message_reactions')
    .upsert(
      { message_id: messageId, user_id: userId, emoji },
      { onConflict: 'message_id,user_id' }
    );
  return !error;
}
