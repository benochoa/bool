import Svg, { Path } from 'react-native-svg';

// Hand-drawn-style birthday cake — body, plate, one candle and a flame.
// Stands in for age.
export function BirthdayCake({ size = 18, color = '#000' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4.5 20.5 V13.5 A2 2 0 0 1 6.5 11.5 H17.5 A2 2 0 0 1 19.5 13.5 V20.5 M2.5 20.5 H21.5 M12 11.5 V7.5"
        stroke={color}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Flame — a teardrop, so it reads as lit at 18pt rather than as a blob. */}
      <Path
        d="M12 3.8 C13.3 5.4 13.6 6.4 12 7.5 C10.4 6.4 10.7 5.4 12 3.8 Z"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
      />
    </Svg>
  );
}