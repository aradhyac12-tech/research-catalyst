import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Zenodo DOI administration. Every handler re-checks the caller's role on the server (zenodo.server.ts -> canZenodo); the UI only hides controls.
const origin = () => { try { return new URL(getRequest().url).origin; } catch { return process.env["PUBLIC_SITE_URL"] ?? ""; } };
// Must equal, character for character, the callback URL registered in the Zenodo application.
const redirectUri = () => `${(process.env["PUBLIC_SITE_URL"]?.trim() || origin()).replace(/\/+$/, "")}/zenodo/callback`;
const zen = () => import("@/lib/server/zenodo.server");
const paperInput = (d: unknown) => z.object({ paperId: z.string().uuid() }).parse(d);

export const zenodoOverview = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const z = await zen();
  const [status, list] = await Promise.all([z.zenodoStatus(context.userId), z.listRegistrations(context.userId)]);
  return { ...status, ...list };
});

export const zenodoApprovePublication = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator(paperInput)
  .handler(async ({ data, context }) => (await zen()).approveAndRegister(data.paperId, context.userId, origin()));

export const zenodoRetry = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator(paperInput)
  .handler(async ({ data, context }) => (await zen()).retryRegistration(data.paperId, context.userId, origin()));

export const zenodoUpdateMetadata = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator(paperInput)
  .handler(async ({ data, context }) => { await (await zen()).updatePublishedMetadata(data.paperId, context.userId, origin()); return { ok: true }; });

export const zenodoTestConnection = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => (await zen()).testConnection(context.userId));

export const zenodoSetProduction = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ enabled: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => { await (await zen()).setProductionEnabled(context.userId, data.enabled); return { ok: true }; });

export const zenodoConnectUrl = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => ({ url: await (await zen()).connectUrl(context.userId, redirectUri()) }));

export const zenodoCompleteConnect = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ code: z.string().min(6).max(300), state: z.string().min(10).max(2000) }).parse(d))
  .handler(async ({ data, context }) => (await zen()).completeConnect(context.userId, data.code, data.state, redirectUri()));

export const zenodoDisconnect = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => { await (await zen()).disconnect(context.userId); return { ok: true }; });
