import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Animated, Dimensions, StyleSheet, Text,
  TouchableOpacity, View,
} from 'react-native';
import History from '@/components/profile/history';
import IndividualPost, { IndividualPostHandle } from '@/components/posts/individualPost';
import { PersonData } from '@/lib/fetchPerson';
import Settings from '@/components/profile/settings';
import { IconSymbol } from '@/components/ui/icon-symbol';
import SlideOver from '@/components/ui/slideOver';
import { Palette, Type } from '@/constants/theme';
import { ChevronLeft } from '@/assets/symbols/ChevronLeft';
import { useHideTabBar } from '@/hooks/use-hide-tab-bar';
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
  useHideTabBar(editMode);

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
      {/* Edit mode's controls only, floating rather than taking a band of its
          own: the post below draws from the top, so history and settings can
          ride inside its scroll and leave with the content. These can't — Done
          has to stay put, since on a long profile the in-post pencil scrolls
          out of reach and there'd be no way out of edit mode. box-none so the
          empty area outside edit mode doesn't swallow taps meant for the post. */}
      <View style={styles.header} pointerEvents="box-none">
        {editMode && (
          <>
            <TouchableOpacity onPress={handleBack} hitSlop={8}>
              <ChevronLeft size={26} color="#000" />
            </TouchableOpacity>
            {saving ? (
              <ActivityIndicator size={24} color={Palette.confirm} />
            ) : (
              // Inert until there is something to save, which is what the grey
              // says — so Done never opens a confirmation over no changes.
              <TouchableOpacity onPress={handleDone} disabled={!dirty}>
                <Text style={[styles.doneText, !dirty && styles.doneTextIdle]}>Done</Text>
              </TouchableOpacity>
            )}
          </>
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
          headerRight={
            <>
              <TouchableOpacity onPress={() => setHistoryOpen(true)}>
                <IconSymbol name="book.fill" size={24} color="#000" />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setSettingsOpen(true)}>
                <IconSymbol name="gearshape.fill" size={24} color="#000" />
              </TouchableOpacity>
            </>
          }
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

      <SlideOver visible={historyOpen} onRequestClose={() => setHistoryOpen(false)}>
        <History onClose={() => setHistoryOpen(false)} />
      </SlideOver>

      <SlideOver visible={settingsOpen} onRequestClose={() => setSettingsOpen(false)}>
        <Settings onClose={() => setSettingsOpen(false)} />
      </SlideOver>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Palette.background,
  },
  // Over the post rather than above it, so the post owns the full height and
  // its own top row can scroll. zIndex keeps it clear of the editor, which
  // slides across the same space.
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    height: 86,
    flexDirection: 'row',
    // Back at the left, Done at the right.
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 20,
  },
  body: {
    flex: 1,
  },
  // Opaque, or the read copy underneath would show through it. The padding
  // stands in for the header the read copy gets from its own top row — without
  // it the edit copy would start under the floating Done.
  editor: {
    backgroundColor: Palette.background,
    paddingTop: 86,
  },
  doneText: {
    ...Type.bodyBold,
    color: Palette.confirm,
  },
  doneTextIdle: {
    color: Palette.muted,
  },
});
