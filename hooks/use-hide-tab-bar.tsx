import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';

// The tab bar paints above every screen, so anything drawn inside a screen —
// an edit screen, a slide-over panel — can't cover it and has to ask for it to
// be hidden. Panels nest (a chat opens details opens a profile), so this counts
// what's covering the bar rather than toggling it: the bar only comes back once
// the last one has finished leaving.
//
// Actions and count are separate contexts on purpose — one value would change
// identity on every count change, re-running the very effect that counts.
const HideTabBarActions = createContext<{ hide: () => void; show: () => void } | null>(null);
const HideTabBarCount = createContext(0);

export function HideTabBarProvider({ children }: { children: ReactNode }) {
  const [count, setCount] = useState(0);

  const actions = useMemo(() => ({
    hide: () => setCount(c => c + 1),
    show: () => setCount(c => c - 1),
  }), []);

  return (
    <HideTabBarActions.Provider value={actions}>
      <HideTabBarCount.Provider value={count}>{children}</HideTabBarCount.Provider>
    </HideTabBarActions.Provider>
  );
}

// Hides the bar for as long as `active` holds. Outside the tabs there's no
// provider and no bar to hide, which is fine rather than an error.
export function useHideTabBar(active: boolean) {
  const actions = useContext(HideTabBarActions);
  useEffect(() => {
    if (!active || !actions) return;
    actions.hide();
    return actions.show;
  }, [active, actions]);
}

export function useTabBarHidden() {
  return useContext(HideTabBarCount) > 0;
}
