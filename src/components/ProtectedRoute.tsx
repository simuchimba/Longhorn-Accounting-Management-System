import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { LockKeyhole } from "lucide-react";
import { useSessionContext } from "@/components/SessionContextProvider";

type Props = { children: ReactNode };

const ProtectedRoute = ({ children }: Props) => {
  const { session, loading } = useSessionContext();

  if (loading) return <div className="auth-loading"><div className="auth-loading-mark"><LockKeyhole size={20} /></div><span>Checking your secure session...</span></div>;
  if (!session) return <Navigate to="/login" replace />;
  return <>{children}</>;
};

export default ProtectedRoute;
