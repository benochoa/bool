import Svg, { Path } from 'react-native-svg';

// Hand-drawn-style play triangle — filled, since at this size an outline would
// close up into a blob.
export function Play({ size = 20, color = '#000' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M7 4.5 L19.5 12 L7 19.5 Z"
        fill={color}
        stroke={color}
        strokeWidth={2.2}
        strokeLinejoin="round"
      />
    </Svg>
  );
}