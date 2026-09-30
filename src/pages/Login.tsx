import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, Eye, EyeOff, LockKeyhole, ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useSessionContext } from "@/components/SessionContextProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Logo from "@/components/Logo";

const Login = () => {
  const navigate = useNavigate();
  const { session } = useSessionContext();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (session) navigate("/", { replace: true });
  }, [navigate, session]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setBusy(false);
    if (signInError) {
      setError(signInError.message);
      return;
    }
    navigate("/", { replace: true });
  };

  return (
    <main className="login-page">
      <section className="login-brand-panel">
        <div className="login-brand-top"><Logo variant="white" height={60} /></div>
        <div className="login-brand-message"><div className="eyebrow text-[#f3a8b3]"><span className="eyebrow-line bg-[#f3a8b3]" /> LONGHORN LEDGER</div><h1>Every payment.<br /><em>Accounted for.</em></h1><p>A considered workspace for creating, approving and signing payment vouchers across Longhorn Associates.</p></div>
        <div className="login-brand-footer"><span><ShieldCheck size={15} /> Protected finance workspace</span><span>© {new Date().getFullYear()} Longhorn Associates</span></div>
      </section>
      <section className="login-form-panel"><div className="login-form-wrap"><div className="mobile-login-logo"><Logo variant="red" height={44} /></div><div className="login-kicker"><span className="login-lock"><LockKeyhole size={16} /></span><span>Secure sign in</span></div><h2>Welcome back</h2><p className="login-subtitle">Sign in to access your payment voucher workspace.</p><form onSubmit={submit} className="login-form"><label><span>Email address</span><Input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@longhorn-associates.com" required /></label><label><span>Password</span><div className="login-password"><Input type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" required /><button type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label>{error && <div className="login-error"><LockKeyhole size={15} /><span>{error}</span></div>}<Button type="submit" disabled={busy} className="login-submit">{busy ? "Signing you in..." : "Sign in to Ledger"}<ArrowRight size={17} /></Button></form><div className="login-help"><ShieldCheck size={15} /><span>Your session is secure and protected.</span></div></div></section>
    </main>
  );
};

export default Login;
