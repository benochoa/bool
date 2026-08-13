import Svg, { Path } from 'react-native-svg';

// Hand-drawn-style mortarboard — the obvious shorthand for a school, and the
// one shape that reads at 18pt without any lettering. Stands in for college.
export function GraduationCap({ size = 18, color = '#000' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M2 9.2 L12 4.5 L22 9.2 L12 13.9 Z"
        stroke={color}
        strokeWidth={2.2}
        strokeLinejoin="round"
      />
      {/* The body of the cap hanging below the board, plus the tassel cord. */}
      <Path
        d="M6.5 11.3 V16.4 C6.5 16.4 8.7 18.6 12 18.6 C15.3 18.6 17.5 16.4 17.5 16.4 V11.3 M22 9.2 V14.2"
        stroke={color}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}