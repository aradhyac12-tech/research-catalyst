import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SITE_CHANNEL, readAdminHint, writeAdminHint } from "@/lib/site-status";
import { useAuth } from "@/hooks/use-auth";
import { meQuery } from "@/lib/queries";
import { getMaintenanceStatus, getMyAccess } from "@/lib/maintenance.functions";
import { MaintenanceScreen, MaintenanceAdminBar, BlockedScreen } from "@/components/maintenance";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { SiteHeader, SiteFooter } from "@/components/site-header";
import { NavProgress } from "@/components/nav-progress";
import { ScrollReveal } from "@/components/scroll-reveal";
import { NativeBridge } from "@/components/native-bridge";
import { useIsNative } from "@/lib/native";
import { SiteBannerBar } from "@/components/promo-banner";
import { RouteError } from "@/components/route-error";
import { Toaster } from "@/components/ui/sonner";
import { getSiteOrigin } from "@/lib/site.functions";
import { buildSiteHead, SITE_DESCRIPTION, SITE_NAME } from "@/lib/domain/site-meta";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="font-serif text-7xl font-semibold text-primary/80">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-button transition-colors hover:bg-primary/92"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error: rawError, reset }: { error: unknown; reset: () => void }) {
  const error = rawError instanceof Error ? rawError : new Error(String(rawError));
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);
  return <RouteError error={error} reset={reset} />;
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  // The site's own address, needed for the absolute image links in share previews. It never changes while the site is open, so it is fetched once.
  staleTime: Infinity,
  // The pause state is read here, on the server, before the first page is sent. So a paused site is drawn as the maintenance page from the
  // very first paint, instead of showing the real page and switching to the maintenance page a moment later.
  loader: async () => {
    const [origin, maintenance] = await Promise.all([
      getSiteOrigin().catch(() => ""),
      getMaintenanceStatus().catch(() => ({ enabled: false, message: null as string | null })),
    ]);
    return { origin, maintenance };
  },
  head: ({ loaderData }) => {
    const site = buildSiteHead(loaderData?.origin);
    return {
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { title: SITE_NAME },
        { name: "description", content: SITE_DESCRIPTION },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
        ...site.meta,
      ],
      links: [
        { rel: "stylesheet", href: appCss },
        ...site.links,
        { rel: "preconnect", href: "https://fonts.googleapis.com" },
        { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
        { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Literata:opsz,wght@7..72,400;7..72,500;7..72,600;7..72,700&family=Public+Sans:wght@400;500;600;700&display=swap" },
      ],
      scripts: site.scripts,
    };
  },
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <Shell />
    </QueryClientProvider>
  );
}

function Shell() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const native = useIsNative();
  const qc = useQueryClient();
  const initial = Route.useLoaderData().maintenance;
  // Master pause. Starts from what the server already knew when it sent the page, then re-checks every 10 seconds, when the tab is
  // opened again, and straight away when an administrator changes it (broadcast below), so nobody has to refresh.
  const pause = useQuery({ queryKey: ["maintenance"], queryFn: () => getMaintenanceStatus(), initialData: initial, initialDataUpdatedAt: () => Date.now(), staleTime: 5_000, refetchInterval: 10_000, refetchOnWindowFocus: true, retry: false });
  const { user, loading } = useAuth();
  // Own access: blocked or not, administrator or not. Only for signed-in people.
  const access = useQuery({ queryKey: ["access", user?.id], queryFn: () => getMyAccess(), enabled: !!user, staleTime: 5_000, refetchInterval: 10_000, refetchOnWindowFocus: true, retry: false });
  const [hint, setHint] = useState(false);
  useEffect(() => { setHint(readAdminHint()); }, []);
  useEffect(() => { if (access.data) { writeAdminHint(access.data.isAdmin); setHint(access.data.isAdmin); } }, [access.data]);
  useEffect(() => { if (!loading && !user) { writeAdminHint(false); setHint(false); } }, [loading, user]);
  useEffect(() => {
    const ch = supabase.channel(SITE_CHANNEL).on("broadcast", { event: "changed" }, () => {
      void qc.invalidateQueries({ queryKey: ["maintenance"] }); void qc.invalidateQueries({ queryKey: ["access"] });
    }).subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [qc]);

  const paused = pause.data?.enabled === true;
  const isAdmin = access.data?.isAdmin === true;
  // Still working out who is signed in, and this device last saw an administrator: show nothing rather than the maintenance page.
  const confirmingAdmin = hint && !isAdmin && (loading || (!!user && access.isLoading));

  if (access.data?.blocked && !isAdmin) return (<><BlockedScreen message={access.data.blockMessage} /><Toaster richColors /></>);
  // The sign-in page stays open so administrators can get in. Everything else is replaced by the maintenance page.
  if (paused && !isAdmin && pathname !== "/auth") {
    if (confirmingAdmin) return <div className="min-h-screen bg-background" aria-busy="true" />;
    return (<><MaintenanceScreen message={pause.data?.message ?? null} /><Toaster richColors /></>);
  }

  return (
    <>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <NavProgress />
      <ScrollReveal />
      <NativeBridge />
      {paused && isAdmin && <MaintenanceAdminBar />}
      {!native && <SiteBannerBar />}
      <SiteHeader />
      <main id="main" tabIndex={-1} className="min-h-[calc(100vh-20rem)] outline-none"><div key={pathname} className="page-enter"><Outlet /></div></main>
      {!native && <SiteFooter />}
      <Toaster richColors />
    </>
  );
}
