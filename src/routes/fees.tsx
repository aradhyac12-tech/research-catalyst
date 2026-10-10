import { createFileRoute, Link } from "@tanstack/react-router";
import { RouteError } from "@/components/route-error";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { getPublicFees } from "@/lib/identity.functions";
import { SUBMISSION_FEE_RETAINED_MINOR } from "@/lib/domain/fees";
import { PageTitle } from "@/lib/ui";

const q = queryOptions({ queryKey: ["public-fees"], queryFn: () => getPublicFees() });
const fmt = (minor: number, cur: string) => { try { return new Intl.NumberFormat("en", { style: "currency", currency: cur }).format(minor / 100); } catch { return `${(minor / 100).toFixed(2)} ${cur}`; } };

export const Route = createFileRoute("/fees")({
  loader: ({ context }) => context.queryClient.ensureQueryData(q),
  head: () => ({ meta: [{ title: "Fees | Paperly" }, { property: "og:title", content: "Fees | Paperly" }, { property: "og:description", content: "What Paperly charges, when, and what is free." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "description", content: "What Paperly charges, when, and what is free." }] }),
  errorComponent: ({ error, reset }) => <RouteError error={error} reset={reset} compact />,
  component: Fees,
});

function Fees() {
  const { data } = useSuspenseQuery(q);
  const payable = data.prices.filter((p) => p.payable);
  return (
    <div className="mx-auto max-w-3xl px-5 pt-10">
      <PageTitle title="Fees" subtitle="A submission fee is paid after upload. Screening starts once it is paid." />
      <section aria-labelledby="fee-h">
        <h2 id="fee-h" className="text-[1.25rem]">Submission fee</h2>
        <dl className="mt-3 grid gap-x-8 gap-y-3 sm:grid-cols-[12rem_1fr]">
          <dt className="text-muted-foreground">Amount</dt>
          <dd>{payable.length > 0 ? payable.map((p) => fmt(p.amount_minor, p.currency)).join(" or ") : "Online payment is not open at the moment, so no fee can currently be charged."}
            {data.prices.some((p) => !p.payable) && <span className="block text-sm text-muted-foreground">Prices also configured but not currently payable: {data.prices.filter((p) => !p.payable).map((p) => fmt(p.amount_minor, p.currency)).join(", ")}.</span>}</dd>
          <dt className="text-muted-foreground">When it is charged</dt><dd>Right after you upload your manuscript. Screening does not start until the fee is paid. Nothing further is charged if the work is accepted.</dd>
          <dt className="text-muted-foreground">What it covers</dt><dd>{data.product?.description ?? "Hosting, metadata preparation and a permanent article page for an accepted work."}</dd>
          <dt className="text-muted-foreground">If your work is rejected</dt><dd>{fmt(SUBMISSION_FEE_RETAINED_MINOR, "INR")} is kept for screening and editorial handling. The rest of the amount you paid is refunded to your original payment method.</dd>
          <dt className="text-muted-foreground">Does payment affect acceptance?</dt><dd>No. Editors decide on the manuscript. The fee is not a criterion, and a rejected paper gets the refund described above.</dd>
          <dt className="text-muted-foreground">Taxes</dt><dd>Paperly adds no tax to the amount shown. The payment provider or your bank may show its own charges or currency conversion.</dd>
          <dt className="text-muted-foreground">Refunds</dt><dd>{data.product?.refund_policy ?? "Full refund if publication does not occur for platform reasons."}</dd>
          <dt className="text-muted-foreground">Waivers</dt><dd>There is no fee waiver programme. A promo code, if you have one, reduces the amount at checkout.</dd>
          <dt className="text-muted-foreground">DOI</dt><dd>Paperly does not currently register DOIs. A record shows a DOI only once one has actually been registered and confirmed.</dd>
        </dl>
      </section>
      <p className="mt-10 text-sm text-muted-foreground">See also the <Link to="/policies/$slug" params={{ slug: "editorial-policy" }} className="link">editorial policy</Link>.</p>
    </div>
  );
}
