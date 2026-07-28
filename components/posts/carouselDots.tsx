import { StyleSheet, View } from 'react-native';

// Page indicator for a paging carousel: `count` small gray dots, the `active`
// one highlighted. `active` is the 0-based index of the page on screen.
export default function CarouselDots({ count, active }: { count: number; active: number }) {
  if (count <= 0) return null;
  return (
    <View style={styles.row}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={[styles.dot, i === active && styles.dotActive]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // alignSelf + justifyContent both center: the row shrinks to its dots and
  // sits centered regardless of dot count or the parent's alignment.
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignSelf: 'center',
    gap: 6,
    marginTop: 8,
  },

  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#ccc',
  },

  dotActive: {
    backgroundColor: '#5AC8FA',
  },
});