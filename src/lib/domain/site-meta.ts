// Site-wide head tags: how Paperly looks when a link is shared (WhatsApp, Telegram, LinkedIn, X, Facebook, Slack, iMessage) and in Google.
// Preview crawlers need an ABSOLUTE image address, so everything here is built from the site's origin.
import { jsonLdScript } from "./metadata";

export const SITE_NAME = "Paperly International Journal of Medical Innovation";
export const SITE_SHORT_NAME = "Paperly";
export const SITE_DESCRIPTION = "A peer-reviewed journal and open repository: submit, screen and publish research with transparent, versioned policies.";
export const OG_IMAGE_PATH = "/og-image.jpg"; // 1200x630, under 100 KB (WhatsApp ignores preview images over about 300 KB)
export const OG_IMAGE_SIZE = { width: 1200, height: 630 } as const;
export const OG_IMAGE_ALT = "Paperly International Journal of Medical Innovation logo";
export const THEME_COLOR = "#001a39";

const clean = (origin: string | null | undefined) => (origin ?? "").trim().replace(/\/+$/, "");

/** Absolute address for a file in /public. With no known origin it stays a root-relative path, which browsers still resolve. */
export const absoluteUrl = (origin: string | null | undefined, path: string) => `${clean(origin)}${path.startsWith("/") ? path : `/${path}`}`;

export function buildSiteHead(origin: string | null | undefined) {
  const image = absoluteUrl(origin, OG_IMAGE_PATH);
  const base = clean(origin);
  const meta: Array<{ name?: string; property?: string; content: string }> = [
    { name: "theme-color", content: THEME_COLOR },
    { name: "application-name", content: SITE_SHORT_NAME },
    { name: "apple-mobile-web-app-title", content: SITE_SHORT_NAME },
    { property: "og:site_name", content: SITE_NAME },
    { property: "og:title", content: SITE_NAME },
    { property: "og:description", content: SITE_DESCRIPTION },
    { property: "og:locale", content: "en" },
    { property: "og:image", content: image },
    { property: "og:image:secure_url", content: image },
    { property: "og:image:type", content: "image/jpeg" },
    { property: "og:image:width", content: String(OG_IMAGE_SIZE.width) },
    { property: "og:image:height", content: String(OG_IMAGE_SIZE.height) },
    { property: "og:image:alt", content: OG_IMAGE_ALT },
    { name: "twitter:title", content: SITE_NAME },
    { name: "twitter:description", content: SITE_DESCRIPTION },
    { name: "twitter:image", content: image },
    { name: "twitter:image:alt", content: OG_IMAGE_ALT },
  ];
  const links: Array<{ rel: string; href: string; type?: string; sizes?: string }> = [
    { rel: "icon", href: "/favicon.ico", sizes: "any" },
    { rel: "icon", href: "/favicon-48.png", type: "image/png", sizes: "48x48" }, // Google shows a favicon whose size is a multiple of 48
    { rel: "icon", href: "/favicon-32.png", type: "image/png", sizes: "32x32" },
    { rel: "apple-touch-icon", href: "/apple-touch-icon.png", sizes: "180x180" },
    { rel: "manifest", href: "/site.webmanifest" },
  ];
  // Tells Google the site's name and logo for search results.
  const scripts: Array<{ type: string; children: string }> = base ? [{
    type: "application/ld+json",
    children: jsonLdScript({
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "Organization", "@id": `${base}/#organization`, name: SITE_NAME, url: base, logo: { "@type": "ImageObject", url: absoluteUrl(base, "/icon-512.png"), width: 512, height: 512 } },
        { "@type": "WebSite", "@id": `${base}/#website`, url: base, name: SITE_NAME, alternateName: SITE_SHORT_NAME, publisher: { "@id": `${base}/#organization` }, inLanguage: "en" },
      ],
    }),
  }] : [];
  return { meta, links, scripts };
}
