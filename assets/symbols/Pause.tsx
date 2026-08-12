import Svg, { Path } from 'react-native-svg';

// Hand-drawn-style pause — two strokes with rounded caps rather than two bars,
// so it matches the rest of the set.
export function Pause({ size = 20, color = '#000' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M9 5 V19 M15 5 V19"
        stroke={color}
        strokeWidth={3.2}
        strokeLinecap="round"
      />
    </Svg>
  );
}