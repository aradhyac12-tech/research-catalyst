import { useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { downloadStampedArticle } from "@/lib/app.functions";
import { saveFileFromUrl } from "@/lib/certificate-download";
import { Button } from "@/components/ui/button";

/** Open to everyone: the article as a PDF with the single Paperly front page in front and the ID stamped up the margin of every page. */
export function StampedDownload({ publicId, className, compact = false }: { publicId: string; className?: string; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      const r = await downloadStampedArticle({ data: { publicId } });
      await saveFileFromUrl(r.url, r.filename);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not prepare the download"); }
    finally { setBusy(false); }
  }
  return (
    <div className={className}>
      <Button onClick={go} disabled={busy} variant="outline" className="h-auto min-h-10 max-w-full whitespace-normal text-left"><Download className="mr-2 size-4 shrink-0" aria-hidden />{busy ? "Preparing…" : compact ? "Download this article (PDF)" : "Download with Paperly page (PDF)"}</Button>
      {!compact && <p className="mt-2 max-w-[60ch] text-sm text-muted-foreground">The full article with one Paperly front page listing its Paperly ID, DOI, version, file hash and certificate numbers beside the title and authors, and the ID stamped up the margin of every page.</p>}
    </div>
  );
}
