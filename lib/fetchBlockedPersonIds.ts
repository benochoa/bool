import { supabase } from '@/supabaseClient';

// Everyone a members card should render as "Blocked user" — both the people I
// blocked and the people who blocked me, since the hiding runs both ways. The
// RPC merges the two directions server-side; RLS hides the second one from the
// client, so this can't be a plain select.
export async function fetchBlockedPersonIds(): Promise<string[]> {
  const { data, error } = await supabase.rpc('get_blocked_person_ids');
  if (error || !data) return [];
  return data as string[];
}
