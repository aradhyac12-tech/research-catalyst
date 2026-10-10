// Public policies. Each statement describes what the platform does today, and says so plainly where something is not done.
// Review by the operator (and legal counsel for privacy and terms) is expected before relying on these texts.
export interface Policy { slug: string; title: string; summary: string; body: string[] }

export const POLICIES: Policy[] = [
  { slug: "aims-and-scope", title: "Aims and scope", summary: "What Paperly is for.",
    body: [
      "Paperly is an open repository for research manuscripts. Authors deposit a manuscript; it receives a permanent Paperly identifier of the form PLY-YYYY-XXXXXX and a public landing page once published.",
      "Paperly accepts work from any research field. Publication in the repository records that a manuscript passed automated screening and an editorial check. It is not, by itself, a statement that the research is correct or has been peer reviewed.",
      "A manuscript is a peer-reviewed journal article only when an administrator has switched on journal mode, an editor has set that record type, and at least one completed peer review is recorded. The record type is shown on every article page.",
    ] },
  { slug: "editorial-policy", title: "Editorial policy", summary: "How manuscripts move from submission to publication.",
    body: [
      "Every submission is checked for file safety, then screened automatically, then read by a human editor. Automated screening can only flag a manuscript for human review. It cannot accept, reject or publish anything. Every accept, reject and revision decision is made and recorded by a named human editor.",
      "Each manuscript has a record type: repository record, preprint or journal article. Only journal articles go to peer review. The type is set by an editor during editorial screening and is shown publicly.",
      "Editors cannot handle, decide on or publish a manuscript they submitted or authored. Editorial decisions are recorded with the editor's identity and the time, and cannot be edited afterwards.",
      "A submission fee is paid after upload, and screening starts once it is paid (see the fees page). The fee has no part in the editorial decision. If a paper is rejected, part of the fee is kept and the rest is refunded.",
    ] },
  { slug: "peer-review", title: "Peer review policy", summary: "How peer review works when it is used.",
    body: [
      "Peer review applies only to records of type journal article while journal mode is enabled. Repository records and preprints are not peer reviewed, and are labelled that way.",
      "The default model is double-anonymous: reviewers do not see author names or affiliations and authors do not see reviewer identities. An administrator can set single-anonymous or open review. The model used for a manuscript is fixed when review starts.",
      "Reviewers must hold the reviewer role, declare any conflict of interest when they accept an invitation, and cannot review a manuscript they submitted or authored. Submitted reviews cannot be edited or deleted.",
      "A journal article cannot be accepted until at least one review is completed. A paper is shown as peer reviewed only when completed reviews are recorded for it.",
      "Authors receive reviews only after the editor has made a decision. Confidential comments to the editor are never shown to authors.",
    ] },
  { slug: "publication-ethics", title: "Publication ethics", summary: "Standards expected of authors, editors and reviewers.",
    body: [
      "Authors must have the right to submit the work, must have the permission of all co-authors, and must declare ethics approval, conflicts of interest, funding and data availability on the submission form. These declarations are stored with the manuscript.",
      "Editors and reviewers must declare conflicts and recuse themselves. The platform blocks the obvious cases (own manuscripts) automatically; other conflicts rely on honest declaration.",
      "Concerns about a published or submitted work can be raised with the editorial office. See the complaints and corrections policies.",
    ] },
  { slug: "research-integrity", title: "Research integrity policy", summary: "How integrity concerns are handled.",
    body: [
      "Automated screening looks for missing declarations, indications of missing ethics approval, statistical or methodological concerns, high textual overlap and attempts to manipulate the screening model. Each finding is a prompt for a human to look. None is a finding of misconduct.",
      "Where an editor believes misconduct may have occurred, the matter is handled through the corrections and retraction processes. Paperly does not currently run formal investigations of institutions or authors.",
    ] },
  { slug: "authorship", title: "Authorship policy", summary: "Who may be listed as an author.",
    body: [
      "Authors are people who made a substantial contribution to the work and agree to be accountable for it. The submission form records each author's contribution using the CRediT role taxonomy.",
      "An AI system cannot be an author. The submission form rejects author names that are AI tools. Use of AI tools is declared separately in the AI disclosure.",
      "An ORCID iD is shown as verified only if the author signed in through ORCID to prove they own it. Other ORCID iDs are shown as unverified.",
    ] },
  { slug: "ai-policy", title: "AI policy", summary: "AI use by authors and by Paperly.",
    body: [
      "Authors must declare AI tools used in the research or writing: the tool, version, purpose, extent and how the authors verified the output. Declarations are shown on the article page.",
      "Paperly itself uses a third-party AI model to screen submissions. The manuscript text (up to about 40,000 characters), title, abstract and declarations are sent to that model through the Lovable AI Gateway. Authors must consent to this before they can submit.",
      "The AI model produces structured findings only. It cannot accept, reject, publish or peer review a manuscript, and its output is never described as peer review. Every AI run, its prompt version and its findings are stored and visible to editors.",
    ] },
  { slug: "similarity", title: "Plagiarism and similarity policy", summary: "How textual overlap is checked.",
    body: [
      "Paperly compares each manuscript with the other manuscripts held on the platform. It does not search the wider web or commercial databases. A low result therefore does not show that a manuscript is original.",
      "High overlap is a signal for editor review, not proof of plagiarism. Authors may be asked to explain overlap before a decision is made.",
    ] },
  { slug: "conflict-of-interest", title: "Conflict of interest policy", summary: "Declaring and handling conflicts.",
    body: [
      "Authors declare conflicts of interest at submission. Reviewers declare conflicts when they accept an invitation; a reviewer who reports a conflict must decline.",
      "Editors and administrators are blocked by the platform from handling, deciding on, reviewing or publishing their own manuscripts.",
    ] },
  { slug: "funding", title: "Funding policy", summary: "Declaring funding.",
    body: [
      "Authors declare funding on the submission form, and may list funders and grant numbers individually. Funding sources are shown on the article page. A statement that there was no funding is a valid declaration.",
      "Funders have no role in editorial decisions at Paperly.",
    ] },
  { slug: "research-ethics", title: "Research ethics policy", summary: "Ethics approval and consent.",
    body: [
      "The submission form asks whether the work involves human participants, animals or a clinical trial, and requires approval details, exemption reasons, consent statements and trial registration where they apply. Clinical and human-subject work is screened under a stricter policy.",
      "Paperly does not verify ethics approvals with the named committees. Editors may ask for evidence.",
    ] },
  { slug: "data-availability", title: "Data availability policy", summary: "Data sharing statements.",
    body: [
      "Every submission includes a data availability statement. Paperly does not host research datasets. Authors should link to data in an appropriate repository.",
    ] },
  { slug: "corrections", title: "Corrections policy", summary: "How published records are corrected.",
    body: [
      "A published record is never silently edited. Changes are made through a public, permanent notice: erratum, correction or addendum. The notice states what changed and when.",
      "Only an administrator can issue a notice. The reason is kept in the audit log. Earlier versions of a record remain available in the version history.",
    ] },
  { slug: "retraction", title: "Retraction and withdrawal policy", summary: "When a record is retracted.",
    body: [
      "A record can be retracted or withdrawn after publication, or marked with an expression of concern. The record stays public and carries a prominent notice explaining the action. It is not deleted.",
      "Certificates issued for a retracted or withdrawn record are marked as retracted on the verification page.",
    ] },
  { slug: "copyright", title: "Copyright policy", summary: "Who owns what.",
    body: [
      "Authors keep copyright in their work. By depositing, authors give Paperly the right to host, display, index and preserve the work under the licence they select.",
      "Authors confirm on submission that they have the right to upload the work. Anyone who believes a record infringes their copyright should write to the editorial office. An administrator can restrict a record while a complaint is assessed.",
    ] },
  { slug: "licensing", title: "Licensing policy", summary: "Licences offered to authors.",
    body: [
      "Authors choose a licence at submission: CC BY 4.0, CC BY-NC 4.0, CC BY-NC-ND 4.0, or all rights reserved (Paperly then holds only a licence to host and display the work). The licence is shown on the article page and in its machine-readable metadata.",
    ] },
  { slug: "privacy", title: "Privacy policy", summary: "What data Paperly handles.",
    body: [
      "Paperly stores the account details you provide (name, email, institution, ORCID iD if you connect one), the manuscripts and declarations you submit, and records of what happens to them (decisions, reviews, payments, audit history).",
      "Manuscript text is sent to a third-party AI model for screening, as described in the AI policy. Payments are handled by Razorpay; Paperly does not receive or store card numbers. ORCID sign-in uses the ORCID service.",
      "Published records and their audit history are part of the permanent scholarly record. Reviewer identities are never shown publicly. Requests about personal data can be sent to the editorial office.",
      "This text should be reviewed by the operator and legal counsel against the laws that apply to them.",
    ] },
  { slug: "terms", title: "Terms of use", summary: "Rules for using Paperly.",
    body: [
      "You may use Paperly to read published records and, with an account, to submit work you have the right to submit. You must provide accurate information and must not upload malicious files or attempt to manipulate screening.",
      "Paperly is a scholarly repository. It is not an accreditation body, and its certificates are platform records only. Paperly may restrict or retract a record, and may suspend accounts that breach these terms.",
      "This text should be reviewed by the operator and legal counsel before reliance.",
    ] },
  { slug: "complaints", title: "Complaints policy", summary: "How to complain.",
    body: [
      "Paperly does not yet have an online complaints form. Complaints about a decision, a record or the conduct of editors, reviewers or authors should be sent to the editorial office using the contact details on the About page; if none are shown there, the office has not published them yet.",
      "Paperly does not guarantee a response time.",
    ] },
  { slug: "appeals", title: "Appeals policy", summary: "Challenging an editorial decision.",
    body: [
      "An author who disagrees with a rejection can write to the editorial office, giving reasons. There is no automated appeal form. An administrator may reopen the manuscript for a fresh editorial decision, which the platform records as an override with a stated reason. An appeal does not guarantee a different outcome.",
    ] },
  { slug: "archiving", title: "Archiving and preservation policy", summary: "Long-term availability.",
    body: [
      "Published records, all versions and their file fingerprints are kept in Paperly's storage and are not deleted. Paperly does not currently deposit its content with an external preservation service. If it does, this page will say which one.",
    ] },
  { slug: "advertising", title: "Advertising policy", summary: "Advertising on Paperly.",
    body: ["Paperly does not currently carry advertising. If that changes, this page will say so."] },
];
export const policyBySlug = (s: string) => POLICIES.find((p) => p.slug === s) ?? null;
