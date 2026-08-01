import Svg, { Path } from 'react-native-svg';

// Leftward arrowhead only (no shaft) — a back affordance, matching ChevronDown.
export function ChevronLeft({ size = 24, color = '#000' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M15 5 L8 12 L15 19" stroke={color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
