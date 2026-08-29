import Svg, { Path } from 'react-native-svg';

// Pushpin, tilted the way SF Symbols' `pin.fill` is — head at the upper right,
// point down to the lower left. Filled rather than stroked: at the 16px it runs
// at beside a chat row it reads as a solid mark, where an outline of the same
// shape turns to mush. Same 24-viewBox as the rest of the set.
export function Pin({ size = 16, color = '#000' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* The head, drawn as one body: the angled cap at the top right and the
          collar it flares out into. It stops short of the needle so the two can
          be filled separately. */}
      <Path
        d="M14.8 2.2 L21.8 9.2 L19.2 11.8 L17.6 11.3 L12.9 16 L8 11.1 L12.7 6.4 L12.2 4.8 Z"
        fill={color}
      />
      {/* The needle, as its own long triangle running to a single point at
          (2.6, 21.4). Splitting it out is what lets it taper: as part of the
          body above it inherited that shape's width and ended in a stub. The
          base spans two full units off the collar, so it reads as a shaft that
          narrows rather than as a hairline. */}
      <Path d="M10.4 12.7 L12.3 14.6 L2.6 21.4 Z" fill={color} />
    </Svg>
  );
}
