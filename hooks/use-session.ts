import { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { supabase } from '@/supabaseClient';

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // getSession reads AsyncStorage behind an auth lock that startAutoRefresh
    // also takes, and on React Native the two can deadlock — the promise then
    // never settles and `loading` pins the app on the splash forever. The
    // listener below reports the session anyway, so failing open here costs
    // nothing: worst case the guard routes to login for the moment it takes
    // onAuthStateChange to fire with the stored session.
    let settled = false;
    const done = (next: Session | null) => {
      if (settled) return;
      settled = true;
      setSession(next);
      setLoading(false);
    };

    const timer = setTimeout(() => {
      if (!settled) console.warn('[use-session] getSession did not settle in 5s');
      done(null);
    }, 5000);

    supabase.auth
      .getSession()
      .then(({ data }) => done(data.session))
      .catch(error => {
        console.warn('[use-session] getSession failed', error);
        done(null);
      });

    // Fires with the stored session shortly after startup, so it doubles as the
    // recovery path when the call above times out.
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      settled = true;
      setSession(session);
      setLoading(false);
    });

    return () => {
      clearTimeout(timer);
      listener.subscription.unsubscribe();
    };
  }, []);

  return { session, loading };
}
