import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getPublicFullText } from "@/lib/app.functions";
import { prepareReader } from "@/lib/reader";

type Size = 0 | 1 | 2;
const SIZE_REM = ["1rem", "1.125rem", "1.25rem"] as const;
const SIZE_KEY = "paperly-reader-size";

/** The whole article as uploaded, laid out for reading: Word files and the text of PDFs become organised sections with a contents list;
 *  the original PDF pages stay one tab away so figures, tables and layout are never lost. */
export function FullText({ paperlyId, publicId, version }: { paperlyId: string; publicId: string; version: string }) {
  const { data, isLoading, isError } = useQuery({ queryKey: ["paper-fulltext", publicId, version], queryFn: () => getPublicFullText({ data: { publicId } }), staleTime: 5 * 60_000 });
  const html = data?.kind === "html" ? data.html : data?.kind === "pdf" ? data.html : null;
  const doc = useMemo(() => (html ? prepareReader(html) : null), [html]);
  const isPdf = data?.kind === "pdf";
  const [tab, setTab] = useState<"read" | "pdf">("read");
  const [size, setSize] = useState<Size>(1);
  useEffect(() => { try { const s = Number(localStorage.getItem(SIZE_KEY)); if (s === 0 || s === 1 || s === 2) setSize(s); } catch { /* storage unavailable */ } }, []);
  const pick = (s: Size) => { setSize(s); try { localStorage.setItem(SIZE_KEY, String(s)); } catch { /* storage unavailable */ } };
  const showPdf = isPdf && (tab === "pdf" || !doc);

  return (
    <section className="mt-12 min-w-0 sm:mt-16" aria-labelledby="ft-h">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-border pb-4">
        <div>
          <p className="flex items-center gap-3 text-[13px] font-semibold uppercase tracking-[0.14em] text-gold"><span aria-hidden="true" className="h-px w-7 bg-gold" />Read online</p>
          <h2 id="ft-h" className="mt-2 text-[1.625rem] sm:text-[1.875rem]">Full text</h2>
        </div>
        {doc && <p className="text-sm text-muted-foreground"><span className="tabular-nums">{doc.minutes}</span> min read <span aria-hidden="true">·</span> <span className="tabular-nums">{doc.words.toLocaleString("en-GB")}</span> words{doc.toc.length > 2 && <> <span aria-hidden="true">·</span> <span className="tabular-nums">{doc.toc.length}</span> sections</>}</p>}
      </div>

      {isLoading && <ReaderSkeleton />}
      {(isError || data?.kind === "none") && <p className="mt-5 rounded-xl border border-border bg-wash px-4 py-3 text-sm text-muted-foreground">The full text could not be displayed on this page.</p>}

      {(doc || isPdf) && (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          {isPdf && doc ? (
            <div role="tablist" aria-label="Full text view" className="inline-flex rounded-full border border-border bg-wash p-1 text-sm">
              {([["read", "Reading view"], ["pdf", "Original PDF"]] as const).map(([k, label]) => (
                <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`min-h-9 rounded-full px-4 font-medium transition-colors duration-200 ${tab === k ? "bg-background text-primary shadow-soft" : "text-muted-foreground hover:text-foreground"}`}>{label}</button>
              ))}
            </div>
          ) : <span />}
          <div className="flex items-center gap-2">
            {doc && !showPdf && (
              <div role="group" aria-label="Text size" className="inline-flex items-center overflow-hidden rounded-full border border-border text-sm">
                <button onClick={() => pick(Math.max(0, size - 1) as Size)} disabled={size === 0} aria-label="Smaller text" className="min-h-9 px-3.5 font-serif text-[13px] transition-colors hover:bg-wash disabled:opacity-40">A</button>
                <span aria-hidden="true" className="h-5 w-px bg-border" />
                <button onClick={() => pick(Math.min(2, size + 1) as Size)} disabled={size === 2} aria-label="Larger text" className="min-h-9 px-3.5 font-serif text-[18px] leading-none transition-colors hover:bg-wash disabled:opacity-40">A</button>
              </div>
            )}
            {isPdf && <a className="inline-flex min-h-9 items-center rounded-full border border-border px-4 text-sm font-medium transition-colors hover:bg-wash" href={`/article/${paperlyId}/pdf`} download={`${paperlyId}.pdf`}>Download PDF</a>}
          </div>
        </div>
      )}

      {doc && !showPdf && (
        <>
          {doc.toc.length > 2 && <Contents toc={doc.toc} />}
          <div className="reader-sheet mt-6">
            <div className="reader fulltext prose-article" style={{ fontSize: SIZE_REM[size] }} dangerouslySetInnerHTML={{ __html: doc.html }} />
            <p aria-hidden="true" className="mt-10 text-center text-gold tracking-[0.6em]">{"❦"}</p>
          </div>
          {data?.kind === "html" && data.truncated && <p className="mt-4 text-sm text-muted-foreground">This record is very long, so the page shows only its first part.</p>}
          {isPdf && <p className="mt-4 text-sm text-muted-foreground">This reading view is the text of the PDF, set out for the screen. Tables, figures and equations are best read in the <button onClick={() => setTab("pdf")} className="link">original PDF</button>.</p>}
        </>
      )}
      {showPdf && <PdfPages url={`/article/${paperlyId}/pdf`} />}
    </section>
  );
}

function Contents({ toc }: { toc: Array<{ id: string; text: string; level: number }> }) {
  return (
    <nav aria-label="In this article" className="mt-6 rounded-2xl border border-border bg-wash/70 p-5 sm:p-6">
      <h3 className="font-sans text-[13px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">In this article</h3>
      <ol className="mt-3 grid list-none gap-x-8 gap-y-1 sm:grid-cols-2">
        {toc.slice(0, 40).map((t) => (
          <li key={t.id} className={t.level > 4 ? "pl-4" : ""}>
            <a href={`#${t.id}`} className={`block rounded-md py-1.5 text-[15px] leading-snug no-underline transition-colors hover:text-primary ${t.level > 4 ? "text-muted-foreground" : "font-medium"}`}>{t.text}</a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function ReaderSkeleton() {
  return (
    <div role="status" aria-label="Loading the full text" className="reader-sheet mt-6 space-y-3">
      <div className="skeleton-shimmer h-7 w-1/3 rounded" />
      {[100, 96, 99, 90, 97, 60].map((w, i) => <div key={i} className="skeleton-shimmer h-4 rounded" style={{ width: `${w}%` }} />)}
      <div className="skeleton-shimmer mt-6 h-7 w-1/4 rounded" />
      {[98, 94, 100, 70].map((w, i) => <div key={i} className="skeleton-shimmer h-4 rounded" style={{ width: `${w}%` }} />)}
    </div>
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
  if (failed) return <p className="mt-5 text-sm text-muted-foreground">The PDF could not be shown inline. <a className="link" href={url}>Open it directly</a>.</p>;
  if (!doc || !pages) return <p className="mt-5 text-sm text-muted-foreground" role="status">Loading the PDF{"…"}</p>;
  return (
    <div ref={wrap} className="mt-6 flex flex-col items-center gap-6 rounded-2xl bg-wash p-3 sm:p-6">
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
    <figure className="w-full max-w-[56rem]">
      <div ref={box} className="w-full overflow-hidden rounded-sm bg-white shadow-lift ring-1 ring-black/5" style={{ aspectRatio: `1 / ${ratio}` }}>
        <canvas ref={canvas} className="block h-full w-full" role="img" aria-label={`Page ${n} of ${total}`} />
      </div>
      <figcaption className="mt-2 text-center text-xs tabular-nums text-muted-foreground">Page {n} of {total}</figcaption>
    </figure>
  );
}
