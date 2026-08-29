import { useEffect } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ChevronLeft } from '@/assets/symbols/ChevronLeft';
import ChatThread from '@/components/chats/chatThread';
import { ViewerImage } from '@/components/chats/imageViewer';
import SlideOver from '@/components/ui/slideOver';
import { Palette, Type } from '@/constants/theme';
import { useSession } from '@/hooks/use-session';
import { markDiscussionRead } from '@/lib/markDiscussionRead';
import { HEADER_TOP } from '@/constants/layout';

// Your own group's room — the members of your group and nobody else, talking
// about nothing in particular.
//
// The thread inside is the real ChatThread in `discussion` mode with the group
// as its own subject, which is what makes this a room rather than a feature:
// photos, video, voice notes, replies, reactions, deleting and reporting are
// the same code paths the matched-group chat uses. Only where the messages are
// read and written differs. See supabase/group_chat.sql.
interface Props {
  // The group whose room this is. Null when closed.
  groupId: string | null;
  groupName: string;
  onClose: () => void;
  // Raised to the screen for the reason the discussion raises it: panning a
  // zoomed photo inside this panel would race the panel's own swipe-to-dismiss.
  onOpenImage: (image: ViewerImage) => void;
}

export default function GroupChatSheet({ groupId, groupName, onClose, onOpenImage }: Props) {
  const { session } = useSession();

  // Marked read on open rather than on close, as the discussion does: the badge
  // should clear the moment you look, and closing is the one moment a crash or
  // a force-quit can eat.
  useEffect(() => {
    if (!groupId || !session?.user) return;
    markDiscussionRead(session.user.id, groupId, groupId);
  }, [groupId, session?.user]);

  return (
    <SlideOver visible={groupId !== null} onRequestClose={onClose}>
      <View style={styles.container}>

        {/* Its own header rather than the thread's: ChatThread's title opens
            ChatDetails, which lays out two groups side by side and would show
            this one twice. */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={onClose}>
            <ChevronLeft size={28} color="#000" />
          </TouchableOpacity>
          <Text style={styles.title} numberOfLines={1}>{groupName}</Text>
        </View>

        {groupId && (
          <ChatThread
            myGroupId={groupId}
            // The group is its own subject. This is the whole of what makes the
            // thread a group chat rather than a discussion.
            otherGroupId={groupId}
            otherGroupName={groupName}
            discussion
            hideHeader
            onClose={onClose}
            onOpenImage={onOpenImage}
          />
        )}

      </View>
    </SlideOver>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Palette.background,
  },
  // Same shape as the discussion and settings panels: chevron left, title
  // beside it, clear of the status bar.
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
    flexShrink: 1,
  },
});
