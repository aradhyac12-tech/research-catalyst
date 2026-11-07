import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { adminSetMaintenance, getMaintenanceStatus } from "@/lib/maintenance.functions";
import { Button } from "@/components/ui/button";
import { announceSiteChange } from "@/lib/site-status";

type Status = { enabled: boolean; message: string | null };

/** Master pause. One click (then one confirm) closes the website for everyone except administrators; one click opens it again. */
export function MasterPause() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["maintenance"], queryFn: () => getMaintenanceStatus(), staleTime: 5_000 });
  const [confirm, setConfirm] = useState(false); const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const on = q.data?.enabled === true;
  const text = msg ?? q.data?.message ?? "";

  async function set(enabled: boolean) {
    const before = qc.getQueryData<Status>(["maintenance"]);
    setBusy(true); setConfirm(false);
    qc.setQueryData<Status>(["maintenance"], { enabled, message: text.trim() || null }); // shows at once; undone below if the server refuses
    try {
      const r = await adminSetMaintenance({ data: { enabled, message: text.trim() || null } });
      qc.setQueryData<Status>(["maintenance"], r);
      announceSiteChange(); // open pages react within about a second, no refresh needed
      toast.success(enabled ? "Website paused. Only administrators can use it now." : "Website is open again.");
    } catch (e) {
      qc.setQueryData<Status | undefined>(["maintenance"], before);
      toast.error(e instanceof Error ? e.message : "Could not change the pause");
    } finally { setBusy(false); }
  }

  if (q.isLoading) return null;
  return (
    <section aria-label="Master pause" className={`mt-5 rounded-xl border px-4 py-3 sm:px-5 ${on ? "border-amber-400 bg-amber-50" : "border-border bg-background"}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 font-semibold">{on ? "🛠️ Website is paused" : "Master pause"}</p>
          <p className="m-0 text-sm text-muted-foreground">{on ? "Visitors see the maintenance page with an apology. Administrators can still use everything." : "Close the website for everyone except administrators, for example while you update something."}</p>
        </div>
        {!confirm && <Button type="button" size="sm" variant={on ? "default" : "outline"} disabled={busy} onClick={() => (on ? void set(false) : setConfirm(true))}>{on ? "Open the website" : "Pause the website"}</Button>}
        {confirm && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">Close it for everyone except administrators?</span>
            <Button type="button" size="sm" disabled={busy} onClick={() => void set(true)}>Yes, pause</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button>
          </div>
        )}
      </div>
      <label className="mt-3 block text-sm font-medium">Message visitors see (optional)
        <input className="mt-1 flex h-10 w-full max-w-xl rounded-lg border border-input bg-background px-3 text-base" maxLength={500} value={text} onChange={(e) => setMsg(e.target.value)} placeholder="We will be back in about an hour." />
      </label>
      {on && text !== (q.data?.message ?? "") && <Button type="button" size="sm" variant="outline" className="mt-2" disabled={busy} onClick={() => void set(true)}>Save message</Button>}
    </section>
  );
}
