import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { meQuery } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { fmtDate, money } from "@/lib/ui";

const KEY = "dues-prompt-dismissed";
const seen = () => { try { return sessionStorage.getItem(KEY) === "1"; } catch { return false; } };

/** Shown over signed-in pages to anyone with dues, with a Pay button that opens the payment page. Closing it hides it for this visit only. */
export function DuesPrompt() {
  const me = useQuery({ ...meQuery(), staleTime: 10_000 });
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);
  const dues = me.data?.dues;
  const items = dues?.items ?? [];
  const needs = items.length > 0 || !!dues?.hold;
  useEffect(() => { if (needs && !seen()) setOpen(true); if (!needs) setOpen(false); }, [needs]);
  if (!needs || !open || path.replace(/\/+$/, "") === "/dues") return null;
  const close = () => { try { sessionStorage.setItem(KEY, "1"); } catch { /* shown again next page load */ } setOpen(false); };
  const total = items.reduce<Record<string, number>>((a, d) => ({ ...a, [d.currency]: (a[d.currency] ?? 0) + d.amount_minor }), {});
  const overdue = items.some((d) => d.overdue);
  return (
    <DialogPrimitive.Root open onOpenChange={(o) => { if (!o) close(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-[rgb(16_32_64/0.55)] backdrop-blur-[3px]" />
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-[61] w-[calc(100vw-1.5rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-background p-6 shadow-lift outline-none sm:p-8">
          <DialogPrimitive.Title className="text-xl font-semibold">{overdue ? "Your dues are overdue" : "You have dues to pay"}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="mt-2 text-sm text-muted-foreground">
            {items.length > 0
              ? `${Object.entries(total).map(([c, m]) => money(m, c)).join(" + ")} is pending${items[0] ? `, ${items[0].overdue ? "was due" : "due"} ${fmtDate(items[0].due_at)}` : ""}. Paying clears it straight away.`
              : "An administrator has placed a dues hold on your account. Please contact them to clear it."}
          </DialogPrimitive.Description>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row">
            {items.length > 0 && <Button asChild size="lg" className="flex-1"><Link to="/dues" onClick={close}>Pay now</Link></Button>}
            <Button variant="outline" size="lg" className="flex-1" onClick={close}>Later</Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
