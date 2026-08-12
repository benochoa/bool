import Svg, { Circle, Path } from 'react-native-svg';

// Hand-drawn-style camera — body, viewfinder bump and lens, matching the
// CheckMark/PaperPlane stroke weight. Takes a photo on the spot.
export function Camera({ size = 26, color = '#000' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Body and bump traced as one outline, so the two never disagree about
          where they meet. */}
      <Path
        d="M2.5 8.5 A2.5 2.5 0 0 1 5 6 H8.2 L9.6 3.5 H14.4 L15.8 6 H19 A2.5 2.5 0 0 1 21.5 8.5 V18 A2.5 2.5 0 0 1 19 20.5 H5 A2.5 2.5 0 0 1 2.5 18 Z"
        stroke={color}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx={12} cy={13.2} r={3.6} stroke={color} strokeWidth={2.2} />
    </Svg>
  );
}