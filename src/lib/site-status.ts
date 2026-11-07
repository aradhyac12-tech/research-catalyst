import { supabase } from "@/integrations/supabase/client";

/** Channel every open page listens on. A message here only tells pages to ask the server again; it carries no data and
 *  grants nothing, so it is safe even though anyone could send it. The server stays the only authority. */
export const SITE_CHANNEL = "site-status";

/** Called by an administrator right after changing the pause or a person's block, so open pages react in about a second
 *  instead of waiting for their next check. Never throws. */
export function announceSiteChange() {
  try {
    const ch = supabase.channel(SITE_CHANNEL);
    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        void ch.send({ type: "broadcast", event: "changed", payload: {} }).finally(() => { void supabase.removeChannel(ch); });
      }
    });
  } catch { /* the periodic check still picks the change up */ }
}

const HINT = "rc_admin_hint";
/** Remembers on this device that an administrator signed in, so the page can skip the maintenance screen while it confirms who is
 *  signed in. Display only: every real permission is checked on the server. */
export function readAdminHint(): boolean { try { return localStorage.getItem(HINT) === "1"; } catch { return false; } }
export function writeAdminHint(v: boolean) { try { if (v) localStorage.setItem(HINT, "1"); else localStorage.removeItem(HINT); } catch { /* ignore */ } }
