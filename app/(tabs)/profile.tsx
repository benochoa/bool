import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, StyleSheet, TouchableOpacity, View } from 'react-native';
import History from '@/components/profile/history';
import IndividualPost, { IndividualPostHandle } from '@/components/posts/individualPost';
import Settings from '@/components/profile/settings';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Palette } from '@/constants/theme';
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
      <View style={styles.header}>
        {/* The ✓ is gone, so this spinner is the only sign a save is running. */}
        {saving ? (
          <ActivityIndicator size={24} color="#43a047" />
        ) : (
          <TouchableOpacity onPress={toggleEditMode}>
            <IconSymbol name="pencil" size={24} color={editMode ? '#43a047' : '#000'} />
          </TouchableOpacity>
        )}
        <View style={styles.headerRight}>
          <TouchableOpacity onPress={() => setHistoryOpen(true)}>
            <IconSymbol name="book.fill" size={24} color="#000" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setSettingsOpen(true)}>
            <IconSymbol name="gearshape.fill" size={24} color="#000" />
          </TouchableOpacity>
        </View>
      </View>
      <IndividualPost
        ref={postRef}
        personId={session.user.id}
        editMode={editMode}
        onDirty={() => setDirty(true)}
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
    // Edit pencil at the left, history/settings at the right.
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 20,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
});
