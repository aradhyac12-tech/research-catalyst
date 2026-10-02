// Razorpay (India) helpers: UPI, Visa/Mastercard/RuPay cards, netbanking via hosted Checkout.
// Paperly never sees card numbers or UPI PINs; Razorpay Checkout collects them.
export async function hmacSha256Hex(secret: string, message: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** Checkout callback signature: HMAC_SHA256(order_id + "|" + payment_id, key_secret). */
export async function verifyCheckoutSignature(keySecret: string, orderId: string, paymentId: string, signature: string) {
  return safeEqual(await hmacSha256Hex(keySecret, `${orderId}|${paymentId}`), signature);
}

/** Webhook signature: HMAC_SHA256(raw body, webhook secret) in X-Razorpay-Signature. */
export async function verifyWebhookSignature(webhookSecret: string, rawBody: string, signature: string) {
  return safeEqual(await hmacSha256Hex(webhookSecret, rawBody), signature);
}

export interface RazorpayConfig { keyId: string; keySecret: string; webhookSecret: string }

export function razorpayConfig(): RazorpayConfig | null {
  const keyId = process.env["RAZORPAY_KEY_ID"] ?? "";
  const keySecret = process.env["RAZORPAY_KEY_SECRET"] ?? "";
  const webhookSecret = process.env["RAZORPAY_WEBHOOK_SECRET"] ?? "";
  if (!keyId || !keySecret) return null;
  return { keyId, keySecret, webhookSecret };
}

async function rzp<T>(cfg: RazorpayConfig, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Basic ${btoa(`${cfg.keyId}:${cfg.keySecret}`)}`, ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Razorpay ${res.status}: ${(body as { error?: { description?: string } }).error?.description ?? "request failed"}`);
  return body as T;
}

export function createRazorpayOrder(cfg: RazorpayConfig, args: { amountMinor: number; currency: string; receipt: string; notes: Record<string, string> }) {
  return rzp<{ id: string; amount: number; currency: string; status: string }>(cfg, "/orders", {
    method: "POST", body: JSON.stringify({ amount: args.amountMinor, currency: args.currency, receipt: args.receipt.slice(0, 40), notes: args.notes }),
  });
}

export interface RazorpayPayment { id: string; order_id: string; amount: number; currency: string; status: string; method: string }
export function fetchRazorpayPayment(cfg: RazorpayConfig, paymentId: string) {
  return rzp<RazorpayPayment>(cfg, `/payments/${encodeURIComponent(paymentId)}`);
}
export function captureRazorpayPayment(cfg: RazorpayConfig, paymentId: string, amountMinor: number, currency: string) {
  return rzp<RazorpayPayment>(cfg, `/payments/${encodeURIComponent(paymentId)}/capture`, { method: "POST", body: JSON.stringify({ amount: amountMinor, currency }) });
}
