import Svg, { Circle, Path } from 'react-native-svg';

// Hand-drawn-style key — round bow, straight shaft, two teeth. Thick rounded
// strokes matching the CheckMark/XMark/PaperPlane set. A "join by invite code"
// affordance.
export function Key({ size = 32, color = '#000' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={7.5} cy={7.5} r={3.5} stroke={color} strokeWidth={2.4} />
      <Path
        d="M10 10 L19 19 M16 19 L18 17 M13.5 16.5 L15.5 14.5"
        stroke={color}
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
