import Svg, { Path } from 'react-native-svg';

// Downward arrowhead only (no shaft) — used as a dropdown affordance next to text.
export function ChevronDown({ size = 16, color = '#000' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M5 9 L12 16 L19 9" stroke={color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}