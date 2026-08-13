import { useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ChevronLeft } from '@/assets/symbols/ChevronLeft';
import IndividualPost from '@/components/posts/individualPost';
import ReportSheet from '@/components/ui/reportSheet';
import SlideOver from '@/components/ui/slideOver';
import { Palette, Type } from '@/constants/theme';
import { useBlockedPeople } from '@/hooks/use-blocked-people';
import { useSession } from '@/hooks/use-session';
import { setPersonBlock } from '@/lib/setPersonBlock';
import { ReportTarget } from '@/lib/submitReport';

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
        {!isSelf && personId && (
          <View style={styles.actions}>
            <TouchableOpacity onPress={() => setReporting({ type: 'person', personId })}>
              <Text style={styles.reportText}>Report</Text>
            </TouchableOpacity>
            {canBlock && (
              <TouchableOpacity onPress={handleBlock}>
                <Text style={styles.blockText}>Block</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
        {personId && <IndividualPost personId={personId} standalone />}

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
    top: 60,
    left: 20,
    height: 44,
    justifyContent: 'center',
    zIndex: 2,
  },

  // Mirrors the back chevron on the other edge, at the same height.
  actions: {
    position: 'absolute',
    top: 60,
    right: 20,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    zIndex: 2,
  },

  // Reporting is the milder of the two, so it doesn't take the alarm colour —
  // only blocking, which changes what you can see from here on, is red.
  reportText: {
    ...Type.bodyBold,
    color: '#000',
  },

  blockText: {
    ...Type.bodyBold,
    color: '#FF3B30',
  },
});
