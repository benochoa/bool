import Svg, { Path } from 'react-native-svg';

// Curved arrow doubling back on itself — the reply mark revealed behind a
// message as it's swiped. Same stroke style as the other symbols here.
export function ReplyArrow({ size = 20, color = '#8A8A8E' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M9 7 L4 12 L9 17 M4 12 H14 a6 6 0 0 1 6 6 v1"
        stroke={color}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
