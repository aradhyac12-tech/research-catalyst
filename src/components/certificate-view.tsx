import { useEffect, useMemo, useState } from "react";
import templateUrl from "@/assets/certificate-template.jpg";
import { CERT_H, CERT_W, CERTIFICATE_TITLES, layoutCertificate, type CertificateData, type Weight } from "@/lib/domain/certificate-layout";

const FAMILY = 'Lora, "Literata", Georgia, "Times New Roman", serif';

/** Measures text with the browser's own font engine (Lora once loaded), so the on-screen layout matches the PDF. */
function makeMeasure() {
  const ctx = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  return (text: string, size: number, weight: Weight) => {
    if (!ctx) return text.length * size * (weight === "bold" ? 0.56 : 0.5);
    ctx.font = `${weight === "bold" ? 700 : 400} ${size}px ${FAMILY}`;
    return ctx.measureText(text).width;
  };
}

/** The certificate exactly as issued: same template, same recorded details, same QR as the downloadable PDF. */
export function CertificateView({ data, className }: { data: CertificateData; className?: string }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    const done = () => { if (live) setReady(true); };
    if (typeof document !== "undefined" && document.fonts) {
      Promise.all([document.fonts.load(`400 24px ${FAMILY}`), document.fonts.load(`700 24px ${FAMILY}`)]).then(done, done);
    } else done();
    return () => { live = false; };
  }, []);

  const layout = useMemo(() => (ready ? layoutCertificate(data, makeMeasure()) : null), [ready, data]);
  const label = `${CERTIFICATE_TITLES[data.type]} ${data.certificateId}: ${data.recipientName}, ${data.paperTitle}`;

  if (!layout) return <div role="status" aria-label="Loading certificate" className={`aspect-[3/2] w-full animate-pulse bg-muted ${className ?? ""}`} />;
  return (
    <svg viewBox={`0 0 ${CERT_W} ${CERT_H}`} role="img" aria-label={label} className={`block h-auto w-full ${className ?? ""}`} xmlns="http://www.w3.org/2000/svg">
      <image href={templateUrl} x={0} y={0} width={CERT_W} height={CERT_H} />
      {layout.ops.map((op, i) => {
        if (op.kind === "text") {
          return <text key={i} x={op.x} y={op.y} fontSize={op.size} fontWeight={op.weight === "bold" ? 700 : 400} fill={op.color} textAnchor={op.anchor} fontFamily={FAMILY}>{op.text}</text>;
        }
        if (op.kind === "line") return <line key={i} x1={op.x1} y1={op.y1} x2={op.x2} y2={op.y2} stroke={op.color} strokeWidth={op.width} />;
        const n = op.modules.length, cell = op.size / (n + 8);
        let path = "";
        for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (op.modules[r]![c]) path += `M${(op.x + (c + 4) * cell).toFixed(2)} ${(op.y + (r + 4) * cell).toFixed(2)}h${cell.toFixed(2)}v${cell.toFixed(2)}h${(-cell).toFixed(2)}z`;
        return <g key={i}><rect x={op.x} y={op.y} width={op.size} height={op.size} fill={op.paper} /><path d={path} fill={op.ink} shapeRendering="crispEdges" /></g>;
      })}
    </svg>
  );
}
