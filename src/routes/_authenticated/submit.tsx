import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { cloneElement, isValidElement, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { submitPaper } from "@/lib/app.functions";
import { MANUSCRIPT_ACCEPT } from "@/lib/domain/file-security";
import { LICENSES, SCREENING_PROFILES } from "@/lib/domain/constants";
import { AI_USE_CATEGORIES, CREDIT_ROLES, looksLikeAiAuthor, type AiUseCategory } from "@/lib/domain/scholarly";
import { orcidChecksumOk } from "@/lib/domain/orcid";
import { keywordProblem, parseKeywords } from "@/lib/domain/keywords";
import { validatePublicationHistory, type ManuscriptVersionType } from "@/lib/domain/rights-policy";
import { formatBytes } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { PageTitle } from "@/lib/ui";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/submit")({
  head: () => ({ meta: [{ title: "Submit research | Paperly" }, { name: "description", content: "Paperly research records, submissions and verification." }, { property: "og:title", content: "Submit research | Paperly" }, { property: "og:description", content: "Paperly research records, submissions and verification." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" }] }),
  component: Submit,
});

const MAX_BYTES = 25 * 1024 * 1024;
const ARTICLE_TYPES = ["Original Research", ...Object.keys(SCREENING_PROFILES).filter((k) => k !== "default")];
const STEPS = ["Manuscript", "Authors", "Declarations", "Review"] as const;
/** Turns a raw server validation error (a JSON list of issues) into a sentence the author can act on. */
function friendlyError(err: unknown): string {
  const fallback = "Submission failed. Nothing was lost; please try again.";
  if (!(err instanceof Error)) return fallback;
  try {
    const parsed = JSON.parse(err.message) as unknown;
    if (Array.isArray(parsed)) {
      const msgs = parsed.map((i: { path?: (string | number)[]; message?: string }) => {
        const where = i.path?.[0] === "keywords" ? "Keywords" : i.path?.length ? String(i.path[0]).replace(/_/g, " ") : "A field";
        return `${where}: ${i.message ?? "invalid"}`;
      });
      if (msgs.length) return msgs.slice(0, 3).join(" · ");
    }
  } catch { /* not JSON: use the message as written */ }
  return err.message || fallback;
}
const select = "flex h-11 w-full rounded-[2px] border border-input bg-background px-3 text-base focus-visible:outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/30";

interface Author { full_name: string; email: string; affiliation: string; orcid: string; is_corresponding: boolean; roles: string[] }
const blankAuthor = (c = false): Author => ({ full_name: "", email: "", affiliation: "", orcid: "", is_corresponding: c, roles: [] });
interface AiItem { category: AiUseCategory; tool_name: string; tool_version: string; purpose: string; extent: string; human_verification: string }
const blankAi = (): AiItem => ({ category: "LANGUAGE_EDITING", tool_name: "", tool_version: "", purpose: "", extent: "", human_verification: "" });

type FieldProps = { id: string; "aria-describedby": string | undefined; "aria-invalid": true | undefined };
function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | undefined; children: React.ReactNode | ((p: FieldProps) => React.ReactNode) }) {
  // Unique id per field instance: label -> control, and hint/error -> control via aria-describedby.
  const id = useId();
  const hintId = `${id}-hint`; const errId = `${id}-err`;
  const describedBy = [error ? errId : hint ? hintId : ""].filter(Boolean).join(" ") || undefined;
  const props: FieldProps = { id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined };
  const control = typeof children === "function" ? children(props) : isValidElement(children)
    ? cloneElement(children as React.ReactElement<Record<string, unknown>>, { id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })
    : children;
  return <div className="space-y-1.5"><Label htmlFor={id}>{label}</Label>{control}{hint && !error && <p id={hintId} className="text-[15px] text-muted-foreground">{hint}</p>}{error && <p id={errId} role="alert" className="text-[15px] font-medium text-destructive">{error}</p>}</div>;
}
function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return <label className="flex cursor-pointer items-start gap-3 text-base leading-snug"><Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} className="mt-0.5" /><span>{children}</span></label>;
}

function Submit() {
  const nav = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [file, setFile] = useState<File | null>(null);
  const [anonFile, setAnonFile] = useState<File | null>(null);
  const [m, setM] = useState({ title: "", abstract: "", keywords: "", references: "", article_type: "Original Research", field: "", license: "CC-BY" as (typeof LICENSES)[number]["code"], copyright_holder: "" });
  const [authors, setAuthors] = useState<Author[]>([blankAuthor(true)]);
  const [r, setR] = useState({ is_author: false, coauthor_permission: false, has_upload_rights: false, previously_published: false, previous_doi: "", manuscript_version_type: "ORIGINAL_SUBMISSION", third_party_content: false, third_party_permission: false, ai_processing_consent: false });
  const [e, setE] = useState({ human_participants: false, animal_subjects: false, clinical_trial: false, ethics_approval: false, ethics_committee: "", approval_number: "", ethics_exempt: false, exemption_reason: "", informed_consent: false, trial_registry: "", trial_registration_number: "", animal_protocol: "", conflict_of_interest: "", funding: "", data_availability: "" });
  const [ai, setAi] = useState<{ none: boolean; items: AiItem[] }>({ none: false, items: [] });
  // Privacy / consent / registration declarations (kept separate on purpose: approval, consent to take part and consent to PUBLISH are three different facts).
  const [sx, setSx] = useState({ identifiable_info_present: false, deidentification_status: "NOT_APPLICABLE", informed_consent_status: "NOT_APPLICABLE", publication_consent_status: "NOT_APPLICABLE", waiver_status: "NOT_APPLICABLE", committee_approval_status: "NOT_APPLICABLE", privacy_sensitive_media: false });
  const [tx, setTx] = useState({ registration_status: "NOT_APPLICABLE", registry_name: "", registration_number: "", registration_url: "", registration_date: "" });
  const [idemKey] = useState(() => crypto.randomUUID()); // one key per form: a repeated click can never create a second paper
  const [prevRef, setPrevRef] = useState("");

  const keywords = parseKeywords(m.keywords);
  const kwLive = m.keywords.trim() ? keywordProblem(m.keywords) : null;
  // Publication-history rules, evaluated live so the author sees them beside the fields, not after pressing Submit.
  const pubIssues = validatePublicationHistory({ previously_published: r.previously_published, previous_doi: r.previous_doi, previous_publication_reference: prevRef, manuscript_version_type: r.manuscript_version_type as ManuscriptVersionType });

  function validate(s: number) {
    const x: Record<string, string> = {};
    if (s === 0) {
      if (!file) x["file"] = "Attach your manuscript as a PDF or Word (.docx) file.";
      else if (file.size > MAX_BYTES) x["file"] = "The file is larger than 25 MB.";
      else if (!/\.(pdf|docx)$/i.test(file.name)) x["file"] = "Only PDF or Word (.docx) files are accepted.";
      if (m.title.trim().length < 5) x["title"] = "Enter the full title (at least 5 characters).";
      if (m.abstract.trim().length < 50) x["abstract"] = "The abstract needs at least 50 characters.";
      const kwErr = keywordProblem(m.keywords); if (kwErr) x["keywords"] = kwErr;
      if (m.field.trim().length < 2) x["field"] = "Name the research field.";
      if (m.copyright_holder.trim().length < 2) x["copyright"] = "State the copyright holder (the authors, their institution, or another named owner).";
    }
    if (s === 1) {
      authors.forEach((a, i) => {
        if (a.full_name.trim().length < 2) x[`a${i}name`] = "Name required.";
        if (a.email && !/^\S+@\S+\.\S+$/.test(a.email)) x[`a${i}email`] = "Enter a valid email.";
        if (a.orcid && !orcidChecksumOk(a.orcid.trim())) x[`a${i}orcid`] = "Not a valid ORCID iD. Format 0000-0000-0000-0000; the last digit is a check digit.";
        if (looksLikeAiAuthor(a.full_name)) x[`a${i}name`] = "An AI system cannot be listed as an author. Describe AI use in the AI disclosure instead.";
      });
      if (!authors.some((a) => a.is_corresponding)) x["corr"] = "Mark one corresponding author.";
    }
    if (s === 2) {
      if (!(r.is_author || r.coauthor_permission)) x["rights1"] = "Confirm you are an author or have every author's permission.";
      if (!r.has_upload_rights) x["rights2"] = "Confirm you have the right to upload this work.";
      if (!r.ai_processing_consent) x["consent"] = "AI-assisted screening consent is required to submit.";
      if (pubIssues.length > 0) x["pub"] = pubIssues.join(" ");
      else if (r.previously_published && r.manuscript_version_type === "PUBLISHER_VERSION") x["pub"] = "Publisher versions can only be hosted with permission; choose the accepted manuscript or preprint, or contact us.";
      if (e.conflict_of_interest.trim().length < 2) x["coi"] = "State conflicts of interest, or write “None”.";
      if (e.funding.trim().length < 2) x["funding"] = "State funding, or write “None”.";
      if (e.data_availability.trim().length < 2) x["data"] = "Describe data availability.";
      if (!ai.none && ai.items.length === 0) x["ai"] = "Declare the AI tools you used, or confirm that none were used.";
      if (!ai.none && ai.items.some((t) => t.tool_name.trim().length < 2 || t.purpose.trim().length < 3 || t.extent.trim().length < 3 || t.human_verification.trim().length < 10)) x["ai2"] = "For each AI tool give its name, purpose, extent of use, and a statement of how the authors verified the output (at least 10 characters).";
    }
    setErrors(x);
    return Object.keys(x).length === 0;
  }
  const next = () => { if (validate(step)) { setStep(step + 1); window.scrollTo({ top: 0 }); } };

  async function submit() {
    for (const s of [0, 1, 2]) { if (!validate(s)) { setStep(s); window.scrollTo({ top: 0 }); toast.error("Please fix the highlighted fields on this page first."); return; } }
    if (!file) return;
    setBusy(true);
    try {
      const meta = {
        title: m.title.trim(), abstract: m.abstract.trim(), keywords, article_type: m.article_type, field: m.field.trim(), license: m.license, copyright_holder: m.copyright_holder.trim(), language: "en", references: m.references,
        authors: authors.map((a) => ({ full_name: a.full_name.trim(), email: a.email.trim(), affiliation: a.affiliation.trim(), orcid: a.orcid.trim(), is_corresponding: a.is_corresponding, roles: a.roles })),
        ai_disclosures: ai.none ? [] : ai.items.map((t) => ({ category: t.category, tool_name: t.tool_name.trim(), tool_version: t.tool_version.trim() || undefined, purpose: t.purpose.trim(), extent: t.extent.trim(), human_verification: t.human_verification.trim() })),
        rights: { ...r, previous_doi: r.previous_doi.trim() || undefined, previous_publication_reference: prevRef.trim() || undefined, third_party_permission: r.third_party_content ? r.third_party_permission : undefined, ai_processing_consent: true as const },
        ethics: { ...e, subject: { human_participants: e.human_participants, identifiable_info_present: sx.identifiable_info_present, deidentification_status: sx.deidentification_status, informed_consent_status: e.informed_consent ? "OBTAINED" : sx.informed_consent_status, publication_consent_status: sx.publication_consent_status, waiver_status: sx.waiver_status, committee_approval_status: e.ethics_approval ? "APPROVED" : e.ethics_exempt ? "EXEMPT_DOCUMENTED" : sx.committee_approval_status, approval_reference: e.approval_number || undefined, privacy_sensitive_media: sx.privacy_sensitive_media },
          trial: { registration_status: tx.registration_status, registry_name: (tx.registry_name || e.trial_registry) || undefined, registration_number: (tx.registration_number || e.trial_registration_number) || undefined, registration_url: tx.registration_url || undefined, registration_date: tx.registration_date || undefined },
          ethics_committee: e.ethics_committee || undefined, approval_number: e.approval_number || undefined, exemption_reason: e.exemption_reason || undefined, trial_registry: e.trial_registry || undefined, trial_registration_number: e.trial_registration_number || undefined, animal_protocol: e.animal_protocol || undefined, ai_none_used: ai.none, ai_tools_used: ai.none ? undefined : ai.items.map((t) => `${t.tool_name.trim()} (${t.purpose.trim()})`).join("; ").slice(0, 1000) },
      };
      const fd = new FormData();
      fd.append("meta", JSON.stringify(meta));
      fd.append("file", file);
      fd.append("idempotency_key", idemKey);
      if (anonFile) fd.append("anonymized_file", anonFile);
      const res = await submitPaper({ data: fd });
      toast.success("Uploaded. Pay the submission fee on the next page to start screening.");
      nav({ to: "/my-research/$id", params: { id: res.id } });
    } catch (err) {
      toast.error(friendlyError(err));
    } finally { setBusy(false); }
  }

  const human = e.human_participants || e.clinical_trial || m.article_type.match(/Trial|Clinical|Case|Observational|Diagnostic/);

  return (
    <div className="mx-auto max-w-3xl px-5 pt-10">
      <PageTitle title="Submit research" subtitle="There are four steps. Screening starts as soon as you submit, and you can follow every check afterwards." />
      <p className="mb-2 text-[15px] font-semibold" aria-live="polite">Step {step + 1} of {STEPS.length}: {STEPS[step]}</p>
      <div className="mb-8 flex gap-1.5" aria-hidden="true">{STEPS.map((_, i) => <div key={i} className={cn("h-1.5 flex-1", i <= step ? "bg-primary" : "bg-wash")} />)}</div>

      {Object.keys(errors).length > 0 && (
        <div role="alert" tabIndex={-1} className="mb-8 border-l-4 border-destructive bg-critical-soft px-4 py-3">
          <p className="font-semibold text-destructive">There is a problem</p>
          <ul className="mt-1 list-disc pl-5 text-[15px]">{Object.values(errors).map((m, i) => <li key={i}>{m}</li>)}</ul>
        </div>
      )}

      <div className="space-y-8">
        {step === 0 && (<>
          <Field label="Manuscript (PDF or Word .docx, up to 25 MB)" error={errors["file"]} hint="Text-based PDFs and Word files screen best. Scanned images cannot be read. Legacy .doc files must be saved as .docx.">
            {(p) => <>
            <input {...p} ref={fileRef} type="file" accept={MANUSCRIPT_ACCEPT} className="sr-only" onChange={(ev) => setFile(ev.target.files?.[0] ?? null)} />
            <button type="button" aria-describedby={p["aria-describedby"]} onClick={() => fileRef.current?.click()} onDragOver={(ev) => ev.preventDefault()} onDrop={(ev) => { ev.preventDefault(); const f = ev.dataTransfer.files?.[0]; if (f) setFile(f); }} className="flex w-full flex-col items-center rounded-[2px] border-2 border-dashed border-input px-4 py-8 hover:bg-wash">
              {file ? <><span className="font-medium">{file.name}</span><span className="text-muted-foreground">{formatBytes(file.size)} · click to replace</span></> : <><span className="font-medium">Choose a PDF or Word file</span><span className="text-muted-foreground">or drop it here</span></>}
            </button>
            </>}
          </Field>
          <Field label="Anonymized copy (optional PDF or Word)" hint="Needed only if this work may enter double-anonymous peer review. Remove author names, affiliations, acknowledgements and identifying self-citations. If you skip it now you can add one later from the submission page; an editor cannot start double-anonymous review without it.">
            <input type="file" accept={MANUSCRIPT_ACCEPT} onChange={(ev) => setAnonFile(ev.target.files?.[0] ?? null)} />
          </Field>
          <Field label="Title" error={errors["title"]}><Input value={m.title} onChange={(ev) => setM({ ...m, title: ev.target.value })} maxLength={400} /></Field>
          <Field label="Abstract" error={errors["abstract"]} hint={`${m.abstract.trim().length} / 5000 characters`}><Textarea rows={7} value={m.abstract} onChange={(ev) => setM({ ...m, abstract: ev.target.value })} maxLength={5000} /></Field>
          <Field label="Keywords" error={errors["keywords"] ?? kwLive ?? undefined} hint="Separate keywords with commas, up to 12, each at most 60 characters."><Input value={m.keywords} onChange={(ev) => setM({ ...m, keywords: ev.target.value })} /></Field>
          <Field label="References" hint="Paste your reference list, one per line or numbered. Include DOIs where you have them; they let the platform check references. Optional, but recommended."><Textarea rows={8} value={m.references} onChange={(ev) => setM({ ...m, references: ev.target.value })} maxLength={60000} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Article type"><select className={select} value={m.article_type} onChange={(ev) => setM({ ...m, article_type: ev.target.value })}>{ARTICLE_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
            <Field label="Research field" error={errors["field"]}><Input value={m.field} onChange={(ev) => setM({ ...m, field: ev.target.value })} placeholder="e.g. Materials science" /></Field>
          </div>
          <Field label="Copyright holder" error={errors["copyright"]} hint="Who owns the copyright: the authors, their institution, or another named owner. Paperly does not assume one."><Input value={m.copyright_holder} onChange={(ev) => setM({ ...m, copyright_holder: ev.target.value })} maxLength={300} /></Field>
          <Field label="Licence" hint="Applies to the published version."><select className={select} value={m.license} onChange={(ev) => setM({ ...m, license: ev.target.value as typeof m.license })}>{LICENSES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}</select></Field>
        </>)}

        {step === 1 && (<>
          {errors["corr"] && <p role="alert" className="text-sm text-destructive">{errors["corr"]}</p>}
          {authors.map((a, i) => {
            const upd = (patch: Partial<Author>) => setAuthors(authors.map((x, j) => (j === i ? { ...x, ...patch } : x)));
            return (
            <section key={i} aria-labelledby={`author-${i}`} className="mx-auto w-full min-w-0 space-y-5 rounded-lg border border-border bg-background p-5 sm:p-6">
              <h2 id={`author-${i}`} className="text-[1.25rem] font-semibold font-serif">Author {i + 1}</h2>
              <div className="grid w-full items-start gap-x-5 gap-y-5 sm:grid-cols-2">
                <Field label="Full name" error={errors[`a${i}name`]}><Input className="w-full" value={a.full_name} onChange={(ev) => upd({ full_name: ev.target.value })} autoComplete="name" /></Field>
                <Field label="Email (optional)" error={errors[`a${i}email`]}><Input className="w-full" type="email" value={a.email} onChange={(ev) => upd({ email: ev.target.value })} autoComplete="email" /></Field>
                <Field label="Affiliation"><Input className="w-full" value={a.affiliation} onChange={(ev) => upd({ affiliation: ev.target.value })} /></Field>
                <Field label="ORCID iD (optional)" error={errors[`a${i}orcid`]} hint="Shown as unverified unless the author links their iD by ORCID sign-in from their Paperly profile."><Input className="w-full" placeholder="0000-0000-0000-0000" value={a.orcid} onChange={(ev) => upd({ orcid: ev.target.value })} /></Field>
              </div>
              <details className="text-[15px]">
                <summary className="cursor-pointer font-medium">Contributions (CRediT roles){a.roles.length > 0 ? `, ${a.roles.length} selected` : ""}</summary>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {CREDIT_ROLES.map(([code, label]) => <Check key={code} checked={a.roles.includes(code)} onChange={(v) => upd({ roles: v ? [...a.roles, code] : a.roles.filter((c) => c !== code) })}>{label}</Check>)}
                </div>
              </details>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                <Check checked={a.is_corresponding} onChange={(v) => setAuthors(authors.map((x, j) => ({ ...x, is_corresponding: j === i ? v : false })))}>Corresponding author</Check>
                {authors.length > 1 && <Button type="button" variant="ghost" size="sm" onClick={() => setAuthors(authors.filter((_, j) => j !== i))}>Remove</Button>}
              </div>
            </section>
            );
          })}
          {authors.length < 30 && <Button type="button" variant="outline" onClick={() => setAuthors([...authors, blankAuthor()])}>Add author</Button>}
          <p className="text-xs text-muted-foreground">AI tools cannot be listed as authors: they cannot take responsibility for the work.</p>
        </>)}

        {step === 2 && (<>
          <section className="space-y-3"><h2 className="text-[1.25rem]">Rights</h2>
            <Check checked={r.is_author} onChange={(v) => setR({ ...r, is_author: v })}>I am an author of this work.</Check>
            <Check checked={r.coauthor_permission} onChange={(v) => setR({ ...r, coauthor_permission: v })}>All co-authors have agreed to this submission.</Check>
            {errors["rights1"] && <p role="alert" className="text-xs text-destructive">{errors["rights1"]}</p>}
            <Check checked={r.has_upload_rights} onChange={(v) => setR({ ...r, has_upload_rights: v })}>I have the right to upload and distribute this work under the chosen licence.</Check>
            {errors["rights2"] && <p role="alert" className="text-xs text-destructive">{errors["rights2"]}</p>}
            <Check checked={r.third_party_content} onChange={(v) => setR({ ...r, third_party_content: v })}>The work contains third-party material (figures, tables, long quotations).</Check>
            {r.third_party_content && <div className="ml-7"><Check checked={r.third_party_permission} onChange={(v) => setR({ ...r, third_party_permission: v })}>I hold permission to reuse that material.</Check></div>}
            <Check checked={r.previously_published} onChange={(v) => { setR({ ...r, previously_published: v, manuscript_version_type: v ? "PREPRINT" : "ORIGINAL_SUBMISSION", previous_doi: v ? r.previous_doi : "" }); if (!v) setPrevRef(""); setErrors((x) => { const { pub: _p, ...rest } = x; return rest; }); }}>This work has been published or posted elsewhere.</Check>
            {r.previously_published && (
              <div className="ml-7 grid gap-4 sm:grid-cols-2">
                <Field label="Version"><select className={select} value={r.manuscript_version_type} onChange={(ev) => setR({ ...r, manuscript_version_type: ev.target.value })}><option value="PREPRINT">Preprint</option><option value="ACCEPTED_MANUSCRIPT">Accepted manuscript</option><option value="PUBLISHER_VERSION">Publisher’s version</option></select></Field>
                <Field label="Earlier DOI"><Input value={r.previous_doi} onChange={(ev) => setR({ ...r, previous_doi: ev.target.value })} placeholder="10.xxxx/…" /></Field><Field label="Where it was published or accepted" hint="Needed for previously published work and accepted manuscripts."><Input value={prevRef} onChange={(ev) => setPrevRef(ev.target.value)} /></Field>
              </div>)}
            {r.previously_published ? pubIssues.map((msg) => <p key={msg} role="alert" className="ml-7 text-[15px] font-medium text-destructive">{msg}</p>) : null}
            {errors["pub"] && !(r.previously_published && pubIssues.length > 0) && <p role="alert" className="ml-7 text-[15px] font-medium text-destructive">{errors["pub"]}</p>}
          </section>

          <section className="space-y-3 border-t border-border pt-7"><h2 className="text-[1.25rem]">Research ethics</h2>
            <Check checked={e.human_participants} onChange={(v) => setE({ ...e, human_participants: v })}>Involves human participants or identifiable data.</Check>
            <Check checked={e.animal_subjects} onChange={(v) => setE({ ...e, animal_subjects: v })}>Involves animal subjects.</Check>
            <Check checked={e.clinical_trial} onChange={(v) => setE({ ...e, clinical_trial: v })}>Is a clinical trial.</Check>
            {human && (<div className="space-y-3 border-l-4 border-border bg-wash p-4">
              <Check checked={e.ethics_approval} onChange={(v) => setE({ ...e, ethics_approval: v })}>Ethics approval was obtained.</Check>
              {e.ethics_approval && <div className="grid gap-4 sm:grid-cols-2"><Field label="Committee"><Input value={e.ethics_committee} onChange={(ev) => setE({ ...e, ethics_committee: ev.target.value })} /></Field><Field label="Approval number"><Input value={e.approval_number} onChange={(ev) => setE({ ...e, approval_number: ev.target.value })} /></Field></div>}
              <Check checked={e.ethics_exempt} onChange={(v) => setE({ ...e, ethics_exempt: v })}>Exempt from ethics review.</Check>
              {e.ethics_exempt && <Field label="Reason for exemption"><Input value={e.exemption_reason} onChange={(ev) => setE({ ...e, exemption_reason: ev.target.value })} /></Field>}
              <Check checked={e.informed_consent} onChange={(v) => setE({ ...e, informed_consent: v })}>Informed consent was obtained.</Check>
              {e.clinical_trial && <div className="grid gap-4 sm:grid-cols-2"><Field label="Trial registry"><Input value={e.trial_registry} onChange={(ev) => setE({ ...e, trial_registry: ev.target.value })} /></Field><Field label="Registration number"><Input value={e.trial_registration_number} onChange={(ev) => setE({ ...e, trial_registration_number: ev.target.value })} /></Field></div>}
            </div>)}
            {e.animal_subjects && <Field label="Animal-care protocol"><Input value={e.animal_protocol} onChange={(ev) => setE({ ...e, animal_protocol: ev.target.value })} /></Field>}
            <Check checked={sx.identifiable_info_present} onChange={(v) => setSx({ ...sx, identifiable_info_present: v })}>Contains identifiable patient or participant information, images or data.</Check>
            {(human || sx.identifiable_info_present || sx.privacy_sensitive_media) && (<div className="space-y-3 border-l-4 border-border bg-wash p-4">
              <p className="text-[15px] text-muted-foreground">Ethics approval, consent to take part and consent to publish are three separate things. Approval does not mean consent to publish exists.</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Ethics committee / IRB status"><select className={select} value={sx.committee_approval_status} onChange={(ev) => setSx({ ...sx, committee_approval_status: ev.target.value })}><option value="NOT_APPLICABLE">Not stated</option><option value="PENDING">Pending</option><option value="NOT_OBTAINED">Not obtained</option></select></Field>
                <Field label="Consent to take part (if not ticked above)"><select className={select} value={sx.informed_consent_status} onChange={(ev) => setSx({ ...sx, informed_consent_status: ev.target.value })}><option value="NOT_APPLICABLE">Not applicable</option><option value="OBTAINED">Obtained</option><option value="NOT_OBTAINED">Not obtained</option></select></Field>
                <Field label="Consent to PUBLISH identifiable information"><select className={select} value={sx.publication_consent_status} onChange={(ev) => setSx({ ...sx, publication_consent_status: ev.target.value })}><option value="NOT_APPLICABLE">Not stated</option><option value="OBTAINED">Obtained</option><option value="WAIVED_DOCUMENTED">Waived (documented)</option><option value="NOT_OBTAINED">Not obtained</option></select></Field>
                <Field label="Consent waiver"><select className={select} value={sx.waiver_status} onChange={(ev) => setSx({ ...sx, waiver_status: ev.target.value })}><option value="NOT_APPLICABLE">Not applicable</option><option value="WAIVER_GRANTED">Granted by an ethics body</option><option value="WAIVER_NOT_GRANTED">Not granted</option></select></Field>
                {sx.identifiable_info_present && <Field label="De-identification"><select className={select} value={sx.deidentification_status} onChange={(ev) => setSx({ ...sx, deidentification_status: ev.target.value })}><option value="NOT_APPLICABLE">Not stated</option><option value="NOT_DEIDENTIFIED">Not de-identified</option><option value="PARTIALLY_DEIDENTIFIED">Partly de-identified</option><option value="FULLY_DEIDENTIFIED">Fully de-identified</option></select></Field>}
              </div>
              <Check checked={sx.privacy_sensitive_media} onChange={(v) => setSx({ ...sx, privacy_sensitive_media: v })}>Includes privacy-sensitive images, video or data.</Check>
            </div>)}
            {(e.clinical_trial || /Trial|Clinical/.test(m.article_type)) && (<div className="space-y-3 border-l-4 border-border bg-wash p-4">
              <p className="text-[15px] text-muted-foreground">Registration is recorded as you declare it. Paperly does not check registries automatically; an ethics reviewer verifies it by hand.</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Trial registration"><select className={select} value={tx.registration_status} onChange={(ev) => setTx({ ...tx, registration_status: ev.target.value })}><option value="NOT_APPLICABLE">Not stated</option><option value="REGISTERED_PROSPECTIVELY">Registered before enrolment</option><option value="REGISTERED_RETROSPECTIVELY">Registered after enrolment began</option><option value="NOT_REGISTERED">Not registered</option></select></Field>
                <Field label="Registry URL (https)"><Input value={tx.registration_url} onChange={(ev) => setTx({ ...tx, registration_url: ev.target.value })} /></Field>
                <Field label="Registry name"><Input value={tx.registry_name} onChange={(ev) => setTx({ ...tx, registry_name: ev.target.value })} /></Field>
                <Field label="Registration number"><Input value={tx.registration_number} onChange={(ev) => setTx({ ...tx, registration_number: ev.target.value })} /></Field>
                <Field label="Registration date"><Input type="date" value={tx.registration_date} onChange={(ev) => setTx({ ...tx, registration_date: ev.target.value })} /></Field>
              </div>
            </div>)}
            <Field label="Conflicts of interest" error={errors["coi"]}><Textarea rows={2} value={e.conflict_of_interest} onChange={(ev) => setE({ ...e, conflict_of_interest: ev.target.value })} /></Field>
            <Field label="Funding" error={errors["funding"]}><Textarea rows={2} value={e.funding} onChange={(ev) => setE({ ...e, funding: ev.target.value })} /></Field>
            <Field label="Data availability" error={errors["data"]}><Textarea rows={2} value={e.data_availability} onChange={(ev) => setE({ ...e, data_availability: ev.target.value })} /></Field>
          </section>

          <section className="space-y-3 border-t border-border pt-7"><h2 className="text-[1.25rem]">Use of AI in preparing this work</h2>
            <p className="text-sm text-muted-foreground">Disclosure carries no penalty. Spelling and grammar checkers need not be listed. Authors remain responsible for everything in the manuscript, and an AI system cannot be an author.</p>
            <Check checked={ai.none} onChange={(v) => setAi({ none: v, items: v ? [] : ai.items })}>No generative AI was used to search literature, write, translate, analyse data, write code, or create images or figures for this work.</Check>
            {!ai.none && (<div className="space-y-5">
              {errors["ai"] && <p role="alert" className="text-sm font-medium text-destructive">{errors["ai"]}</p>}
              {errors["ai2"] && <p role="alert" className="text-sm font-medium text-destructive">{errors["ai2"]}</p>}
              {ai.items.map((t, i) => {
                const set = (patch: Partial<AiItem>) => setAi({ ...ai, items: ai.items.map((x, j) => j === i ? { ...x, ...patch } : x) });
                return (
                  <fieldset key={i} className="space-y-3 border-l-4 border-border bg-wash p-4">
                    <legend className="sr-only">AI tool {i + 1}</legend>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Kind of use"><select className={select} value={t.category} onChange={(ev) => set({ category: ev.target.value as AiUseCategory })}>{AI_USE_CATEGORIES.map(([c, l]) => <option key={c} value={c}>{l}</option>)}</select></Field>
                      <Field label="Tool name"><Input value={t.tool_name} onChange={(ev) => set({ tool_name: ev.target.value })} maxLength={120} /></Field>
                      <Field label="Version, if known"><Input value={t.tool_version} onChange={(ev) => set({ tool_version: ev.target.value })} maxLength={60} /></Field>
                      <Field label="Purpose"><Input value={t.purpose} onChange={(ev) => set({ purpose: ev.target.value })} maxLength={500} placeholder="e.g. Language editing" /></Field>
                    </div>
                    <Field label="Extent of use"><Input value={t.extent} onChange={(ev) => set({ extent: ev.target.value })} maxLength={500} placeholder="e.g. Introduction and Discussion only" /></Field>
                    <Field label="Human verification statement"><Textarea rows={2} value={t.human_verification} onChange={(ev) => set({ human_verification: ev.target.value })} maxLength={1000} placeholder="e.g. The authors reviewed, edited and approved all output." /></Field>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setAi({ ...ai, items: ai.items.filter((_, j) => j !== i) })}>Remove this tool</Button>
                  </fieldset>
                );
              })}
              {ai.items.length < 12 && <Button type="button" variant="outline" onClick={() => setAi({ ...ai, items: [...ai.items, blankAi()] })}>Add an AI tool</Button>}
            </div>)}
          </section>

          <section className="space-y-2 border-t border-border pt-7"><h2 className="text-[1.25rem]">Automated screening</h2>
            <Check checked={r.ai_processing_consent} onChange={(v) => setR({ ...r, ai_processing_consent: v })}>I consent to the manuscript text being sent to an external AI service for screening. It produces findings only. It is not peer review, and a human editor makes every decision. The text is not used to train models.</Check>
            {errors["consent"] && <p role="alert" className="text-xs text-destructive">{errors["consent"]}</p>}
          </section>
        </>)}

        {step === 3 && (
          <dl className="grid gap-x-6 gap-y-3 border-y border-border py-4 sm:grid-cols-[10rem_1fr]">
            {[["File", file ? `${file.name} (${formatBytes(file.size)})` : "—"], ["Title", m.title], ["Type and field", `${m.article_type}, ${m.field}`], ["Keywords", keywords.join(", ")], ["Authors", authors.map((a) => a.full_name + (a.is_corresponding ? " (corresponding)" : "")).join("; ")], ["Licence", LICENSES.find((l) => l.code === m.license)?.label ?? m.license], ["AI use", ai.none ? "None declared" : ai.items.map((t) => `${t.tool_name} (${t.purpose})`).join("; ")], ["Copyright holder", m.copyright_holder]].map(([k, v]) => (
              <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="break-words">{v}</dd></div>
            ))}
          </dl>
        )}

        <div className="flex items-center justify-between border-t-2 border-foreground pt-5">
          <Button type="button" variant="ghost" disabled={step === 0 || busy} onClick={() => setStep(step - 1)}>Back</Button>
          {step < 3 ? <Button type="button" onClick={next}>Continue</Button> : <Button type="button" onClick={submit} disabled={busy}>{busy ? "Uploading…" : "Upload and continue to payment"}</Button>}
        </div>
      </div>
    </div>
  );
}
