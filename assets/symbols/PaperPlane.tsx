import Svg, { Path } from 'react-native-svg';

// Hand-drawn-style paper airplane (a "send" affordance, like Instagram/Telegram),
// matching the CheckMark/XMark stroke style — thick, rounded caps, black.
export function PaperPlane({ size = 32, color = '#000' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M22 2 L15 22 L11 13 L2 9 Z M22 2 L11 13"
        stroke={color}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
