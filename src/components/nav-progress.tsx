import { useRouterState } from "@tanstack/react-router";

/** Thin bar that appears the instant a navigation starts, so every click gets visible feedback. */
export function NavProgress() {
  const active = useRouterState({ select: (s) => s.status === "pending" || s.isLoading });
  return (
    <div aria-hidden="true" className={`pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 origin-left bg-primary transition-opacity duration-200 ${active ? "nav-progress opacity-100" : "opacity-0"}`} />
  );
}
