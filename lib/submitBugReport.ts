import { supabase } from '@/supabaseClient';

// Free text only. Unlike submitReport there's no reason list to pick from: a bug
// is whatever the person says it is, and a fixed set would just push everything
// into "Other".
export async function submitBugReport(reporterId: string, body: string): Promise<boolean> {
  const { error } = await supabase.from('bug_reports').insert({
    reporter_id: reporterId,
    body,
  });
  if (error) console.error('[submitBugReport]', error.message);
  return !error;
}
