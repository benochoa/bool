import { useSession } from '@/hooks/use-session';
import { fetchBlockedPersonIds } from '@/lib/fetchBlockedPersonIds';
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';

interface BlockedPeopleContextValue {
  // Everyone hidden from this viewer, in both directions — people they blocked
  // and people who blocked them. A members card can't tell the two apart, and
  // shouldn't: both render as "Blocked user".
  blockedIds: Set<string>;
  refreshBlocked: () => void;
}

const BlockedPeopleContext = createContext<BlockedPeopleContextValue | null>(null);

// One fetch for the whole app rather than one per card: the same set is read by
// every members card, the profile panel's Block button, and the Settings list,
// and they would otherwise disagree for as long as it took each to refetch.
export function BlockedPeopleProvider({ children }: { children: ReactNode }) {
  const { session, loading: sessionLoading } = useSession();
  const [blockedIds, setBlockedIds] = useState<Set<string>>(new Set());

  const refreshBlocked = useCallback(() => {
    if (sessionLoading) return;
    if (!session?.user) {
      setBlockedIds(new Set());
      return;
    }
    fetchBlockedPersonIds().then(ids => setBlockedIds(new Set(ids)));
  }, [session, sessionLoading]);

  useEffect(() => {
    refreshBlocked();
  }, [refreshBlocked]);

  return (
    <BlockedPeopleContext.Provider value={{ blockedIds, refreshBlocked }}>
      {children}
    </BlockedPeopleContext.Provider>
  );
}

export function useBlockedPeople() {
  const ctx = useContext(BlockedPeopleContext);
  if (!ctx) throw new Error('useBlockedPeople must be used within BlockedPeopleProvider');
  return ctx;
}
