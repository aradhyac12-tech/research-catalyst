import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { cloneElement, isValidElement, useEffect, useId, useRef, useState } from "react";
import { Check as CheckIcon } from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { submitPaper, suggestMetadata } from "@/lib/app.functions";
import { appendFile, forgetFile, stageFile } from "@/lib/stage-upload";
import { UploadRow, SubmitProgress } from "@/components/upload-progress";
import { meQuery } from "@/lib/queries";
import { canSuggestMetadata } from "@/lib/domain/permissions";
import { MANUSCRIPT_ACCEPT } from "@/lib/domain/file-security";
import { LICENSES, SCREENING_PROFILES } from "@/lib/domain/constants";
import { AI_USE_CATEGORIES, CREDIT_ROLES, looksLikeAiAuthor, type AiUseCategory } from "@/lib/domain/scholarly";
import { orcidChecksumOk } from "@/lib/domain/orcid";
import { KEYWORDS_MAX_COUNT, KEYWORD_MAX_LENGTH, keywordProblem, parseKeywords } from "@/lib/domain/keywords";
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

const MAX_BYTES = 50 * 1024 * 1024;
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
const select = "flex h-11 w-full rounded-lg border border-input bg-background px-3 text-base focus-visible:outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/30";

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
  const alertRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [file, setFile] = useState<File | null>(null);
  const [anonFile, setAnonFile] = useState<File | null>(null);
  const [upPct, setUpPct] = useState<{ file: number; anon: number }>({ file: 0, anon: 0 });
  const [saving, setSaving] = useState(false);
  const [upErr, setUpErr] = useState<{ file?: string; anon?: string }>({});
  /** Starts uploading the moment a file is chosen, so by the time the form is filled in the file is usually already there. */
  const pick = (which: "file" | "anon", f: File | null) => {
    (which === "file" ? setFile : setAnonFile)(f);
    setUpPct((p) => ({ ...p, [which]: 0 })); setUpErr((e) => ({ ...e, [which]: undefined }));
    if (f) stageFile(f, (v) => setUpPct((p) => ({ ...p, [which]: v }))).catch((err) => setUpErr((e) => ({ ...e, [which]: err instanceof Error ? err.message : "Upload failed" })));
  };
  const { data: me } = useQuery(meQuery());
  const canSuggest = canSuggestMetadata(me?.roles ?? []);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestNotes, setSuggestNotes] = useState<string[]>([]);
  const [m, setM] = useState({ title: "", abstract: "", keywords: "", references: "", article_type: "Original Research", field: "", license: "CC-BY" as (typeof LICENSES)[number]["code"], copyright_holder: "" });
  const [authors, setAuthors] = useState<Author[]>([blankAuthor(true)]);
  const [r, setR] = useState({ is_author: false, coauthor_permission: false, has_upload_rights: false, previously_published: false, previous_doi: "", manuscript_version_type: "ORIGINAL_SUBMISSION", third_party_content: false, third_party_permission: false, ai_processing_consent: false });
    const [ai, setAi] = useState<{ none: boolean; items: AiItem[] }>({ none: false, items: [] });
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
      else if (file.size > MAX_BYTES) x["file"] = "The file is larger than 50 MB.";
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
      const seenEmail = new Map<string, number>();
      authors.forEach((a, i) => { const e = a.email.trim().toLowerCase(); if (!e) return; if (seenEmail.has(e)) x[`a${i}email`] = `Author ${(seenEmail.get(e) ?? 0) + 1} already uses this email. Each author needs their own address.`; else seenEmail.set(e, i); });
      if (!authors.some((a) => a.is_corresponding)) x["corr"] = "Mark one corresponding author.";
    }
    if (s === 2) {
      if (!(r.is_author || r.coauthor_permission)) x["rights1"] = "Confirm you are an author or have every author's permission.";
      if (!r.has_upload_rights) x["rights2"] = "Confirm you have the right to upload this work.";
      if (!r.ai_processing_consent) x["consent"] = "AI-assisted screening consent is required to submit.";
      if (pubIssues.length > 0) x["pub"] = pubIssues.join(" ");
      else if (r.previously_published && r.manuscript_version_type === "PUBLISHER_VERSION") x["pub"] = "Publisher versions can only be hosted with permission; choose the accepted manuscript or preprint, or contact us.";
      if (!ai.none && ai.items.length === 0) x["ai"] = "Declare the AI tools you used, or confirm that none were used.";
      if (!ai.none && ai.items.some((t) => t.tool_name.trim().length < 2 || t.purpose.trim().length < 3 || t.extent.trim().length < 3 || t.human_verification.trim().length < 10)) x["ai2"] = "For each AI tool give its name, purpose, extent of use, and a statement of how the authors verified the output (at least 10 characters).";
    }
    setErrors(x);
    return Object.keys(x).length === 0;
  }
  /** Reads the chosen file on the server and fills Abstract, Keywords and References. Nothing is overwritten without asking, and everything stays editable. */
  async function suggest() {
    if (!canSuggest || !file || !r.ai_processing_consent) return;
    setSuggesting(true); setSuggestNotes([]);
    try {
      const fd = new FormData();
      await appendFile(fd, "file", file); fd.append("ai_consent", "true");
      const res = await suggestMetadata({ data: fd });
      const hasTyped = !!(m.abstract.trim() || m.keywords.trim() || m.references.trim());
      if (hasTyped && (res.abstract || res.keywords.length || res.referenceCount) && !window.confirm("Replace the abstract, keywords and references you already typed with the suggestions?")) { toast.message("Kept what you typed."); return; }
      setM((cur) => ({ ...cur, abstract: res.abstract || cur.abstract, keywords: res.keywords.length ? res.keywords.join(", ") : cur.keywords, references: res.referenceCount ? res.references : cur.references }));
      setErrors((x) => { const { keywords: _k, abstract: _a, ...rest } = x; void _k; void _a; return rest; });
      setSuggestNotes(res.notes);
      toast.success(`${res.abstract ? "Abstract, " : ""}${res.keywords.length} keyword${res.keywords.length === 1 ? "" : "s"} and ${res.referenceCount} reference${res.referenceCount === 1 ? "" : "s"} suggested. Please check them.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message.slice(0, 240) : "Suggestions could not be made. Type your abstract, keywords and references instead.");
    } finally { setSuggesting(false); }
  }
  const errorCount = Object.keys(errors).length;
  useEffect(() => { if (errorCount > 0) { alertRef.current?.focus(); alertRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }); } }, [errorCount]);
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
        // Research ethics is switched off: the server still stores a neutral record, nothing here is asked of the author.
        ethics: { human_participants: false, animal_subjects: false, clinical_trial: false, ethics_approval: false, ethics_exempt: false, informed_consent: false, conflict_of_interest: "", funding: "", data_availability: "",
          subject: { human_participants: false, identifiable_info_present: false, deidentification_status: "NOT_APPLICABLE", informed_consent_status: "NOT_APPLICABLE", publication_consent_status: "NOT_APPLICABLE", waiver_status: "NOT_APPLICABLE", committee_approval_status: "NOT_APPLICABLE", privacy_sensitive_media: false },
          trial: { registration_status: "NOT_APPLICABLE" },
          ai_none_used: ai.none, ai_tools_used: ai.none ? undefined : ai.items.map((t) => `${t.tool_name.trim()} (${t.purpose.trim()})`).join("; ").slice(0, 1000) },
      };
      const fd = new FormData();
      fd.append("meta", JSON.stringify(meta));
      await appendFile(fd, "file", file, (v) => setUpPct((p) => ({ ...p, file: v })));
      fd.append("idempotency_key", idemKey);
      if (anonFile) await appendFile(fd, "anonymized_file", anonFile, (v) => setUpPct((p) => ({ ...p, anon: v })));
      setSaving(true);
      const res = await submitPaper({ data: fd });
      toast.success("Uploaded. Pay the submission fee on the next page to start screening.");
      nav({ to: "/my-research/$id", params: { id: res.id } });
    } catch (err) {
      forgetFile(file); forgetFile(anonFile); setUpPct({ file: 0, anon: 0 }); setSaving(false);
      toast.error(friendlyError(err));
    } finally { setBusy(false); setSaving(false); }
  }


  return (
    <div className="mx-auto max-w-3xl px-5 pt-10">
      <PageTitle title="Submit research" subtitle="There are four steps. Screening starts as soon as you submit, and you can follow every check afterwards." />
      <p className="sr-only" aria-live="polite">Step {step + 1} of {STEPS.length}: {STEPS[step]}</p>
      <ol className="mb-10 flex items-center" aria-label="Progress">
        {STEPS.map((label, i) => (
          <li key={label} className={cn("flex items-center", i < STEPS.length - 1 && "flex-1")} aria-current={i === step ? "step" : undefined}>
            <button type="button" disabled={i >= step || busy} onClick={() => setStep(i)} className="group flex items-center gap-2.5 disabled:cursor-default">
              <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold transition-[background-color,border-color,color,box-shadow] duration-300 ease-premium",
                i < step ? "border-primary bg-primary text-primary-foreground group-hover:bg-primary/90" : i === step ? "border-primary bg-background text-primary shadow-[0_0_0_4px_color-mix(in_srgb,var(--color-primary)_14%,transparent)]" : "border-border bg-background text-muted-foreground")}>
                {i < step ? <CheckIcon aria-hidden="true" className="size-4" /> : i + 1}
              </span>
              <span className={cn("text-[15px] transition-colors duration-300", i === step ? "font-semibold text-foreground" : "hidden text-muted-foreground sm:inline")}>{label}</span>
            </button>
            {i < STEPS.length - 1 && <span aria-hidden="true" className="relative mx-3 h-px flex-1 bg-border"><span className="absolute inset-y-0 left-0 bg-primary transition-[width] duration-500 ease-premium" style={{ width: i < step ? "100%" : "0%" }} /></span>}
          </li>
        ))}
      </ol>

      {Object.keys(errors).length > 0 && (
        <div ref={alertRef} role="alert" tabIndex={-1} className="mb-8 rounded-lg border border-destructive/30 bg-critical-soft px-4 py-3 outline-none animate-in fade-in-0 slide-in-from-top-1 duration-300">
          <p className="font-semibold text-destructive">There is a problem</p>
          <ul className="mt-1 list-disc pl-5 text-[15px]">{Object.values(errors).map((m, i) => <li key={i}>{m}</li>)}</ul>
        </div>
      )}

      <div key={step} className="animate-in fade-in-0 slide-in-from-bottom-2 space-y-8 duration-300">
        {step === 0 && (<>
          <Field label="Manuscript (PDF or Word .docx, up to 50 MB)" error={errors["file"]} hint="Text-based PDFs and Word files screen best. Scanned images cannot be read. Legacy .doc files must be saved as .docx.">
            {(p) => <>
            <input {...p} ref={fileRef} type="file" accept={MANUSCRIPT_ACCEPT} className="sr-only" onChange={(ev) => pick("file", ev.target.files?.[0] ?? null)} />
            <button type="button" aria-describedby={p["aria-describedby"]} onClick={() => fileRef.current?.click()} onDragOver={(ev) => ev.preventDefault()} onDrop={(ev) => { ev.preventDefault(); const f = ev.dataTransfer.files?.[0]; if (f) pick("file", f); }} className="flex w-full min-w-0 flex-col items-center overflow-hidden rounded-lg border-2 border-dashed border-input px-4 py-8 hover:bg-wash">
              {file ? <><span className="max-w-full text-center font-medium break-words">{file.name}</span><span className="text-muted-foreground">{formatBytes(file.size)} · click to replace</span></> : <><span className="font-medium">Choose a PDF or Word file</span><span className="text-muted-foreground">or drop it here</span></>}
            </button>
            {file && file.size > 1024 * 1024 && <div className="mt-3"><UploadRow name={file.name} size={file.size} pct={upPct.file} error={upErr.file} state={upErr.file ? "error" : upPct.file >= 1 ? "done" : "uploading"} /></div>}
            </>}
          </Field>
          <Field label="Anonymized copy (optional PDF or Word)" hint="Needed only if this work may enter double-anonymous peer review. Remove author names, affiliations, acknowledgements and identifying self-citations. If you skip it now you can add one later from the submission page; an editor cannot start double-anonymous review without it.">
            <input type="file" accept={MANUSCRIPT_ACCEPT} onChange={(ev) => pick("anon", ev.target.files?.[0] ?? null)} />
            {anonFile && anonFile.size > 1024 * 1024 && <div className="mt-3"><UploadRow name={anonFile.name} size={anonFile.size} pct={upPct.anon} error={upErr.anon} state={upErr.anon ? "error" : upPct.anon >= 1 ? "done" : "uploading"} /></div>}
          </Field>
          <Field label="Title" error={errors["title"]}><Input value={m.title} onChange={(ev) => setM({ ...m, title: ev.target.value })} maxLength={400} /></Field>
          <Field label="Abstract" error={errors["abstract"]} hint={`${m.abstract.trim().length} / 5000 characters`}><Textarea rows={7} value={m.abstract} onChange={(ev) => setM({ ...m, abstract: ev.target.value })} maxLength={5000} /></Field>
          {canSuggest && <div className="space-y-3 border border-border bg-muted/30 p-4">
            <p className="font-semibold">Fill abstract, keywords and references from the file <span className="ml-2 border border-foreground px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide">Founder / admin</span></p>
            <p className="text-[15px] text-muted-foreground">An AI service reads your uploaded manuscript, copies your abstract (or writes one if your file has none), suggests keywords and copies out your reference list. A reference is only kept if it appears in your file, so none is invented. These are suggestions: check all three before you continue.</p>
            <Check checked={r.ai_processing_consent} onChange={(v) => setR({ ...r, ai_processing_consent: v })}>I consent to the manuscript text being sent to an external AI service. The text is not used to train models.</Check>
            <Button type="button" variant="outline" onClick={suggest} disabled={!file || !r.ai_processing_consent || suggesting}>{suggesting ? "Reading your file…" : "Suggest abstract, keywords and references"}</Button>
            {!file && <p className="text-sm text-muted-foreground">Choose your manuscript file first.</p>}
            {suggestNotes.length > 0 && <ul role="status" className="list-disc space-y-1 pl-5 text-sm">{suggestNotes.map((n) => <li key={n}>{n}</li>)}</ul>}
          </div>}
          <Field label="Keywords" error={errors["keywords"] ?? kwLive ?? undefined} hint={`Separate keywords with commas, up to ${KEYWORDS_MAX_COUNT}, each at most ${KEYWORD_MAX_LENGTH} characters.`}><Input value={m.keywords} onChange={(ev) => setM({ ...m, keywords: ev.target.value })} /></Field>
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
            const hasMore = !!(a.affiliation || a.orcid || a.roles.length);
            return (
            <section key={i} aria-labelledby={`author-${i}`} className="mx-auto w-full min-w-0 space-y-5 rounded-lg border border-border bg-background p-5 sm:p-6">
              <h2 id={`author-${i}`} className="text-[1.25rem] font-semibold font-serif">Author {i + 1}</h2>
              <div className="grid w-full items-start gap-x-5 gap-y-5 sm:grid-cols-2">
                <Field label="Full name" error={errors[`a${i}name`]}><Input className="w-full" value={a.full_name} onChange={(ev) => upd({ full_name: ev.target.value })} autoComplete="name" /></Field>
                <Field label="Email (optional)" error={errors[`a${i}email`]} hint="Each author gets their own certificate with their name on it when the work is published. Every author with an email address receives one e-mail with all the authors' certificates attached."><Input className="w-full" type="email" value={a.email} onChange={(ev) => upd({ email: ev.target.value })} autoComplete="off" /></Field>
              </div>
              <details className="text-[15px]" open={hasMore ? true : undefined}>
                <summary className="cursor-pointer font-medium">More details (optional): affiliation, ORCID iD, contributions</summary>
                <div className="mt-4 space-y-5">
                  <div className="grid w-full items-start gap-x-5 gap-y-5 sm:grid-cols-2">
                    <Field label="Affiliation (optional)"><Input className="w-full" value={a.affiliation} onChange={(ev) => upd({ affiliation: ev.target.value })} /></Field>
                    <Field label="ORCID iD (optional)" error={errors[`a${i}orcid`]} hint="Shown as unverified unless the author links their iD by ORCID sign-in from their Paperly profile."><Input className="w-full" placeholder="0000-0000-0000-0000" value={a.orcid} onChange={(ev) => upd({ orcid: ev.target.value })} /></Field>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {CREDIT_ROLES.map(([code, label]) => <Check key={code} checked={a.roles.includes(code)} onChange={(v) => upd({ roles: v ? [...a.roles, code] : a.roles.filter((c) => c !== code) })}>{label}</Check>)}
                  </div>
                </div>
              </details>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                <Check checked={a.is_corresponding} onChange={(v) => setAuthors(authors.map((x, j) => ({ ...x, is_corresponding: j === i ? v : false })))}>Corresponding author</Check>
                {authors.length > 1 && <Button type="button" variant="ghost" size="sm" onClick={() => setAuthors(authors.filter((_, j) => j !== i).map((x, j, arr) => (arr.some((y) => y.is_corresponding) ? x : { ...x, is_corresponding: j === 0 })))}>Remove</Button>}
              </div>
            </section>
            );
          })}
          {authors.length < 30 && <Button type="button" variant="outline" onClick={() => setAuthors([...authors, blankAuthor()])}>Add another author</Button>}
          <p className="text-xs text-muted-foreground">Every author you add gets their own certificate with their name on it. Each email address receives all the certificates for this article, so give every author a different email.</p>
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

          <section className="space-y-3 border-t border-border pt-7"><h2 className="text-[1.25rem]">Use of AI in preparing this work</h2>
            <p className="text-sm text-muted-foreground">Disclosure carries no penalty. Spelling and grammar checkers need not be listed. Authors remain responsible for everything in the manuscript, and an AI system cannot be an author.</p>
            <Check checked={ai.none} onChange={(v) => setAi({ none: v, items: v ? [] : ai.items })}>No generative AI was used to search literature, write, translate, analyse data, write code, or create images or figures for this work.</Check>
            {!ai.none && (<div className="space-y-5">
              {errors["ai"] && <p role="alert" className="text-sm font-medium text-destructive">{errors["ai"]}</p>}
              {errors["ai2"] && <p role="alert" className="text-sm font-medium text-destructive">{errors["ai2"]}</p>}
              {ai.items.map((t, i) => {
                const set = (patch: Partial<AiItem>) => setAi({ ...ai, items: ai.items.map((x, j) => j === i ? { ...x, ...patch } : x) });
                return (
                  <fieldset key={i} className="space-y-3 rounded-lg border border-border bg-wash p-4">
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
          <dl className="grid gap-x-6 gap-y-3 border-y border-border py-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
            {[["File", file ? `${file.name} (${formatBytes(file.size)})` : "—"], ["Title", m.title], ["Type and field", `${m.article_type}, ${m.field}`], ["Keywords", keywords.join(", ")], ["Authors", authors.map((a) => a.full_name + (a.is_corresponding ? " (corresponding)" : "")).join("; ")], ["Licence", LICENSES.find((l) => l.code === m.license)?.label ?? m.license], ["AI use", ai.none ? "None declared" : ai.items.map((t) => `${t.tool_name} (${t.purpose})`).join("; ")], ["Copyright holder", m.copyright_holder]].map(([k, v]) => (
              <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="break-words">{v}</dd></div>
            ))}
          </dl>
        )}

        {step === 3 && busy && file && (
          <SubmitProgress saving={saving} rows={[
            { key: "file", label: "Manuscript", name: file.name, size: file.size, pct: file.size > 1024 * 1024 ? upPct.file : 1, error: upErr.file },
            ...(anonFile ? [{ key: "anon", label: "Anonymized copy", name: anonFile.name, size: anonFile.size, pct: anonFile.size > 1024 * 1024 ? upPct.anon : 1, error: upErr.anon }] : []),
          ]} />
        )}

        <div className="sticky bottom-0 z-10 -mx-5 flex items-center justify-between border-t border-border bg-background/90 px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 backdrop-blur">
          <Button type="button" variant="ghost" disabled={step === 0 || busy} onClick={() => setStep(step - 1)}>Back</Button>
          {step < 3 ? <Button type="button" onClick={next}>Continue</Button> : <Button type="button" onClick={submit} disabled={busy}>{busy ? (saving ? "Saving…" : `Uploading ${Math.round(((file ? file.size * (file.size > 1048576 ? upPct.file : 1) : 0) + (anonFile ? anonFile.size * (anonFile.size > 1048576 ? upPct.anon : 1) : 0)) / ((file?.size ?? 0) + (anonFile?.size ?? 0) || 1) * 100)}%`) : "Upload and continue to payment"}</Button>}
        </div>
      </div>
    </div>
  );
}
