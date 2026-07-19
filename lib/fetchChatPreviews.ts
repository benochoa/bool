import { supabase } from '@/supabaseClient';

export interface ChatPreview {
  otherGroupId: string;
  otherGroupName: string;
  lastMessage: string | null;
  lastMessageAt: string | null;
}

export async function fetchChatPreviews(myGroupId: string): Promise<ChatPreview[]> {
  // One request: get_chat_previews runs server-side — it finds the matched
  // groups, joins their names, and picks each pair's newest message. The
  // per-pair "newest" is why this is an RPC: "limit 1 per pair" can't be
  // expressed in the PostgREST query language.
  const { data, error } = await supabase.rpc('get_chat_previews', { my_group_id: myGroupId });
  if (error || !data) return [];
  return (data as any[]).map(row => ({
    otherGroupId: row.other_group_id,
    otherGroupName: row.other_group_name,
    lastMessage: row.last_message,
    lastMessageAt: row.last_message_at,
  }));
}