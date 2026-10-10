// Central permission model. Roles are only a way to hold permissions; every sensitive server path asks for a PERMISSION,
// so adding a role never silently widens what another role can do. Enforced server-side (core.server.ts requirePermission);
// the database re-checks the roles that matter for ethics inside its security-definer functions.
export const PERMISSIONS = [
  "SUBMISSION_MANAGE", // create/amend own submissions
  "EDITORIAL_REVIEW", // screening queue, editorial decisions
  "PEER_REVIEW_MANAGE", // invite/assign/close peer reviews
  "PEER_REVIEW_PARTICIPATE", // do an assigned peer review
  "ETHICS_REVIEW", // inspect and decide ethics cases
  "ETHICS_ASSIGN", // assign ethics reviewers (assigning is not deciding)
  "COPYRIGHT_REVIEW",
  "PAYMENT_MANAGE",
  "CERTIFICATE_MANAGE",
  "PUBLICATION_MANAGE",
  "SYSTEM_ADMIN", // roles, settings, identity, board
  "AUDIT_READ",
  "USERS_READ", // list registered users and their roles
  "FINANCE_READ", // revenue totals and the transaction list (read only)
  "ROLE_ASSIGN_STAFF", // allow or remove the editor and reviewer roles
] as const;
export type Permission = (typeof PERMISSIONS)[number];
export type RoleName = "researcher" | "editor" | "reviewer" | "admin" | "super_admin" | "payment_admin" | "ethics_reviewer" | "copyright_reviewer" | "founder";

export const ROLE_PERMISSIONS: Record<RoleName, readonly Permission[]> = {
  researcher: ["SUBMISSION_MANAGE"],
  editor: ["EDITORIAL_REVIEW", "PEER_REVIEW_MANAGE"],
  reviewer: ["PEER_REVIEW_PARTICIPATE"],
  // Admins run the journal; they do NOT decide ethics or copyright and are not payment staff by virtue of the title.
  // Payment visibility for admin/super_admin is kept because the existing payment console already allowed it; it is an
  // explicit grant here, not an accident of "is staff".
  admin: ["EDITORIAL_REVIEW", "PEER_REVIEW_MANAGE", "ETHICS_ASSIGN", "PAYMENT_MANAGE", "CERTIFICATE_MANAGE", "PUBLICATION_MANAGE", "SYSTEM_ADMIN", "AUDIT_READ", "USERS_READ", "FINANCE_READ", "ROLE_ASSIGN_STAFF"],
  super_admin: ["EDITORIAL_REVIEW", "PEER_REVIEW_MANAGE", "ETHICS_ASSIGN", "PAYMENT_MANAGE", "CERTIFICATE_MANAGE", "PUBLICATION_MANAGE", "SYSTEM_ADMIN", "AUDIT_READ", "USERS_READ", "FINANCE_READ", "ROLE_ASSIGN_STAFF"],
  payment_admin: ["PAYMENT_MANAGE"],
  ethics_reviewer: ["ETHICS_REVIEW"],
  copyright_reviewer: ["COPYRIGHT_REVIEW"],
  // Founder: sees users, money and transactions, and can allow editors and reviewers. Nothing else.
  founder: ["USERS_READ", "FINANCE_READ", "ROLE_ASSIGN_STAFF"],
};

export function permissionsFor(roles: readonly string[]): Set<Permission> {
  const out = new Set<Permission>();
  for (const r of roles) for (const p of ROLE_PERMISSIONS[r as RoleName] ?? []) out.add(p);
  return out;
}
export function hasPermission(roles: readonly string[], perm: Permission): boolean {
  return permissionsFor(roles).has(perm);
}
/** Anyone may own a submission; the check exists so SUBMISSION_MANAGE is not special-cased anywhere. */
export function rolesGranting(perm: Permission): RoleName[] {
  return (Object.keys(ROLE_PERMISSIONS) as RoleName[]).filter((r) => ROLE_PERMISSIONS[r].includes(perm));
}

/** Roles that can be handed out from the roles screen. Admin-level roles are never granted here. */
export const ASSIGNABLE_ROLES = ["editor", "reviewer", "founder"] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

/** Who may allow which role. Administrators may allow all three; a founder may allow only editor and reviewer,
 *  never founder, and never on their own account. */
export function canAssignRole(actorRoles: readonly string[], role: string, targetIsSelf: boolean): { ok: true } | { ok: false; reason: string } {
  if (!(ASSIGNABLE_ROLES as readonly string[]).includes(role)) return { ok: false, reason: "That role cannot be assigned here" };
  if (actorRoles.some((r) => r === "admin" || r === "super_admin")) return { ok: true };
  if (actorRoles.includes("founder")) {
    if (role === "founder") return { ok: false, reason: "Only an administrator can make someone a founder" };
    if (targetIsSelf) return { ok: false, reason: "You cannot change your own roles" };
    return { ok: true };
  }
  return { ok: false, reason: "Forbidden: insufficient role" };
}
