import { supabase } from '@/supabaseClient';

export interface ChatPreview {
  otherGroupId: string;
  otherGroupName: string;
  lastMessage: string | null;
  lastMessageAt: string | null;
  // Who wrote that last message, for the "Name: message" preview line. The RPC
  // resolves it against auth.uid(), so the viewer's own messages come back as
  // 'You' rather than their name. Null when the chat is empty, and deliberately
  // null for a sender this viewer has blocked — the body is already replaced
  // with a placeholder there, so naming them would put back what it removes.
  senderName: string | null;
  // The other group's first photo, shown beside the row. Comes from the RPC's
  // other_group_image_urls, so it stays one round trip.
  imageUrl: string | null;
}

export async function fetchChatPreviews(myGroupId: string): Promise<ChatPreview[]> {
  // One request: get_chat_previews runs server-side — it finds the matched
  // groups, joins their names, and picks each pair's newest message. The
  // per-pair "newest" is why this is an RPC: "limit 1 per pair" can't be
  // expressed in the PostgREST query language. It also returns the other
  // group's image_urls, so the preview photo costs no extra call.
  const { data, error } = await supabase.rpc('get_chat_previews', { my_group_id: myGroupId });
  if (error || !data) return [];
  return (data as any[]).map(row => ({
    otherGroupId: row.other_group_id,
    otherGroupName: row.other_group_name,
    lastMessage: row.last_message,
    lastMessageAt: row.last_message_at,
    senderName: row.last_message_sender ?? null,
    imageUrl: row.other_group_image_urls?.[0] ?? null,
  }));
}