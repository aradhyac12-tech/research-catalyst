import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { submitPaper, startScreening } from "@/lib/app.functions";
import { LICENSES, SCREENING_PROFILES } from "@/lib/domain/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { PageTitle } from "@/lib/ui";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/submit")({
  head: () => ({ meta: [{ title: "Submit research — Paperly" }, { name: "robots", content: "noindex" }] }),
  component: Submit,
});

const MAX_BYTES = 25 * 1024 * 1024;
const ARTICLE_TYPES = ["Original Research", ...Object.keys(SCREENING_PROFILES).filter((k) => k !== "default")];
const STEPS = ["Manuscript", "Authors", "Declarations", "Review"] as const;
const select = "flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

interface Author { full_name: string; email: string; affiliation: string; orcid: string; is_corresponding: boolean }
const blankAuthor = (c = false): Author => ({ full_name: "", email: "", affiliation: "", orcid: "", is_corresponding: c });

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | undefined; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label>{label}</Label>{children}{hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}{error && <p role="alert" className="text-xs text-destructive">{error}</p>}</div>;
}
function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return <label className="flex cursor-pointer items-start gap-3 text-sm leading-snug"><Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} className="mt-0.5" /><span>{children}</span></label>;
}

function Submit() {
  const nav = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [file, setFile] = useState<File | null>(null);
  const [m, setM] = useState({ title: "", abstract: "", keywords: "", article_type: "Original Research", field: "", license: "CC-BY" as (typeof LICENSES)[number]["code"] });
  const [authors, setAuthors] = useState<Author[]>([blankAuthor(true)]);
  const [r, setR] = useState({ is_author: false, coauthor_permission: false, has_upload_rights: false, previously_published: false, previous_doi: "", manuscript_version_type: "ORIGINAL_SUBMISSION", third_party_content: false, third_party_permission: false, ai_processing_consent: false });
  const [e, setE] = useState({ human_participants: false, animal_subjects: false, clinical_trial: false, ethics_approval: false, ethics_committee: "", approval_number: "", ethics_exempt: false, exemption_reason: "", informed_consent: false, trial_registry: "", trial_registration_number: "", animal_protocol: "", conflict_of_interest: "", funding: "", data_availability: "" });
  const [ai, setAi] = useState({ none: false, tools: "" });

  const keywords = m.keywords.split(",").map((k) => k.trim()).filter(Boolean);

  function validate(s: number) {
    const x: Record<string, string> = {};
    if (s === 0) {
      if (!file) x["file"] = "Attach your manuscript as a PDF.";
      else if (file.size > MAX_BYTES) x["file"] = "The file is larger than 25 MB.";
      else if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") x["file"] = "Only PDF files are accepted.";
      if (m.title.trim().length < 5) x["title"] = "Enter the full title (at least 5 characters).";
      if (m.abstract.trim().length < 50) x["abstract"] = "The abstract needs at least 50 characters.";
      if (keywords.length < 1 || keywords.length > 12) x["keywords"] = "Add between 1 and 12 keywords, separated by commas.";
      if (m.field.trim().length < 2) x["field"] = "Name the research field.";
    }
    if (s === 1) {
      authors.forEach((a, i) => {
        if (a.full_name.trim().length < 2) x[`a${i}name`] = "Name required.";
        if (a.email && !/^\S+@\S+\.\S+$/.test(a.email)) x[`a${i}email`] = "Enter a valid email.";
        if (a.orcid && !/^(\d{4}-){3}\d{3}[\dX]$/.test(a.orcid)) x[`a${i}orcid`] = "ORCID format: 0000-0000-0000-0000.";
      });
      if (!authors.some((a) => a.is_corresponding)) x["corr"] = "Mark one corresponding author.";
    }
    if (s === 2) {
      if (!(r.is_author || r.coauthor_permission)) x["rights1"] = "Confirm you are an author or have every author's permission.";
      if (!r.has_upload_rights) x["rights2"] = "Confirm you have the right to upload this work.";
      if (!r.ai_processing_consent) x["consent"] = "AI-assisted screening consent is required to submit.";
      if (r.previously_published && r.manuscript_version_type === "PUBLISHER_VERSION") x["pub"] = "Publisher versions can only be hosted with permission; choose the accepted manuscript or preprint, or contact us.";
      if (e.conflict_of_interest.trim().length < 2) x["coi"] = "State conflicts of interest, or write “None”.";
      if (e.funding.trim().length < 2) x["funding"] = "State funding, or write “None”.";
      if (e.data_availability.trim().length < 2) x["data"] = "Describe data availability.";
      if (!ai.none && ai.tools.trim().length < 3) x["ai"] = "Declare the AI tools you used, or confirm that none were used.";
    }
    setErrors(x);
    return Object.keys(x).length === 0;
  }
  const next = () => { if (validate(step)) { setStep(step + 1); window.scrollTo({ top: 0 }); } };

  async function submit() {
    if (!validate(2) || !file) return;
    setBusy(true);
    try {
      const meta = {
        title: m.title.trim(), abstract: m.abstract.trim(), keywords, article_type: m.article_type, field: m.field.trim(), license: m.license,
        authors: authors.map((a) => ({ full_name: a.full_name.trim(), email: a.email.trim(), affiliation: a.affiliation.trim(), orcid: a.orcid.trim(), is_corresponding: a.is_corresponding })),
        rights: { ...r, previous_doi: r.previous_doi.trim() || undefined, third_party_permission: r.third_party_content ? r.third_party_permission : undefined, ai_processing_consent: true as const },
        ethics: { ...e, ethics_committee: e.ethics_committee || undefined, approval_number: e.approval_number || undefined, exemption_reason: e.exemption_reason || undefined, trial_registry: e.trial_registry || undefined, trial_registration_number: e.trial_registration_number || undefined, animal_protocol: e.animal_protocol || undefined, ai_none_used: ai.none, ai_tools_used: ai.none ? undefined : ai.tools.trim() },
      };
      const fd = new FormData();
      fd.append("meta", JSON.stringify(meta));
      fd.append("file", file);
      const res = await submitPaper({ data: fd });
      toast.success("Submitted. Screening has started.");
      void startScreening({ data: { id: res.id } }).catch(() => undefined); // runs in the background; the report page also starts it if needed
      nav({ to: "/my-research/$id", params: { id: res.id } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Submission failed. Nothing was lost; please try again.");
    } finally { setBusy(false); }
  }

  const human = e.human_participants || e.clinical_trial || m.article_type.match(/Trial|Clinical|Case|Observational|Diagnostic/);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <PageTitle title="Submit research" subtitle="Four short steps. Screening starts as soon as you submit, and you can follow every check." />
      <ol className="mb-8 grid grid-cols-4 gap-2" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i === step ? "step" : undefined}>
            <div className={cn("h-1 rounded-full", i <= step ? "bg-primary" : "bg-muted")} />
            <div className={cn("mt-2 text-xs", i === step ? "font-medium" : "text-muted-foreground")}>{i + 1}. {s}</div>
          </li>
        ))}
      </ol>

      <div className="space-y-6 rounded-lg border border-border bg-card p-6">
        {step === 0 && (<>
          <Field label="Manuscript (PDF, up to 25 MB)" error={errors["file"]} hint="Text-based PDFs screen best. Scanned images cannot be read.">
            <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(ev) => setFile(ev.target.files?.[0] ?? null)} />
            <button type="button" onClick={() => fileRef.current?.click()} className="flex w-full flex-col items-center rounded-md border border-dashed border-border px-4 py-8 text-sm transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {file ? <><span className="font-medium">{file.name}</span><span className="text-muted-foreground">{(file.size / 1024 / 1024).toFixed(1)} MB · click to replace</span></> : <><span className="font-medium">Choose a PDF</span><span className="text-muted-foreground">or drop it here</span></>}
            </button>
          </Field>
          <Field label="Title" error={errors["title"]}><Input value={m.title} onChange={(ev) => setM({ ...m, title: ev.target.value })} maxLength={400} /></Field>
          <Field label="Abstract" error={errors["abstract"]} hint={`${m.abstract.trim().length} / 5000 characters`}><Textarea rows={7} value={m.abstract} onChange={(ev) => setM({ ...m, abstract: ev.target.value })} maxLength={5000} /></Field>
          <Field label="Keywords" error={errors["keywords"]} hint="Comma-separated, up to 12."><Input value={m.keywords} onChange={(ev) => setM({ ...m, keywords: ev.target.value })} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Article type"><select className={select} value={m.article_type} onChange={(ev) => setM({ ...m, article_type: ev.target.value })}>{ARTICLE_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
            <Field label="Research field" error={errors["field"]}><Input value={m.field} onChange={(ev) => setM({ ...m, field: ev.target.value })} placeholder="e.g. Materials science" /></Field>
          </div>
          <Field label="Licence" hint="Applies to the published version."><select className={select} value={m.license} onChange={(ev) => setM({ ...m, license: ev.target.value as typeof m.license })}>{LICENSES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}</select></Field>
        </>)}

        {step === 1 && (<>
          {errors["corr"] && <p role="alert" className="text-sm text-destructive">{errors["corr"]}</p>}
          {authors.map((a, i) => (
            <fieldset key={i} className="space-y-4 rounded-md border border-border p-4">
              <legend className="px-1 text-sm font-medium">Author {i + 1}</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Full name" error={errors[`a${i}name`]}><Input value={a.full_name} onChange={(ev) => setAuthors(authors.map((x, j) => j === i ? { ...x, full_name: ev.target.value } : x))} /></Field>
                <Field label="Email (optional)" error={errors[`a${i}email`]}><Input type="email" value={a.email} onChange={(ev) => setAuthors(authors.map((x, j) => j === i ? { ...x, email: ev.target.value } : x))} /></Field>
                <Field label="Affiliation"><Input value={a.affiliation} onChange={(ev) => setAuthors(authors.map((x, j) => j === i ? { ...x, affiliation: ev.target.value } : x))} /></Field>
                <Field label="ORCID (optional)" error={errors[`a${i}orcid`]}><Input placeholder="0000-0000-0000-0000" value={a.orcid} onChange={(ev) => setAuthors(authors.map((x, j) => j === i ? { ...x, orcid: ev.target.value } : x))} /></Field>
              </div>
              <div className="flex items-center justify-between">
                <Check checked={a.is_corresponding} onChange={(v) => setAuthors(authors.map((x, j) => ({ ...x, is_corresponding: j === i ? v : false })))}>Corresponding author</Check>
                {authors.length > 1 && <Button type="button" variant="ghost" size="sm" onClick={() => setAuthors(authors.filter((_, j) => j !== i))}>Remove</Button>}
              </div>
            </fieldset>
          ))}
          {authors.length < 30 && <Button type="button" variant="outline" onClick={() => setAuthors([...authors, blankAuthor()])}>Add author</Button>}
          <p className="text-xs text-muted-foreground">AI tools cannot be listed as authors: they cannot take responsibility for the work.</p>
        </>)}

        {step === 2 && (<>
          <section className="space-y-3"><h2 className="font-serif text-lg font-semibold">Rights</h2>
            <Check checked={r.is_author} onChange={(v) => setR({ ...r, is_author: v })}>I am an author of this work.</Check>
            <Check checked={r.coauthor_permission} onChange={(v) => setR({ ...r, coauthor_permission: v })}>All co-authors have agreed to this submission.</Check>
            {errors["rights1"] && <p role="alert" className="text-xs text-destructive">{errors["rights1"]}</p>}
            <Check checked={r.has_upload_rights} onChange={(v) => setR({ ...r, has_upload_rights: v })}>I have the right to upload and distribute this work under the chosen licence.</Check>
            {errors["rights2"] && <p role="alert" className="text-xs text-destructive">{errors["rights2"]}</p>}
            <Check checked={r.third_party_content} onChange={(v) => setR({ ...r, third_party_content: v })}>The work contains third-party material (figures, tables, long quotations).</Check>
            {r.third_party_content && <div className="ml-7"><Check checked={r.third_party_permission} onChange={(v) => setR({ ...r, third_party_permission: v })}>I hold permission to reuse that material.</Check></div>}
            <Check checked={r.previously_published} onChange={(v) => setR({ ...r, previously_published: v })}>This work has been published or posted elsewhere.</Check>
            {r.previously_published && (
              <div className="ml-7 grid gap-4 sm:grid-cols-2">
                <Field label="Version"><select className={select} value={r.manuscript_version_type} onChange={(ev) => setR({ ...r, manuscript_version_type: ev.target.value })}><option value="PREPRINT">Preprint</option><option value="ACCEPTED_MANUSCRIPT">Accepted manuscript</option><option value="PUBLISHER_VERSION">Publisher’s version</option></select></Field>
                <Field label="Earlier DOI"><Input value={r.previous_doi} onChange={(ev) => setR({ ...r, previous_doi: ev.target.value })} placeholder="10.xxxx/…" /></Field>
              </div>)}
            {errors["pub"] && <p role="alert" className="text-xs text-destructive">{errors["pub"]}</p>}
          </section>

          <section className="space-y-3 border-t border-border pt-6"><h2 className="font-serif text-lg font-semibold">Research ethics</h2>
            <Check checked={e.human_participants} onChange={(v) => setE({ ...e, human_participants: v })}>Involves human participants or identifiable data.</Check>
            <Check checked={e.animal_subjects} onChange={(v) => setE({ ...e, animal_subjects: v })}>Involves animal subjects.</Check>
            <Check checked={e.clinical_trial} onChange={(v) => setE({ ...e, clinical_trial: v })}>Is a clinical trial.</Check>
            {human && (<div className="space-y-3 rounded-md bg-muted/40 p-4">
              <Check checked={e.ethics_approval} onChange={(v) => setE({ ...e, ethics_approval: v })}>Ethics approval was obtained.</Check>
              {e.ethics_approval && <div className="grid gap-4 sm:grid-cols-2"><Field label="Committee"><Input value={e.ethics_committee} onChange={(ev) => setE({ ...e, ethics_committee: ev.target.value })} /></Field><Field label="Approval number"><Input value={e.approval_number} onChange={(ev) => setE({ ...e, approval_number: ev.target.value })} /></Field></div>}
              <Check checked={e.ethics_exempt} onChange={(v) => setE({ ...e, ethics_exempt: v })}>Exempt from ethics review.</Check>
              {e.ethics_exempt && <Field label="Reason for exemption"><Input value={e.exemption_reason} onChange={(ev) => setE({ ...e, exemption_reason: ev.target.value })} /></Field>}
              <Check checked={e.informed_consent} onChange={(v) => setE({ ...e, informed_consent: v })}>Informed consent was obtained.</Check>
              {e.clinical_trial && <div className="grid gap-4 sm:grid-cols-2"><Field label="Trial registry"><Input value={e.trial_registry} onChange={(ev) => setE({ ...e, trial_registry: ev.target.value })} /></Field><Field label="Registration number"><Input value={e.trial_registration_number} onChange={(ev) => setE({ ...e, trial_registration_number: ev.target.value })} /></Field></div>}
            </div>)}
            {e.animal_subjects && <Field label="Animal-care protocol"><Input value={e.animal_protocol} onChange={(ev) => setE({ ...e, animal_protocol: ev.target.value })} /></Field>}
            <Field label="Conflicts of interest" error={errors["coi"]}><Textarea rows={2} value={e.conflict_of_interest} onChange={(ev) => setE({ ...e, conflict_of_interest: ev.target.value })} /></Field>
            <Field label="Funding" error={errors["funding"]}><Textarea rows={2} value={e.funding} onChange={(ev) => setE({ ...e, funding: ev.target.value })} /></Field>
            <Field label="Data availability" error={errors["data"]}><Textarea rows={2} value={e.data_availability} onChange={(ev) => setE({ ...e, data_availability: ev.target.value })} /></Field>
          </section>

          <section className="space-y-3 border-t border-border pt-6"><h2 className="font-serif text-lg font-semibold">Use of AI in preparing this work</h2>
            <p className="text-sm text-muted-foreground">Disclosure is expected under COPE and ICMJE guidance and carries no penalty. Spelling and grammar checkers need not be listed. Authors remain responsible for everything in the manuscript.</p>
            <Check checked={ai.none} onChange={(v) => setAi({ ...ai, none: v })}>No generative AI was used to write, translate, analyse or illustrate this work.</Check>
            {!ai.none && <Field label="Tools, purpose and extent" error={errors["ai"]} hint="e.g. “ChatGPT was used to improve the language of the Introduction. I reviewed and edited all output.”"><Textarea rows={3} value={ai.tools} onChange={(ev) => setAi({ ...ai, tools: ev.target.value })} maxLength={1000} /></Field>}
          </section>

          <section className="space-y-2 border-t border-border pt-6"><h2 className="font-serif text-lg font-semibold">Automated screening</h2>
            <Check checked={r.ai_processing_consent} onChange={(v) => setR({ ...r, ai_processing_consent: v })}>I consent to the manuscript text being sent to an external AI service for screening. It produces findings only; a published policy makes the decision, and the text is not used to train models.</Check>
            {errors["consent"] && <p role="alert" className="text-xs text-destructive">{errors["consent"]}</p>}
          </section>
        </>)}

        {step === 3 && (
          <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-[10rem_1fr]">
            {[["File", file ? `${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)` : "—"], ["Title", m.title], ["Type and field", `${m.article_type}, ${m.field}`], ["Keywords", keywords.join(", ")], ["Authors", authors.map((a) => a.full_name + (a.is_corresponding ? " (corresponding)" : "")).join("; ")], ["Licence", LICENSES.find((l) => l.code === m.license)?.label ?? m.license], ["AI use", ai.none ? "None declared" : ai.tools]].map(([k, v]) => (
              <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="break-words">{v}</dd></div>
            ))}
          </dl>
        )}

        <div className="flex items-center justify-between border-t border-border pt-5">
          <Button type="button" variant="ghost" disabled={step === 0 || busy} onClick={() => setStep(step - 1)}>Back</Button>
          {step < 3 ? <Button type="button" onClick={next}>Continue</Button> : <Button type="button" onClick={submit} disabled={busy}>{busy ? "Uploading…" : "Submit for screening"}</Button>}
        </div>
      </div>
    </div>
  );
}
