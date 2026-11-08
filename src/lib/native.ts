import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";

/** True only inside the Android app (the native shell around the site). Always false on the web and during server rendering. */
export const isNativeApp = (): boolean => typeof window !== "undefined" && Capacitor.isNativePlatform();

/** The one page this app opens on. */
export const ADMIN_HOME = "/admin";

/** The app is the administrator panel only. These are the pages it may show: the panel, sign-in, and what the panel itself opens. */
const APP_PATHS = [/^\/admin(\/|$)/, /^\/founder(\/|$)/, /^\/auth(\/|$)/, /^\/profile(\/|$)/, /^\/manuscript\//, /^\/my-research\/[^/]+/, /^\/orcid\//, /^\/zenodo\//];
export const isAppPath = (pathname: string): boolean => APP_PATHS.some((r) => r.test(pathname));

/** False on the server and on first paint, true once the page knows it is inside the app (avoids a server/browser mismatch). */
export function useIsNative(): boolean {
  const [n, setN] = useState(false);
  useEffect(() => { setN(isNativeApp()); }, []);
  return n;
}

/** Where the app sends people back to after Google sign-in. Needs `paperly://**` in Supabase > Authentication > URL configuration > Redirect URLs. */
export const NATIVE_AUTH_REDIRECT = "paperly://auth/callback";

/**
 * Turns a link that opened the app into a path on this site, or null if the link is not ours.
 *   https://<this site>/admin#money/payments  ->  /admin#money/payments
 *   paperly://admin                           ->  /admin
 *   paperly://auth/callback?code=...          ->  /admin?code=...   (finishes Google sign-in)
 * Pages outside the admin panel open /admin instead.
 * Links to any other website are ignored, so a crafted link cannot send the app anywhere else.
 */
export function pathFromAppLink(raw: string, siteOrigin: string): string | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol === "https:") return u.origin === siteOrigin ? (isAppPath(u.pathname) ? `${u.pathname}${u.search}${u.hash}` : ADMIN_HOME) : null;
  if (u.protocol === "paperly:") {
    if (u.host === "auth") return `${ADMIN_HOME}${u.search}${u.hash}`;
    const path = `/${u.host}${u.pathname}`.replace(/\/{2,}/g, "/").replace(/\/+$/, "") || "/";
    return isAppPath(path) ? `${path}${u.search}${u.hash}` : ADMIN_HOME;
  }
  return null;
}

/** A link that carries a sign-in result must load the page afresh, so the sign-in code in it is read and exchanged. */
export const carriesSignIn = (path: string): boolean => /[?&#](code|access_token|refresh_token|error_description)=/.test(path);
