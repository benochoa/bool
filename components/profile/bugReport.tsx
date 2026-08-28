import { useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { ChevronLeft } from '@/assets/symbols/ChevronLeft';
import { Palette, Type } from '@/constants/theme';
import { useSession } from '@/hooks/use-session';
import { submitBugReport } from '@/lib/submitBugReport';
import { HEADER_TOP } from '@/constants/layout';

interface Props {
  onClose: () => void;
}

export default function BugReport({ onClose }: Props) {
  const { session } = useSession();
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  // Whitespace alone isn't a bug report, and it's what the idle button reads.
  const canSubmit = body.trim().length > 0;

  async function handleSubmit() {
    if (!canSubmit || !session?.user) return;
    setSending(true);
    const ok = await submitBugReport(session.user.id, body.trim());
    if (!ok) {
      setSending(false);
      Alert.alert('Report failed', 'Please try again.');
      return;
    }
    setBody('');
    setSending(false);
    onClose();
    // After the sheet is gone, so it isn't talking over itself.
    Alert.alert('Thanks', 'Your report has been sent.');
  }

  return (
    <View style={styles.container}>

      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={onClose}>
          <ChevronLeft size={28} color="#000" />
        </TouchableOpacity>
        <Text style={styles.title}>Report a Bug</Text>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

          <Text style={styles.prompt}>Tell us what went wrong below:</Text>

          <TextInput
            style={styles.body}
            value={body}
            onChangeText={setBody}
            placeholderTextColor={Palette.muted}
            multiline
            autoFocus
          />

          {/* Inert until something's been typed — the same idle-until-valid
              treatment the report sheet and the Done buttons use. */}
          <TouchableOpacity
            style={[styles.submit, !canSubmit && styles.submitIdle]}
            onPress={handleSubmit}
            disabled={!canSubmit || sending}
          >
            {sending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.submitText}>Submit</Text>
            )}
          </TouchableOpacity>

        </ScrollView>
      </KeyboardAvoidingView>

    </View>
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

  // Taller than the report sheet's optional details box, since here it's the
  // whole of what's being asked for rather than an afterthought.
  body: {
    ...Type.body,
    color: '#000',
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    minHeight: 160,
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
