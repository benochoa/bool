import { supabase } from '@/supabaseClient';
import { Message } from './fetchMessages';

// One group's private discussion about one candidate group, oldest first.
//
// Returns the same `Message` shape the real thread uses, deliberately: every
// leaf component below the thread — the bubbles, MessageActions, SwipeToReply,
// ReactionRow, VoiceMessage — is written against that type, and reusing it is
// what lets a discussion render through all of them unchanged. senderGroupId is
// always the owning group here; a discussion has one side, so nothing reads it.
export async function fetchDiscussionMessages(
  groupId: string,
  aboutGroupId: string
): Promise<Message[]> {
  const { data, error } = await supabase
    .from('discussion_messages')
    // profiles reached explicitly through sender_id, as in fetchMessages:
    // discussion_reactions points at both this table and profiles, so an
    // unqualified embed has two paths and is rejected as ambiguous.
    .select('id, sender_id, body, kind, media_url, media_aspect_ratio, media_waveform, deleted_at, reply_to_id, created_at, profiles!sender_id(name, profile_pic_url)')
    .eq('group_id', groupId)
    .eq('about_group_id', aboutGroupId)
    .order('created_at', { ascending: true });
  // Loud on the way out: a select naming a column that doesn't exist yet fails
  // the whole query, and an empty discussion looks identical to a new one.
  if (error) console.error('[fetchDiscussionMessages]', error.message);
  if (error || !data) return [];

  return data.map(row => {
    const profile = row.profiles as unknown as { name: string; profile_pic_url: string | null } | null;
    return {
      id: row.id,
      senderGroupId: groupId,
      senderId: row.sender_id,
      senderName: profile?.name ?? '...',
      senderProfilePicUrl: profile?.profile_pic_url ?? null,
      body: row.body,
      kind: row.kind,
      mediaUrl: row.media_url,
      mediaAspectRatio: row.media_aspect_ratio,
      waveform: row.media_waveform,
      deletedAt: row.deleted_at,
      replyToId: row.reply_to_id,
      createdAt: row.created_at,
    };
  });
}
