// Static privacy check for the referral-link system. Run: node tests/referral-privacy.test.mjs   (exits non-zero on failure)
// It pins the guarantees that must not regress: partner identity stays admin-only, enforced on the server,
// and never reaches authors, public pages, URLs, cookies or the audit log.
import fs from "node:fs";
import path from "node:path";

let failures = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { failures++; console.log("FAIL", msg); } };
const read = (f) => fs.readFileSync(f, "utf8");
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const srcFiles = walk("src").filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f));

// 1. Only the referral server module may touch the referral tables or RPCs (types.ts is generated; the migration is SQL).
for (const f of srcFiles) {
  if (f.endsWith("referrals.server.ts") || f.endsWith("types.ts")) continue;
  ok(!/referral_(partners|links|user_attributions|paper_attributions|set_paper_shares|partner_stats)/.test(read(f)), `${f} touches referral tables outside referrals.server.ts`);
}

// 2. Every admin* function in the server module gates on REFERRAL_ADMIN first, so a call site cannot skip it.
const server = read("src/lib/server/referrals.server.ts");
ok(/requirePermission\(actorId, "REFERRAL_ADMIN"\)/.test(server), "requireReferralAdmin does not enforce REFERRAL_ADMIN");
const adminFns = [...server.matchAll(/export async function (admin\w+)\(([^)]*)\)[^{]*\{\n([^\n]*)/g)];
ok(adminFns.length >= 9, `expected at least 9 admin functions, found ${adminFns.length}`);
for (const [, name, , firstLine] of adminFns) ok(/await requireReferralAdmin\(actorId\)/.test(firstLine), `${name} does not start with requireReferralAdmin(actorId)`);

// 3. The server-function layer: authenticated, admin-prefixed, and nothing identity-related comes from the browser.
const fns = read("src/lib/referrals.functions.ts");
const blocks = fns.split(/\n(?=export const \w+ = createServerFn)/).slice(1);
ok(blocks.length >= 9, "referrals.functions.ts should define the admin functions");
for (const b of blocks) {
  const name = /^export const (\w+)/.exec(b)[1];
  ok(/^admin/.test(name), `${name}: every referral server function must be admin-prefixed`);
  ok(b.includes("requireSupabaseAuth"), `${name}: missing requireSupabaseAuth`);
  ok(/context\.userId/.test(b), `${name}: must pass the verified session user to the server module`);
  ok(!/data\.(userId|actorId|isAdmin|role)\b/.test(b), `${name}: browser-supplied identity or role`);
}

// 4. Author-facing code only RECORDS (inside try/catch); it can never read or return referral data.
const app = read("src/lib/app.functions.ts");
const uses = [...app.matchAll(/\(await referrals\(\)\)\.(\w+)/g)].map((m) => m[1]);
ok(uses.length === 2 && uses.includes("recordRegistrationReferral") && uses.includes("recordSubmissionReferral"), `app.functions.ts may only call the two record* functions (found: ${uses.join(", ")})`);
ok(/try \{ await \(await referrals\(\)\)\.recordRegistrationReferral[^\n]*catch/.test(app), "registration recording must be failure-isolated");
ok(/try \{ await \(await referrals\(\)\)\.recordSubmissionReferral[^\n]*catch/.test(app), "submission recording must be failure-isolated");
ok(!/referral/i.test(read("src/lib/server/dashboard.server.ts")), "dashboard must not mention referrals");
// Author payloads select whole rows, so referral data must never be added to papers/profiles. The migration must not alter them either.
const mig = read("drizzle/migrations/0043_referral_links.sql");
ok(!/alter\s+table\s+public\.(papers|profiles|user_roles|payments|audit_logs)/i.test(mig), "migration must not alter existing tables (additive only)");
ok(!/\b(drop|truncate|delete\s+from|update\s+public)\b/i.test(mig.replace(/--[^\n]*/g, "")) || /delete from public\.referral_paper_attributions/.test(mig), "migration must not drop or rewrite existing data");

// 5. Referral components appear only in admin screens.
for (const f of srcFiles) {
  if (/referral-admin/.test(read(f)) && !/(admin\.tsx|remove-articles\.tsx|referral-admin\.tsx)$/.test(f)) ok(false, `${f} imports the admin referral UI`);
}
for (const f of ["src/routes/_authenticated/my-research.$id.tsx", "src/routes/_authenticated/my-research.index.tsx", "src/routes/_authenticated/dashboard.tsx", "src/routes/_authenticated/profile.tsx", "src/routes/_authenticated/submit.tsx", "src/routes/article.$paperlyId.tsx", "src/routes/index.tsx", "src/routes/explore.tsx", "src/routes/paper.$publicId.tsx"]) {
  ok(!/referral/i.test(read(f)), `${f} (author or public page) mentions referrals`);
}

// 6. The public link route: no lookup, no database, no identity. Same answer for every well-formed code.
const route = read("src/routes/r.$code.ts");
const routeCode = route.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
ok(!/core\.server|referrals\.server|supabase|dbx|\bdb\b/.test(routeCode), "r.$code.ts must not touch the database (no validity oracle)");
ok(/HttpOnly/.test(read("src/lib/domain/referrals.ts")), "cookie must be HttpOnly");
ok(/noindex/.test(route) && /no-store/.test(route) && /no-referrer/.test(route), "r.$code.ts must be noindex, no-store and no-referrer");
ok(/Disallow: \/r\//.test(read("src/lib/domain/metadata.ts")), "robots.txt must disallow /r/");

// 7. The code and cookie are opaque: the generator uses no partner data, and the audit log carries ids only, never names.
const dom = read("src/lib/domain/referrals.ts");
ok(/export function generateReferralCode\(randomBytes: RandomBytes = cryptoBytes\)/.test(dom), "generateReferralCode must take only a random source");
ok(!/display_name|displayName|partnerName|contact_email/.test(dom.replace(/\/\/[^\n]*/g, "")), "domain/referrals.ts must not handle partner names");
for (const m of server.matchAll(/await audit\(\{[\s\S]*?\}\);/g)) ok(!/display_name|displayName|partnerName|contact_email|notes/.test(m[0]), `audit entry carries a partner name: ${m[0].slice(0, 60)}`);
for (const m of server.matchAll(/log\("[^"]+", \{[^}]*\}\)/g)) ok(!/display_name|displayName|partnerName|contact_email/.test(m[0]), "log line carries a partner name");

// 8. Database: server-only tables (RLS on, no grants to anon or authenticated), function execute only for service_role.
for (const t of ["referral_partners", "referral_links", "referral_user_attributions", "referral_paper_attributions"]) {
  ok(new RegExp(`alter table public\\.${t} enable row level security`).test(mig), `${t}: RLS not enabled`);
  ok(new RegExp(`revoke all on public\\.${t} from public, anon, authenticated`).test(mig), `${t}: grants not revoked`);
  ok(!new RegExp(`grant [^;]*on public\\.${t} to (anon|authenticated|public)`).test(mig), `${t}: granted to a client role`);
}
for (const fn of ["referral_set_paper_shares\\(uuid, jsonb, text, boolean, uuid\\)", "referral_partner_stats\\(\\)"]) {
  ok(new RegExp(`revoke all on function public\\.${fn} from public, anon, authenticated`).test(mig), `${fn}: execute not revoked`);
  ok(new RegExp(`grant execute on function public\\.${fn} to service_role`).test(mig), `${fn}: not limited to service_role`);
}
ok(/total <> 100/.test(mig), "the database must enforce shares adding up to exactly 100");
ok(/referral_code_ok|code ~ '\^\[A-HJ-KM-NP-Z2-9\]\{8\}\$'/.test(mig), "link codes must be constrained to the opaque format");

// 9. Only admin and super_admin hold the permission.
const perms = read("src/lib/domain/permissions.ts");
const holders = [...perms.matchAll(/^\s{2}(\w+): \[([^\]]*)\]/gm)].filter((m) => m[2].includes('"REFERRAL_ADMIN"')).map((m) => m[1]).sort();
ok(JSON.stringify(holders) === JSON.stringify(["admin", "super_admin"]), `REFERRAL_ADMIN holders: ${holders.join(", ")}`);

console.log(`referral privacy: ${checks} checks, ${failures} failure(s)`);
process.exit(failures ? 1 : 0);
