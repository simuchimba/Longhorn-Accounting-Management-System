import type { ReactNode } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { LockKeyhole, ShieldCheck } from "lucide-react";
import { useSessionContext } from "@/components/SessionContextProvider";
import ProtectedRoute from "@/components/ProtectedRoute";

/**
 * Gate for the admin panel.
 *
 * The real check is on the server: every `/api/admin/*` route re-reads the
 * caller's role and refuses anyone who is not an admin. This only avoids showing
 * an admin the panel they cannot use.
 */
const AdminRoute = ({ children }: { children: ReactNode }) => {
  const { profile, profileLoading } = useSessionContext();
  const location = useLocation();

  if (profileLoading && !profile) {
    return (
      <div className="auth-loading">
        <div className="auth-loading-mark"><LockKeyhole size={20} /></div>
        <span>Checking your access...</span>
      </div>
    );
  }

  if (profile && !profile.isAdmin) {
    return (
      <div className="auth-setup-card">
        <div className="auth-lock-mark"><ShieldCheck size={22} /></div>
        <h1>Admin only</h1>
        <p>
          This panel is for workspace admins, and your account is signed in as a {profile.role}. Ask an admin if you need
          access to branches, roles or sign-in settings.
        </p>
        <Link to="/" className="auth-back">Back to the ledger</Link>
      </div>
    );
  }

  return <ProtectedRoute>{children}</ProtectedRoute>;
};

export default AdminRoute;