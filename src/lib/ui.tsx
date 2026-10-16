import { Skeleton } from "@/components/ui/skeleton";
import { STATUS_LABEL } from "@/lib/domain/constants";
import { Badge } from "@/components/ui/badge";

export function StatusBadge({ status }: { status: string }) {
  const tone = ["PUBLISHED", "CORRECTED", "ACCEPTED", "PAID"].includes(status) ? "default"
    : ["REJECTED", "RETRACTED", "FAILED"].includes(status) ? "destructive"
    : ["REVIEW_REQUIRED", "REVISION_REQUIRED", "PAYMENT_PENDING", "PENDING", "REVIEWER_ASSIGNMENT", "PEER_REVIEW", "EDITORIAL_DECISION"].includes(status) ? "caution" : "secondary";
  return <Badge variant={tone as "default"}>{STATUS_LABEL[status] ?? status}</Badge>;
}

export function money(minor: number, currency: string) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency }).format(minor / 100);
}

export function fmtDate(d: string | null | undefined) {
  return d ? new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }) : "\u2014";
}

export function PageTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-8">
      <h1 className="text-[clamp(1.75rem,1.3rem+1.6vw,2.4rem)] text-foreground">{title}</h1>
      {subtitle && <p className="mt-3 max-w-[60ch] text-lg leading-relaxed text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

/** Label and value pairs separated by rules, used instead of boxed cards. */
export function Facts({ items }: { items: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="divide-y divide-border border-y border-border text-[15px]">
      {items.map(([k, v]) => (
        <div key={k} className="grid grid-cols-[6.75rem_1fr] gap-3 py-2.5"><dt className="text-muted-foreground">{k}</dt><dd className="min-w-0 break-words">{v}</dd></div>
      ))}
    </dl>
  );
}

/** A calm placeholder while a whole page loads. */
export function PageLoading() {
  return (
    <div role="status" aria-label="Loading" className="mx-auto max-w-5xl px-5 pt-10">
      <Skeleton className="h-9 w-56" /><Skeleton className="mt-3 h-5 w-80 max-w-full" />
      <div className="mt-10 space-y-4"><Skeleton className="h-20 rounded-xl" /><Skeleton className="h-20 rounded-xl" /><Skeleton className="h-20 rounded-xl" /></div>
    </div>
  );
}
