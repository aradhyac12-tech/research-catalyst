import { db, audit, getRoles, STAFF } from "./core.server";
import { LEGACY_ID_RE, PAPERLY_ID_RE } from "@/lib/domain/scholarly";
import { PUBLIC_STATUSES } from "@/lib/domain/constants";
import { DOCX_MIME } from "@/lib/domain/file-security";
import { CITATION_FORMATS, type CitablePaper } from "@/lib/domain/citation-formats";
import { describeRecord } from "@/lib/domain/certificate-pdf";
import { STAMP_LAYOUT_VERSION, renderStampedArticle, type StampData } from "@/lib/domain/article-stamp";
import type { PublicationType } from "@/lib/domain/scholarly";

const BUCKET = "manuscripts";

async function loadPaper(publicId: string) {
  const col = PAPERLY_ID_RE.test(publicId) ? "paperly_id" : LEGACY_ID_RE.test(publicId) ? "public_id" : null;
  if (!col) return null;
  const { data } = await db.from("papers")
    .select("id, owner_id, public_id, paperly_id, publication_type, title, abstract, keywords, license, language, published_at, status, peer_reviewed, current_version_id")
    .eq(col, publicId).in("status", [...PUBLIC_STATUSES]).is("deleted_at", null).maybeSingle();
  return data ?? null;
}

/** The uploader, any listed author who has an account on this record, or staff. Nobody else is offered the download. */
async function isEligible(uid: string, paper: { id: string; owner_id: string }) {
  if (paper.owner_id === uid) return true;
  const { data: a } = await db.from("paper_authors").select("id").eq("paper_id", paper.id).eq("user_id", uid).limit(1);
  if ((a?.length ?? 0) > 0) return true;
  return (await getRoles(uid)).some((r) => STAFF.includes(r));
}

export async function stampedAccess(uid: string, publicId: string) {
  const paper = await loadPaper(publicId);
  return { eligible: !!paper && (await isEligible(uid, paper)) };
}

const sha256Hex = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))).map((b) => b.toString(16).padStart(2, "0")).join("");

export async function stampedArticleUrl(uid: string, publicId: string, origin: string) {
  const paper = await loadPaper(publicId);
  if (!paper || !(await isEligible(uid, paper))) throw new Error("Not available");
  if (!paper.current_version_id) throw new Error("This record has no file to download");
  const site = (process.env["PUBLIC_SITE_URL"] || origin || "https://paperlys.lovable.app").replace(/\/+$/, "");

  const [{ data: ver }, { data: authors }, { data: doiRec }, { data: certs }] = await Promise.all([
    db.from("paper_versions").select("version_number, version_code, file_hash, storage_path, mime_type").eq("id", paper.current_version_id).maybeSingle(),
    db.from("paper_authors").select("full_name, orcid, user_id, affiliation").eq("paper_id", paper.id).order("position"),
    db.from("doi_records").select("status, doi").eq("paper_id", paper.id).maybeSingle(),
    db.from("certificates").select("certificate_id, certificate_type, recipient_name_at_issue, status, verification_token, on_hold").eq("paper_id", paper.id).neq("certificate_type", "PEER_REVIEW").eq("on_hold", false).order("issued_at"),
  ]);
  if (!ver?.storage_path) throw new Error("This record has no file to download");
  const kind = ver.mime_type === "application/pdf" ? "pdf" : ver.mime_type === DOCX_MIME ? "docx" : null;
  if (!kind) throw new Error("This file type cannot be stamped");

  // An ORCID iD is printed only when the author's own account proved it through ORCID sign-in.
  const uids = (authors ?? []).map((a) => a.user_id).filter((u): u is string => !!u);
  const { data: vr } = uids.length ? await db.from("orcid_verifications").select("user_id, orcid").in("user_id", uids) : { data: [] as Array<{ user_id: string; orcid: string }> };
  const verified = new Map((vr ?? []).map((v) => [v.user_id, v.orcid]));
  const authorList = (authors ?? []).map((a) => ({ name: a.full_name, affiliation: (a as unknown as { affiliation?: string | null }).affiliation ?? null, orcid: a.orcid && a.user_id && verified.get(a.user_id) === a.orcid ? a.orcid : null }));

  const articleUrl = `${site}/article/${paper.paperly_id}`;
  const rec = describeRecord(paper.publication_type, paper.peer_reviewed, paper.status);
  const doi = doiRec?.status === "VERIFIED" && doiRec.doi ? doiRec.doi : null;
  const citable: CitablePaper = {
    title: paper.title, authors: authorList.map((a) => a.name), year: Number((paper.published_at ?? "").slice(0, 4)) || new Date().getFullYear(),
    publicId: paper.paperly_id, doi, url: articleUrl, version: ver.version_number as string, publicationType: paper.publication_type as PublicationType,
    publishedDate: paper.published_at?.slice(0, 10) ?? null, abstract: paper.abstract, keywords: paper.keywords ?? [], language: paper.language,
  };
  const vancouver = CITATION_FORMATS[0][2](citable);

  const data: StampData = {
    paperlyId: paper.paperly_id, legacyId: paper.public_id, title: paper.title, authors: authorList, abstract: paper.abstract ?? "", keywords: paper.keywords ?? [], doi,
    version: ver.version_number as string, versionIdentifier: ver.version_code ?? null, fileSha256: ver.file_hash, publishedAt: paper.published_at, status: paper.status,
    recordType: rec.recordType, reviewStatement: rec.reviewStatement, license: paper.license, articleUrl, citation: vancouver,
    certificates: (certs ?? []).map((c) => ({ id: c.certificate_id, type: c.certificate_type, recipient: c.recipient_name_at_issue, status: c.status, url: `${site}/verify/certificate/${c.certificate_id}` })),
    generatedAt: new Date().toISOString(), sourceKind: kind,
  };

  // Same record, same version, same certificates and same layout give the same file, so it is made once and reused.
  const { generatedAt: _g, ...keyed } = data; void _g;
  const key = (await sha256Hex(JSON.stringify([STAMP_LAYOUT_VERSION, keyed]))).slice(0, 32);
  const path = `stamped/${paper.id}/${key}.pdf`;
  const bucket = db.storage.from(BUCKET);
  const exists = await bucket.exists(path);
  if (!exists.data) {
    const file = await bucket.download(ver.storage_path);
    if (file.error || !file.data) throw new Error("The manuscript file could not be read");
    const src = new Uint8Array(await file.data.arrayBuffer());
    let blocks;
    if (kind === "docx") blocks = (await (await import("@/lib/domain/docx-html")).docxToHtml(src)).blocks;
    const pdf = await renderStampedArticle(data, src, blocks);
    const up = await bucket.upload(path, pdf, { contentType: "application/pdf", upsert: true });
    if (up.error) throw new Error("The download could not be prepared");
  }
  const filename = `${paper.paperly_id}-v${data.version}.pdf`;
  const s = await bucket.createSignedUrl(path, 300, { download: filename });
  if (s.error || !s.data?.signedUrl) throw new Error("The download could not be prepared");
  await audit({ actor_id: uid, action: "article_stamped_download", resource_type: "paper", resource_id: paper.id, metadata: { paperly_id: paper.paperly_id, version: data.version } });
  return { url: s.data.signedUrl, filename };
}
