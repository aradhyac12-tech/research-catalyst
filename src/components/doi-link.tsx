import qrcode from "qrcode-generator";
import { doiHref, isSandboxDoi } from "@/lib/domain/zenodo";

/** The confirmed DOI as a clickable https://doi.org/<DOI> link with a QR code that resolves to the same address.
 *  Rendered only when a DOI is passed; callers pass the DOI only after Zenodo confirmed it. A Sandbox DOI is labelled as a test DOI. */
export function DoiLink({ doi, qr = true }: { doi: string; qr?: boolean }) {
  const href = doiHref(doi);
  const sandbox = isSandboxDoi(doi);
  let modules: boolean[][] = [];
  if (qr) { const q = qrcode(0, "M"); q.addData(href); q.make(); const n = q.getModuleCount(); modules = Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => q.isDark(r, c))); }
  const n = modules.length;
  return (
    <span className="flex flex-wrap items-start gap-3">
      <span className="min-w-0">
        <a className="link break-all" href={href} rel="noopener">{href}</a>
        {sandbox
          ? <span className="mt-1 block text-sm text-muted-foreground">Zenodo Sandbox test DOI: it does not resolve at doi.org.</span>
          : <span className="mt-1 block text-sm text-muted-foreground">Verified by Zenodo.</span>}
      </span>
      {qr && n > 0 && (
        <svg role="img" aria-label={`QR code for ${href}`} viewBox={`-2 -2 ${n + 4} ${n + 4}`} width={88} height={88} shapeRendering="crispEdges" className="shrink-0 bg-white">
          {modules.flatMap((row, r) => row.map((on, c) => (on ? <rect key={`${r}-${c}`} x={c} y={r} width={1} height={1} fill="#000" /> : null)))}
        </svg>
      )}
    </span>
  );
}
