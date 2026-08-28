// Fallback for using MaterialCommunityIcons on Android and web.

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { SymbolWeight, SymbolViewProps } from 'expo-symbols';
import { ComponentProps } from 'react';
import { OpaqueColorValue, type StyleProp, type TextStyle } from 'react-native';

type IconMapping = Record<SymbolViewProps['name'], ComponentProps<typeof MaterialCommunityIcons>['name']>;
type IconSymbolName = keyof typeof MAPPING;

/**
 * Add your SF Symbols to Material Community Icons mappings here.
 * - see the icons in the [Icons Directory](https://icons.expo.fyi).
 * - see SF Symbols in the [SF Symbols](https://developer.apple.com/sf-symbols/) app.
 */
// MaterialCommunityIcons rather than MaterialIcons: it carries an -outline twin
// for most glyphs, which is what the tab bar is built on — outline unfocused,
// the same shape filled when focused, the only thing marking the active tab.
// Material's base set has filled glyphs only for several of these, which forced
// either a shape change between states or no change at all.
//
// An unmapped name resolves to `undefined` and draws as nothing at all — the tab
// stays there and stays tappable, just invisible — so every symbol the app asks
// for needs an entry, and every tab pair needs both halves.
const MAPPING = {
  'house.fill': 'home',
  'paperplane.fill': 'send',
  'chevron.left.forwardslash.chevron.right': 'code-tags',
  'chevron.right': 'chevron-right',
  'gearshape.fill': 'cog',
  'book.fill': 'book-open-variant',
  'pencil': 'pencil',
  // inbox over the literal `tray` glyph: SF's pair is one tray shape that fills
  // in, and inbox/inbox-outline is the pair that behaves that way here. The
  // tray glyphs only vary by what's sitting in the tray, not by fill.
  'tray': 'inbox-outline',
  'tray.fill': 'inbox',
  // Three figures and two overlapping bubbles, the same counts SF draws.
  'person.3': 'account-group-outline',
  'person.3.fill': 'account-group',
  'bubble.left.and.bubble.right': 'forum-outline',
  'bubble.left.and.bubble.right.fill': 'forum',
  'person.crop.circle': 'account-circle-outline',
  'person.crop.circle.fill': 'account-circle',
} as IconMapping;

/**
 * An icon component that uses native SF Symbols on iOS, and Material Community
 * Icons on Android and web.
 * This ensures a consistent look across platforms, and optimal resource usage.
 * Icon `name`s are based on SF Symbols and require manual mapping.
 */
export function IconSymbol({
  name,
  size = 24,
  color,
  style,
}: {
  name: IconSymbolName;
  size?: number;
  color: string | OpaqueColorValue;
  style?: StyleProp<TextStyle>;
  weight?: SymbolWeight;
}) {
  return <MaterialCommunityIcons color={color} size={size} name={MAPPING[name]} style={style} />;
}
