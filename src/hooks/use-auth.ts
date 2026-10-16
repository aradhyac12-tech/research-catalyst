import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    // Local read: no network call, so the header settles immediately.
    supabase.auth.getSession().then(({ data }) => { if (alive) { setUser(data.session?.user ?? null); setLoading(false); } });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { if (alive) { setUser(s?.user ?? null); setLoading(false); } });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, []);
  return { user, loading };
}
