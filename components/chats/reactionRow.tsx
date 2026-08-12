import { MessageReaction } from '@/lib/fetchMessageReactions';
import { FontFamily } from '@/constants/theme';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface Props {
  reactions: MessageReaction[];
  myUserId: string | undefined;
  // Tapping a pill sets that emoji, or clears it when it's already yours.
  onToggle: (emoji: string) => void;
}

// The tapbacks under one message: one pill per distinct emoji, with a count
// once more than one person has picked it.
export default function ReactionRow({ reactions, myUserId, onToggle }: Props) {
  // Grouped in first-seen order, so pills don't reshuffle as they come in.
  const order: string[] = [];
  const counts = new Map<string, number>();
  let mine: string | null = null;

  for (const r of reactions) {
    if (!counts.has(r.emoji)) order.push(r.emoji);
    counts.set(r.emoji, (counts.get(r.emoji) ?? 0) + 1);
    if (r.userId === myUserId) mine = r.emoji;
  }

  return (
    <View style={styles.row}>
      {order.map(emoji => (
        <TouchableOpacity
          key={emoji}
          style={[styles.pill, emoji === mine && styles.pillMine]}
          onPress={() => onToggle(emoji)}
          activeOpacity={0.7}
        >
          <Text style={styles.emoji}>{emoji}</Text>
          {(counts.get(emoji) ?? 0) > 1 && (
            <Text style={styles.count}>{counts.get(emoji)}</Text>
          )}
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    // Pulled up under the bubble's corner, the way a tapback hangs off the
    // message rather than sitting on its own line.
    marginTop: -4,
  },

  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e2e2',
  },

  // Yours is outlined in the app's purple, so you can tell at a glance which
  // of the pills you're counted in.
  pillMine: {
    borderColor: '#3B3B98',
    backgroundColor: '#f0f0fa',
  },

  emoji: {
    fontSize: 13,
  },

  count: {
    fontFamily: FontFamily.semiBold,
    fontSize: 11,
    color: '#666',
  },
});
