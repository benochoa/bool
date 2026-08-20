import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';

// Runs `onResume` each time the app returns to the foreground.
//
// Backgrounding suspends the JS thread, which kills the realtime socket, and
// postgres_changes has no replay — every row that changed while it was down is
// simply lost, and the channel reconnects looking perfectly healthy. Navigation
// focus can't cover the gap either: coming back to the screen you never left is
// not a navigation event, so useFocusEffect never fires. Refetching on resume is
// what fills the hole.
//
// Paired with each screen's existing focus callback rather than given fetchers
// of its own, so the two triggers can't drift apart.
export function useAppResume(onResume: () => void) {
  // Kept in a ref so a caller's inline callback doesn't tear down and re-add the
  // listener on every render.
  const saved = useRef(onResume);
  saved.current = onResume;

  useEffect(() => {
    // iOS passes through `inactive` in both directions (notification shade, app
    // switcher), so the previous state is what distinguishes a real return from
    // a blip. A blip that does slip through only costs a redundant refetch.
    let previous = AppState.currentState;

    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (previous.match(/inactive|background/) && next === 'active') {
        saved.current();
      }
      previous = next;
    });

    return () => subscription.remove();
  }, []);
}
