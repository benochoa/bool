import { useState } from 'react';
import { Alert, StyleSheet, TouchableOpacity, View } from 'react-native';
import { ChevronLeft } from '@/assets/symbols/ChevronLeft';
import { Ellipsis } from '@/assets/symbols/Ellipsis';
import IndividualPost from '@/components/posts/individualPost';
import ActionSheet from '@/components/ui/actionSheet';
import ReportSheet from '@/components/ui/reportSheet';
import SlideOver from '@/components/ui/slideOver';
import { Palette } from '@/constants/theme';
import { useBlockedPeople } from '@/hooks/use-blocked-people';
import { useSession } from '@/hooks/use-session';
import { setPersonBlock } from '@/lib/setPersonBlock';
import { ReportTarget } from '@/lib/submitReport';
import { HEADER_TOP } from '@/constants/layout';

// Someone's profile, read-only, over whatever opened it — a members card, a
// message's picture. A panel can only cover its own screen, so this belongs to
// the screen rather than to the card that opens it: nested inside a post it
// would draw under that screen's floating back chevron.
interface Props {
  // Null when closed — the panel keeps showing the last person on the way out.
  personId: string | null;
  onClose: () => void;
}

export default function PersonPanel({ personId, onClose }: Props) {
  const { session } = useSession();
  const { blockedIds, refreshBlocked } = useBlockedPeople();
  const [reporting, setReporting] = useState<ReportTarget | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);

  // Your own profile can be reached through a members card, and blocking
  // yourself is neither meaningful nor allowed (the table rejects it).
  const isSelf = personId !== null && personId === session?.user.id;
  const canBlock = personId !== null && !isSelf && !blockedIds.has(personId);

  function handleBlock() {
    if (!personId || !session?.user) return;
    Alert.alert(
      'Block this person?',
      "You won't see their messages in any chat, and they won't see yours. Your groups can still match with theirs.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            const ok = await setPersonBlock(session.user.id, personId, true);
            if (!ok) {
              Alert.alert('Block failed', 'Please try again.');
              return;
            }
            // The panel is now showing a profile the app has just agreed to
            // stop showing, so it closes rather than sitting there blocked.
            refreshBlocked();
            onClose();
          },
        },
      ]
    );
  }

  return (
    <SlideOver visible={personId !== null} onRequestClose={onClose}>
      <View style={styles.container}>
        <TouchableOpacity style={styles.backButton} onPress={onClose}>
          <ChevronLeft size={28} color="#000" />
        </TouchableOpacity>
        {personId && (
          <IndividualPost
            personId={personId}
            standalone
            // Your own profile has nothing to report or block, so it gets no
            // dots — and with none, no empty row either.
            headerRight={!isSelf ? (
              <TouchableOpacity onPress={() => setActionsOpen(true)} hitSlop={8}>
                <Ellipsis size={24} color="#000" />
              </TouchableOpacity>
            ) : undefined}
          />
        )}

        {/* Over the post and its chevron, which is why it's a sibling here
            rather than something the post draws for itself. */}
        <ActionSheet
          visible={actionsOpen}
          actions={[
            {
              label: 'Report',
              onPress: () => {
                setActionsOpen(false);
                if (personId) setReporting({ type: 'person', personId });
              },
            },
            ...(canBlock ? [{
              label: 'Block',
              destructive: true,
              onPress: () => { setActionsOpen(false); handleBlock(); },
            }] : []),
          ]}
          onClose={() => setActionsOpen(false)}
        />

        <ReportSheet target={reporting} onClose={() => setReporting(null)} />
      </View>
    </SlideOver>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Palette.background,
  },

  // The post draws its own content from the top, so the back button floats
  // over it.
  backButton: {
    position: 'absolute',
    top: HEADER_TOP,
    left: 20,
    height: 44,
    justifyContent: 'center',
    zIndex: 2,
  },
});
