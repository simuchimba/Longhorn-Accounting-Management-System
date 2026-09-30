import { useEffect } from "react";
import { Auth } from "@supabase/auth-ui-react";
import { ThemeSupa } from "@supabase/auth-ui-shared";
import { ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useSessionContext } from "@/components/SessionContextProvider";

const Login = () => {
  const navigate = useNavigate();
  const { session } = useSessionContext();

  useEffect(() => {
    if (session) navigate("/", { replace: true });
  }, [navigate, session]);

  return (
    <main className="login-page">
      <section className="login-brand-panel">
        <div className="login-brand-top"><div className="brand-mark" aria-hidden="true"><span>LH</span></div><div><div className="font-display text-[21px] font-semibold tracking-[-0.04em] text-white">longhorn</div><div className="-mt-1 text-[9px] font-semibold uppercase tracking-[0.3em] text-[#f3a8b3]">associates</div></div></div>
        <div className="login-brand-message"><div className="eyebrow text-[#f3a8b3]"><span className="eyebrow-line bg-[#f3a8b3]" /> LONGHORN LEDGER</div><h1>Every payment.<br /><em>Accounted for.</em></h1><p>A considered workspace for creating, approving and signing payment vouchers across Longhorn Associates.</p></div>
        <div className="login-brand-footer"><span><ShieldCheck size={15} /> Protected finance workspace</span><span>© {new Date().getFullYear()} Longhorn Associates</span></div>
      </section>
      <section className="login-form-panel"><div className="login-form-wrap"><div className="mobile-login-logo"><div className="brand-mark" aria-hidden="true"><span>LH</span></div><div><div className="font-display text-[19px] font-semibold tracking-[-0.04em] text-[#182238]">longhorn</div><div className="-mt-1 text-[9px] font-semibold uppercase tracking-[0.3em] text-[#D71939]">associates</div></div></div><div className="login-kicker"><span className="login-lock"><ShieldCheck size={16} /></span><span>Supabase secure sign in</span></div><h2>Welcome back</h2><p className="login-subtitle">Sign in to access your payment voucher workspace.</p><div className="supabase-auth-card"><Auth supabaseClient={supabase} providers={[]} view="sign_in" appearance={{ theme: ThemeSupa, variables: { default: { colors: { brand: "#D71939", brandAccent: "#B91430", inputBorder: "#DDD8D1", inputBorderFocus: "#D71939" }, radii: { borderRadiusButton: "9px", inputBorderRadius: "9px" } } } }} theme="light" /></div><div className="login-help"><ShieldCheck size={15} /><span>Your session is managed by Supabase Auth and protected by row-level security.</span></div></div></section>
    </main>
  );
};

export default Login;
