import { useRef, useState } from 'react';
import { Image } from 'expo-image';
import { ActivityIndicator, Alert, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import History from '@/components/profile/history';
import IndividualPost, { IndividualPostHandle } from '@/components/posts/individualPost';
import Settings from '@/components/profile/settings';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Palette, Type } from '@/constants/theme';
import { useSession } from '@/hooks/use-session';

export default function ProfileScreen() {
  const { session } = useSession();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  // Set by the post on its first edit; leaving edit mode re-reads the saved
  // row, so anything unsaved is dropped unless it's saved on the way out.
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const postRef = useRef<IndividualPostHandle>(null);

  if (!session) return null;

  async function handleSave() {
    // The post has a spinner of its own, but it sits by the profile picture —
    // scrolled off if you saved from the header, so Done needs one too.
    setSaving(true);
    const saved = await postRef.current?.save();
    setSaving(false);
    // A failed save has already shown its own alert — stay in edit mode so the
    // edits aren't lost.
    if (saved) { setDirty(false); setEditMode(false); }
  }

  function toggleEditMode() {
    if (!editMode) { setDirty(false); setEditMode(true); return; }
    // Nothing to save, so no need to ask.
    if (!dirty) { setEditMode(false); return; }
    Alert.alert('Done editing?', undefined, [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Save changes', onPress: handleSave },
      { text: 'Discard changes', style: 'destructive', onPress: () => { setDirty(false); setEditMode(false); } },
    ]);
  }

  return (
    <View style={styles.container}>
      {/* This header never scrolls, unlike the pencil inside the post — which
          is why Done lives here: on a long profile the pencil scrolls out of
          reach, leaving no way out of edit mode. Editing also takes over the
          slot entirely, so history and settings simply aren't reachable until
          you're done. */}
      <View style={styles.header}>
        <Image
          source={require('../../assets/images/bool-logo.png')}
          style={styles.logo}
          contentFit="contain"
        />
        {editMode ? (
          saving ? (
            <ActivityIndicator size={24} color="#43a047" />
          ) : (
            <TouchableOpacity onPress={toggleEditMode}>
              <Text style={styles.doneText}>Done</Text>
            </TouchableOpacity>
          )
        ) : (
          <View style={styles.headerRight}>
            <TouchableOpacity onPress={() => setHistoryOpen(true)}>
              <IconSymbol name="book.fill" size={24} color="#000" />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setSettingsOpen(true)}>
              <IconSymbol name="gearshape.fill" size={24} color="#000" />
            </TouchableOpacity>
          </View>
        )}
      </View>
      <IndividualPost
        ref={postRef}
        personId={session.user.id}
        editMode={editMode}
        onDirty={() => setDirty(true)}
        onToggleEdit={toggleEditMode}
      />

      <Modal visible={historyOpen} animationType="slide" onRequestClose={() => setHistoryOpen(false)}>
        <History onClose={() => setHistoryOpen(false)} />
      </Modal>

      <Modal visible={settingsOpen} animationType="slide" onRequestClose={() => setSettingsOpen(false)}>
        <Settings onClose={() => setSettingsOpen(false)} />
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Palette.background,
  },
  header: {
    flexDirection: 'row',
    // Logo at the left, history/settings at the right.
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 20,
  },
  // Matches the file's own aspect (755x289), so `contain` fills the box exactly
  // and the wordmark neither letterboxes nor crops. The artwork is trimmed to
  // the ink, so this height is the letter height — it sets the header's height,
  // and the 24pt icons centre against it.
  logo: {
    height: 26,
    width: 68,
    // The artwork is trimmed to the ink, so it has no optical margin of its own
    // — this nudges it off the header's own left padding.
    marginLeft: 6,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  // Green, like every other affirmative action in the app.
  doneText: {
    ...Type.bodyBold,
    color: '#43a047',
  },
});
