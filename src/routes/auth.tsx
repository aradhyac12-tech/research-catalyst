import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mark } from "@/components/site-header";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [
    { title: "Sign in \u2014 Paperly" }, { name: "description", content: "Sign in or create a Paperly researcher account." },
    { property: "og:title", content: "Sign in \u2014 Paperly" }, { property: "og:description", content: "Researcher accounts for submitting and tracking work." },
  ] }),
  component: AuthPage,
});

function AuthPage() {
  const nav = useNavigate();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [busy, setBusy] = useState(false);
  // Google/Supabase send failures back as query or hash parameters; show them instead of a silent bounce.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search + "&" + window.location.hash.replace(/^#/, ""));
    const msg = q.get("error_description") ?? q.get("error");
    if (msg) { toast.error(msg.replace(/\+/g, " ")); window.history.replaceState({}, "", window.location.pathname); }
  }, []);
  // Already signed in (for example returning from Google): go straight to the dashboard.
  useEffect(() => { void supabase.auth.getSession().then(({ data }) => { if (data.session) nav({ to: "/my-research" }); }); }, [nav]);
  const [gBusy, setGBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    const r = mode === "in"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
    setBusy(false);
    if (r.error) { toast.error(r.error.message); return; }
    if (mode === "up" && !r.data.session) { toast.success("Check your email to confirm your account."); return; }
    nav({ to: "/my-research" });
  }
  async function google() {
    setGBusy(true);
    const r = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${window.location.origin}/my-research`, queryParams: { prompt: "select_account" } } });
    if (r.error) { toast.error(r.error.message); setGBusy(false); }
  }
  return (
    <div className="mx-auto grid max-w-6xl gap-0 px-5 py-12 md:py-20 lg:grid-cols-2">
      <aside className="hidden rounded-l-2xl bg-primary p-12 text-primary-foreground lg:flex lg:flex-col lg:justify-between">
        <Mark className="size-9" onDark />
        <div>
          <p className="font-serif text-[2rem] font-medium leading-tight">Every check, every decision, in one record you can read.</p>
          <p className="mt-5 max-w-sm text-sm leading-relaxed text-primary-foreground/75">Your account tracks each submission from upload to publication, including the screening report and the policy that produced the decision.</p>
        </div>
        <p className="text-xs text-primary-foreground/60">Paperly is a scholarly repository, not an accreditation authority.</p>
      </aside>
      <div className="rounded-2xl border border-border bg-card p-8 shadow-[0_24px_48px_-28px_oklch(0.2_0.08_262/0.25)] sm:p-12 lg:rounded-l-none lg:border-l-0">
        <h1 className="font-serif text-3xl font-medium">{mode === "in" ? "Sign in" : "Create your account"}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{mode === "in" ? "Welcome back. Pick up where you left off." : "It takes a minute. You can submit as soon as you are in."}</p>
        <form onSubmit={submit} className="mt-8 space-y-4">
          <div className="space-y-1.5"><Label htmlFor="email">Email</Label><Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="pw">Password</Label><Input id="pw" type="password" autoComplete={mode === "in" ? "current-password" : "new-password"} required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />{mode === "up" && <p className="text-xs text-muted-foreground">At least 8 characters.</p>}</div>
          <Button className="w-full" size="lg" disabled={busy}>{busy ? "Please wait\u2026" : mode === "in" ? "Sign in" : "Create account"}</Button>
        </form>
        <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" /></div>
        <Button variant="outline" size="lg" className="w-full" onClick={google} disabled={gBusy}>
          <svg viewBox="0 0 24 24" className="!size-[18px]" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.27-2.09 3.57-5.17 3.57-8.81Z"/><path fill="#34A853" d="M12 24c3.24 0 5.95-1.07 7.93-2.91l-3.87-3a7.2 7.2 0 0 1-10.7-3.78H1.4v3.09A12 12 0 0 0 12 24Z"/><path fill="#FBBC05" d="M5.36 14.31a7.2 7.2 0 0 1 0-4.62V6.6H1.4a12 12 0 0 0 0 10.8l3.96-3.09Z"/><path fill="#EA4335" d="M12 4.77c1.76 0 3.34.61 4.58 1.8l3.43-3.43A11.95 11.95 0 0 0 12 0 12 12 0 0 0 1.4 6.6l3.96 3.09A7.16 7.16 0 0 1 12 4.77Z"/></svg>
          {gBusy ? "Opening Google…" : "Continue with Google"}
        </Button>
        <button className="mt-7 text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground" onClick={() => setMode(mode === "in" ? "up" : "in")}>
          {mode === "in" ? "No account yet? Create one" : "Already registered? Sign in"}
        </button>
      </div>
    </div>
  );
}
