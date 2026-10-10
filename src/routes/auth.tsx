import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [
    { title: "Sign in to Paperly" }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "description", content: "Sign in or create a Paperly account to submit and track research." },
    { property: "og:title", content: "Sign in to Paperly" }, { property: "og:description", content: "Sign in or create an account." },
  ] }),
  component: AuthPage,
});

function AuthPage() {
  const nav = useNavigate();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false); const [gBusy, setGBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search + "&" + window.location.hash.replace(/^#/, ""));
    const msg = q.get("error_description") ?? q.get("error");
    if (msg) { setError(msg.replace(/\+/g, " ")); window.history.replaceState({}, "", window.location.pathname); }
  }, []);
  useEffect(() => {
    let live = true;
    (async () => {
      try { const { data } = await supabase.auth.getSession(); if (live && data.session) nav({ to: "/my-research" }); }
      catch { /* session restore failed: stay on the sign-in form */ }
    })();
    return () => { live = false; };
  }, [nav]);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const r = mode === "in"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
      if (r.error) { setError(r.error.message); return; }
      if (mode === "up" && !r.data.session) { toast.success("Check your email to confirm your account."); return; }
      nav({ to: "/my-research" });
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Something went wrong. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }
  async function google() {
    setGBusy(true); setError(null);
    try {
      const r = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${window.location.origin}/my-research`, queryParams: { prompt: "select_account" } } });
      if (r.error) setError(r.error.message);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Google sign-in could not start. Try again.");
    } finally {
      setGBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl px-5 pt-14">
      <h1 className="text-[2rem]">{mode === "in" ? "Sign in" : "Create an account"}</h1>
      <p className="mt-3 text-lg text-muted-foreground">{mode === "in" ? "Use your Paperly account to submit research and follow its progress." : "You need an account to submit research and follow its progress."}</p>

      {error && (
        <div role="alert" className="mt-7 border-l-4 border-destructive bg-critical-soft px-4 py-3">
          <p className="font-semibold text-destructive">There is a problem</p>
          <p className="mt-1 text-[15px]">{error}</p>
        </div>
      )}

      <Button variant="outline" size="lg" className="mt-8 w-full" onClick={google} disabled={gBusy}>
        <svg viewBox="0 0 24 24" className="!size-[18px]" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.27-2.09 3.57-5.17 3.57-8.81Z"/><path fill="#34A853" d="M12 24c3.24 0 5.95-1.07 7.93-2.91l-3.87-3a7.2 7.2 0 0 1-10.7-3.78H1.4v3.09A12 12 0 0 0 12 24Z"/><path fill="#FBBC05" d="M5.36 14.31a7.2 7.2 0 0 1 0-4.62V6.6H1.4a12 12 0 0 0 0 10.8l3.96-3.09Z"/><path fill="#EA4335" d="M12 4.77c1.76 0 3.34.61 4.58 1.8l3.43-3.43A11.95 11.95 0 0 0 12 0 12 12 0 0 0 1.4 6.6l3.96 3.09A7.16 7.16 0 0 1 12 4.77Z"/></svg>
        {gBusy ? "Opening Google…" : "Continue with Google"}
      </Button>
      <p className="my-6 text-center text-muted-foreground">or use your email address</p>

      <form onSubmit={submit} className="space-y-6" noValidate>
        <div className="space-y-2"><Label htmlFor="email">Email address</Label><Input id="email" type="email" autoComplete="email" spellCheck={false} required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="pw">Password</Label>
          {mode === "up" && <p className="text-[15px] text-muted-foreground">Use at least 8 characters.</p>}
          <Input id="pw" type="password" autoComplete={mode === "in" ? "current-password" : "new-password"} required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        <Button size="lg" disabled={busy}>{busy ? "Please wait…" : mode === "in" ? "Sign in" : "Create account"}</Button>
      </form>
      <p className="mt-8 border-t border-border pt-5">
        {mode === "in" ? "No account yet? " : "Already have an account? "}
        <button className="link font-medium" onClick={() => { setMode(mode === "in" ? "up" : "in"); setError(null); }}>{mode === "in" ? "Create an account" : "Sign in"}</button>
      </p>
    </div>
  );
}
