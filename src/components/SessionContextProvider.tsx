import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { ApiError, fetchMe } from "@/lib/api";
import type { CurrentUser } from "@/lib/types";

type SessionContextValue = {
  session: Session | null;
  user: User | null;
  /** Role and branch, resolved on the server. Null until it has loaded. */
  profile: CurrentUser | null;
  loading: boolean;
  profileLoading: boolean;
  /** Why the profile could not be resolved, if it could not. */
  profileError: string;
  /** True when database/multi_company_setup.sql still needs to be run. */
  needsMigration: boolean;
  refreshProfile: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue>({
  session: null,
  user: null,
  profile: null,
  loading: true,
  profileLoading: false,
  profileError: "",
  needsMigration: false,
  refreshProfile: async () => {},
});

export const SessionContextProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<CurrentUser | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [needsMigration, setNeedsMigration] = useState(false);

  useEffect(() => {
    let mounted = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
      if (!nextSession) {
        setProfile(null);
        setProfileError("");
      }
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!session) {
      setProfile(null);
      return;
    }
    setProfileLoading(true);
    try {
      const data = await fetchMe();
      setProfile(data.user);
      setNeedsMigration(data.needsMigration || data.setupRequired);
      setProfileError(data.setupRequired ? "The ledger server has no Supabase keys configured yet." : "");
    } catch (error) {
      setProfile(null);
      if (error instanceof ApiError && error.status === 401) {
        // The token went stale. The auth listener will sort the session out.
        setProfileError("");
      } else {
        setProfileError(error instanceof Error ? error.message : "Could not load your profile.");
      }
    } finally {
      setProfileLoading(false);
    }
  }, [session]);

  useEffect(() => {
    if (!session) return;
    void refreshProfile();
  }, [session, refreshProfile]);

  const value = useMemo(
    () => ({ session, user: session?.user || null, profile, loading, profileLoading, profileError, needsMigration, refreshProfile }),
    [loading, needsMigration, profile, profileError, profileLoading, refreshProfile, session],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
};

export const useSessionContext = () => useContext(SessionContext);