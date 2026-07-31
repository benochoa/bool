import { useRef, useState } from 'react';
import { Alert, Modal, StyleSheet, TouchableOpacity, View } from 'react-native';
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
  const postRef = useRef<IndividualPostHandle>(null);

  if (!session) return null;

  async function handleSave() {
    // The post shows its own spinner in place of the pencil while this runs.
    const saved = await postRef.current?.save();
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
      {/* The edit pencil lives beside the name inside the post, so it scrolls
          away with the content — this header is only history/settings. */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => setHistoryOpen(true)}>
          <IconSymbol name="book.fill" size={24} color="#000" />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setSettingsOpen(true)}>
          <IconSymbol name="gearshape.fill" size={24} color="#000" />
        </TouchableOpacity>
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
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 16,
    paddingTop: 60,
    paddingHorizontal: 20,
  },
});
