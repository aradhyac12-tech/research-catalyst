import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getPublicFullText } from "@/lib/app.functions";

/** The whole article as uploaded, shown on the page: Word files as converted HTML, PDFs rendered page by page in the browser. */
export function FullText({ paperlyId, publicId, version }: { paperlyId: string; publicId: string; version: string }) {
  const { data, isLoading, isError } = useQuery({ queryKey: ["paper-fulltext", publicId, version], queryFn: () => getPublicFullText({ data: { publicId } }), staleTime: 5 * 60_000 });
  return (
    <section className="mt-12" aria-labelledby="ft-h">
      <h2 id="ft-h" className="text-[1.25rem]">Full text</h2>
      {isLoading && <p className="mt-3 text-sm text-muted-foreground" role="status">Loading the full text{"…"}</p>}
      {(isError || data?.kind === "none") && <p className="mt-3 text-sm text-muted-foreground">The full text could not be displayed on this page.</p>}
      {data?.kind === "html" && (
        <>
          <div className="fulltext prose-article mt-4" dangerouslySetInnerHTML={{ __html: data.html }} />
          {data.truncated && <p className="mt-4 text-sm text-muted-foreground">This record is very long, so the page shows only its first part.</p>}
        </>
      )}
      {data?.kind === "pdf" && (
        <>
          <PdfPages url={`/article/${paperlyId}/pdf`} />
          <p className="mt-4 text-sm"><a className="link font-semibold" href={`/article/${paperlyId}/pdf`}>Open or download the PDF</a></p>
        </>
      )}
    </section>
  );
}

function PdfPages({ url }: { url: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<number | null>(null);
  const [doc, setDoc] = useState<import("pdfjs-dist").PDFDocumentProxy | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let dead = false;
    let loaded: import("pdfjs-dist").PDFDocumentProxy | null = null;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
        pdfjs.GlobalWorkerOptions.workerSrc = worker;
        loaded = await pdfjs.getDocument({ url, isEvalSupported: false }).promise;
        if (dead) { void loaded.destroy(); return; }
        setDoc(loaded); setPages(loaded.numPages);
      } catch { if (!dead) setFailed(true); }
    })();
    return () => { dead = true; if (loaded) void loaded.destroy(); };
  }, [url]);
  if (failed) return <p className="mt-3 text-sm text-muted-foreground">The PDF could not be shown inline. <a className="link" href={url}>Open it directly</a>.</p>;
  if (!doc || !pages) return <p className="mt-3 text-sm text-muted-foreground" role="status">Loading the PDF{"…"}</p>;
  return (
    <div ref={wrap} className="mt-4 flex flex-col gap-4">
      {Array.from({ length: pages }, (_, i) => <PdfPage key={i} doc={doc} n={i + 1} total={pages} />)}
    </div>
  );
}

function PdfPage({ doc, n, total }: { doc: import("pdfjs-dist").PDFDocumentProxy; n: number; total: number }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ratio, setRatio] = useState(1.414);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); } }, { rootMargin: "800px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!seen) return;
    let task: { cancel: () => void } | null = null;
    let dead = false;
    (async () => {
      const page = await doc.getPage(n);
      const w = box.current?.clientWidth ?? 800;
      const base = page.getViewport({ scale: 1 });
      const scale = w / base.width;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const vp = page.getViewport({ scale: scale * dpr });
      const c = canvas.current;
      if (!c || dead) return;
      c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
      setRatio(base.height / base.width);
      const r = page.render({ canvasContext: c.getContext("2d")!, viewport: vp });
      task = r;
      try { await r.promise; } catch { /* cancelled */ }
    })();
    return () => { dead = true; task?.cancel(); };
  }, [seen, doc, n]);
  return (
    <div ref={box} className="w-full max-w-[56rem] border border-border bg-white" style={{ aspectRatio: `1 / ${ratio}` }}>
      <canvas ref={canvas} className="block h-full w-full" role="img" aria-label={`Page ${n} of ${total}`} />
    </div>
  );
}
