import { describe, expect, it } from "vitest";
import { absoluteUrl, buildSiteHead, OG_IMAGE_PATH } from "./site-meta";

const origin = "https://paperly-ashy.vercel.app";
const find = (head: ReturnType<typeof buildSiteHead>, key: string) => head.meta.find((m) => (m.property ?? m.name) === key);

describe("share preview tags", () => {
  it("point the preview image at an absolute address on the site", () => {
    const h = buildSiteHead(origin);
    expect(find(h, "og:image")?.content).toBe(`${origin}${OG_IMAGE_PATH}`);
    expect(find(h, "twitter:image")?.content).toBe(`${origin}${OG_IMAGE_PATH}`);
    expect(find(h, "og:image:width")?.content).toBe("1200");
    expect(find(h, "og:image:height")?.content).toBe("630");
  });
  it("ignore a trailing slash on the origin", () => {
    expect(absoluteUrl(`${origin}/`, "/og-image.jpg")).toBe(`${origin}/og-image.jpg`);
  });
  it("name the site and link icons for browsers, phones and Google", () => {
    const h = buildSiteHead(origin);
    expect(find(h, "og:site_name")?.content).toContain("Paperly");
    const rels = h.links.map((l) => `${l.rel}:${l.sizes ?? ""}`);
    expect(rels).toContain("icon:48x48");
    expect(rels).toContain("apple-touch-icon:180x180");
    expect(h.links.some((l) => l.rel === "manifest")).toBe(true);
  });
  it("describes the organisation and its logo to Google, and cannot break out of the script tag", () => {
    const h = buildSiteHead(origin);
    const json = h.scripts[0]!.children;
    expect(json).toContain('"@type":"Organization"');
    expect(json).toContain(`${origin}/icon-512.png`);
    expect(json).not.toContain("</script>");
  });
  it("still works when the origin is unknown: relative image path, no structured data", () => {
    const h = buildSiteHead("");
    expect(find(h, "og:image")?.content).toBe(OG_IMAGE_PATH);
    expect(h.scripts).toHaveLength(0);
  });
});
