<<<<<<< HEAD
import { useEffect, useState, type ReactNode } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { DatabaseZap, LockKeyhole } from "lucide-react";
import Logo from "@/components/Logo";
=======
import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { LockKeyhole } from "lucide-react";
import { useSessionContext } from "@/components/SessionContextProvider";
>>>>>>> c27fa6790a8eb0a14a327ccb370983ac5a548dfa

type Props = { children: ReactNode };

const ProtectedRoute = ({ children }: Props) => {
  const { session, loading } = useSessionContext();

<<<<<<< HEAD
  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then((response) => {
        if (response.status === 401) {
          setState("unauthenticated");
          return;
        }
        if (!response.ok) {
          setState("unavailable");
          return;
        }
        setState("authenticated");
      })
      .catch(() => setState("unavailable"));
  }, []);

  if (state === "checking") return <div className="auth-loading"><div className="auth-loading-mark"><LockKeyhole size={20} /></div><span>Checking your secure session...</span></div>;
  if (state === "unauthenticated") return <Navigate to="/login" replace />;
  if (state === "unavailable") return <main className="auth-setup-page"><div className="auth-setup-card"><Logo variant="red" height={38} /><div className="auth-setup-icon"><DatabaseZap size={25} /></div><div className="eyebrow"><span className="eyebrow-line" /> DATABASE SETUP REQUIRED</div><h1>Connect the Ledger to PostgreSQL</h1><p>The secure login is ready, but this workspace needs your PostgreSQL connection configured before users can sign in.</p><div className="auth-setup-steps"><b>Next steps</b><span>1. Run <code>database/longhorn_ledger_seed.sql</code> in pgAdmin.</span><span>2. Add <code>NITRO_DATABASE_URL</code> and <code>NITRO_SESSION_SECRET</code> to the server environment.</span><span>3. Reload the workspace and sign in with a seeded user.</span></div><button onClick={() => navigate("/login")} className="secondary-action">Open sign in</button></div></main>;
=======
  if (loading) return <div className="auth-loading"><div className="auth-loading-mark"><LockKeyhole size={20} /></div><span>Checking your secure session...</span></div>;
  if (!session) return <Navigate to="/login" replace />;
>>>>>>> c27fa6790a8eb0a14a327ccb370983ac5a548dfa
  return <>{children}</>;
};

export default ProtectedRoute;
