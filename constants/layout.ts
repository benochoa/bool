import { Platform } from 'react-native';
import { initialWindowMetrics } from 'react-native-safe-area-context';

// How far down the screen a panel's own chrome starts.
//
// Every screen used to hardcode 60 (and 100 for a chevron floating over a post),
// hand-tuned against an iPhone. That holds on iOS, where the safe area above the
// content is 47-59pt on every current device. It does not hold on Android, where
// the status bar runs 24-48dp — and `edgeToEdgeEnabled` means the app draws
// underneath it, so the same 60 leaves the header sitting well below where it
// was drawn to sit.
//
// iOS keeps the literals it was designed against, so nothing shifts on the
// device the layout was built on. Android derives from the real inset, keeping
// roughly the gap above the bar that iOS ends up with.
//
// `initialWindowMetrics` rather than the useSafeAreaInsets hook: these are read
// inside StyleSheet.create, which runs once at module load and can't call hooks.
// It doesn't follow a rotation, which costs nothing here — the app is locked to
// portrait in app.json.
const TOP_INSET = initialWindowMetrics?.insets.top ?? 24;

// Headers, title bands, and back chevrons pinned near the top of a panel.
export const HEADER_TOP = Platform.OS === 'ios' ? 60 : TOP_INSET + 12;

// The taller offset used where a back chevron floats over a full post rather
// than sitting in a header band of its own.
export const FLOATING_TOP = Platform.OS === 'ios' ? 100 : TOP_INSET + 52;

// The same story at the bottom. The literals were tuned against the iPhone home
// indicator (~34pt); Android's bottom inset is a ~24dp gesture pill or a ~48dp
// three-button bar — the user can switch between them in Settings — and
// edge-to-edge draws under both. Derived values keep the same clearance above
// the inset that the originals kept above the home indicator.
const BOTTOM_INSET = initialWindowMetrics?.insets.bottom ?? 0;

// Only the offsets measured against the TRUE screen bottom get these — panels
// that hide the tab bar (SlideOver via useHideTabBar), and the composer inside
// them. The deck's check/cross buttons deliberately don't: they sit on a tab
// screen where the bar is visible, the content area already ends above it, and
// React Navigation folds the bottom inset into the bar itself.
export const COMPOSER_BOTTOM = Platform.OS === 'ios' ? 44 : BOTTOM_INSET + 12;
export const CONFIRM_ROW_BOTTOM = Platform.OS === 'ios' ? 48 : BOTTOM_INSET + 16;
export const LEADER_ROW_BOTTOM = Platform.OS === 'ios' ? 40 : BOTTOM_INSET + 16;
