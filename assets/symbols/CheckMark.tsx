import Svg, { Path } from 'react-native-svg';

// Hand-drawn-style checkmark — thick, rounded caps, single confident motion,
// rather than a mechanical icon-font glyph.
export function CheckMark({ size = 32, color = '#000' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4 13 L9 18 L20 6" stroke={color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
