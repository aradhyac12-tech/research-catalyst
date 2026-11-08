import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { toast } from "sonner";
import { completeProfile } from "@/lib/app.functions";
import { meQuery } from "@/lib/queries";
import { cleanAge, cleanPersonName, MAX_AGE, MIN_AGE } from "@/lib/domain/referrals";
import { Button } from "@/components/ui/button";

/**
 * Shown over every signed-in page until the account has a real name and an age. It cannot be closed, dismissed by clicking outside, or
 * skipped with Escape. Only the server marks an account as completed (completeProfile), so the browser cannot skip it either.
 */
export function ProfileDetailsGate() {
  const qc = useQueryClient();
  const me = useQuery({ ...meQuery(), staleTime: 10_000 });
  const profile = me.data?.profile as { display_name?: string; email?: string | null; age?: number | null; details_completed?: boolean } | null | undefined;
  const [name, setName] = useState<string | null>(null); const [age, setAge] = useState("");
  const [busy, setBusy] = useState(false); const [touched, setTouched] = useState(false);
  if (!profile || profile.details_completed) return null;

  const shownName = name ?? (cleanPersonName(profile.display_name, profile.email) ?? "");
  const nameOk = cleanPersonName(shownName, profile.email) !== null; const ageOk = cleanAge(age) !== null;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setTouched(true);
    if (!nameOk || !ageOk) return;
    setBusy(true);
    try { await completeProfile({ data: { display_name: shownName, age: Number(age) } }); await qc.invalidateQueries({ queryKey: ["me"] }); void qc.invalidateQueries({ queryKey: ["role-users"] }); toast.success("Thank you. Your details are saved."); }
    catch (err) { toast.error(err instanceof Error && err.message ? err.message : "Could not save your details. Try again."); }
    finally { setBusy(false); }
  };

  return (
    <DialogPrimitive.Root open modal>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[70] bg-[rgb(16_32_64/0.55)] backdrop-blur-[3px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          onEscapeKeyDown={(e) => e.preventDefault()} onPointerDownOutside={(e) => e.preventDefault()} onInteractOutside={(e) => e.preventDefault()}
          className="fixed left-1/2 top-1/2 z-[71] max-h-[92dvh] w-[calc(100vw-1.5rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-border bg-background p-6 shadow-lift outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 sm:p-8">
          <div aria-hidden className="mb-5 h-1 w-12 rounded-full bg-primary" />
          <DialogPrimitive.Title className="text-[1.5rem] font-semibold leading-tight">Tell us about you</DialogPrimitive.Title>
          <DialogPrimitive.Description className="mt-2 text-[15px] text-muted-foreground">Your name appears on your records and certificates. Please enter it as you want it written, and your age. Both are required to continue.</DialogPrimitive.Description>
          <form onSubmit={submit} noValidate className="mt-6 space-y-5">
            <div className="space-y-2">
              <label htmlFor="pd-name" className="text-sm font-medium">Full name</label>
              <input id="pd-name" autoFocus autoComplete="name" maxLength={120} value={shownName} onChange={(e) => setName(e.target.value)} aria-invalid={touched && !nameOk || undefined} aria-describedby={touched && !nameOk ? "pd-name-e" : undefined}
                className={`h-12 w-full min-w-0 rounded-xl border bg-background px-4 text-base shadow-soft outline-none transition focus:ring-4 ${touched && !nameOk ? "border-destructive focus:ring-destructive/20" : "border-input focus:border-primary focus:ring-primary/20"}`} />
              {touched && !nameOk && <p id="pd-name-e" role="alert" className="text-sm text-destructive">Enter your full name, not just your email name.</p>}
            </div>
            <div className="space-y-2">
              <label htmlFor="pd-age" className="text-sm font-medium">Age</label>
              <input id="pd-age" inputMode="numeric" autoComplete="off" maxLength={3} value={age} onChange={(e) => setAge(e.target.value.replace(/\D/g, ""))} aria-invalid={touched && !ageOk || undefined} aria-describedby={touched && !ageOk ? "pd-age-e" : undefined}
                className={`h-12 w-full min-w-0 rounded-xl border bg-background px-4 text-base tabular-nums shadow-soft outline-none transition focus:ring-4 sm:w-32 ${touched && !ageOk ? "border-destructive focus:ring-destructive/20" : "border-input focus:border-primary focus:ring-primary/20"}`} />
              {touched && !ageOk && <p id="pd-age-e" role="alert" className="text-sm text-destructive">Enter your age in years, between {MIN_AGE} and {MAX_AGE}.</p>}
            </div>
            <Button size="lg" className="w-full" loading={busy} disabled={busy}>Save and continue</Button>
          </form>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
