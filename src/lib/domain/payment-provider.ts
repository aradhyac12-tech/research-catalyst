// PaymentProvider abstraction. No card data ever touches Paperly: providers use hosted pages.
export interface CheckoutRequest { orderId: string; amountMinor: number; currency: string; description: string; returnUrl: string }
export interface CheckoutSession { redirectUrl: string; providerSessionId: string }
export interface VerifiedEvent {
  eventId: string;
  type: "payment.succeeded" | "payment.failed" | "payment.refunded" | "payment.cancelled";
  orderId: string;
  transactionId: string;
  amountMinor: number;
  currency: string;
}

export interface PaymentProvider {
  readonly name: string;
  readonly isTestMode: boolean;
  createCheckout(req: CheckoutRequest): Promise<CheckoutSession>;
  /** Verify signature and parse. Throws on invalid signature / stale timestamp. */
  verifyWebhook(rawBody: string, headers: Headers): Promise<VerifiedEvent>;
}

async function hmacHex(secret: string, message: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function timingSafeEqualHex(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const WEBHOOK_TOLERANCE_SECONDS = 300;

/** Signs a payload the way the simulated provider does. Exported for tests and the test hosted page. */
export async function signTestPayload(secret: string, body: string, timestamp: number) {
  return `t=${timestamp},v1=${await hmacHex(secret, `${timestamp}.${body}`)}`;
}

export class TestPaymentProvider implements PaymentProvider {
  readonly name = "test";
  readonly isTestMode = true;
  constructor(private secret: string, private now: () => number = () => Math.floor(Date.now() / 1000)) {
    if (!secret) throw new Error("TEST_PAYMENT_WEBHOOK_SECRET is not configured");
  }
  async createCheckout(req: CheckoutRequest): Promise<CheckoutSession> {
    return { redirectUrl: `/pay/test/${encodeURIComponent(req.orderId)}`, providerSessionId: `test_sess_${req.orderId}` };
  }
  async verifyWebhook(rawBody: string, headers: Headers): Promise<VerifiedEvent> {
    const header = headers.get("x-test-signature") ?? "";
    const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=") as [string, string]));
    const t = Number(parts["t"]);
    if (!parts["v1"] || !Number.isFinite(t)) throw new Error("Missing signature");
    if (Math.abs(this.now() - t) > WEBHOOK_TOLERANCE_SECONDS) throw new Error("Stale webhook timestamp");
    const expected = await hmacHex(this.secret, `${t}.${rawBody}`);
    if (!timingSafeEqualHex(expected, parts["v1"])) throw new Error("Invalid signature");
    const p = JSON.parse(rawBody);
    const allowed = ["payment.succeeded", "payment.failed", "payment.refunded", "payment.cancelled"];
    if (!allowed.includes(p.type)) throw new Error("Unknown event type");
    return {
      eventId: String(p.id), type: p.type, orderId: String(p.data.order_id), transactionId: String(p.data.transaction_id),
      amountMinor: Number(p.data.amount_minor), currency: String(p.data.currency),
    };
  }
}

/** Placeholder for a Kyrgyzstan acquiring bank integration; intentionally unimplemented. */
export class UnconfiguredProvider implements PaymentProvider {
  readonly isTestMode = false;
  constructor(readonly name: string) {}
  async createCheckout(): Promise<CheckoutSession> { throw new Error(`Payment provider "${this.name}" is not configured`); }
  async verifyWebhook(): Promise<VerifiedEvent> { throw new Error(`Payment provider "${this.name}" is not configured`); }
}

export const PAYMENT_TRANSITIONS: Record<string, string[]> = {
  PENDING: ["PROCESSING", "PAID", "FAILED", "CANCELLED"],
  PROCESSING: ["PAID", "FAILED", "CANCELLED"],
  PAID: ["REFUNDED"],
  FAILED: [],
  REFUNDED: [],
  CANCELLED: [],
};
export function canPaymentTransition(from: string, to: string) {
  return PAYMENT_TRANSITIONS[from]?.includes(to) ?? false;
}
