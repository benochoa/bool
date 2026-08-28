import { MessageReaction } from '@/lib/fetchMessageReactions';
import { supabase } from '@/supabaseClient';

// Every reaction in one discussion, in one round trip. The !inner embed turns
// the join into a filter — reactions whose message belongs to this discussion —
// so this never has to send a list of message ids the sheet is holding.
//
// Returns the same MessageReaction shape the real thread uses, so ReactionRow
// and ReactionsSheet render a discussion without knowing it is one.
export async function fetchDiscussionReactions(
  groupId: string,
  aboutGroupId: string
): Promise<MessageReaction[]> {
  const { data, error } = await supabase
    .from('discussion_reactions')
    .select('message_id, user_id, emoji, created_at, discussion_messages!inner(group_id, about_group_id), profiles!user_id(name, profile_pic_url)')
    .eq('discussion_messages.group_id', groupId)
    .eq('discussion_messages.about_group_id', aboutGroupId)
    .order('created_at', { ascending: true });
  if (error) console.error('[fetchDiscussionReactions]', error.message);
  if (error || !data) return [];

  return data.map(row => {
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
