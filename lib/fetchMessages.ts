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
  kind: 'text' | 'image' | 'audio';
  mediaUrl: string | null;
  mediaAspectRatio: number | null;
  createdAt: string;
}

export async function fetchMessages(groupIdA: string, groupIdB: string): Promise<Message[]> {
  const [g1, g2] = canonicalPair(groupIdA, groupIdB);

  const { data, error } = await supabase
    .from('messages')
    .select('id, sender_group_id, sender_id, body, kind, media_url, media_aspect_ratio, created_at, profiles(name, profile_pic_url)')
    .eq('group_1_id', g1)
    .eq('group_2_id', g2)
    .order('created_at', { ascending: true });
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
      createdAt: row.created_at,
    };
  });
}
