import { supabase } from '@/supabaseClient';

// What is being reported. A message used to carry its text along, for
// message_snapshot — messages are soft deletable, so the sender could blank the
// evidence before anyone read the report. That copy is now taken server-side by
// the reports_snapshot trigger, which reads the body from target_message_id: a
// snapshot the reporter writes is a snapshot the reporter can invent.
// `discussion` says which table messageId belongs to. Without it a discussion
// message's id went into target_message_id, which is FK'd to messages(id) — and
// because the two tables have independent identity sequences, that id usually
// exists over there, so the report attached itself to an unrelated message in a
// stranger's chat instead of failing.
export type ReportTarget =
  | { type: 'group'; groupId: string }
  | { type: 'person'; personId: string }
  | { type: 'message'; messageId: number; discussion?: boolean };

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
    target_message_id:
      target.type === 'message' && !target.discussion ? target.messageId : null,
    target_discussion_message_id:
      target.type === 'message' && target.discussion ? target.messageId : null,
    // message_snapshot is deliberately not sent: the trigger fills it from the
    // message itself and would overwrite anything passed here anyway.
    reason,
    details: details || null,
  });
  if (error) console.error('[submitReport]', error.message);
  return !error;
}
