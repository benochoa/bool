import Svg, { Path } from 'react-native-svg';

// Hand-drawn-style X — thick, rounded caps, single confident motion,
// rather than a mechanical icon-font glyph.
export function XMark({ size = 32, color = '#000' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M6 6 L18 18 M18 6 L6 18" stroke={color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
