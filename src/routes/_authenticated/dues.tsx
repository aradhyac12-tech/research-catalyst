import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getMyDues, startDuesPayment, confirmRazorpay } from "@/lib/app.functions";
import { meQuery } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { PageTitle, fmtDate, money, PageLoading } from "@/lib/ui";

export const Route = createFileRoute("/_authenticated/dues")({
  head: () => ({ meta: [{ title: "Pay dues | Paperly" }, { name: "robots", content: "noindex" }] }),
  component: Dues,
});

function loadCheckout(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (window.Razorpay) return Promise.resolve(true);
  return new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js"; s.async = true;
    s.onload = () => resolve(true); s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

function Dues() {
  const qc = useQueryClient();
  const me = useQuery({ ...meQuery(), staleTime: 30_000 });
  const q = useQuery({ queryKey: ["my-dues"], queryFn: () => getMyDues(), retry: false, staleTime: 0, refetchOnMount: "always" });
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { void loadCheckout(); }, []);
  const profile = me.data?.profile as { email?: string | null; display_name?: string | null } | null | undefined;

  const refresh = async () => {
    await Promise.all([qc.invalidateQueries({ queryKey: ["my-dues"] }), qc.invalidateQueries({ queryKey: ["me"] }), qc.invalidateQueries({ queryKey: ["founder-hold"] }), qc.invalidateQueries({ queryKey: ["founder-summary"] })]);
  };

  async function pay(id: string) {
    setBusy(id);
    try {
      const [ok, order] = await Promise.all([loadCheckout(), startDuesPayment({ data: { deferralId: id } })]);
      if (!ok || !window.Razorpay) throw new Error("Could not load the payment window. Check your connection and try again.");
      const checkout = new window.Razorpay({
        key: order.razorpay.keyId, order_id: order.razorpay.orderId, amount: order.amountMinor, currency: order.currency,
        name: "Paperly", description: `Dues · ${order.orderId}`,
        prefill: { name: profile?.display_name ?? undefined, email: profile?.email ?? undefined },
        theme: { color: "#243b63" },
        modal: { ondismiss: () => setBusy(null) },
        handler: async (r: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
          try {
            await confirmRazorpay({ data: { orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature } });
            toast.success("Payment received. Your due is cleared.");
            await refresh();
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "We could not confirm the payment. If you were charged, it will be reconciled automatically.");
            await refresh();
          } finally { setBusy(null); }
        },
      });
      checkout.on("payment.failed", () => { toast.error("The payment did not go through. You have not been charged for this attempt."); setBusy(null); });
      checkout.open();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start payment");
      setBusy(null);
    }
  }

  if (q.isLoading) return <PageLoading />;
  if (q.isError || !q.data) return <div role="alert" className="mx-auto max-w-2xl px-5 pt-10">Your dues could not be loaded. Refresh to try again.</div>;
  const { items, hold } = q.data;
  const clear = items.length === 0 && !hold;
  return (
    <div className="content-enter mx-auto w-full max-w-2xl px-4 pb-16 pt-10 sm:px-5">
      <PageTitle title="Pay dues" />
      {clear && (
        <div role="status" className="mt-6 space-y-3 border border-border p-5">
          <p className="text-lg font-semibold">You have no dues</p>
          <p className="text-muted-foreground">Everything on your account is cleared.</p>
          <Button asChild><Link to="/dashboard">Go to dashboard</Link></Button>
        </div>
      )}
      {items.length > 0 && (
        <ul className="mt-6 space-y-3">
          {items.map((d) => (
            <li key={d.id} className={`border p-5 ${d.overdue ? "border-destructive/40 bg-destructive/5" : "border-border"}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-2xl font-semibold tabular-nums">{money(d.amount_minor, d.currency)}</span>
                <span className={`text-sm ${d.overdue ? "font-medium text-destructive" : "text-muted-foreground"}`}>{d.overdue ? "Overdue, was due " : "Due "}{fmtDate(d.due_at)}</span>
              </div>
              {d.note && <p className="mt-2 text-sm text-muted-foreground">{d.note}</p>}
              <Button className="mt-4 w-full sm:w-auto" size="lg" disabled={busy !== null} aria-busy={busy === d.id} onClick={() => void pay(d.id)}>
                {busy === d.id ? "Opening secure checkout…" : `Pay ${money(d.amount_minor, d.currency)}`}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {hold && (
        <div role="alert" className="mt-6 space-y-2 border border-destructive/40 bg-destructive/5 p-5">
          <p className="font-semibold">An administrator has placed a dues hold on your account</p>
          {hold.note && <p className="border-l-2 border-border pl-3 text-sm">{hold.note}</p>}
          <p className="text-sm text-muted-foreground">This one has no online amount. Please contact an administrator to clear it.</p>
        </div>
      )}
    </div>
  );
}
