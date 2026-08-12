import Svg, { Path } from 'react-native-svg';

// Hand-drawn-style microphone — capsule, cradle and stand, matching the
// CheckMark/PaperPlane stroke weight. Records a voice message.
export function Microphone({ size = 26, color = '#000' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Capsule: a 6-wide bar with both ends rounded off by half its width. */}
      <Path
        d="M12 2 A3 3 0 0 1 15 5 V11.5 A3 3 0 0 1 9 11.5 V5 A3 3 0 0 1 12 2 Z"
        stroke={color}
        strokeWidth={2.2}
        strokeLinejoin="round"
      />
      {/* Cradle under it, then the stand. */}
      <Path
        d="M5.5 11 V12.5 A6.5 6.5 0 0 0 18.5 12.5 V11 M12 19 V22 M8.5 22 H15.5"
        stroke={color}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}