import { AlertCircle, CheckCircle2, FileText, Loader2 } from "lucide-react";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";

export type UploadState = "uploading" | "done" | "saving" | "error";

/** Premium progress bar: gradient fill, soft glow, moving sheen while active, indeterminate mode for server-side work. */
export function PremiumBar({ pct, state, className }: { pct: number; state: UploadState; className?: string }) {
  const p = Math.max(0, Math.min(1, pct));
  const done = state === "done";
  const err = state === "error";
  return (
    <div
      role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={state === "saving" ? undefined : Math.round(p * 100)}
      className={cn("relative h-2.5 w-full overflow-hidden rounded-full bg-primary/10 shadow-[inset_0_1px_2px_rgb(16_32_64/0.12)]", className)}
    >
      {state === "saving" ? (
        <div className="upl-indeterminate absolute inset-y-0 w-2/5 rounded-full bg-gradient-to-r from-primary/40 via-primary to-primary/40" />
      ) : (
        <div
          className={cn(
            "relative h-full overflow-hidden rounded-full transition-[width] duration-300 ease-[var(--ease-premium)]",
            done ? "bg-gradient-to-r from-emerald-500 to-emerald-600 shadow-[0_0_12px_rgb(16_185_129/0.45)]"
              : err ? "bg-destructive"
              : "bg-gradient-to-r from-primary/80 via-primary to-sky-500 shadow-[0_0_12px_rgb(15_59_120/0.4)]",
          )}
          style={{ width: `${Math.max(p * 100, p > 0 ? 3 : 0)}%` }}
        >
          {state === "uploading" && <span className="upl-sheen absolute inset-0 bg-gradient-to-r from-transparent via-white/45 to-transparent" />}
        </div>
      )}
    </div>
  );
}

/** One file's row: icon, wrapped name, size, live percent, bar. */
export function UploadRow({ name, size, pct, state, label, error }: { name: string; size: number; pct: number; state: UploadState; label?: string; error?: string }) {
  const percent = Math.round(Math.max(0, Math.min(1, pct)) * 100);
  return (
    <div role="status" aria-live="polite" className="min-w-0 rounded-xl border border-border bg-card p-3.5 shadow-[var(--shadow-soft)]">
      <div className="flex min-w-0 items-start gap-3">
        <span className={cn("mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg", state === "done" ? "bg-emerald-50 text-emerald-600" : state === "error" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary")}>
          {state === "done" ? <CheckCircle2 className="size-5" /> : state === "error" ? <AlertCircle className="size-5" /> : <FileText className="size-5" />}
        </span>
        <div className="min-w-0 flex-1">
          {label && <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>}
          <p className="truncate text-[15px] font-medium leading-snug" title={name}>{name}</p>
          <p className="text-sm text-muted-foreground">{formatBytes(size)}</p>
        </div>
        <div className="shrink-0 text-right">
          {state === "uploading" && <p className="text-lg font-semibold tabular-nums leading-none text-primary">{percent}<span className="text-sm">%</span></p>}
          {state === "saving" && <Loader2 className="size-5 animate-spin text-primary" aria-hidden />}
          {state === "done" && <p className="text-sm font-semibold text-emerald-700">Uploaded</p>}
        </div>
      </div>
      {state !== "error" && <PremiumBar className="mt-3" pct={pct} state={state} />}
      {state === "error" && <p className="mt-2 text-sm text-destructive">Upload failed{error ? `: ${error}` : ""}. Choose the file again, or press the button to retry.</p>}
    </div>
  );
}

/** Final-step panel: every file plus the server-side saving step, with one overall percentage. */
export function SubmitProgress({ rows, saving }: { rows: { key: string; label: string; name: string; size: number; pct: number; error?: string }[]; saving: boolean }) {
  const total = rows.reduce((s, r) => s + r.size, 0) || 1;
  const overall = rows.reduce((s, r) => s + r.size * r.pct, 0) / total;
  const stage = saving ? "Saving your submission…" : overall >= 1 ? "Upload complete" : "Uploading your files…";
  return (
    <section aria-label="Upload progress" className="space-y-3 rounded-2xl border border-primary/15 bg-gradient-to-b from-primary/[0.04] to-transparent p-4 shadow-[var(--shadow-lift)]">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-semibold">{stage}</p>
        <p className="text-sm tabular-nums text-muted-foreground">{saving ? "Almost there" : `${Math.round(overall * 100)}% overall`}</p>
      </div>
      {rows.map((r) => (
        <UploadRow key={r.key} label={r.label} name={r.name} size={r.size} pct={r.pct} error={r.error}
          state={r.error ? "error" : r.pct >= 1 ? (saving ? "done" : "done") : "uploading"} />
      ))}
      {saving && (
        <div className="rounded-xl border border-border bg-card p-3.5 shadow-[var(--shadow-soft)]">
          <div className="flex items-center justify-between gap-3"><p className="text-[15px] font-medium">Registering your manuscript</p><Loader2 className="size-5 animate-spin text-primary" aria-hidden /></div>
          <PremiumBar className="mt-3" pct={1} state="saving" />
        </div>
      )}
      <p className="text-sm text-muted-foreground">Keep this page open. You will go to payment automatically.</p>
    </section>
  );
}
