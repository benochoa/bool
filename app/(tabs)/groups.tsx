import {
  StyleSheet, View, Text, TouchableOpacity,
  ActivityIndicator, Alert, Animated, Dimensions
} from 'react-native';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '@/supabaseClient';
import GroupPost, { GroupPostHandle } from '@/components/posts/groupPost';
import { GroupData } from '@/lib/fetchGroup';
import PersonPanel from '@/components/posts/personPanel';
import GroupSwitcher from '@/components/groups/groupSwitcher';
import JoinGroup from '@/components/groups/joinGroup';
import { PostSkeleton } from '@/components/ui/skeleton';
import SlideOver from '@/components/ui/slideOver';
import { ChevronDown } from '@/assets/symbols/ChevronDown';
import { ChevronLeft } from '@/assets/symbols/ChevronLeft';
import { Palette, Type } from '@/constants/theme';
import { useAppResume } from '@/hooks/use-app-resume';
import { useCurrentGroup } from '@/hooks/use-current-group';
import { useHideTabBar } from '@/hooks/use-hide-tab-bar';
import { useSession } from '@/hooks/use-session';
import { fetchGroupSummaries, GroupSummary } from '@/lib/fetchGroupSummaries';
import { HEADER_TOP } from '@/constants/layout';

// How far offscreen the editor rests — a full screen width to the right.
const WIDTH = Dimensions.get('window').width;

export default function GroupsScreen() {

  const { myGroupIds, loadingGroups, currentGroupId, setCurrentGroupId, refreshGroups } = useCurrentGroup();
  const { session } = useSession();

  // State
  const [creating, setCreating] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [joining, setJoining] = useState(false);
  // A member's profile, opened from the post's members card. It lives here
  // rather than in the post so it can cover the switcher band.
  const [openPersonId, setOpenPersonId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  // Set by the post on its first edit; leaving edit mode re-reads the saved
  // row, so anything unsaved is dropped unless it's saved on the way out.
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const postRef = useRef<GroupPostHandle>(null);
  // The row the read copy fetched, handed to the edit copy so it mounts
  // instantly instead of fetching the same group a second time.
  const [snapshot, setSnapshot] = useState<GroupData | null>(null);
  // Bumped after a save so the read copy underneath re-reads what was written.
  const [readKey, setReadKey] = useState(0);
  // Bumped when the group changed elsewhere. Unlike readKey this doesn't
  // remount the post — it asks the mounted one to refetch in place.
  const [refreshToken, setRefreshToken] = useState(0);
  // Stays true through the slide-out, so the edit copy is still there to watch
  // leave; `editMode` alone would unmount it mid-animation.
  const [editorMounted, setEditorMounted] = useState(false);
  const slide = useRef(new Animated.Value(WIDTH)).current;
  // What the switcher asked for, held until the switcher is off screen.
  const pendingAction = useRef<'create' | 'join' | null>(null);

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

  // Editing takes over the whole screen: with the bar hidden there's no way to
  // leave the tab mid-edit, so unsaved work can't be stranded behind a switch.
  useHideTabBar(editMode);

  // One query resolves every switcher name — the menu rows and the active
  // label both read from it.
  useEffect(() => {
    fetchGroupSummaries(myGroupIds).then(setGroups);
  }, [myGroupIds]);

  // The switcher needs every group's name, so a refresh needs the whole id
  // list — but refreshGroups hands back a brand new array each time, so naming
  // myGroupIds in a dependency array would tear the channel down and rebuild it
  // on every refresh. Read through a ref, it stays current without doing that.
  const myGroupIdsRef = useRef(myGroupIds);
  myGroupIdsRef.current = myGroupIds;

  // Everything this tab shows, brought up to date. refreshGroups only re-reads
  // which groups are mine, so on its own it misses every change that doesn't
  // add or remove one — which is most of them.
  const refreshTab = useCallback(() => {
    refreshGroups();
    fetchGroupSummaries(myGroupIdsRef.current).then(setGroups);
    setRefreshToken(t => t + 1);
  }, [refreshGroups]);

  // Live updates for the group on screen: the leader's edits land on the row,
  // and joins, leaves and kicks all land on its memberships. use-current-group
  // already watches memberships filtered to *me*, which catches my own leaving
  // but nothing anyone else does.
  useEffect(() => {
    if (!currentGroupId) return;

    const refetch = () => {
      fetchGroupSummaries(myGroupIdsRef.current).then(setGroups);
      setRefreshToken(t => t + 1);
    };

    const channel = supabase
      .channel(`groups-tab-${currentGroupId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'groups', filter: `id=eq.${currentGroupId}` },
        refetch
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'memberships', filter: `group_id=eq.${currentGroupId}` },
        refetch
      )
      .subscribe(status => console.log('[realtime] groups tab channel:', status));

    return () => { supabase.removeChannel(channel); };
  }, [currentGroupId]);

  const currentGroup = groups.find(g => g.id === currentGroupId);
  const currentGroupName = currentGroup?.name ?? '';
  // Only the leader can edit, so only the leader gets a pencil. Reading it off
  // the switcher's data means no extra query and no wait on GroupPost's fetch.
  const isLeader = !!(session?.user && currentGroup?.created_by === session.user.id);

  async function handleSave() {
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
      refreshGroups();
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

  // Refetch on focus, so anything changed while this tab was in the background
  // — a rename, a join, a leave, an edit made straight in Supabase — is already
  // right by the time it's on screen.
  useFocusEffect(
    useCallback(() => {
      refreshTab();
    }, [refreshTab])
  );

  // Same reason, for the resume that focus can't see. It also covers what the
  // channel above missed: postgres_changes has no replay, so every event sent
  // while the socket was down is simply gone.
  useAppResume(refreshTab);

  return (
    <View style={styles.container}>

      {/* Editing takes over the band entirely: the switcher would be a way out
          of the group mid-edit, and the name is editable in the post anyway. */}
      {editMode ? (
        <View style={styles.editBand}>
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
        </View>
      ) : (
        /* Current group switcher */
        <View style={styles.switcherWrap} pointerEvents="box-none">
          <TouchableOpacity style={styles.switcherButton} onPress={() => setSwitcherOpen(o => !o)}>
            <Text style={styles.switcherButtonText} numberOfLines={1}>{currentGroupName || 'Select a group'}</Text>
            <ChevronDown size={16} color="#000" />
          </TouchableOpacity>
        </View>
      )}

      <GroupSwitcher
        visible={switcherOpen}
        groups={groups}
        // Edit mode belongs to the group you were editing, so switching leaves it.
        onSelect={(id) => { setCurrentGroupId(id); setSwitcherOpen(false); setEditMode(false); setDirty(false); }}
        // Create and Join open modals of their own, which iOS refuses to
        // present while the switcher is still on screen — so they're queued
        // and fired from onClosed, once it has finished sliding out.
        onCreate={() => { pendingAction.current = 'create'; setSwitcherOpen(false); }}
        onJoin={() => { pendingAction.current = 'join'; setSwitcherOpen(false); }}
        onClose={() => setSwitcherOpen(false)}
        onClosed={() => {
          const next = pendingAction.current;
          pendingAction.current = null;
          if (next === 'create') setCreating(true);
          else if (next === 'join') setJoining(true);
        }}
      />

      {/* My groups */}
      {loadingGroups ? (
        <PostSkeleton topInset={114} />
      ) : myGroupIds.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>You are not in any groups yet. Create one or join your friends!</Text>
        </View>
      ) : (
        // The post owns the scrolling — wrapping it in a ScrollView of its own
        // would leave its inner one with nothing to scroll, and with no way to
        // bring a keyboard-covered card into view.
        <View style={styles.groupsList}>
          {/* The read copy stays mounted underneath, so the editor has
              something to slide over — and it's the one that fetches. */}
          {currentGroupId && (
            <GroupPost
              key={`${currentGroupId}-${readKey}`}
              groupId={currentGroupId}
              isMember
              topInset={114}
              refreshToken={refreshToken}
              onSelectMember={setOpenPersonId}
              onLoaded={setSnapshot}
              // Only the leader gets a pencil, so only the leader gets the toggle.
              onToggleEdit={isLeader ? enterEditMode : undefined}
              onLeft={() => { setEditMode(false); refreshGroups(); }}
              onDissolved={() => { setEditMode(false); refreshGroups(); }}
            />
          )}

          {editorMounted && currentGroupId && (
            <Animated.View
              style={[StyleSheet.absoluteFill, styles.editor, { transform: [{ translateX: slide }] }]}
            >
              <GroupPost
                ref={postRef}
                groupId={currentGroupId}
                isMember
                topInset={114}
                editMode
                onSelectMember={setOpenPersonId}
                initialData={snapshot}
                onDirty={() => setDirty(true)}
                onLeft={() => { setEditMode(false); refreshGroups(); }}
                onDissolved={() => { setEditMode(false); refreshGroups(); }}
              />
            </Animated.View>
          )}
        </View>
      )}

      {/* Join group modal. Joining is a deliberate act, so it also switches to
          the group you just joined rather than leaving you on the old one. */}
      <JoinGroup
        visible={joining}
        onClose={() => setJoining(false)}
        onJoined={id => { setCurrentGroupId(id); refreshGroups(); }}
      />

      {/* Create group */}
      <SlideOver visible={creating} onRequestClose={() => setCreating(false)}>
        <GroupPost
          creating
          onClose={() => { setCreating(false); refreshGroups(); }}
          onCreated={id => { setCurrentGroupId(id); setCreating(false); refreshGroups(); }}
        />
      </SlideOver>

      {/* Last, so a member's profile covers the post that opened it. */}
      <PersonPanel personId={openPersonId} onClose={() => setOpenPersonId(null)} />

    </View>
  );
}

const styles = StyleSheet.create({

  container: {
    flex: 1,
    backgroundColor: Palette.background,
  },

  // Edit controls — the same 44pt band the switcher occupies, so nothing below
  // shifts when one replaces the other.
  editBand: {
    position: 'absolute',
    top: HEADER_TOP,
    left: 20,
    right: 20,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 3,
  },

  doneText: {
    ...Type.bodyBold,
    color: Palette.confirm,
  },

  doneTextIdle: {
    color: Palette.muted,
  },

  // Current group switcher — pinned, and opaque from the very top of the
  // screen down, so the post's own name scrolls out of sight underneath it
  // instead of sliding through the band.
  switcherWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: HEADER_TOP,
    backgroundColor: Palette.background,
    alignItems: 'center',
    zIndex: 3,
  },

  switcherButton: {
    maxWidth: '80%',
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },

  switcherButtonText: {
    ...Type.title,
    color: '#000',
    flexShrink: 1,
  },

  // Empty state
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  emptyText: {
    ...Type.title,
    color: '#000',
    textAlign: 'center',
    paddingHorizontal: 40,
  },

  // Groups list
  groupsList: {
    flex: 1,
  },

  // Opaque, or the read copy underneath would show through it.
  editor: {
    backgroundColor: Palette.background,
  },

});
