import { supabase } from '@/supabaseClient';

export async function fetchAllGroupIds(): Promise<string[]> {
  const { data, error } = await supabase.from('groups').select('id');
  if (error || !data) return [];
  return data.map(row => row.id);
}