import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { getMyOrcid, orcidConnectUrl } from "@/lib/app.functions";
import { Button } from "@/components/ui/button";
import { PageTitle, fmtDate } from "@/lib/ui";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({ meta: [{ title: "Profile | Paperly" }, { name: "description", content: "Paperly research records, submissions and verification." }, { property: "og:title", content: "Profile | Paperly" }, { property: "og:description", content: "Paperly research records, submissions and verification." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" }] }),
  component: Profile,
});

function Profile() {
  const { data, isLoading } = useQuery({ queryKey: ["my-orcid"], queryFn: () => getMyOrcid() });
  const [busy, setBusy] = useState(false);
  async function connect() {
    setBusy(true);
    try { const r = await orcidConnectUrl(); window.location.assign(r.url); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not start ORCID sign-in"); setBusy(false); }
  }
  return (
    <div className="mx-auto max-w-3xl px-5 pt-10">
      <PageTitle title="Profile" subtitle="Your researcher identity on Paperly." />
      <section className="space-y-3 border-t-2 border-foreground pt-6">
        <h2 className="text-[1.25rem]">ORCID iD</h2>
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {data?.verified && (
          <p className="text-[15px]">Verified: <a className="link tabular-nums" href={`https://orcid.org/${data.verified.orcid}`} rel="noopener">{data.verified.orcid}</a>, confirmed through ORCID sign-in on {fmtDate(data.verified.verified_at)}.</p>
        )}
        {data && !data.verified && (
          <>
            <p className="max-w-[62ch] text-[15px] text-muted-foreground">An ORCID iD is only shown as verified after you sign in to ORCID and approve the link. Typing an iD is not enough, and nobody can claim an iD that belongs to someone else.</p>
            {data.configured
              ? <Button onClick={connect} disabled={busy}>{busy ? "Opening ORCID…" : "Connect your ORCID iD"}</Button>
              : <p role="status" className="border-l-4 border-border bg-wash px-3 py-2 text-sm">ORCID sign-in is not configured on this site yet.</p>}
            {data.configured && data.sandbox && <p className="text-xs text-muted-foreground">This site is connected to the ORCID sandbox for testing. Sandbox iDs are not real researcher records.</p>}
          </>
        )}
      </section>
    </div>
  );
}
