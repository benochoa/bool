import { useAppResume } from '@/hooks/use-app-resume';
import { useCurrentGroup } from '@/hooks/use-current-group';
import { BadgeCounts, EMPTY_BADGE_COUNTS, fetchBadgeCounts } from '@/lib/fetchBadgeCounts';
import { supabase } from '@/supabaseClient';
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';

interface TabBadgeContextValue extends BadgeCounts {
  refreshBadges: () => void;
}

const TabBadgeContext = createContext<TabBadgeContextValue | null>(null);

// The three numbers on the tab bar. They live above the screens because the bar
// draws over all of them and a screen only fetches while it's focused — the
// Received badge has to be right before you've ever opened Received.
export function TabBadgeProvider({ children }: { children: ReactNode }) {
  const { currentGroupId } = useCurrentGroup();
  const [counts, setCounts] = useState<BadgeCounts>(EMPTY_BADGE_COUNTS);

  const refreshBadges = useCallback(() => {
    if (!currentGroupId) {
      setCounts(EMPTY_BADGE_COUNTS);
      return;
    }
    fetchBadgeCounts(currentGroupId).then(setCounts);
  }, [currentGroupId]);

  // Also covers switching which group you're acting as: all three counts are
  // scoped to it, so they're refetched whenever it changes.
  useEffect(() => {
    refreshBadges();
  }, [refreshBadges]);

  // A resume that left the counts short would read as "nobody messaged you".
  // Recounted rather than caught up, since the events missed while
  // backgrounded are gone.
  useAppResume(refreshBadges);

  // Anything that moves a number: a member's swipe or a leader's send (my
  // group suggesting), a suggestion arriving or being answered (aimed at my
  // group), and messages in either half of a chat pair. Marking a chat read
  // isn't here — it writes to chat_reads, so Chats calls refreshBadges itself.
  useEffect(() => {
    if (!currentGroupId) return;

    const channel = supabase
      .channel(`tab-badges-${currentGroupId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'group_suggestions', filter: `suggesting_group_id=eq.${currentGroupId}` },
        refreshBadges
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'group_suggestions', filter: `target_group_id=eq.${currentGroupId}` },
        refreshBadges
      )
      // Which side of the pair you are depends on canonicalPair's ordering, and
      // a filter takes one condition, so both halves need a listener.
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `group_1_id=eq.${currentGroupId}` },
        refreshBadges
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `group_2_id=eq.${currentGroupId}` },
        refreshBadges
      )
      .subscribe(status => console.log('[realtime] tab badges channel:', status));

    return () => { supabase.removeChannel(channel); };
  }, [currentGroupId, refreshBadges]);

  return (
    <TabBadgeContext.Provider value={{ ...counts, refreshBadges }}>
      {children}
    </TabBadgeContext.Provider>
  );
}

export function useTabBadges() {
  const ctx = useContext(TabBadgeContext);
  if (!ctx) throw new Error('useTabBadges must be used within TabBadgeProvider');
  return ctx;
}