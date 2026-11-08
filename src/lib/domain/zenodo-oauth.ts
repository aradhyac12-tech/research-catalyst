// Zenodo OAuth ("Connect Zenodo"). Pure helpers: no database, no process.env access except through the argument.
// The authorised token is stored encrypted; the key is derived from ZENODO_CLIENT_SECRET, so rotating that secret in Zenodo
// (which invalidates the stored refresh token anyway) also makes the old ciphertext unreadable.
import { signState, verifyState } from "./orcid";
import { ZENODO_HOST, describeZenodoBody, type ZenodoEnvironment } from "./zenodo";

export const ZENODO_OAUTH_SCOPE = "deposit:write deposit:actions";
/** Refresh a little before the token really expires so a long upload never starts with a token that dies midway. */
export const REFRESH_SKEW_MS = 5 * 60_000;

const clean = (v?: string) => v?.trim().replace(/^["'`]+|["'`]+$/g, "").trim();

export type ZenodoOAuthConfig =
  | { ok: true; clientId: string; clientSecret: string; stateKey: string; encKey: string }
  | { ok: false; missing: string[] };

export function zenodoOAuthConfig(env: Record<string, string | undefined>): ZenodoOAuthConfig {
  const clientId = clean(env["ZENODO_CLIENT_ID"]), clientSecret = clean(env["ZENODO_CLIENT_SECRET"]);
  const missing = [!clientId && "ZENODO_CLIENT_ID", !clientSecret && "ZENODO_CLIENT_SECRET"].filter(Boolean) as string[];
  if (missing.length || !clientId || !clientSecret) return { ok: false, missing };
  return { ok: true, clientId, clientSecret, stateKey: `zenodo-state:${clientSecret}`, encKey: `zenodo-token:${clientSecret}` };
}

export const zenodoRedirectUri = (siteUrl: string) => `${siteUrl.trim().replace(/\/+$/, "")}/zenodo/callback`;

export function buildAuthorizeUrl(environment: ZenodoEnvironment, clientId: string, redirectUri: string, state: string): string {
  const u = new URL(`https://${ZENODO_HOST[environment]}/oauth/authorize`);
  u.search = new URLSearchParams({ client_id: clientId, response_type: "code", scope: ZENODO_OAUTH_SCOPE, redirect_uri: redirectUri, state }).toString();
  return u.toString();
}

export const signConnectState = (uid: string, cfg: { stateKey: string }, now = Date.now()) => signState({ uid, exp: now + 10 * 60_000, n: crypto.randomUUID() }, cfg.stateKey);
export const verifyConnectState = (state: string, cfg: { stateKey: string }, now = Date.now()) => verifyState(state, cfg.stateKey, now);

export const tokenNeedsRefresh = (expiresAt: string | null | undefined, now = Date.now()) => !!expiresAt && new Date(expiresAt).getTime() - now < REFRESH_SKEW_MS;

// ---------------------------------------------------------------- token endpoint
export class ZenodoOAuthError extends Error {
  code: "ZENODO_OAUTH_REDIRECT" | "ZENODO_OAUTH_CLIENT" | "ZENODO_OAUTH_GRANT" | "ZENODO_OAUTH_FAILED";
  constructor(code: ZenodoOAuthError["code"], message: string) { super(message); this.code = code; }
}
export interface ZenodoTokens { accessToken: string; refreshToken: string | null; expiresAt: string | null; scope: string | null; userId: string | null; userName: string | null }
type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

async function tokenRequest(fetchFn: FetchFn, environment: ZenodoEnvironment, params: Record<string, string>, now: number): Promise<ZenodoTokens> {
  const res = await fetchFn(`https://${ZENODO_HOST[environment]}/oauth/token`, {
    method: "POST", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Paperly/1.0 (+https://paperly-ashy.vercel.app)" }, body: new URLSearchParams(params),
  });
  const rawText = await res.text().catch(() => "");
  const body = (() => { try { return JSON.parse(rawText) as Record<string, unknown>; } catch { return {} as Record<string, unknown>; } })();
  if (!res.ok) {
    const why = `${body["error"] ?? ""} ${body["error_description"] ?? ""}`.toLowerCase();
    if (why.includes("redirect")) throw new ZenodoOAuthError("ZENODO_OAUTH_REDIRECT", "Zenodo did not accept the redirect address. It must be registered in the Zenodo application exactly as https://<your site>/zenodo/callback");
    if (why.includes("invalid_grant")) throw new ZenodoOAuthError("ZENODO_OAUTH_GRANT", "That Zenodo link was already used or has expired. Press Connect Zenodo again.");
    if (why.includes("client") || res.status === 401) throw new ZenodoOAuthError("ZENODO_OAUTH_CLIENT", `Zenodo rejected ZENODO_CLIENT_ID / ZENODO_CLIENT_SECRET (HTTP ${res.status}: ${describeZenodoBody(rawText)}). They must come from the application registered on the same Zenodo environment (zenodo.org for production), and the site must be redeployed after changing them.`);
    throw new ZenodoOAuthError("ZENODO_OAUTH_FAILED", `Zenodo did not accept the sign-in request (HTTP ${res.status}: ${describeZenodoBody(rawText)}). ${res.status === 403 ? "Check that ZENODO_CLIENT_ID and ZENODO_CLIENT_SECRET belong to an application registered on the same Zenodo site as ZENODO_ENVIRONMENT, and that its redirect address matches exactly." : ""}`.trim());
  }
  const accessToken = typeof body["access_token"] === "string" ? body["access_token"] : "";
  if (!accessToken) throw new ZenodoOAuthError("ZENODO_OAUTH_FAILED", "Zenodo returned no access token.");
  const user = (body["user"] ?? {}) as { id?: unknown; name?: unknown };
  const expiresIn = Number(body["expires_in"]);
  return {
    accessToken,
    refreshToken: typeof body["refresh_token"] === "string" && body["refresh_token"] ? body["refresh_token"] : null,
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(now + expiresIn * 1000).toISOString() : null,
    scope: typeof body["scope"] === "string" ? body["scope"] : null,
    userId: user.id == null ? null : String(user.id), userName: typeof user.name === "string" ? user.name : null,
  };
}
export const exchangeCode = (f: FetchFn, env: ZenodoEnvironment, cfg: { clientId: string; clientSecret: string }, code: string, redirectUri: string, now = Date.now()) =>
  tokenRequest(f, env, { client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: "authorization_code", code, redirect_uri: redirectUri }, now);
export const refreshTokens = (f: FetchFn, env: ZenodoEnvironment, cfg: { clientId: string; clientSecret: string }, refreshToken: string, now = Date.now()) =>
  tokenRequest(f, env, { client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: "refresh_token", refresh_token: refreshToken }, now);

// ---------------------------------------------------------------- encryption at rest (AES-256-GCM)
const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
async function aesKey(material: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function encryptSecret(plain: string, material: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(material), new TextEncoder().encode(plain)));
  return `v1.${b64u(iv)}.${b64u(ct)}`;
}
export async function decryptSecret(blob: string, material: string): Promise<string> {
  const [v, iv, ct] = blob.split(".");
  if (v !== "v1" || !iv || !ct) throw new Error("Unreadable stored token");
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64u(iv) }, await aesKey(material), unb64u(ct)));
}
