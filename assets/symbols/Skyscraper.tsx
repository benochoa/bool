import Svg, { Path } from 'react-native-svg';

// Hand-drawn-style skyscrapers — one tall, one short, on a street line, with a
// couple of windows so the shapes read as buildings. Stands in for city.
export function Skyscraper({ size = 18, color = '#000' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 20.5 V4.5 H11.5 V20.5 M13.5 20.5 V10.5 H20 V20.5 M2.5 20.5 H21.5"
        stroke={color}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M6.8 8.5 H8.7 M6.8 13 H8.7 M15.9 14.5 H17.6"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </Svg>
  );
}