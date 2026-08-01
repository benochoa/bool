import { useEffect, useRef, useState } from 'react';
import { useNavigation } from 'expo-router';
import {
  ActivityIndicator, Alert, Animated, Dimensions, Modal, StyleSheet, Text,
  TouchableOpacity, View,
} from 'react-native';
import History from '@/components/profile/history';
import IndividualPost, { IndividualPostHandle } from '@/components/posts/individualPost';
import { PersonData } from '@/lib/fetchPerson';
import Settings from '@/components/profile/settings';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Palette, Type } from '@/constants/theme';
import { ChevronLeft } from '@/assets/symbols/ChevronLeft';
import { useSession } from '@/hooks/use-session';

// How far offscreen the editor rests — a full screen width to the right.
const WIDTH = Dimensions.get('window').width;

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
  // The row the read copy fetched, handed to the edit copy so it mounts
  // instantly instead of fetching the same profile a second time.
  const [snapshot, setSnapshot] = useState<PersonData | null>(null);
  // Bumped after a save so the read copy underneath re-reads what was written.
  const [readKey, setReadKey] = useState(0);
  // Stays true through the slide-out, so the edit copy is still there to watch
  // leave; `editMode` alone would unmount it mid-animation.
  const [editorMounted, setEditorMounted] = useState(false);
  const slide = useRef(new Animated.Value(WIDTH)).current;

  // Editing takes over the whole screen: with the bar hidden there's no way to
  // leave the tab mid-edit, so unsaved work can't be stranded behind a switch.
  const navigation = useNavigation();
  useEffect(() => {
    navigation.setOptions({ tabBarStyle: editMode ? { display: 'none' } : undefined });
  }, [navigation, editMode]);

  useEffect(() => {
    if (editMode) setEditorMounted(true);
    Animated.timing(slide, {
      toValue: editMode ? 0 : WIDTH,
      duration: editMode ? 280 : 240,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && !editMode) setEditorMounted(false);
    });
  }, [editMode, slide]);

  if (!session) return null;

  async function handleSave() {
    // The post has a spinner of its own, but it sits by the profile picture —
    // scrolled off if you saved from the header, so Done needs one too.
    setSaving(true);
    const saved = await postRef.current?.save();
    setSaving(false);
    // A failed save has already shown its own alert — stay in edit mode so the
    // edits aren't lost.
    if (saved) {
      setDirty(false);
      setEditMode(false);
      // The read copy underneath still holds the pre-save row, and it's about
      // to be the only thing on screen.
      setReadKey(k => k + 1);
    }
  }

  function enterEditMode() {
    setDirty(false);
    setEditMode(true);
  }

  // Only reachable with unsaved edits — Done is inert until then, so there is
  // never a confirmation with nothing to confirm.
  function handleDone() {
    Alert.alert('Save changes?', undefined, [
      { text: 'Continue editing', style: 'cancel' },
      { text: 'Confirm', onPress: handleSave },
    ]);
  }

  function handleBack() {
    // Nothing to lose, so leave straight away.
    if (!dirty) { setEditMode(false); return; }
    Alert.alert('Discard changes?', undefined, [
      { text: 'Continue editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => { setDirty(false); setEditMode(false); } },
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
        {editMode ? (
          <TouchableOpacity onPress={handleBack} hitSlop={8}>
            <ChevronLeft size={26} color="#000" />
          </TouchableOpacity>
        ) : (
          // Nothing on the left outside edit mode — an empty slot, so the
          // header's space-between still pushes the icons to the right.
          <View />
        )}
        {editMode ? (
          saving ? (
            <ActivityIndicator size={24} color={Palette.confirm} />
          ) : (
            // Inert until there is something to save, which is what the grey
            // says — so Done never opens a confirmation over no changes.
            <TouchableOpacity onPress={handleDone} disabled={!dirty}>
              <Text style={[styles.doneText, !dirty && styles.doneTextIdle]}>Done</Text>
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
      {/* The read copy stays mounted underneath, so the editor has something to
          slide over — and it's the one that fetches the profile. */}
      <View style={styles.body}>
        <IndividualPost
          key={readKey}
          personId={session.user.id}
          onLoaded={setSnapshot}
          onToggleEdit={enterEditMode}
        />

        {editorMounted && (
          <Animated.View
            style={[StyleSheet.absoluteFill, styles.editor, { transform: [{ translateX: slide }] }]}
          >
            <IndividualPost
              ref={postRef}
              personId={session.user.id}
              editMode
              initialData={snapshot}
              onDirty={() => setDirty(true)}
            />
          </Animated.View>
        )}
      </View>

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
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  // Anchors the editor's absolute fill to the area below the header, so the
  // header's own controls stay above it and never slide.
  body: {
    flex: 1,
  },
  // Opaque, or the read copy underneath would show through it.
  editor: {
    backgroundColor: Palette.background,
  },
  doneText: {
    ...Type.bodyBold,
    color: Palette.confirm,
  },
  doneTextIdle: {
    color: Palette.muted,
  },
});
