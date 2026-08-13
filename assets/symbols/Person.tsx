import Svg, { Circle, Path } from 'react-native-svg';

// Hand-drawn-style person — a head and a pair of shoulders, nothing else.
// Stands in for gender, so it deliberately carries no other detail.
export function Person({ size = 18, color = '#000' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={7.8} r={3.8} stroke={color} strokeWidth={2.2} />
      <Path
        d="M4.8 20.5 C4.8 16.4 8 14 12 14 C16 14 19.2 16.4 19.2 20.5"
        stroke={color}
        strokeWidth={2.2}
        strokeLinecap="round"
      />
    </Svg>
  );
}