// Static security check: every server function requires a signed-in user unless it is on the explicit public list.
// Run: node tests/server-functions-auth.test.mjs   (also exits non-zero on failure)
import fs from "node:fs";
const files = ["src/lib/app.functions.ts", "src/lib/review.functions.ts", "src/lib/scholarly.functions.ts", "src/lib/identity.functions.ts", "src/lib/ethics.functions.ts", "src/lib/versions.functions.ts"];
const PUBLIC = new Set(["explorePapers", "getPublicPaper", "verifyCertificate", "getJournalIdentity", "getEditorialBoard", "getTrustStatus", "getPublicFees", "certificateDownloadPublic"]); // certificateDownloadPublic: token-gated (constant-time compare), pre-existing public download
let failures = 0, checked = 0;
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  const parts = src.split(/\n(?=export const \w+ = createServerFn)/).slice(1);
  for (const block of parts) {
    const name = /^export const (\w+)/.exec(block)[1];
    checked++;
    const authed = block.includes("requireSupabaseAuth");
    if (PUBLIC.has(name)) { if (authed) continue; if (/context\.userId/.test(block)) { console.log("FAIL public fn uses userId:", name); failures++; } continue; }
    if (!authed) { console.log("FAIL unauthenticated server function:", name, "in", f); failures++; }
    if (/^(admin|editor)/.test(name) && !/(await \w+\(\)\)|requireRole|rv\(\)|sc\(\)|idn\(\)|pay\(\)|pipe\(\)|recordDecision|requireTestAdmin)/.test(block)) { console.log("FAIL admin/editor fn has no server-side role gate:", name); failures++; }
    if (/data\.(userId|isAdmin)\b/.test(block)) { console.log("FAIL client-supplied identity used:", name); failures++; }
    // A browser-supplied role is allowed only for the admin-gated grant of non-privileged roles.
    if (/data\.role\b/.test(block) && !(name === "adminSetRole" && /z\.enum\(\["editor", "reviewer"\]\)/.test(block))) { console.log("FAIL client-supplied role used:", name); failures++; }
  }
}
// Payment/acceptance/DOI/role values must never be accepted from the browser.
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  for (const bad of [/z\.object\([^)]*\b(status|accepted|doi|role)\s*:/g]) {
    // allow explicit role-grant input in adminSetRole (admin-gated) and DOI in citations/references
    const m = src.match(bad) ?? [];
    for (const hit of m) if (!/adminSetRole|outcome|kind|type|status: z\.enum\(\[\"PUBLISHED/.test(hit) && /\b(accepted|doi)\s*:/.test(hit)) { console.log("FAIL browser may submit acceptance/doi:", hit.slice(0, 80)); failures++; }
  }
}
console.log(`checked ${checked} server functions, ${failures} failure(s)`);

// The server functions those handlers delegate to must themselves gate on role / editor checks.
const gated = { "src/lib/server/review.server.ts": ["recordDecision", "setRole", "updateSettings", "startPeerReview", "inviteReviewer", "closeReviews"], "src/lib/server/scholarly.server.ts": ["issueNotice"], "src/lib/server/versions.server.ts": ["issueCorrectedVersion"],
  "src/lib/server/identity.server.ts": ["adminIdentity", "saveIdentity", "adminBoard", "saveBoardMember", "setBoardConfirmed", "deleteBoardMember", "auditPage"] };
for (const [file, names] of Object.entries(gated)) {
  const src = fs.readFileSync(file, "utf8");
  for (const n of names) {
    const m = new RegExp(`export async function ${n}\\b[\\s\\S]*?\\n}\\n`).exec(src);
    if (!m) { console.log("FAIL cannot find", n, "in", file); failures++; continue; }
    if (!/requireRole|requireHandlingEditor|requireAdmin/.test(m[0])) { console.log("FAIL server function without role gate:", n); failures++; }
  }
}
console.log(failures ? `${failures} failure(s)` : "delegated role gates present");
process.exit(failures ? 1 : 0);

// requireTestAdmin must itself enforce the SYSTEM_ADMIN permission (the admin test-mode functions rely on it).
{
  const src = fs.readFileSync("src/lib/app.functions.ts", "utf8");
  const m = /async function requireTestAdmin\b[\s\S]*?\n}\n/.exec(src);
  if (!m || !/requirePermission\(userId, "SYSTEM_ADMIN"\)/.test(m[0])) { console.log("FAIL requireTestAdmin does not enforce SYSTEM_ADMIN"); process.exit(1); }
  console.log("requireTestAdmin gate present");
}
