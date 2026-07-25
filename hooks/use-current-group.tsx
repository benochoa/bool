import { useSession } from '@/hooks/use-session';
import { fetchMyActiveGroupIds } from '@/lib/fetchMyActiveGroupIds';
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';

interface CurrentGroupContextValue {
  myGroupIds: string[];
  loadingGroups: boolean;
  currentGroupId: string | null;
  setCurrentGroupId: (id: string) => void;
  refreshGroups: () => void;
}

const CurrentGroupContext = createContext<CurrentGroupContextValue | null>(null);

export function CurrentGroupProvider({ children }: { children: ReactNode }) {
  const { session, loading: sessionLoading } = useSession();
  const [myGroupIds, setMyGroupIds] = useState<string[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(true);
  const [currentGroupId, setCurrentGroupId] = useState<string | null>(null);

  const refreshGroups = useCallback(() => {
    if (sessionLoading) return;
    if (!session?.user) {
      setMyGroupIds([]);
      setLoadingGroups(false);
      return;
    }
    fetchMyActiveGroupIds(session.user.id).then(ids => {
      setMyGroupIds(ids);
      // Keep the current selection if it's still valid, otherwise default to the first group.
      setCurrentGroupId(current => (current && ids.includes(current)) ? current : (ids[0] ?? null));
      setLoadingGroups(false);
    });
  }, [session, sessionLoading]);

  useEffect(() => {
    refreshGroups();
  }, [refreshGroups]);

  return (
    <CurrentGroupContext.Provider
      value={{ myGroupIds, loadingGroups, currentGroupId, setCurrentGroupId, refreshGroups }}
    >
      {children}
    </CurrentGroupContext.Provider>
  );
}

export function useCurrentGroup() {
  const ctx = useContext(CurrentGroupContext);
  if (!ctx) throw new Error('useCurrentGroup must be used within CurrentGroupProvider');
  return ctx;
}