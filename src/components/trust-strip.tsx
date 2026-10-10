import { useQuery } from "@tanstack/react-query";
import { BadgeCheck } from "lucide-react";
import { getTrustStatus } from "@/lib/identity.functions";

/** Public identity badges. Everything here is read from the live configuration, nothing is typed by hand:
 *  ORCID shows when the server has the ORCID keys, ISSN numbers show once an administrator has confirmed them. */
export function TrustStrip({ className = "" }: { className?: string }) {
  const { data } = useQuery({ queryKey: ["trust-status"], queryFn: () => getTrustStatus(), staleTime: 5 * 60_000 });
  if (!data) return null;
  const items: Array<{ label: string; value: string }> = [];
  if (data.orcidLive) items.push({ label: "ORCID", value: data.orcidSandbox ? "iD sign-in (test mode)" : "iD verification enabled" });
  if (data.issn) items.push({ label: "ISSN (print)", value: data.issn });
  if (data.eissn) items.push({ label: "ISSN (online)", value: data.eissn });
  if (items.length === 0) return null;
  return (
    <ul aria-label="Journal identifiers" className={`flex flex-wrap gap-2 ${className}`}>
      {items.map((i) => (
        <li key={i.label} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-[13px] shadow-sm">
          <BadgeCheck className="size-4 text-primary" aria-hidden="true" />
          <span className="text-muted-foreground">{i.label}</span>
          <span className="font-medium tabular-nums">{i.value}</span>
        </li>
      ))}
    </ul>
  );
}
