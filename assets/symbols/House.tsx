import Svg, { Path } from 'react-native-svg';

// Roof, walls and a doorway, traced as one closed outline that detours up and
// around the door — so the base line simply isn't there across the opening,
// and `filled` (the active-tab variant) leaves the doorway empty for free.
export function House({ size = 24, color = '#000', filled = false }: {
  size?: number;
  color?: string;
  filled?: boolean;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M8.8 21.8 V14.4 H15.2 V21.8 H21 V10.8 L12 2.2 L3 10.8 V21.8 Z"
        stroke={color}
        strokeWidth={2.2}
        strokeLinejoin="round"
        fill={filled ? color : 'none'}
      />
    </Svg>
  );
}
