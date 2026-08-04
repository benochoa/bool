import Svg, { Path } from 'react-native-svg';

// Rightward arrowhead only (no shaft) — a "there's more behind this" affordance
// next to a label. Mirrors ChevronLeft, but usually drawn smaller and lighter.
export function ChevronRight({ size = 16, color = '#aaa' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M9 5 L16 12 L9 19" stroke={color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
