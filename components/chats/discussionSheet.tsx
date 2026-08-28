import { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ChevronLeft } from '@/assets/symbols/ChevronLeft';
import { ChevronRight } from '@/assets/symbols/ChevronRight';
import ChatThread from '@/components/chats/chatThread';
import { ViewerImage } from '@/components/chats/imageViewer';
import GroupPost from '@/components/posts/groupPost';
import SlideOver from '@/components/ui/slideOver';
import { Palette, Type } from '@/constants/theme';
import { useInAppNotifications } from '@/hooks/use-in-app-notifications';
import { useSession } from '@/hooks/use-session';
import { markDiscussionRead } from '@/lib/markDiscussionRead';

// Your own group's private back-room about one candidate group — a full-screen
// panel over whatever opened it, leaving by its back chevron or by a swipe to
// the right, like every other panel in the app.
//
// The thread inside is the real ChatThread in `discussion` mode, not a copy of
// it: photos, voice notes, replies, reactions, deleting and reporting are the
// same code paths the matched-group chat uses, so the two cannot drift apart.
// Only where the messages are read and written differs.

interface Props {
  // The group being discussed. Null when closed.
  aboutGroupId: string | null;
  aboutGroupName: string;
  myGroupId: string;
  onClose: () => void;
  // Raised to the screen rather than handled here, for the same reason the
  // chat raises it: panning a zoomed photo inside this panel would race the
  // panel's own swipe-to-dismiss, and closing the whole discussion out from
  // under the photo is not what a drag on a photo should do.
  onOpenImage: (image: ViewerImage) => void;
  // Tapping a member of the group under discussion. Raised to the screen for
  // the reason groupPost gives: the panel that shows a profile has to sit above
  // the screen's own floating chrome, which one opened from in here would not.
  onSelectMember: (personId: string) => void;
}

export default function DiscussionSheet({
  aboutGroupId, aboutGroupName, myGroupId, onClose, onOpenImage, onSelectMember,
}: Props) {
  const { session } = useSession();
  const { setOpenDiscussion } = useInAppNotifications();
  // The candidate's full post, opened from the name in the header.
  const [postOpen, setPostOpen] = useState(false);

  // Marked read on open rather than on close: the badge should clear the moment
  // you look, and closing is the one moment a crash or a force-quit can eat.
  useEffect(() => {
    if (!aboutGroupId || !session?.user) return;
    markDiscussionRead(session.user.id, myGroupId, aboutGroupId);
  }, [aboutGroupId, myGroupId, session?.user]);

  // While this is open its own messages arrive on screen, so bannering them
  // over the top would only cover up what you are already reading.
  useEffect(() => {
    setOpenDiscussion(aboutGroupId);
    return () => setOpenDiscussion(null);
  }, [aboutGroupId, setOpenDiscussion]);

  return (
    <>
      <SlideOver visible={aboutGroupId !== null} onRequestClose={onClose}>
        <View style={styles.container}>

          {/* The panel's own header rather than the thread's: the thread titles
              itself with the group and offers a way into who's in the chat, and
              neither reads right for a room the other group isn't in. */}
          <View style={styles.header}>
            <TouchableOpacity style={styles.backButton} onPress={onClose}>
              <ChevronLeft size={28} color="#000" />
            </TouchableOpacity>
            {/* Name and chevron are one target — both open the group being
                discussed, so you can check the post without losing the thread
                you were reading it against. */}
            <TouchableOpacity style={styles.titleRow} onPress={() => setPostOpen(true)}>
              <Text style={styles.title} numberOfLines={1}>{aboutGroupName}</Text>
              <ChevronRight />
            </TouchableOpacity>
          </View>

          {aboutGroupId && (
            <ChatThread
              myGroupId={myGroupId}
              otherGroupId={aboutGroupId}
              otherGroupName={aboutGroupName}
              discussion
              hideHeader
              onClose={onClose}
              onOpenImage={onOpenImage}
            />
          )}

        </View>
      </SlideOver>

      {/* A sibling of the discussion rather than a child, so it slides in over
          it on its own rather than being carried along by it. Rendered after,
          which is what puts it on top. */}
      <SlideOver visible={postOpen} onRequestClose={() => setPostOpen(false)}>
        <View style={styles.postPanel}>
          <TouchableOpacity style={styles.postBack} onPress={() => setPostOpen(false)}>
            <ChevronLeft size={28} color="#000" />
          </TouchableOpacity>
          {aboutGroupId && (
            <GroupPost groupId={aboutGroupId} onSelectMember={onSelectMember} />
          )}
        </View>
      </SlideOver>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Palette.background,
  },

  // Same shape as the settings and report panels: chevron left, title beside
  // it, clear of the status bar.
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 60,
    paddingBottom: 16,
    paddingHorizontal: 20,
  },

  backButton: {
    marginRight: 16,
  },

  // Name and chevron travel together, and shrink together on a long name.
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },

  title: {
    ...Type.header,
    color: '#000',
    flexShrink: 1,
  },

  // The candidate's post, laid out the way both tabs lay out their own detail
  // panel: the chevron floats over the post rather than sitting above it.
  postPanel: {
    flex: 1,
    backgroundColor: Palette.background,
    paddingTop: 100,
  },

  postBack: {
    position: 'absolute',
    top: 60,
    left: 20,
    zIndex: 10,
  },
});
