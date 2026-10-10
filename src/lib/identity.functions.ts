import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const idn = () => import("@/lib/server/identity.server");
const role = z.enum(["EDITOR_IN_CHIEF", "ASSOCIATE_EDITOR", "EDITORIAL_BOARD_MEMBER", "ADVISORY_BOARD_MEMBER"]);

export const getJournalIdentity = createServerFn({ method: "GET" }).handler(async () => (await idn()).publicIdentity());
export const getTrustStatus = createServerFn({ method: "GET" }).handler(async () => {
  const id = await (await idn()).publicIdentity();
  // ORCID sign-in counts as live only when all three server settings are present. The values themselves are never sent to the browser.
  const orcidLive = !!(process.env["ORCID_CLIENT_ID"] && process.env["ORCID_CLIENT_SECRET"] && process.env["ORCID_STATE_SECRET"]);
  return { orcidLive, orcidSandbox: process.env["ORCID_ENV"] !== "production", issn: id.issn, eissn: id.eissn };
});
export const getEditorialBoard = createServerFn({ method: "GET" }).handler(async () => (await idn()).publicBoard());
export const getPublicFees = createServerFn({ method: "GET" }).handler(async () => (await idn()).publicFees());

export const adminGetIdentity = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => (await idn()).adminIdentity(context.userId));
export const adminSaveIdentity = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    journal_title: z.string().trim().min(2).max(200), publisher_name: z.string().max(200).optional(), aims_scope: z.string().max(5000).optional(),
    publication_frequency: z.string().trim().min(2).max(100), editorial_office_email: z.string().max(200).optional(), editorial_office_address: z.string().max(500).optional(),
    issn: z.string().max(9).optional(), eissn: z.string().max(9).optional(), issn_officially_assigned: z.boolean().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => { await (await idn()).saveIdentity(context.userId, data); return { ok: true }; });

export const adminListBoard = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => (await idn()).adminBoard(context.userId));
export const adminSaveBoardMember = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    id: z.string().uuid().optional(), full_name: z.string().trim().min(2).max(200), affiliation: z.string().trim().min(2).max(300), country: z.string().max(100).optional(),
    credentials: z.string().max(200).optional(), orcid: z.string().max(19).optional(), role, biography: z.string().max(2000).optional(), display_order: z.number().int().min(0).max(1000).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => (await idn()).saveBoardMember(context.userId, data));
export const adminConfirmBoardMember = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid(), confirmed: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => { await (await idn()).setBoardConfirmed(context.userId, data.id, data.confirmed); return { ok: true }; });
export const adminDeleteBoardMember = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => { await (await idn()).deleteBoardMember(context.userId, data.id); return { ok: true }; });

export const adminAuditLog = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ action: z.string().max(60).optional(), resource: z.string().max(60).optional(), page: z.number().int().min(1).max(10000) }).parse(d))
  .handler(async ({ data, context }) => (await idn()).auditPage(context.userId, data));
