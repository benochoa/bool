import { supabase } from '@/supabaseClient';

// A group's invite code, readable only by its leader. The column itself is
// revoked from clients — anyone able to select it could harvest every code in
// the app and walk into any group, and from there into its chats — so this is
// the only way to see one, and the function checks created_by server-side.
export async function fetchInviteCode(groupId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('get_invite_code', { p_group_id: groupId });
  if (error) return null;
  return (data as string | null) ?? null;
}
