import { useEffect, useLayoutEffect } from "react";
import { useRouterState } from "@tanstack/react-router";

// Scroll reveal: anything marked data-reveal eases up and fades in the first time it scrolls into view; items that arrive together
// (a list, a row of cards) follow each other 70 ms apart. Nothing is hidden until this script has run, and nothing is hidden at all
// when the visitor asks their device for reduced motion, so the page always works without it.
// Values: data-reveal (rise), data-reveal="fade", data-reveal="scale".
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;
// Public reading pages get their sections revealed automatically. Tools (admin, submit, dashboards) never animate on scroll.
const AUTO = /^\/(explore|about|fees|editorial-board|policies|verify|article\/)/;
const STEP_MS = 70;
const MAX_STAGGER = 5;

export function ScrollReveal() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useIsoLayoutEffect(() => {
    if (typeof window === "undefined" || !("IntersectionObserver" in window)) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const main = document.getElementById("main");
    if (!main) return;
    document.documentElement.classList.add("js-reveal");

    const started = performance.now();
    const seen = new WeakSet<Element>();
    const auto = AUTO.test(pathname);

    const io = new IntersectionObserver((entries) => {
      let n = 0;
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const el = e.target as HTMLElement;
        el.style.setProperty("--rv", `${Math.min(n++, MAX_STAGGER) * STEP_MS}ms`);
        el.classList.add("is-in");
        io.unobserve(el);
      }
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0 });

    const scan = () => {
      if (auto) {
        main.querySelectorAll<HTMLElement>("section, aside").forEach((el) => {
          if (el.hasAttribute("data-reveal") || el.closest("[data-reveal]") || el.classList.contains("hero-seq")) return;
          el.setAttribute("data-reveal", "");
        });
      }
      const vh = window.innerHeight;
      const fresh = performance.now() - started < 500; // first paint of this page: what is already on screen just stays
      main.querySelectorAll<HTMLElement>("[data-reveal]").forEach((el) => {
        if (seen.has(el) || el.classList.contains("is-in")) return;
        seen.add(el);
        const r = el.getBoundingClientRect();
        if (r.top < vh * 0.92 && r.bottom > 0) {
          if (fresh) el.classList.add("is-in", "is-instant"); else { el.style.setProperty("--rv", "0ms"); requestAnimationFrame(() => el.classList.add("is-in")); }
        } else io.observe(el);
      });
    };

    scan();
    // Lists fill in after their data arrives, so new rows are picked up as they appear.
    let raf = 0;
    const mo = new MutationObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(scan); });
    mo.observe(main, { childList: true, subtree: true });
    return () => { cancelAnimationFrame(raf); mo.disconnect(); io.disconnect(); };
  }, [pathname]);

  return null;
}
