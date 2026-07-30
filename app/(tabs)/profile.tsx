import { useState } from 'react';
import { Alert, Modal, StyleSheet, TouchableOpacity, View } from 'react-native';
import History from '@/components/profile/history';
import IndividualPost from '@/components/posts/individualPost';
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
  // row, so anything unsaved is dropped and has to be confirmed first.
  const [dirty, setDirty] = useState(false);

  if (!session) return null;

  function toggleEditMode() {
    if (editMode && dirty) {
      Alert.alert('Discard changes?', 'Your unsaved edits will be lost.', [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => { setDirty(false); setEditMode(false); } },
      ]);
      return;
    }
    setDirty(false);
    setEditMode(e => !e);
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={toggleEditMode}>
          <IconSymbol name="pencil" size={24} color={editMode ? '#43a047' : '#000'} />
        </TouchableOpacity>
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
        personId={session.user.id}
        editMode={editMode}
        onDirty={() => setDirty(true)}
        onSave={() => { setDirty(false); setEditMode(false); }}
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
