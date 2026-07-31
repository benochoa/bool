import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Keyboard, KeyboardEvent, NativeScrollEvent, NativeSyntheticEvent, Platform,
  ScrollView, View,
} from 'react-native';

// Scrolls the focused card to sit just above the keyboard, wherever it started.
// Both the card and the keyboard are measured in window coordinates, so this
// doesn't depend on the scroll view shrinking when the keyboard opens — which
// it doesn't do under Android edge-to-edge.
export function useKeyboardAwareScroll(gap: number = 12) {
  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  // Window y of the keyboard's top edge; 0 while the keyboard is closed.
  const keyboardTop = useRef(0);
  const pending = useRef<View | null>(null);
  // Render this much empty space at the end of the content while the keyboard
  // is up. Without it the last card has nowhere to scroll to — the scroll
  // clamps at the content's end and the card stays behind the keyboard.
  const [spacerHeight, setSpacerHeight] = useState(0);

  const scrollToPending = useCallback(() => {
    const target = pending.current;
    const scroll = scrollRef.current;
    if (!target || !scroll || !keyboardTop.current) return;
    target.measureInWindow((_x, y, _w, height) => {
      // How far the card's bottom edge (plus a gap) is below the keyboard's
      // top — negative when it sits above, so this pulls it down too.
      const delta = y + height + gap - keyboardTop.current;
      if (Math.abs(delta) < 1) return;
      scroll.scrollTo({ y: Math.max(0, scrollY.current + delta), animated: true });
    });
  }, [gap]);

  useEffect(() => {
    // The event already carries the keyboard's final frame, so there's no need
    // to wait for it to finish opening.
    function onShow(e: KeyboardEvent) {
      keyboardTop.current = e.endCoordinates.screenY;
      setSpacerHeight(e.endCoordinates.height);
    }
    const subs = [
      // iOS fires willShow as the keyboard starts animating, which lets the
      // card ride up alongside it instead of after it. Android only has
      // didShow, and it fires early enough there.
      ...(Platform.OS === 'ios' ? [Keyboard.addListener('keyboardWillShow', onShow)] : []),
      Keyboard.addListener('keyboardDidShow', e => {
        onShow(e);
        // A correction pass: on iOS the card is already in place and this
        // measures a sub-pixel delta, which is ignored.
        scrollToPending();
      }),
      Keyboard.addListener('keyboardDidHide', () => {
        keyboardTop.current = 0;
        pending.current = null;
        setSpacerHeight(0);
      }),
    ];
    return () => subs.forEach(s => s.remove());
  }, [scrollToPending]);

  // Scrolling is driven off the spacer rather than the keyboard event itself:
  // the extra room has to be laid out first, or the scroll gets clamped to the
  // old content height.
  useEffect(() => {
    if (!spacerHeight) return;
    const frame = requestAnimationFrame(scrollToPending);
    return () => cancelAnimationFrame(frame);
  }, [spacerHeight, scrollToPending]);

  // Call from the input's onFocus with the card that should be revealed.
  // Moving between inputs while the keyboard is already up fires no keyboard
  // event, so that case has to scroll straight away.
  const reveal = useCallback((target: View | null) => {
    pending.current = target;
    if (keyboardTop.current) scrollToPending();
  }, [scrollToPending]);

  // The scroll position is needed to turn the measured gap into an offset.
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.current = e.nativeEvent.contentOffset.y;
  }, []);

  return { scrollRef, onScroll, reveal, spacerHeight };
}
