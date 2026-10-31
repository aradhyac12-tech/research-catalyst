import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

/** The public address of this site, for absolute links in the page head (share previews need them). The configured PUBLIC_SITE_URL wins, then the address the request came in on. */
export const getSiteOrigin = createServerFn({ method: "GET" }).handler(async () => {
  const clean = (u?: string) => (u ?? "").trim().replace(/\/+$/, "");
  const configured = clean(process.env["PUBLIC_SITE_URL"]);
  if (configured) return configured;
  try { return new URL(getRequest().url).origin; } catch { return ""; }
});
