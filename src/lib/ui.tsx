import { STATUS_LABEL } from "@/lib/domain/constants";
import { Badge } from "@/components/ui/badge";

export function StatusBadge({ status }: { status: string }) {
  const tone = ["PUBLISHED", "CORRECTED", "ACCEPTED", "PAID"].includes(status) ? "default"
    : ["REJECTED", "RETRACTED", "FAILED"].includes(status) ? "destructive" : "secondary";
  return <Badge variant={tone as "default"}>{STATUS_LABEL[status] ?? status}</Badge>;
}

export function money(minor: number, currency: string) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency }).format(minor / 100);
}

export function fmtDate(d: string | null | undefined) {
  return d ? new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "numeric" }) : "\u2014";
}

export function PageTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-9">
      <h1 className="font-serif text-[2rem] font-medium leading-tight tracking-tight text-foreground md:text-[2.5rem]">{title}</h1>
      {subtitle && <p className="mt-2.5 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">{subtitle}</p>}
    </div>
  );
}
