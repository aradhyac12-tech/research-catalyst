import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { Award, ChevronDown, ClipboardCheck, FileText, LayoutDashboard, LogOut, Search, ShieldCheck, User, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { meQuery } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { TrustStrip } from "@/components/trust-strip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

// Signed-in pages. They live in the account menu (header) and in the footer, so nothing is lost from the top bar.
const ACCOUNT_LINKS = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/my-research", label: "My research", icon: FileText },
  { to: "/certificates", label: "My certificates", icon: Award },
  { to: "/reviews", label: "My reviews", icon: ClipboardCheck, needs: ["reviewer"] },
  { to: "/founder", label: "Founder view", icon: Wallet, needs: ["founder"] },
  { to: "/profile", label: "Profile", icon: User },
  { to: "/admin", label: "Editorial queue", icon: ClipboardCheck, needs: ["editor", "admin", "super_admin"], hideIfAdmin: true },
  { to: "/admin", label: "Admin panel", icon: ShieldCheck, needs: ["admin", "super_admin"] },
] as const;

/** Each link is shown only to people whose roles need it. The server still enforces permissions on every call. */
function useVisibleLinks() {
  const { user } = useAuth();
  const { data } = useQuery({ ...meQuery(), enabled: !!user, staleTime: 10_000, refetchOnMount: "always" });
  const roles = data?.roles ?? [];
  const isAdmin = roles.some((r) => r === "admin" || r === "super_admin");
  return ACCOUNT_LINKS.filter((l) => {
    if ("hideIfAdmin" in l && l.hideIfAdmin && isAdmin) return false;
    return !("needs" in l) || l.needs.some((n) => roles.includes(n));
  });
}

// Pages that already put the matching action front and centre, so the header does not repeat it.
const OWN_SUBMIT_ACTION = ["/", "/submit", "/my-research"];
const OWN_SEARCH = ["/", "/explore"];

function useCleanPath() {
  const p = useRouterState({ select: (s) => s.location.pathname });
  return p.length > 1 ? p.replace(/\/+$/, "") : p;
}

export function SiteHeader() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const path = useCleanPath();
  const showSubmit = !OWN_SUBMIT_ACTION.includes(path);
  const showSearch = !OWN_SEARCH.includes(path);
  const signOut = async () => { await supabase.auth.signOut(); router.navigate({ to: "/" }); };
  const links = useVisibleLinks();
  const initial = (user?.email ?? "?").trim().charAt(0).toUpperCase();

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur-xl">
      <a href="#main" className="sr-only rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50">Skip to main content</a>
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5">
        <Link to="/" className="flex items-baseline gap-3 no-underline" aria-label="Paperly, home">
          <span className="font-serif text-[26px] font-semibold leading-none tracking-tight text-foreground">Paperly</span>
          <span className="hidden text-[13px] text-muted-foreground lg:inline">Open repository for screened research</span>
        </Link>

        <div className="flex items-center gap-1.5">
          {showSearch && (
            <Button asChild variant="ghost" size="icon" aria-label="Search published research">
              <Link to="/explore"><Search className="size-[18px]!" /></Link>
            </Button>
          )}
          {loading ? (
            <span aria-hidden="true" className="size-9 animate-pulse rounded-full bg-wash" />
          ) : user ? (
            <>
              {showSubmit && <Button asChild size="sm"><Link to="/submit">Submit research</Link></Button>}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" aria-label="Account menu" className="group ml-1 flex items-center gap-1.5 rounded-full border border-border bg-background py-1 pl-1 pr-2 shadow-sm transition-all duration-200 ease-premium hover:border-foreground/30 hover:shadow-soft data-[state=open]:border-primary/50">
                    <span className="flex size-7 items-center justify-center rounded-full bg-primary text-[13px] font-semibold text-primary-foreground">{initial}</span>
                    <ChevronDown className="size-4 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  <DropdownMenuLabel className="truncate px-2.5 py-2 text-xs font-medium text-muted-foreground">{user.email}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {links.map(({ to, label, icon: Icon }) => (
                    <DropdownMenuItem key={label} asChild>
                      <Link to={to} className="no-underline"><Icon className="text-muted-foreground" />{label}</Link>
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => { void signOut(); }}><LogOut className="text-muted-foreground" />Sign out</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <>
              <Button asChild size="sm" variant="ghost"><Link to="/auth">Sign in</Link></Button>
              {showSubmit && <Button asChild size="sm"><Link to="/submit">Submit research</Link></Button>}
            </>
          )}
        </div>
      </div>
    </header>
  );
}

const linkCls = "inline-flex min-h-10 items-center text-[15px] text-foreground/75 no-underline transition-colors duration-150 hover:text-primary";

export function SiteFooter() {
  const { user } = useAuth();
  const links = useVisibleLinks();
  const columns: Array<{ title: string; links: ReadonlyArray<{ to: string; label: string }> }> = [
    { title: "Research", links: [{ to: "/explore", label: "Published research" }, { to: "/submit", label: "Submit research" }, { to: "/verify", label: "Verify a certificate" }] },
    { title: "Journal", links: [{ to: "/about", label: "About" }, { to: "/editorial-board", label: "Editorial board" }, { to: "/fees", label: "Fees" }, { to: "/policies", label: "Policies" }] },
    { title: "Account", links: user ? links.map(({ to, label }) => ({ to: to as string, label })) : [{ to: "/auth", label: "Sign in" }] },
  ];
  return (
    <footer className="mt-24 border-t border-border bg-wash/60">
      <div className="mx-auto max-w-6xl px-5 pb-10 pt-14">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.5fr_repeat(3,1fr)]">
          <div className="sm:col-span-2 lg:col-span-1">
            <p className="font-serif text-2xl font-semibold tracking-tight text-foreground">Paperly</p>
            <p className="mt-2 max-w-[28ch] text-[15px] leading-relaxed text-muted-foreground">Open repository for screened research.</p>
            <TrustStrip className="mt-4" />
          </div>
          {columns.map((c) => (
            <nav key={c.title} aria-label={c.title}>
              <h2 className="font-sans text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{c.title}</h2>
              <ul className="mt-3">
                {c.links.map((l) => (
                  <li key={l.label}><Link to={l.to as "/"} className={linkCls}>{l.label}</Link></li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="mt-12 flex flex-col gap-4 border-t border-border pt-6 text-sm text-muted-foreground md:flex-row md:items-start md:justify-between md:gap-10">
          <p className="max-w-2xl leading-relaxed">
            Paperly is a scholarly repository, not an accreditation authority. Automated screening is not peer review. Payment does not affect whether a manuscript is accepted.
          </p>
          <p className="shrink-0">© {new Date().getFullYear()} Paperly</p>
        </div>
      </div>
    </footer>
  );
}
