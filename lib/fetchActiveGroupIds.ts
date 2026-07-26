import { supabase } from '@/supabaseClient';

// Every joinable group for the Discover feed. Dissolved groups are excluded —
// only active groups should ever be recommended.
export async function fetchActiveGroupIds(): Promise<string[]> {
  const { data, error } = await supabase.from('groups').select('id').eq('status', 'active');
  if (error || !data) return [];
  return data.map(row => row.id);
}