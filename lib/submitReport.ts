import { supabase } from '@/supabaseClient';

// What is being reported. A message carries its text along because messages are
// soft deletable — the sender can blank it before anyone reads the report.
export type ReportTarget =
  | { type: 'group'; groupId: string }
  | { type: 'person'; personId: string }
  | { type: 'message'; messageId: number; body: string };

export async function submitReport(
  reporterId: string,
  target: ReportTarget,
  reason: string,
  details?: string
): Promise<boolean> {
  const { error } = await supabase.from('reports').insert({
    reporter_id: reporterId,
    target_type: target.type,
    target_group_id: target.type === 'group' ? target.groupId : null,
    target_person_id: target.type === 'person' ? target.personId : null,
    target_message_id: target.type === 'message' ? target.messageId : null,
    message_snapshot: target.type === 'message' ? target.body : null,
    reason,
    details: details || null,
  });
  if (error) console.error('[submitReport]', error.message);
  return !error;
}
