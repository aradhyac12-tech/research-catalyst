import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { downloadStampedArticle, getStampedAccess } from "@/lib/app.functions";
import { saveFileFromUrl } from "@/lib/certificate-download";
import { Button } from "@/components/ui/button";

/** Shown only to the uploader, a listed author with an account, or staff: the article as a PDF with a Paperly record sheet in front. */
export function StampedDownload({ publicId, className }: { publicId: string; className?: string }) {
  const { user } = useAuth();
  const { data } = useQuery({ queryKey: ["stamped-access", publicId, user?.id], queryFn: () => getStampedAccess({ data: { publicId } }), enabled: !!user, staleTime: 5 * 60_000, retry: false });
  const [busy, setBusy] = useState(false);
  if (!user || !data?.eligible) return null;
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
      <Button onClick={go} disabled={busy} variant="outline"><Download className="mr-2 size-4" aria-hidden />{busy ? "Preparing…" : "Download with Paperly record sheet (PDF)"}</Button>
      <p className="mt-2 max-w-[60ch] text-sm text-muted-foreground">Your full article with a front sheet that lists its Paperly ID, DOI, version, file hash and certificate numbers beside the title and authors, and the ID stamped up the margin of every page.</p>
    </div>
  );
}
