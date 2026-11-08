import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

/** Shown instead of the whole site while an administrator has paused it. Administrators never see this. */
export function MaintenanceScreen({ message }: { message?: string | null }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-5 py-10">
      <div className="w-full max-w-lg text-center">
        <img src="/paperly-seal.png" alt="Paperly International Journal of Medical Innovation" width={512} height={512} decoding="async" className="mx-auto size-28 sm:size-32" />
        <p className="mt-3 font-serif text-lg font-semibold text-primary">Paperly</p>
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">International Journal of Medical Innovation</p>
        <div className="mt-8 rounded-2xl border border-border bg-card px-6 py-8 shadow-sm">
          <div aria-hidden="true" className="text-5xl leading-none">🛠️</div>
          <h1 className="mt-4 font-serif text-2xl font-semibold sm:text-3xl">We are under maintenance</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
            {message ?? "Paperly is closed for a short while so we can make it better. Everything is safe, and we will be back very soon."} ⏳
          </p>
          <p className="mt-5 text-[15px] font-medium">🙏 We apologise for the inconvenience.</p>
          <p className="mt-1 text-sm text-muted-foreground">Thank you for your patience and understanding 💙</p>
        </div>
        <p className="mt-6 text-xs text-muted-foreground">
          <Link to="/auth" className="underline underline-offset-4 hover:text-foreground">Staff sign in</Link>
        </p>
      </div>
    </div>
  );
}

/** Thin bar shown only to administrators while the site is paused, so they never forget it is closed to everyone else. */
export function MaintenanceAdminBar() {
  return (
    <div role="status" className="bg-amber-100 px-4 py-1.5 text-center text-sm font-medium text-amber-950">
      🛠️ The site is paused for everyone except administrators. <Link to="/admin" hash="journal/settings" className="underline underline-offset-4">Open the pause switch</Link>
    </div>
  );
}

/** Shown instead of the whole site to one person whose access an administrator has paused. */
export function BlockedScreen({ message }: { message?: string | null }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-5 py-10">
      <div className="w-full max-w-lg text-center">
        <img src="/paperly-seal.png" alt="Paperly International Journal of Medical Innovation" width={512} height={512} decoding="async" className="mx-auto size-28 sm:size-32" />
        <p className="mt-3 font-serif text-lg font-semibold text-primary">Paperly</p>
        <div className="mt-8 rounded-2xl border border-border bg-card px-6 py-8 shadow-sm">
          <div aria-hidden="true" className="text-5xl leading-none">🔒</div>
          <h1 className="mt-4 font-serif text-2xl font-semibold sm:text-3xl">Your access is paused</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">{message ?? "An administrator has paused your access to Paperly. If you think this is a mistake, please contact the Paperly team."}</p>
        </div>
        <button type="button" onClick={() => { void supabase.auth.signOut(); }} className="mt-6 text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground">Sign out</button>
      </div>
    </div>
  );
}
