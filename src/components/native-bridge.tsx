import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ADMIN_HOME, carriesSignIn, isAppPath, isNativeApp, pathFromAppLink } from "@/lib/native";

/** Renders nothing. Inside the Android app it opens deep links, finishes Google sign-in, and makes the back button behave. */
export function NativeBridge() {
  const router = useRouter();
  // Anything outside the admin panel (the public site, author pages) is sent back to /admin, also for links followed inside a page.
  useEffect(() => {
    if (!isNativeApp()) return;
    const check = () => { if (!isAppPath(window.location.pathname)) router.history.replace(ADMIN_HOME); };
    check();
    return router.history.subscribe(check);
  }, [router]);
  useEffect(() => {
    if (!isNativeApp()) return;
    let off: Array<() => void> = [];
    let alive = true;
    (async () => {
      const [{ App }, { Browser }] = await Promise.all([import("@capacitor/app"), import("@capacitor/browser")]);
      const open = async (url: string) => {
        const path = pathFromAppLink(url, window.location.origin);
        if (!path) return;
        try { await Browser.close(); } catch { /* no browser sheet was open */ }
        const code = new URL(url).searchParams.get("code");
        if (code) {
          // Google sign-in is back: exchange the one-time code (PKCE) for the session, then open the panel without the code in the address.
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) { toast.error("Sign-in could not be completed. Try again."); router.history.replace("/auth"); }
          else router.history.replace(ADMIN_HOME);
        } else if (carriesSignIn(path)) window.location.assign(path);
        else router.history.push(path);
      };
      const added = await Promise.all([
        App.addListener("appUrlOpen", (e) => { void open(e.url); }),
        App.addListener("backButton", () => {
          if (window.location.pathname !== "/" && window.history.length > 1) router.history.back();
          else void App.exitApp();
        }),
      ]);
      if (!alive) { added.forEach((h) => void h.remove()); return; }
      off = added.map((h) => () => void h.remove());
      // The app was started by a link (it was closed when the link was tapped).
      const launch = await App.getLaunchUrl();
      if (launch?.url) void open(launch.url);
    })().catch(() => { /* the site still works without the bridge */ });
    return () => { alive = false; off.forEach((f) => f()); };
  }, [router]);
  return null;
}
