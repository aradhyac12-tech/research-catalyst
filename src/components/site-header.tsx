import { Link, useRouter } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";

export function Mark({ className = "size-7", onDark = false }: { className?: string; onDark?: boolean }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="7" className={onDark ? "fill-primary-foreground" : "fill-primary"} />
      <path d="M10 8.5h7.2a4.8 4.8 0 0 1 0 9.6H10V8.5Zm0 9.6V24" fill="none" className={onDark ? "stroke-primary" : "stroke-primary-foreground"} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="22.5" cy="22.5" r="2" fill="oklch(0.85 0.1 170)" />
    </svg>
  );
}

const nav = "relative px-1 py-5 text-sm text-muted-foreground transition-colors hover:text-foreground";
const navActive = { className: "relative px-1 py-5 text-sm font-medium text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-primary" };

export function SiteHeader() {
  const { user } = useAuth();
  const router = useRouter();
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-md supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex max-w-6xl items-center gap-8 px-5">
        <Link to="/" className="flex items-center gap-2.5 py-3" aria-label="Paperly home">
          <Mark />
          <span className="font-serif text-[22px] font-medium tracking-tight">Paperly</span>
        </Link>
        <nav className="hidden items-center gap-6 md:flex" aria-label="Primary">
          <Link to="/explore" className={nav} activeProps={navActive}>Explore</Link>
          <Link to="/verify" className={nav} activeProps={navActive}>Verify</Link>
          {user && <Link to="/my-research" className={nav} activeProps={navActive}>My research</Link>}
          {user && <Link to="/certificates" className={nav} activeProps={navActive}>Certificates</Link>}
          {user && <Link to="/admin" className={nav} activeProps={navActive}>Editorial</Link>}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {user ? (
            <>
              <Button asChild size="sm"><Link to="/submit">Submit research</Link></Button>
              <Button size="sm" variant="ghost" onClick={async () => { await supabase.auth.signOut(); router.navigate({ to: "/" }); }}>Sign out</Button>
            </>
          ) : (
            <>
              <Button asChild size="sm" variant="ghost"><Link to="/auth">Sign in</Link></Button>
              <Button asChild size="sm"><Link to="/submit">Submit research</Link></Button>
            </>
          )}
        </div>
      </div>
      <nav className="flex gap-5 overflow-x-auto border-t border-border px-5 md:hidden" aria-label="Primary mobile">
        <Link to="/explore" className={nav} activeProps={navActive}>Explore</Link>
        <Link to="/verify" className={nav} activeProps={navActive}>Verify</Link>
        {user && <Link to="/my-research" className={nav} activeProps={navActive}>My research</Link>}
        {user && <Link to="/certificates" className={nav} activeProps={navActive}>Certificates</Link>}
        {user && <Link to="/admin" className={nav} activeProps={navActive}>Editorial</Link>}
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-border bg-card">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-12 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2.5"><Mark className="size-6" /><span className="font-serif text-xl font-medium">Paperly</span></div>
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted-foreground">A repository where every screening decision is recorded, explained and open to editorial review.</p>
        </div>
        <FooterCol title="Platform" links={[["Explore published work", "/explore"], ["Submit research", "/submit"], ["Verify a certificate", "/verify"]]} />
        <FooterCol title="Your account" links={[["Sign in", "/auth"], ["My research", "/my-research"], ["Certificates", "/certificates"]]} />
        <div>
          <h3 className="text-sm font-semibold">Good to know</h3>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">Paperly is a scholarly repository, not an accreditation authority. Automated screening is not peer review, and payment never affects whether a paper is accepted.</p>
        </div>
      </div>
      <div className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-5 py-4 text-xs text-muted-foreground">
          <span>© {new Date().getFullYear()} Paperly</span>
          <span>Aligned with COPE and ICMJE guidance on AI use in manuscripts</span>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: Array<[string, string]> }) {
  return (
    <div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <ul className="mt-3 space-y-2 text-sm">
        {links.map(([label, to]) => <li key={to}><Link to={to} className="text-muted-foreground transition-colors hover:text-foreground">{label}</Link></li>)}
      </ul>
    </div>
  );
}
