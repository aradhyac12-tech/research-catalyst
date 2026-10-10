import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

// Certificates issued before M-5 carry a QR code pointing here; keep them working.
export const Route = createFileRoute("/verify_/$certId")({
  validateSearch: z.object({ t: z.string().optional() }),
  beforeLoad: ({ params, search }) => { throw redirect({ to: "/verify/certificate/$certId", params: { certId: params.certId }, search: { t: search.t }, replace: true }); },
});
