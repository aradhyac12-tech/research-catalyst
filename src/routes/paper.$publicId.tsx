import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { getPublicPaper } from "@/lib/app.functions";

// Legacy RP- links keep working: they forward to the canonical /article/PLY-… URL.
export const Route = createFileRoute("/paper/$publicId")({
  loader: async ({ params }) => {
    const p = await getPublicPaper({ data: { publicId: params.publicId } });
    if (!p) throw notFound();
    throw redirect({ to: "/article/$paperlyId", params: { paperlyId: p.paperly_id }, statusCode: 301 });
  },
  notFoundComponent: () => <div className="mx-auto max-w-3xl p-10">This record is not public.</div>,
});
