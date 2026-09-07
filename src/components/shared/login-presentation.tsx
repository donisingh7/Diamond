"use client";

import { ThemeToggle } from "@/components/ui/theme-toggle";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, LockKeyhole, ShieldCheck, Smartphone, UserRound } from "lucide-react";
import { Brand } from "./navigation";
import { GlassCard } from "@/components/ui/surface";
import { Input, PasswordInput } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { OTP_RESEND_COOLDOWN_MS } from "@/modules/auth/config";

type View = "password" | "otp-phone" | "otp-code";

async function readJson(response: Response): Promise<{ data?: { requestId?: string; devCode?: string }; error?: { message: string } }> {
  try { return await response.json(); } catch { return {}; }
}

export function LoginPresentation({ admin = false }: { admin?: boolean }) {
  const router = useRouter();
  const portal = admin ? "ADMIN" : "PLAYER";
  const [view, setView] = useState<View>("password");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [requestId, setRequestId] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [resendReady, setResendReady] = useState(true);

  function goToHomeForRole(role: string) {
    router.push(role === "ADMIN" ? "/admin" : "/");
    router.refresh();
  }

  async function submitPassword(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ portal, loginId, password }),
      });
      const body = await readJson(response);
      if (!response.ok) throw new Error(body.error?.message ?? "Invalid credentials.");
      goToHomeForRole(portal);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function requestOtp() {
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/otp/request", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone }),
      });
      const body = await readJson(response);
      if (!response.ok) throw new Error(body.error?.message ?? "Something went wrong. Please try again.");
      setRequestId(body.data?.requestId ?? null);
      setDevCode(body.data?.devCode ?? null);
      setCode("");
      setView("otp-code");
      setResendReady(false);
      setTimeout(() => setResendReady(true), OTP_RESEND_COOLDOWN_MS);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitOtp(event: FormEvent) {
    event.preventDefault();
    if (!requestId) return;
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/otp/verify", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId, code }),
      });
      const body = await readJson(response);
      if (!response.ok) throw new Error(body.error?.message ?? "Invalid or expired code.");
      goToHomeForRole("PLAYER");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function backToPassword() {
    setView("password");
    setError(null);
    setCode("");
    setRequestId(null);
    setDevCode(null);
  }

  return (
    <main className={`login-page${admin ? " login-page--admin" : ""}`}>
      <div className="login-brand"><Brand /><ThemeToggle /></div>
      <div className="login-composition">
        <div className="login-story">
          <div className="diamond-aperture" aria-hidden="true"><span /><span /><span /></div>
          <p className="eyebrow">{admin ? "A clear perspective" : "Every market. One place."}</p>
          <h1 className="type-display">{admin ? <>Clarity.<br /><span className="text-accent">In every detail.</span></> : <>The day.<br />The numbers.<br /><span className="text-accent">Your next play.</span></>}</h1>
          <p className="text-secondary">{admin ? "A focused workspace for the Diamond experience." : "Follow your markets. Know the timing. Stay close to every result."}</p>
          <div className="login-signature"><span aria-hidden="true" /><p className="type-caption text-muted">{admin ? "Secure administration" : "A considered space for your next play"}</p></div>
        </div>
        <GlassCard variant="strong" className="login-card">
          <div className="stack">
            <span className="login-icon" aria-hidden="true">{admin ? <ShieldCheck /> : view === "password" ? <LockKeyhole /> : <Smartphone />}</span>

            {view === "password" && (
              <>
                <div>
                  <h2 className="type-page-title">{admin ? "Admin access" : "Welcome back"}</h2>
                  <p className="text-secondary type-body-small">{admin ? "Sign in to your workspace." : "Sign in to your Diamond account."}</p>
                </div>
                {error && <Alert title="Sign-in failed" tone="danger">{error}</Alert>}
                <form className="stack" onSubmit={submitPassword}>
                  <Input label={admin ? "Login ID / Email" : "Login ID"} autoComplete="username" placeholder="Enter your login ID" leadingIcon={<UserRound aria-hidden="true" />} value={loginId} onChange={(event) => setLoginId(event.target.value)} required />
                  <PasswordInput label="Password" autoComplete="current-password" placeholder="Enter your password" value={password} onChange={(event) => setPassword(event.target.value)} required />
                  <Button type="submit" size="lg" loading={submitting} trailingIcon={<ArrowRight aria-hidden="true" />}>Sign in</Button>
                </form>
                {!admin && (
                  <div className="login-alternative">
                    <p className="type-body-small text-secondary">Having trouble signing in?</p>
                    <Button variant="ghost" disabled={submitting} onClick={() => { setError(null); setView("otp-phone"); }} trailingIcon={<ArrowRight aria-hidden="true" />}>Login with OTP</Button>
                  </div>
                )}
              </>
            )}

            {view === "otp-phone" && (
              <>
                <div>
                  <h2 className="type-page-title">Login with OTP</h2>
                  <p className="text-secondary type-body-small">Enter your registered phone number.</p>
                </div>
                {error && <Alert title="Could not send code" tone="danger">{error}</Alert>}
                <form className="stack" onSubmit={(event) => { event.preventDefault(); void requestOtp(); }}>
                  <Input label="Registered phone number" autoComplete="tel" placeholder="Enter your phone number" inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} required />
                  <Button type="submit" size="lg" loading={submitting} trailingIcon={<ArrowRight aria-hidden="true" />}>Send code</Button>
                </form>
                <div className="login-alternative">
                  <Button variant="ghost" disabled={submitting} onClick={backToPassword} leadingIcon={<ArrowLeft aria-hidden="true" />}>Back to password login</Button>
                </div>
              </>
            )}

            {view === "otp-code" && (
              <>
                <div>
                  <h2 className="type-page-title">Enter your code</h2>
                  <p className="text-secondary type-body-small">We sent a 6-digit code to your registered phone.</p>
                </div>
                {devCode && <p className="preview-notice">Development preview · mock code {devCode}</p>}
                {error && <Alert title="Verification failed" tone="danger">{error}</Alert>}
                <form className="stack" onSubmit={submitOtp}>
                  <Input label="6-digit code" autoComplete="one-time-code" inputMode="numeric" placeholder="000000" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} required />
                  <Button type="submit" size="lg" loading={submitting} disabled={code.length !== 6} trailingIcon={<ArrowRight aria-hidden="true" />}>Verify</Button>
                </form>
                <div className="login-alternative">
                  {resendReady
                    ? <Button variant="ghost" disabled={submitting} onClick={() => void requestOtp()}>Resend code</Button>
                    : <p className="type-caption text-muted">You can resend the code shortly.</p>}
                  <Button variant="ghost" disabled={submitting} onClick={backToPassword} leadingIcon={<ArrowLeft aria-hidden="true" />}>Back to password login</Button>
                </div>
              </>
            )}
          </div>
        </GlassCard>
      </div>
      <footer className="login-footer type-caption">Diamond · {admin ? "Administration" : "Player access"}</footer>
    </main>
  );
}
