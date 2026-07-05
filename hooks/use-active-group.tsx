import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { useSession } from '@/hooks/use-session';
import { fetchMyGroupIds } from '@/lib/fetchMyGroupIds';

interface ActiveGroupContextValue {
  myGroupIds: string[];
  loadingGroups: boolean;
  activeGroupId: string | null;
  setActiveGroupId: (id: string) => void;
  refreshGroups: () => void;
}

const ActiveGroupContext = createContext<ActiveGroupContextValue | null>(null);

export function ActiveGroupProvider({ children }: { children: ReactNode }) {
  const { session, loading: sessionLoading } = useSession();
  const [myGroupIds, setMyGroupIds] = useState<string[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(true);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);

  const refreshGroups = useCallback(() => {
    if (sessionLoading) return;
    if (!session?.user) {
      setMyGroupIds([]);
      setLoadingGroups(false);
      return;
    }
    fetchMyGroupIds(session.user.id).then(ids => {
      setMyGroupIds(ids);
      // Keep the current selection if it's still valid, otherwise default to the first group.
      setActiveGroupId(current => (current && ids.includes(current)) ? current : (ids[0] ?? null));
      setLoadingGroups(false);
    });
  }, [session, sessionLoading]);

  useEffect(() => {
    refreshGroups();
  }, [refreshGroups]);

  return (
    <ActiveGroupContext.Provider
      value={{ myGroupIds, loadingGroups, activeGroupId, setActiveGroupId, refreshGroups }}
    >
      {children}
    </ActiveGroupContext.Provider>
  );
}

export function useActiveGroup() {
  const ctx = useContext(ActiveGroupContext);
  if (!ctx) throw new Error('useActiveGroup must be used within ActiveGroupProvider');
  return ctx;
}