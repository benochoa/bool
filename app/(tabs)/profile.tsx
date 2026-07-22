import { useState } from 'react';
import { Modal, StyleSheet, TouchableOpacity, View } from 'react-native';
import History from '@/components/history';
import IndividualPost from '@/components/individualPost';
import Settings from '@/components/settings';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Palette } from '@/constants/theme';
import { useSession } from '@/hooks/use-session';

export default function ProfileScreen() {
  const { session } = useSession();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  if (!session) return null;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => setHistoryOpen(true)}>
          <IconSymbol name="book.fill" size={24} color="#000" />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setSettingsOpen(true)}>
          <IconSymbol name="gearshape.fill" size={24} color="#000" />
        </TouchableOpacity>
      </View>
      <IndividualPost personId={session.user.id} editable={true} />

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
