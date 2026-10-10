// ORCID iD validation (ISO 7064 MOD 11-2). Pure functions, mirrored by public.orcid_checksum_ok() in the database.
// A well-formed iD is NOT a verified iD: verification happens only through ORCID OAuth (orcid_verifications).
export function orcidChecksumOk(orcid: string): boolean {
  if (!/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(orcid)) return false;
  const digits = orcid.replace(/-/g, "");
  let total = 0;
  for (let i = 0; i < 15; i++) total = (total + Number(digits[i])) * 2;
  const check = (12 - (total % 11)) % 11;
  return digits[15] === (check === 10 ? "X" : String(check));
}

export function normalizeOrcid(input: string): string | null {
  const m = input.trim().replace(/^https?:\/\/(sandbox\.)?orcid\.org\//i, "");
  return orcidChecksumOk(m) ? m : null;
}

export const orcidUrl = (orcid: string) => `https://orcid.org/${orcid}`;

// Signed OAuth state. Binds the flow to the user who started it; the callback page must be opened by that same user.
export async function signState(payload: { uid: string; exp: number; n: string }, secret: string): Promise<string> {
  const body = btoa(JSON.stringify(payload)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${body}.${await hmac(body, secret)}`;
}
export async function verifyState(state: string, secret: string, now = Date.now()): Promise<{ uid: string; exp: number; n: string } | null> {
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  const expected = await hmac(body, secret);
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const p = JSON.parse(atob(body.replace(/-/g, "+").replace(/_/g, "/")));
    if (typeof p.uid !== "string" || typeof p.exp !== "number" || typeof p.n !== "string" || p.exp < now) return null;
    return p;
  } catch { return null; }
}
async function hmac(msg: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}
