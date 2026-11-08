import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { displayTitle } from "@/lib/title-case";

/** One published record in a list. The whole row is the link target; the title is the accessible link. */
export function ArticleRow({ paperlyId, title, abstract, children }: { paperlyId: string; title: string; abstract: string; children: ReactNode }) {
  return (
    <li data-reveal="" className="surface surface-interactive group relative min-w-0 p-5 sm:p-7">
      <span aria-hidden="true" className="absolute inset-y-5 left-0 w-[3px] rounded-r bg-gold opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-within:opacity-100" />
      <Link to="/article/$paperlyId" params={{ paperlyId }} className="title-link inline-block max-w-full break-words font-serif text-[1.1875rem] font-semibold leading-[1.3] tracking-[-0.005em] text-primary [text-wrap:pretty] after:absolute after:inset-0 after:content-[''] sm:text-[1.3rem]">{displayTitle(title)}</Link>
      <p className="mt-2.5 line-clamp-3 max-w-[70ch] text-[15px] leading-[1.7] text-muted-foreground">{abstract}</p>
      <div className="mt-4 flex min-w-0 border-t border-border/70 pt-3 flex-wrap items-center gap-x-3 gap-y-1 break-words text-sm text-muted-foreground">{children}</div>
    </li>
  );
}
