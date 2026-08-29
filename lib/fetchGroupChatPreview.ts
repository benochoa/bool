import { supabase } from '@/supabaseClient';

// The pinned row at the top of Chats: your own group's room, with no candidate
// as its subject. Stored as a discussion whose about_group_id is the group
// itself — see supabase/group_chat.sql for why that beats a nullable column.
export interface GroupChatPreview {
  groupName: string;
  lastMessage: string | null;
  lastMessageAt: string | null;
  // 'You' for your own message, resolved server-side against auth.uid() the way
  // get_chat_previews does it. Null when the room is empty, and deliberately
  // null for a sender this viewer has blocked.
  senderName: string | null;
  imageUrl: string | null;
  // Counted server-side rather than compared against a local read timestamp:
  // unlike the matched chats, this row has no entry in the `reads` map the
  // screen keeps, and the RPC already has the read state in hand.
  unread: number;
}

export async function fetchGroupChatPreview(myGroupId: string): Promise<GroupChatPreview | null> {
  const { data, error } = await supabase.rpc('get_group_chat_preview', { my_group_id: myGroupId });
  // Loud: this RPC is the one piece of this feature that must be run in the
  // dashboard before the app reloads, and a missing function is otherwise
  // indistinguishable from an empty room.
  if (error) {
    console.error('[fetchGroupChatPreview]', error.message);
    return null;
  }
  const row = (data as any[])?.[0];
  if (!row) return null;
  return {
    groupName: row.group_name,
    lastMessage: row.last_message,
    lastMessageAt: row.last_message_at,
    senderName: row.last_message_sender ?? null,
    imageUrl: row.image_urls?.[0] ?? null,
    unread: row.unread ?? 0,
  };
}
