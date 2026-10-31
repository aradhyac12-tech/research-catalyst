import { describe, expect, it } from "vitest";
import { buildAuthorizeUrl, decryptSecret, encryptSecret, exchangeCode, refreshTokens, signConnectState, tokenNeedsRefresh, verifyConnectState, zenodoOAuthConfig, zenodoRedirectUri } from "./zenodo-oauth";

const cfg = { clientId: "cid", clientSecret: "shh-secret-value" };
const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })) as never;

describe("zenodo oauth", () => {
  it("needs both client id and secret", () => {
    expect(zenodoOAuthConfig({})).toEqual({ ok: false, missing: ["ZENODO_CLIENT_ID", "ZENODO_CLIENT_SECRET"] });
    expect(zenodoOAuthConfig({ ZENODO_CLIENT_ID: " cid ", ZENODO_CLIENT_SECRET: '"s"' })).toMatchObject({ ok: true, clientId: "cid", clientSecret: "s" });
  });
  it("builds the authorise URL for the right host and the registered redirect", () => {
    const u = new URL(buildAuthorizeUrl("production", "cid", zenodoRedirectUri("https://paperly-ashy.vercel.app/"), "st"));
    expect(u.origin + u.pathname).toBe("https://zenodo.org/oauth/authorize");
    expect(u.searchParams.get("redirect_uri")).toBe("https://paperly-ashy.vercel.app/zenodo/callback");
    expect(u.searchParams.get("scope")).toBe("deposit:write deposit:actions");
    expect(new URL(buildAuthorizeUrl("sandbox", "cid", "https://x/zenodo/callback", "st")).host).toBe("sandbox.zenodo.org");
  });
  it("state is bound to the user and expires", async () => {
    const c = { stateKey: "k" };
    const s = await signConnectState("user-1", c, 1000);
    expect((await verifyConnectState(s, c, 2000))?.uid).toBe("user-1");
    expect(await verifyConnectState(s, c, 1000 + 11 * 60_000)).toBeNull();
    expect(await verifyConnectState(s, { stateKey: "other" }, 2000)).toBeNull();
  });
  it("reads tokens and sets an expiry", async () => {
    const t = await exchangeCode(reply(200, { access_token: "A", refresh_token: "R", expires_in: 3600, scope: "deposit:write", user: { id: 7, name: "Journal" } }), "production", cfg, "code", "https://x/zenodo/callback", 0);
    expect(t).toMatchObject({ accessToken: "A", refreshToken: "R", userId: "7", userName: "Journal", expiresAt: new Date(3_600_000).toISOString() });
  });
  it("turns Zenodo errors into actionable messages without echoing the secret", async () => {
    await expect(exchangeCode(reply(400, { error: "invalid_grant" }), "production", cfg, "c", "r")).rejects.toMatchObject({ code: "ZENODO_OAUTH_GRANT" });
    await expect(refreshTokens(reply(401, { error: "invalid_client" }), "production", cfg, "R")).rejects.toThrow(/ZENODO_CLIENT_ID/);
    await expect(exchangeCode(reply(400, { error: "redirect_uri_mismatch" }), "production", cfg, "c", "r")).rejects.toMatchObject({ code: "ZENODO_OAUTH_REDIRECT" });
    await expect(exchangeCode(reply(500, {}), "production", cfg, "c", "r")).rejects.not.toThrow(/shh-secret-value/);
  });
  it("refreshes shortly before expiry", () => {
    expect(tokenNeedsRefresh(new Date(1_000_000).toISOString(), 1_000_000 - 60_000)).toBe(true);
    expect(tokenNeedsRefresh(new Date(1_000_000).toISOString(), 1_000_000 - 3_600_000)).toBe(false);
    expect(tokenNeedsRefresh(null)).toBe(false);
  });
  it("encrypts at rest and only the right key opens it", async () => {
    const blob = await encryptSecret("tok_abc", "key-1");
    expect(blob).not.toContain("tok_abc");
    expect(await decryptSecret(blob, "key-1")).toBe("tok_abc");
    await expect(decryptSecret(blob, "key-2")).rejects.toThrow();
  });
});
