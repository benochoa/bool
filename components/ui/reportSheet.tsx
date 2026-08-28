import { useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { ChevronLeft } from '@/assets/symbols/ChevronLeft';
import SlideOver from '@/components/ui/slideOver';
import { Palette, Type } from '@/constants/theme';
import { useSession } from '@/hooks/use-session';
import { ReportTarget, submitReport } from '@/lib/submitReport';
import { HEADER_TOP } from '@/constants/layout';

// Fixed list rather than free text alone: a reason that's one of a known set can
// be counted and sorted later, and most people won't write a paragraph.
const REASONS = [
  'Harassment or bullying',
  'Hate speech',
  'Sexual content',
  'Spam or scam',
  'Impersonation',
  'Someone is in danger',
  'Other',
];

interface Props {
  // Null when closed — the sheet keeps showing the last target on the way out.
  target: ReportTarget | null;
  onClose: () => void;
}

// Reporting never blocks: the two are deliberately separate actions, so a
// report about a broken photo doesn't cost you a group, and blocking someone
// doesn't quietly accuse them of anything.
export default function ReportSheet({ target, onClose }: Props) {
  const { session } = useSession();
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState('');
  const [sending, setSending] = useState(false);

  function reset() {
    setReason(null);
    setDetails('');
    setSending(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSubmit() {
    if (!target || !reason || !session?.user) return;
    setSending(true);
    const ok = await submitReport(session.user.id, target, reason, details.trim());
    if (!ok) {
      setSending(false);
      Alert.alert('Report failed', 'Please try again.');
      return;
    }
    reset();
    onClose();
    // After the sheet is gone, so it isn't talking over itself.
    Alert.alert('Report received', 'Thanks — we review every report.');
  }

  const noun =
    target?.type === 'group' ? 'group' : target?.type === 'message' ? 'message' : 'person';

  return (
    <SlideOver visible={target !== null} onRequestClose={handleClose}>
      <View style={styles.container}>

        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={handleClose}>
            <ChevronLeft size={28} color="#000" />
          </TouchableOpacity>
          <Text style={styles.title}>Report {noun}</Text>
        </View>

        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

            <Text style={styles.prompt}>What&apos;s wrong?</Text>

            {REASONS.map((r, i) => (
              <TouchableOpacity
                key={r}
                style={[styles.reasonRow, i > 0 && styles.reasonRowDivided]}
                onPress={() => setReason(r)}
              >
                <Text style={styles.reasonText}>{r}</Text>
                {reason === r && <Text style={styles.check}>✓</Text>}
              </TouchableOpacity>
            ))}

            <TextInput
              style={styles.details}
              value={details}
              onChangeText={setDetails}
              placeholder="Anything else we should know? (optional)"
              placeholderTextColor={Palette.muted}
              multiline
            />

            {/* Inert until a reason is picked, which is what the grey says —
                the same idle-until-valid treatment the Done buttons use. */}
            <TouchableOpacity
              style={[styles.submit, !reason && styles.submitIdle]}
              onPress={handleSubmit}
              disabled={!reason || sending}
            >
              {sending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitText}>Submit report</Text>
              )}
            </TouchableOpacity>

          </ScrollView>
        </KeyboardAvoidingView>

      </View>
    </SlideOver>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Palette.background,
  },

  flex: {
    flex: 1,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: HEADER_TOP,
    paddingBottom: 16,
    paddingHorizontal: 20,
  },

  backButton: {
    marginRight: 16,
  },

  title: {
    ...Type.header,
    color: '#000',
  },

  content: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },

  prompt: {
    ...Type.label,
    color: '#555',
    marginBottom: 8,
  },

  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },

  reasonRowDivided: {
    borderTopColor: '#eee',
  },

  reasonText: {
    ...Type.body,
    color: '#000',
  },

  check: {
    ...Type.bodyBold,
    color: Palette.confirm,
  },

  details: {
    ...Type.body,
    color: '#000',
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    marginTop: 20,
    minHeight: 90,
    textAlignVertical: 'top',
  },

  submit: {
    backgroundColor: Palette.confirm,
    borderRadius: 8,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
  },

  submitIdle: {
    backgroundColor: Palette.muted,
  },

  submitText: {
    ...Type.bodyBold,
    color: '#fff',
  },
});
