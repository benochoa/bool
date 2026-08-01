/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

// App palette — screens own the page background; cards sit on it in white.
export const Palette = {
  background: '#F5F5F7',
  // Done/Confirm, once an edit has something to save...
  confirm: '#3B3B98',
  // ...and the same control before it does: readable, but plainly not live.
  muted: '#8A8A8E',
};

const tintColorLight = '#0a7ea4';
const tintColorDark = '#fff';

export const Colors = {
  light: {
    text: '#11181C',
    background: '#fff',
    tint: tintColorLight,
    icon: '#687076',
    tabIconDefault: '#687076',
    tabIconSelected: tintColorLight,
  },
  dark: {
    text: '#ECEDEE',
    background: '#151718',
    tint: tintColorDark,
    icon: '#9BA1A6',
    tabIconDefault: '#9BA1A6',
    tabIconSelected: tintColorDark,
  },
};

// Manrope — loaded from assets/fonts in app/_layout.tsx. With custom fonts,
// weight is picked by family name, not fontWeight.
export const FontFamily = {
  regular: 'Manrope_400Regular',
  medium: 'Manrope_500Medium',
  semiBold: 'Manrope_600SemiBold',
  bold: 'Manrope_700Bold',
};

// Type scale — spread into text styles (e.g. `...Type.title`).
export const Type = {
  title: { fontFamily: FontFamily.bold, fontSize: 24 },
  header: { fontFamily: FontFamily.semiBold, fontSize: 18 },
  body: { fontFamily: FontFamily.regular, fontSize: 16 },
  bodyBold: { fontFamily: FontFamily.semiBold, fontSize: 16 },
  label: { fontFamily: FontFamily.medium, fontSize: 14 },
  caption: { fontFamily: FontFamily.regular, fontSize: 12 },
};
