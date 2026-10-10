import { db, getRoles, ADMINS, STAFF } from "./core.server";

const count = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0;

/** Role-based summary. Every figure is computed here from the database; nothing comes from the browser. */
export async function dashboardFor(uid: string) {
  const roles = await getRoles(uid);
  const isStaff = roles.some((r) => STAFF.includes(r));
  const isAdmin = roles.some((r) => ADMINS.includes(r));
  const isReviewer = roles.includes("reviewer");

  const [papers, pays, certs] = await Promise.all([
    db.from("papers").select("id, paperly_id, title, status, published_at, doi, review_round").eq("owner_id", uid).order("created_at", { ascending: false }).limit(100),
    db.from("payments").select("order_id, status, amount_minor, currency, paper_id, created_at").eq("user_id", uid).order("created_at", { ascending: false }).limit(20),
    db.from("certificates").select("certificate_id", { count: "exact", head: true }).eq("recipient_user_id", uid),
  ]);
  const mine = papers.data ?? [];
  const by = (s: string[]) => mine.filter((p) => s.includes(p.status));
  const author = {
    submissions: mine.filter((p) => !["PUBLISHED", "CORRECTED", "RETRACTED", "ARCHIVED"].includes(p.status)).map((p) => ({ id: p.id, paperly_id: p.paperly_id, title: p.title, status: p.status })),
    revisionsRequested: by(["REVISION_REQUIRED"]).map((p) => ({ id: p.id, paperly_id: p.paperly_id, title: p.title })),
    awaitingPayment: by(["ACCEPTED", "PAYMENT_PENDING"]).map((p) => ({ id: p.id, paperly_id: p.paperly_id, title: p.title })),
    published: by(["PUBLISHED", "CORRECTED", "RETRACTED"]).map((p) => ({ paperly_id: p.paperly_id, title: p.title, status: p.status, doi: p.doi })),
    payments: pays.data ?? [],
    certificates: certs.count ?? 0,
  };

  let reviewer: null | { invitations: number; active: number; completed: number; overdue: number; nextDue: string | null } = null;
  if (isReviewer) {
    const { data } = await db.from("review_assignments").select("id, status, due_at").eq("reviewer_id", uid).limit(200);
    const rows = data ?? [];
    const now = Date.now();
    const active = rows.filter((r) => r.status === "ACCEPTED");
    reviewer = {
      invitations: rows.filter((r) => r.status === "INVITED").length,
      active: active.length,
      completed: rows.filter((r) => r.status === "COMPLETED").length,
      overdue: active.filter((r) => r.due_at && Date.parse(r.due_at) < now).length,
      nextDue: active.map((r) => r.due_at).filter((d): d is string => !!d).sort()[0] ?? null,
    };
  }

  let editor: null | Record<string, number> = null;
  if (isStaff) {
    const statuses = ["SUBMITTED", "PROCESSING", "AI_SCREENING", "REVIEW_REQUIRED", "REVIEWER_ASSIGNMENT", "PEER_REVIEW", "EDITORIAL_DECISION", "REVISION_REQUIRED", "ACCEPTED", "PAYMENT_PENDING", "PUBLICATION_PENDING"];
    const counts = await Promise.all(statuses.map((s) => count(db.from("papers").select("id", { count: "exact", head: true }).eq("status", s as never))));
    editor = Object.fromEntries(statuses.map((s, i) => [s, counts[i]]));
  }

  let admin: null | { users: number; boardUnconfirmed: number; journalMode: boolean; paymentsOpen: boolean; doiProvider: string; auditLast24h: number; issnConfirmed: boolean; pendingPayments: number } = null;
  if (isAdmin) {
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const { getSettings } = await import("./review.server");
    const { availableMethods } = await import("./payments.server");
    const { getDoiProvider } = await import("@/lib/domain/doi-provider");
    const [users, board, audit, ident, pending, settings, methods] = await Promise.all([
      count(db.from("profiles").select("id", { count: "exact", head: true })),
      count(db.from("editorial_board_members").select("id", { count: "exact", head: true }).eq("confirmed", false)),
      count(db.from("audit_logs").select("id", { count: "exact", head: true }).gte("created_at", since)),
      db.from("journal_identity").select("issn_confirmed_at").eq("id", true).maybeSingle(),
      count(db.from("payments").select("id", { count: "exact", head: true }).in("status", ["PENDING", "PROCESSING"])),
      getSettings(), availableMethods(),
    ]);
    admin = { users, boardUnconfirmed: board, journalMode: !!settings.journal_mode_enabled, paymentsOpen: !!methods.RAZORPAY, doiProvider: getDoiProvider().name, auditLast24h: audit, issnConfirmed: !!ident.data?.issn_confirmed_at, pendingPayments: pending };
  }
  return { roles, author, reviewer, editor, admin };
}
