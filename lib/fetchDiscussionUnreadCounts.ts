import { supabase } from '@/supabaseClient';

// Unread discussion messages per candidate group, for the badges on the preview
// tiles. One round trip for the whole list rather than one per tile — Pending
// and Received both draw a column of them, and the count differs per tile.
//
// Keyed by the group being discussed, which is what both screens already key
// their tiles on (targetGroupId in Pending, suggestingGroupId in Received).
export async function fetchDiscussionUnreadCounts(
  myGroupId: string
): Promise<Map<string, number>> {
  const { data, error } = await supabase.rpc('get_discussion_unread_counts', {
    my_group_id: myGroupId,
  });
  if (error) console.error('[fetchDiscussionUnreadCounts]', error.message);
  if (error || !data) return new Map();

  return new Map(
    (data as { about_group_id: string; unread: number }[]).map(row => [
      row.about_group_id,
      row.unread,
    ])
  );
}
