import { supabase } from '@/supabaseClient';
import { canonicalPair } from './canonicalPair';
import { fetchMatchedGroupIds } from './fetchMatchedGroupIds';

export interface ChatPreview {
  otherGroupId: string;
  otherGroupName: string;
  lastMessage: string | null;
  lastMessageAt: string | null;
}

export async function fetchChatPreviews(myGroupId: string): Promise<ChatPreview[]> {
  const otherGroupIds = await fetchMatchedGroupIds(myGroupId);

  return Promise.all(otherGroupIds.map(async otherGroupId => {
    const [g1, g2] = canonicalPair(myGroupId, otherGroupId);

    const [{ data: group }, { data: lastMessage }] = await Promise.all([
      supabase.from('groups').select('name').eq('id', otherGroupId).single(),
      supabase
        .from('messages')
        .select('body, created_at')
        .eq('group_1_id', g1)
        .eq('group_2_id', g2)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    return {
      otherGroupId,
      otherGroupName: group?.name ?? '...',
      lastMessage: lastMessage?.body ?? null,
      lastMessageAt: lastMessage?.created_at ?? null,
    };
  }));
}
