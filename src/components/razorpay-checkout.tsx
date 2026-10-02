import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { startPayment, confirmRazorpay } from "@/lib/app.functions";
import { money } from "@/lib/ui";

declare global {
  interface Window { Razorpay?: new (o: Record<string, unknown>) => { open(): void; on(e: string, cb: (r: unknown) => void): void } }
}

function loadCheckout(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (window.Razorpay) return Promise.resolve(true);
  return new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.async = true;
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

export function RazorpayPay({ paperId, amountMinor, currency, email, name, onPaid }: {
  paperId: string; amountMinor: number; currency: string; email?: string | null | undefined; name?: string | null | undefined; onPaid: () => void;
}) {
  const [busy, setBusy] = useState(false);
  useEffect(() => { void loadCheckout(); }, []); // load the Razorpay script ahead of the click

  async function pay() {
    setBusy(true);
    try {
      const [ok, order] = await Promise.all([loadCheckout(), startPayment({ data: { paperId, method: "RAZORPAY" } })]);
      if (!ok) throw new Error("Could not load the payment window. Check your connection and try again.");
      const rz = (order as { razorpay?: { keyId: string; orderId: string } }).razorpay;
      if (!rz || !window.Razorpay) throw new Error("Payments are not available right now.");
      const checkout = new window.Razorpay({
        key: rz.keyId,
        order_id: rz.orderId,
        amount: order.amountMinor,
        currency: order.currency,
        name: "Paperly",
        description: `Publication processing · ${order.publicId}`,
        prefill: { name: name ?? undefined, email: email ?? undefined },
        theme: { color: "#243b63" },
        modal: { ondismiss: () => setBusy(false) },
        handler: async (r: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
          try {
            await confirmRazorpay({ data: { orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature } });
            toast.success("Payment received. Your work is being published.");
            onPaid();
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "We could not confirm the payment. If you were charged, it will be reconciled automatically.");
          } finally { setBusy(false); }
        },
      });
      checkout.on("payment.failed", () => { toast.error("The payment did not go through. You have not been charged for this attempt."); setBusy(false); });
      checkout.open();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start payment");
      setBusy(false);
    }
  }

  return (
    <Button onClick={pay} disabled={busy} size="lg" className="w-full sm:w-auto">
      {busy ? "Opening secure checkout…" : `Pay ${money(amountMinor, currency)}`}
    </Button>
  );
}
