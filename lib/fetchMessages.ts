import { supabase } from '@/supabaseClient';
import { canonicalPair } from './canonicalPair';

export interface Message {
  id: number;
  senderGroupId: string;
  senderId: string;
  senderName: string;
  senderProfilePicUrl: string | null;
  body: string;
  // 'text' for a typed message; the others carry mediaUrl and render that
  // instead, with body left as the label the Chats preview falls back on.
  kind: 'text' | 'image' | 'audio' | 'video';
  mediaUrl: string | null;
  mediaAspectRatio: number | null;
  // Bar levels for a voice note. Null on recordings made before the column
  // existed — the player draws a plain progress bar for those.
  waveform: number[] | null;
  // Set once the sender deletes it. The row stays — ordering, and anything
  // pointing at it, outlive the content — and the bubble becomes a tombstone.
  deletedAt: string | null;
  // The message this one is answering, if any. Resolved against the thread's
  // own list rather than embedded — a thread loads whole, so the quoted message
  // is already in hand, and a self-join here would be one more ambiguous embed.
  replyToId: number | null;
  createdAt: string;
}

export async function fetchMessages(groupIdA: string, groupIdB: string): Promise<Message[]> {
  const [g1, g2] = canonicalPair(groupIdA, groupIdB);

  const { data, error } = await supabase
    .from('messages')
    // profiles is reached explicitly through sender_id. message_reactions
    // points at both messages and profiles, which PostgREST reads as a junction
    // table — so without the hint there are two possible paths here and the
    // embed is rejected as ambiguous.
    .select('id, sender_group_id, sender_id, body, kind, media_url, media_aspect_ratio, media_waveform, deleted_at, reply_to_id, created_at, profiles!sender_id(name, profile_pic_url)')
    .eq('group_1_id', g1)
    .eq('group_2_id', g2)
    .order('created_at', { ascending: true });
  // Loud on the way out: a select naming a column that doesn't exist yet fails
  // the whole query, and an empty thread looks identical to a new one.
  if (error) console.error('[fetchMessages]', error.message);
  if (error || !data) return [];

  return data.map(row => {
    // messages.sender_id -> profiles.id is many-to-one, so PostgREST embeds
    // profiles as a single object — the inferred array type here is wrong
    // (this client has no generated schema to tell it the real cardinality).
    const profile = row.profiles as unknown as { name: string; profile_pic_url: string | null } | null;
    return {
      id: row.id,
      senderGroupId: row.sender_group_id,
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
