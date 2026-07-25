import Svg, { Path } from 'react-native-svg';

// Hand-drawn-style plus — thick, rounded caps, matching the CheckMark/XMark set.
export function Plus({ size = 32, color = '#000' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 5 L12 19 M5 12 L19 12" stroke={color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
