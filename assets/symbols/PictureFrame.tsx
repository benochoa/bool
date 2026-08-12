import Svg, { Circle, Path, Rect } from 'react-native-svg';

// Hand-drawn-style picture frame — sun over a ridge inside a frame, matching
// the CheckMark/PaperPlane stroke weight. Opens the camera roll.
export function PictureFrame({ size = 26, color = '#000' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect
        x={2.5}
        y={4}
        width={19}
        height={16}
        rx={3}
        stroke={color}
        strokeWidth={2.2}
        strokeLinejoin="round"
      />
      <Circle cx={8.4} cy={9.2} r={1.5} stroke={color} strokeWidth={2.2} />
      {/* Ridge running off both edges of the frame, so it reads as a scene
          rather than a shape floating inside a box. */}
      <Path
        d="M3 17.4 L9.3 11.6 L13.6 15.6 L16.2 13.2 L21 17.6"
        stroke={color}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}