import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

/** One published record in a list. The whole row is the link target; the title is the accessible link. */
export function ArticleRow({ paperlyId, title, abstract, children }: { paperlyId: string; title: string; abstract: string; children: ReactNode }) {
  return (
    <li className="result-row relative py-6">
      <Link to="/article/$paperlyId" params={{ paperlyId }} className="title-link font-serif text-[1.3rem] font-semibold leading-snug text-primary after:absolute after:inset-0 after:content-['']">{title}</Link>
      <p className="mt-2 line-clamp-2 max-w-[70ch] text-[15px] leading-relaxed text-muted-foreground">{abstract}</p>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">{children}</div>
    </li>
  );
}
