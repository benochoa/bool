import { useSession } from '@/hooks/use-session';
import { fetchMyActiveGroupIds } from '@/lib/fetchMyActiveGroupIds';
import { supabase } from '@/supabaseClient';
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

  // Losing a group has to reach the app the moment it happens. Without this the
  // context kept acting as a group you were no longer in — still swiping, still
  // approving, still sending — and every one of those writes would be refused,
  // so the failure surfaced as actions that quietly did nothing rather than as
  // the group disappearing. Kicks, leaving from another device, and a
  // dissolution all land as a status change on one of your own membership rows,
  // and joining elsewhere lands as an insert, so one filter catches them all.
  // refreshGroups already drops a selection that's no longer valid and falls
  // back to your first remaining group, so nothing else has to react.
  useEffect(() => {
    const personId = session?.user?.id;
    if (!personId) return;

    const channel = supabase
      .channel(`memberships-${personId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'memberships', filter: `person_id=eq.${personId}` },
        refreshGroups
      )
      .subscribe(status => console.log('[realtime] memberships channel:', status));

    return () => { supabase.removeChannel(channel); };
  }, [session, refreshGroups]);

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