import Svg, { Circle } from 'react-native-svg';

// Three dots in a row — the "more actions" affordance. Filled circles rather
// than a stroked path, so the dots stay round at every size.
export function Ellipsis({ size = 24, color = '#000' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={5} cy={12} r={2} fill={color} />
      <Circle cx={12} cy={12} r={2} fill={color} />
      <Circle cx={19} cy={12} r={2} fill={color} />
    </Svg>
  );
}
