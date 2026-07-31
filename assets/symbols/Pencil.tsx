import Svg, { Circle, Path } from 'react-native-svg';

// Hand-drawn-style pencil in a white disc — short and fat, laid diagonally with
// the tip at bottom-left and the eraser at top-right. Outline only (no fill), so
// the disc reads through it. Matches the CheckMark/XMark/Key stroke weight.
// The disc (r = 13.2) now overflows the 24-unit grid the pencil is drawn on, so
// the viewBox is padded by 1.2 on every side and the rendered box grows by the
// same 1.1 factor — that keeps one unit the same number of points, i.e. the
// pencil the same on-screen size while the disc gets 20% bigger.
const PAD = 1.2;
const VIEW = 24 + PAD * 2;

export function Pencil({ size = 24, color = '#000' }: { size?: number; color?: string }) {
  return (
    <Svg
      width={size * (VIEW / 24)}
      height={size * (VIEW / 24)}
      viewBox={`${-PAD} ${-PAD} ${VIEW} ${VIEW}`}
      fill="none"
    >
      <Circle cx={12} cy={12} r={13.2} fill="#fff" />
      {/* Body: tip → collar → eraser end → back down the other long side. */}
      <Path
        d="M6.8 17.2 L10.3 16.7 L18.7 8.3 L15.7 5.3 L7.3 13.7 Z"
        stroke={color}
        strokeWidth={2.2}
        strokeLinejoin="round"
      />
      {/* Collar — the line the sharpened tip splays from. */}
      <Path d="M10.3 16.7 L7.3 13.7" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
    </Svg>
  );
}
