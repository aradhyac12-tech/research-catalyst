import { db, audit, notify, transition, getStatus, log } from "./core.server";
import { publishPaper } from "./pipeline.server";
import { canPaymentTransition } from "@/lib/domain/payment-provider";
import {
  razorpayConfig, createRazorpayOrder, fetchRazorpayPayment, captureRazorpayPayment,
  verifyCheckoutSignature, verifyWebhookSignature,
} from "@/lib/domain/razorpay";

export type PayMethod = "RAZORPAY" | "KG_QR" | "TEST";
export const METHOD_CURRENCY: Record<PayMethod, string> = { RAZORPAY: "INR", KG_QR: "KGS", TEST: "INR" };
type Target = "PROCESSING" | "PAID" | "FAILED" | "REFUNDED" | "CANCELLED";

function newOrderId() {
  const rand = crypto.getRandomValues(new Uint8Array(4));
  return `PPL-${Date.now().toString(36).toUpperCase()}-${Array.from(rand).map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

export async function getKgQrSettings() {
  const { data } = await db.from("payment_settings").select("value").eq("key", "KG_QR").maybeSingle();
  const v = (data?.value ?? {}) as { enabled?: boolean; image_path?: string | null; recipient?: string | null; instructions?: string | null };
  let imageUrl: string | null = null;
  if (v.image_path) {
    const s = await db.storage.from("payment-qr").createSignedUrl(v.image_path, 3600);
    imageUrl = s.data?.signedUrl ?? null;
  }
  return { enabled: !!v.enabled && !!v.image_path, imagePath: v.image_path ?? null, imageUrl, recipient: v.recipient ?? null, instructions: v.instructions ?? null };
}

export async function availableMethods() {
  const kg = await getKgQrSettings();
  return {
    RAZORPAY: !!razorpayConfig(),
    KG_QR: false && kg.enabled, // hidden: Razorpay only for now
    TEST: (process.env["PAYMENT_TEST_MODE"] ?? "on") !== "off" && !!process.env["TEST_PAYMENT_WEBHOOK_SECRET"],
  };
}

export async function priceFor(currency: string) {
  const { data: product } = await db.from("products").select("id, name, required_for_publication").eq("code", "PUBLICATION_PROCESSING").single();
  if (!product) throw new Error("Publication product missing");
  const { data: price } = await db.from("product_prices").select("amount_minor, currency").eq("product_id", product.id).eq("currency", currency).eq("active", true).maybeSingle();
  if (!price) throw new Error(`No ${currency} price configured`);
  return { productId: product.id, productName: product.name, amountMinor: price.amount_minor, currency };
}

/** Starts (or resumes) a publication payment. Payment never affects the editorial decision: only ACCEPTED papers reach here. */
export async function startPublicationPayment(userId: string, paperId: string, method: PayMethod) {
  const methods = await availableMethods();
  if (!methods[method]) throw new Error("This payment method is not available yet");
  const { data: paper } = await db.from("papers").select("id, owner_id, status, public_id, title").eq("id", paperId).single();
  if (!paper || paper.owner_id !== userId) throw new Error("Paper not found");
  if (!["ACCEPTED", "PAYMENT_PENDING"].includes(paper.status)) throw new Error("Payment is only possible after acceptance");

  const currency = METHOD_CURRENCY[method];
  const price = await priceFor(currency);
  const { data: open } = await db.from("payments").select("*").eq("paper_id", paperId).in("status", ["PENDING", "PROCESSING"]);
  let payment = (open ?? []).find((p) => p.method === method && p.status === "PENDING") ?? null;
  if ((open ?? []).some((p) => p.status === "PROCESSING")) throw new Error("A payment is already awaiting verification");
  for (const p of open ?? []) {
    if (p.id !== payment?.id) {
      await db.from("payments").update({ status: "CANCELLED" }).eq("id", p.id).eq("status", "PENDING");
      await audit({ actor_id: userId, action: "payment_cancelled", resource_type: "payment", resource_id: p.id, metadata: { reason: "switched method" } });
    }
  }
  if (!payment) {
    const orderId = newOrderId();
    const ins = await db.from("payments").insert({
      order_id: orderId, user_id: userId, paper_id: paperId, product_id: price.productId, amount_minor: price.amountMinor, currency,
      provider: method === "RAZORPAY" ? "razorpay" : method === "KG_QR" ? "kg_qr_manual" : "test", method,
      idempotency_key: `${paperId}:${method}:${orderId}`,
    }).select("*").single();
    if (ins.error || !ins.data) throw new Error(ins.error?.message ?? "Could not create payment");
    payment = ins.data;
    await audit({ actor_id: userId, action: "payment_created", resource_type: "payment", resource_id: payment.id, new_value: { method, amount_minor: price.amountMinor, currency } });
  }
  if (paper.status === "ACCEPTED") await transition(paperId, "PAYMENT_PENDING", userId, "USER", `payment ${payment.order_id} started`);

  const base = { orderId: payment.order_id, amountMinor: payment.amount_minor, currency, method, paperTitle: paper.title, publicId: paper.public_id };
  if (method === "RAZORPAY") {
    const cfg = razorpayConfig()!;
    let rzOrder = payment.provider_order_id;
    if (!rzOrder) {
      const o = await createRazorpayOrder(cfg, { amountMinor: payment.amount_minor, currency, receipt: payment.order_id, notes: { order_id: payment.order_id, paper: paper.public_id } });
      rzOrder = o.id;
      await db.from("payments").update({ provider_order_id: rzOrder }).eq("id", payment.id);
    }
    return { ...base, razorpay: { keyId: cfg.keyId, orderId: rzOrder } };
  }
  if (method === "KG_QR") {
    const kg = await getKgQrSettings();
    return { ...base, kgQr: { imageUrl: kg.imageUrl, recipient: kg.recipient, instructions: kg.instructions } };
  }
  return { ...base, testUrl: `/pay/test/${payment.order_id}` };
}

/** Single place that applies a payment outcome and advances the paper. Idempotent via optimistic status checks. */
export async function finalizePayment(paymentId: string, target: Target, opts: { transactionId?: string | null; actorId?: string | null; actorType: "USER" | "SYSTEM" | "PROVIDER"; origin: string; note?: string }) {
  const { data: payment } = await db.from("payments").select("*").eq("id", paymentId).single();
  if (!payment) throw new Error("Payment not found");
  if (payment.status === target) return { changed: false };
  if (!canPaymentTransition(payment.status, target)) return { changed: false };
  const now = new Date().toISOString();
  const upd = await db.from("payments").update({
    status: target,
    provider_transaction_id: opts.transactionId ?? payment.provider_transaction_id,
    completed_at: target === "PAID" ? now : payment.completed_at,
    refunded_at: target === "REFUNDED" ? now : payment.refunded_at,
    ...(opts.actorType === "USER" && (target === "PAID" || target === "FAILED") ? { reviewed_by: opts.actorId ?? null, reviewed_at: now, review_note: opts.note ?? null } : {}),
  }).eq("id", payment.id).eq("status", payment.status).select("id");
  if (!upd.data?.length) return { changed: false }; // lost race
  await audit({ actor_id: opts.actorId ?? null, actor_type: opts.actorType, action: target === "PAID" ? "payment_completed" : `payment_${target.toLowerCase()}`, resource_type: "payment", resource_id: payment.id, old_value: { status: payment.status }, new_value: { status: target }, metadata: { method: payment.method, note: opts.note ?? null } });
  if (target !== "PROCESSING") {
    await notify(payment.user_id, `payment_${target.toLowerCase()}`, target === "PAID" ? "Payment received" : `Payment ${target.toLowerCase()}`, `Order ${payment.order_id}${opts.note ? ` — ${opts.note}` : ""}`, payment.paper_id ? `/my-research/${payment.paper_id}` : undefined);
  }
  if (payment.paper_id) {
    const st = await getStatus(payment.paper_id);
    if (target === "PAID" && st === "PAYMENT_PENDING") {
      await transition(payment.paper_id, "PAYMENT_COMPLETED", opts.actorId ?? null, opts.actorType, `payment ${payment.order_id}`);
      await transition(payment.paper_id, "PUBLICATION_PENDING", null, "SYSTEM", "payment completed");
      try { await publishPaper(payment.paper_id, null, opts.origin); }
      catch (e) { log("publication_after_payment_failed", { paper_id: payment.paper_id, error: e instanceof Error ? e.message : String(e) }); }
    } else if ((target === "FAILED" || target === "CANCELLED") && st === "PAYMENT_PENDING") {
      await transition(payment.paper_id, "ACCEPTED", null, "SYSTEM", `payment ${target.toLowerCase()}`);
    }
  }
  return { changed: true };
}

// ---------- Razorpay ----------
async function settleRazorpayPayment(rzPaymentId: string, origin: string) {
  const cfg = razorpayConfig();
  if (!cfg) throw new Error("Razorpay is not configured");
  let p = await fetchRazorpayPayment(cfg, rzPaymentId);
  const { data: payment } = await db.from("payments").select("*").eq("provider", "razorpay").eq("provider_order_id", p.order_id).maybeSingle();
  if (!payment) throw new Error("Unknown order");
  if (p.amount !== payment.amount_minor || p.currency !== payment.currency) {
    await audit({ actor_type: "PROVIDER", action: "payment_mismatch", resource_type: "payment", resource_id: payment.id, metadata: { expected: payment.amount_minor, got: p.amount, currency: p.currency } });
    throw new Error("Amount mismatch");
  }
  if (p.status === "authorized") p = await captureRazorpayPayment(cfg, p.id, payment.amount_minor, payment.currency);
  if (p.status === "captured") await finalizePayment(payment.id, "PAID", { transactionId: p.id, actorType: "PROVIDER", origin });
  else if (p.status === "failed") await finalizePayment(payment.id, "FAILED", { transactionId: p.id, actorType: "PROVIDER", origin });
  return { status: p.status, paymentId: payment.id };
}

/** Called after Checkout success. Signature is verified, then the payment is re-fetched from Razorpay (never trust the browser). */
export async function confirmRazorpayCheckout(userId: string, args: { orderId: string; paymentId: string; signature: string }, origin: string) {
  const cfg = razorpayConfig();
  if (!cfg) throw new Error("Razorpay is not configured");
  const { data: payment } = await db.from("payments").select("user_id").eq("provider", "razorpay").eq("provider_order_id", args.orderId).maybeSingle();
  if (!payment || payment.user_id !== userId) throw new Error("Payment not found");
  if (!(await verifyCheckoutSignature(cfg.keySecret, args.orderId, args.paymentId, args.signature))) {
    log("razorpay_checkout_bad_signature", { order: args.orderId });
    throw new Error("Payment signature could not be verified");
  }
  return settleRazorpayPayment(args.paymentId, origin);
}

export async function handleRazorpayWebhook(rawBody: string, headers: Headers, origin: string) {
  const cfg = razorpayConfig();
  if (!cfg?.webhookSecret) return { status: 503, body: "not configured" };
  const sig = headers.get("x-razorpay-signature") ?? "";
  if (!sig || !(await verifyWebhookSignature(cfg.webhookSecret, rawBody, sig))) {
    log("payment_webhook_rejected", { provider: "razorpay" });
    return { status: 401, body: "invalid signature" };
  }
  const evt = JSON.parse(rawBody) as { event: string; payload?: { payment?: { entity?: { id: string; order_id: string } } } };
  const eventId = headers.get("x-razorpay-event-id") ?? `${evt.event}:${evt.payload?.payment?.entity?.id ?? "?"}`;
  const entity = evt.payload?.payment?.entity;
  const { data: payment } = entity ? await db.from("payments").select("id").eq("provider", "razorpay").eq("provider_order_id", entity.order_id).maybeSingle() : { data: null };
  const ins = await db.from("payment_events").insert({
    payment_id: payment?.id ?? null, provider: "razorpay", provider_event_id: eventId, event_type: evt.event, signature_valid: true, payload: evt as never,
  }).select("id").single();
  if (ins.error) {
    if (ins.error.code === "23505") return { status: 200, body: "duplicate ignored" };
    throw new Error(ins.error.message);
  }
  if (entity && payment && ["payment.captured", "payment.authorized", "payment.failed", "order.paid"].includes(evt.event)) {
    try { await settleRazorpayPayment(entity.id, origin); }
    catch (e) { log("razorpay_webhook_settle_failed", { error: e instanceof Error ? e.message : String(e) }); }
  }
  await db.from("payment_events").update({ processed: true }).eq("id", ins.data.id);
  return { status: 200, body: "ok" };
}

// ---------- Kyrgyz QR (manual verification) ----------
export async function submitKgQrReference(userId: string, orderId: string, reference: string, origin: string) {
  const ref = reference.trim();
  if (ref.length < 4 || ref.length > 64) throw new Error("Enter the transaction number shown in your banking app");
  const { data: payment } = await db.from("payments").select("*").eq("order_id", orderId).single();
  if (!payment || payment.user_id !== userId || payment.method !== "KG_QR") throw new Error("Payment not found");
  if (payment.status !== "PENDING") throw new Error("This payment has already been submitted");
  const upd = await db.from("payments").update({ payer_reference: ref }).eq("id", payment.id).eq("status", "PENDING");
  if (upd.error) throw new Error(upd.error.code === "23505" ? "This transaction number was already used" : upd.error.message);
  await finalizePayment(payment.id, "PROCESSING", { actorId: userId, actorType: "USER", origin });
  const { data: admins } = await db.from("user_roles").select("user_id").in("role", ["payment_admin", "admin", "super_admin"]);
  for (const a of new Set((admins ?? []).map((r) => r.user_id))) {
    await notify(a, "payment_review", "Kyrgyz QR payment to verify", `Order ${payment.order_id}, reference ${ref}`, "/admin");
  }
}

export async function reviewKgQrPayment(actorId: string, paymentId: string, approve: boolean, note: string, origin: string) {
  const { data: payment } = await db.from("payments").select("method, status").eq("id", paymentId).single();
  if (!payment || payment.method !== "KG_QR" || payment.status !== "PROCESSING") throw new Error("Payment is not awaiting verification");
  if (!approve && note.trim().length < 5) throw new Error("Give a short reason for rejecting");
  await finalizePayment(paymentId, approve ? "PAID" : "FAILED", { actorId, actorType: "USER", origin, ...(note.trim() ? { note: note.trim() } : {}) });
}

// ---------- Simulated test provider (for trying the flow without real money) ----------
import { TestPaymentProvider } from "@/lib/domain/payment-provider";
export async function handleTestWebhook(rawBody: string, headers: Headers, origin: string) {
  const provider = new TestPaymentProvider(process.env["TEST_PAYMENT_WEBHOOK_SECRET"] ?? "");
  let evt;
  try { evt = await provider.verifyWebhook(rawBody, headers); } catch { return { status: 401, body: "invalid signature" }; }
  const { data: payment } = await db.from("payments").select("*").eq("order_id", evt.orderId).maybeSingle();
  const ins = await db.from("payment_events").insert({ payment_id: payment?.id ?? null, provider: "test", provider_event_id: evt.eventId, event_type: evt.type, signature_valid: true, payload: JSON.parse(rawBody) }).select("id").single();
  if (ins.error) return ins.error.code === "23505" ? { status: 200, body: "duplicate ignored" } : { status: 500, body: "error" };
  if (!payment) return { status: 404, body: "unknown order" };
  if (payment.amount_minor !== evt.amountMinor || payment.currency !== evt.currency) return { status: 400, body: "amount mismatch" };
  const target = ({ "payment.succeeded": "PAID", "payment.failed": "FAILED", "payment.refunded": "REFUNDED", "payment.cancelled": "CANCELLED" } as const)[evt.type];
  await finalizePayment(payment.id, target, { transactionId: evt.transactionId, actorType: "PROVIDER", origin });
  await db.from("payment_events").update({ processed: true }).eq("id", ins.data.id);
  return { status: 200, body: "ok" };
}

/** Test page action: signs a simulated provider event server-side and processes it. */
export async function simulateTestPayment(userId: string, orderId: string, outcome: "payment.succeeded" | "payment.failed", origin: string) {
  const { data: payment } = await db.from("payments").select("*").eq("order_id", orderId).single();
  if (!payment || payment.user_id !== userId || payment.method !== "TEST") throw new Error("Payment not found");
  const { signTestPayload } = await import("@/lib/domain/payment-provider");
  const body = JSON.stringify({ id: `evt_${crypto.randomUUID()}`, type: outcome, data: { order_id: orderId, transaction_id: `test_txn_${crypto.randomUUID().slice(0, 8)}`, amount_minor: payment.amount_minor, currency: payment.currency } });
  const t = Math.floor(Date.now() / 1000);
  const h = new Headers({ "x-test-signature": await signTestPayload(process.env["TEST_PAYMENT_WEBHOOK_SECRET"] ?? "", body, t) });
  return handleTestWebhook(body, h, origin);
}
