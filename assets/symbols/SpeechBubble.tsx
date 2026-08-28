import Svg, { Path } from 'react-native-svg';

// Rounded speech bubble with a tail at the bottom left — the mark on a preview
// tile that opens your group's private discussion about that group. Same stroke
// style as the other symbols here.
export function SpeechBubble({ size = 20, color = '#000' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 5 C7.6 5 4 8.1 4 12 c0 1.9 0.9 3.6 2.4 4.9 L5.4 20.2 L9.3 18.6 c0.8 0.2 1.7 0.3 2.7 0.3 c4.4 0 8 -3.1 8 -6.9 S16.4 5 12 5 Z"
        stroke={color}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
