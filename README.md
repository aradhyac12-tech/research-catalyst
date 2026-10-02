# Research Catalyst

You are the lead architect, senior full-stack engineer, AI/ML engineer, security engineer, scholarly-publishing systems engineer, and compliance engineer for this project.

Build a production-grade scholarly research publishing platform where researchers can submit research papers/articles, an AI-powered screening system evaluates submissions according to a transparent versioned policy, submissions are automatically ACCEPTED, REJECTED, or sent to HUMAN REVIEW when appropriate, accepted publications can receive DOI metadata, users can pay for explicitly defined publication/services, and the platform automatically generates a cryptographically verifiable certificate containing the uploader/author's name.

Do not create a superficial demo. First inspect the existing repository, architecture, dependencies, authentication, database, storage, UI, and deployment configuration. Preserve existing working functionality. Do not unnecessarily redesign existing UI or navigation. Fix root causes rather than adding temporary workarounds.

IMPORTANT PRODUCT PRINCIPLES

The platform is a scholarly repository/publication platform, not a government accreditation authority.

A certificate confirms a documented platform event such as submission, publication, or peer-review completion. It must NOT claim that the platform has scientifically certified the truth of the research unless that specific claim is genuinely supported.

Payment must NEVER influence acceptance/rejection.

AI must not directly execute publication or rejection actions.

AI produces structured findings; a deterministic policy engine produces the final machine decision.

AI must have a third outcome besides ACCEPT and REJECT: REVIEW_REQUIRED.

Human administrators must be able to override AI decisions, with mandatory reason and immutable audit logging.

Never silently overwrite scientific records. Preserve versions.

Never store payment-card numbers, CVV, or other raw card credentials.

Do not represent an ordinary platform-generated certificate as a government-qualified electronic certificate.

Do not claim Scopus, PubMed, Web of Science, Google Scholar, Crossref, or other indexing unless actual integration/eligibility has been established.

Never promise acceptance merely because a user pays.

Do not expose private manuscripts to external AI services without an explicit privacy/data-processing design and author-facing disclosure.

Never use AI-generated-text detection alone as evidence of plagiarism or misconduct.

================================================== PHASE 1 — REPOSITORY AND ARCHITECTURE AUDIT

Before modifying code:

Inspect the complete repository.

Identify frontend framework.

Identify backend/API architecture.

Identify database.

Identify authentication.

Identify object/file storage.

Identify current payment implementation, if any.

Identify current email system.

Identify current PDF/document handling.

Identify deployment environment.

Identify test framework.

Identify existing security controls.

Identify existing admin functionality.

Identify existing user/profile functionality.

Identify current environment variables.

Identify current database migrations.

Identify current routing.

Identify current design system.

Create an implementation plan based on the actual repository.

Do NOT replace the existing architecture merely because you prefer another stack.

If the repository is empty, use a production-suitable architecture such as:

Frontend:

Next.js/React/TypeScript

Backend:

TypeScript API/server architecture

Database:

PostgreSQL

Object storage:

S3-compatible storage

Authentication:

secure email/password + OAuth where appropriate

Background processing:

queue/worker architecture

PDF generation:

server-side PDF generation

Search:

PostgreSQL full-text initially, extensible to OpenSearch/Meilisearch later

AI:

provider abstraction so models can be changed without rewriting business logic

Payment:

payment-provider abstraction

DOI:

Crossref/provider abstraction

Email:

transactional email provider abstraction

Do not hard-code one AI/payment/DOI provider throughout the application.

================================================== PHASE 2 — USER ROLES

Implement role-based access control.

Roles:

RESEARCHER EDITOR REVIEWER ADMIN SUPER_ADMIN

Optional:

PAYMENT_ADMIN ETHICS_REVIEWER COPYRIGHT_REVIEWER

Researchers can:

create profile

upload manuscripts

add authors

enter affiliations

add ORCID

select licence

declare copyright ownership/rights

declare previous publication

provide ethics information

track submission

respond to revision requests

pay for permitted services

download certificates

verify publications

Editors can:

inspect submissions

review AI findings

override AI decision

request revision

accept/reject

assign reviewers

Reviewers can only access papers assigned to them.

Admins can:

manage users

manage submissions

configure policies

inspect AI decisions

inspect audit logs

manage payments

manage certificates

manage publication status

SUPER_ADMIN can manage:

AI policies

model versions

decision thresholds

system configuration

roles

security controls

================================================== PHASE 3 — RESEARCHER PROFILE

Create researcher profile:

full legal/display name

email

institution

department

country

ORCID

profile photo optional

biography optional

researcher ID

verified email

created_at

updated_at

Never automatically claim ORCID authorship merely because an ORCID was entered.

Where possible, support ORCID OAuth/verification.

Store:

author_name_at_submission

because the historical certificate/article record must not silently change when the user later changes their profile name.

================================================== PHASE 4 — PAPER SUBMISSION

Create a robust submission workflow.

Required:

manuscript file

title

abstract

keywords

article type

field/category

authors

affiliations

corresponding author

references where available

Article types:

Original Research

Review

Systematic Review

Meta-analysis

Case Report

Case Series

Clinical Study

Randomized Controlled Trial

Observational Study

Diagnostic Study

Qualitative Study

Experimental/Laboratory Study

Animal Study

Technical Report

Conference Paper

Preprint

Thesis/Dissertation

Other

Allow field-specific metadata.

Never make all article types pass through the exact same scientific checklist.

================================================== PHASE 5 — COPYRIGHT AND RIGHTS DECLARATION

Before submission, require explicit declarations.

The user must declare:

whether they are an author

whether they have permission from co-authors

whether they have rights to upload the submitted version

whether the work was previously published

whether the uploaded file is a preprint, accepted manuscript, or publisher version

whether third-party figures/content are included

selected licence

Support:

CC BY

CC BY-NC

CC BY-NC-ND

All Rights Reserved / platform hosting licence

Store:

rights_declaration_version rights_declaration_timestamp rights_declaration_user selected_license previous_publication_status previous_doi

Do not allow the system to imply that the uploader automatically owns copyright.

================================================== PHASE 6 — RESEARCH ETHICS

Ask appropriate questions based on article type.

Human research:

human participants?

ethics approval?

ethics committee/IRB?

approval number

informed consent?

publication consent?

anonymization?

patient-identifying information?

Animal research:

animal subjects?

institutional approval?

protocol/reference?

Clinical trials:

trial registration?

registry

registration number

Conflict of interest:

declarations

Funding:

funding source

grant number if applicable

Data:

data availability

repository if applicable

Do not automatically reject unusual research solely because the model does not understand it.

Route uncertain ethical situations to HUMAN_REVIEW.

================================================== PHASE 7 — DOCUMENT SECURITY PIPELINE

Never immediately publish an uploaded file.

Pipeline:

UPLOAD → authentication → file-size validation → MIME validation → extension validation → malware/virus scan → PDF structural validation → metadata extraction → text extraction → hash generation → quarantine storage → AI analysis → moderation/decision → publication storage

Calculate SHA-256 for every uploaded version.

Store:

file_hash file_size mime_type storage_path uploaded_at version

Do not execute arbitrary uploaded files.

Reject executable content disguised as PDF.

================================================== PHASE 8 — VERSION CONTROL

Every manuscript must be versioned.

Example:

Paper: RP-2026-000184

Versions:

1.0 1.1 2.0

Never overwrite an existing published manuscript.

Maintain:

previous_version_id current_version_id version_number change_reason uploaded_at

If a published paper is corrected:

create correction record

preserve previous record

update public status

maintain audit trail

If retracted:

preserve public metadata

clearly mark RETRACTED

do not silently delete historical publication information

================================================== PHASE 9 — AI SCREENING ENGINE

Build an AI provider abstraction.

Do not tightly couple the platform to one model.

Create:

AIProvider

with functions conceptually equivalent to:

analyzeDocument() classifyStudyType() extractMetadata() evaluateMethodology() evaluateEthics() evaluateStatistics() evaluateCitations() evaluateIntegrity() generateFindings()

Every AI result must include:

model_provider model_name model_version policy_version prompt_version timestamp input_hash output_hash structured_result

The AI must return structured JSON validated against a strict schema.

Never allow free-form AI output to directly trigger publication.

================================================== PHASE 10 — AI CHECKLIST

Implement modular checks.

A. DOCUMENT CHECKS

readable file

title present

author information

abstract

keywords

references

expected sections

malformed document

suspicious metadata

B. AUTHORSHIP CHECKS

authors listed

corresponding author

duplicate author entries

ORCID validation where available

authorship declaration

C. COPYRIGHT CHECKS

rights declaration

previous publication

licence

suspicious third-party content

D. PLAGIARISM/SIMILARITY

Use an appropriate similarity service or internal engine.

Never equate similarity with plagiarism automatically.

Return:

similarity_percentage matched_sources matched_sections risk_level

Use:

LOW MEDIUM HIGH REVIEW_REQUIRED

Do not automatically reject solely from a raw similarity percentage.

E. CITATION CHECKS

Extract references.

Where possible validate against:

Crossref PubMed for medical literature other authoritative scholarly metadata

Detect:

nonexistent DOI

title mismatch

author mismatch

year mismatch

suspicious citations

duplicate references

citation/reference inconsistencies

F. METHODOLOGY

Classify study type first.

Then apply study-specific checklist.

G. STATISTICS

Check:

sample size

statistical test selection

p-values

confidence intervals

effect sizes

percentages

denominators

internal arithmetic consistency

reported results vs tables

obvious contradictions

AI should flag potential statistical problems rather than claim mathematical certainty where it cannot establish it.

H. ETHICS

Detect:

human research

animal research

clinical trial

patient data

consent claims

ethics approval claims

missing required declarations

I. DATA CONSISTENCY

Compare:

abstract methods results tables figures conclusion

Detect contradictions such as:

Abstract sample size = 200 Methods sample size = 180 Results sample size = 172

Flag for review.

J. IMAGE/FIGURE SCREENING

Where technically feasible:

detect duplicated figures

suspicious image reuse

obvious manipulation indicators

figure/table inconsistencies

Never make a final misconduct determination from image analysis alone.

K. AI-GENERATED CONTENT

AI-generated-content detection is NOT an automatic rejection criterion.

Use it only as an additional signal.

Do not claim that an AI detector proves AI authorship.

================================================== PHASE 11 — MEDICAL RESEARCH CHECKLISTS

Implement specialized screening profiles.

RCT:

randomization

allocation

comparator

sample size

outcomes

statistical plan

adverse events

CONSORT-related completeness

Systematic Review:

research question

databases

search strategy

eligibility criteria

screening

PRISMA-related completeness

risk of bias

synthesis

Meta-analysis:

effect measure

heterogeneity

model selection

confidence intervals

publication bias where applicable

Case Report:

patient anonymization

consent

clinical timeline

diagnosis

intervention

outcome

Observational Study:

population

exposure

outcome

confounders

statistical methodology

STROBE-related completeness

Do not claim "CONSORT compliant", "PRISMA compliant", etc. unless the actual required evaluation has been implemented and validated.

================================================== PHASE 12 — DECISION ENGINE

AI does NOT directly decide publication.

Create:

DecisionPolicyEngine

Input:

validated AI assessment

Output:

ACCEPT REJECT REVIEW_REQUIRED REVISION_REQUIRED

Example deterministic policy:

IF security_failure = TRUE → REJECT

IF copyright_rights_missing = TRUE → REJECT or REVIEW depending on policy

IF severe_integrity_issue = TRUE → REVIEW_REQUIRED

IF ethics_information_required AND missing → REVISION_REQUIRED or REVIEW_REQUIRED

IF methodology_issue = severe → REVIEW_REQUIRED

IF statistical_issue = severe → REVIEW_REQUIRED

IF all mandatory checks pass AND no critical risk → ACCEPT

Thresholds must be versioned and configurable.

Never use one opaque overall score as the sole decision mechanism.

================================================== PHASE 13 — AI DECISION REPORT

Every submission receives an internal decision report.

Example:

Decision: REVIEW_REQUIRED

Checks:

Document: PASS

Copyright: PASS

Ethics: REVIEW_REQUIRED

Methodology: PASS

Statistics: REVIEW_REQUIRED

References: PASS

Similarity: LOW

Data consistency: WARNING

Reasons:

Ethics approval information incomplete

Statistical test requires editorial verification

Results section contains an apparent denominator inconsistency

Store the evidence supporting each finding.

Where possible, include:

page_number section paragraph table figure reference

Do not fabricate evidence locations.

================================================== PHASE 14 — HUMAN REVIEW

Human review is mandatory when configured uncertainty or high-risk conditions occur.

Admin/editor sees:

manuscript

AI findings

evidence

model/version

policy/version

previous decisions

author declarations

Actions:

ACCEPT REJECT REQUEST_REVISION OVERRIDE_AI

Override requires:

reason reviewer/admin ID timestamp

Never permit an unlogged override.

================================================== PHASE 15 — PAYMENT ARCHITECTURE

Create PaymentProvider abstraction.

Never store:

card number

CVV

card expiry

Store only:

payment_id user_id paper_id order_id amount currency provider provider_transaction_id status created_at completed_at

Support:

PENDING PROCESSING PAID FAILED REFUNDED CANCELLED

Payment webhook must be server-to-server verified.

Never trust:

payment_success=true

from the browser.

Verify payment with the provider.

Payment must be logically isolated from the AI decision engine.

The AI must not receive:

payment amount

premium status

payment status

as decision inputs.

Payment cannot improve acceptance probability.

================================================== PHASE 16 — PAYMENT PRODUCTS

Create configurable products such as:

Publication Processing

DOI/Metadata Service

Professional Formatting

Similarity Report

Editorial Review

Peer Review

Do not make payment equal acceptance.

Display:

"Payment covers the selected service and does not guarantee acceptance or publication."

Refund logic must be explicit.

================================================== PHASE 17 — DOI

Create DOIProvider abstraction.

Do not invent DOI identifiers.

Support Crossref or another legitimate DOI registration agency when the business qualifies.

Store:

doi doi_provider doi_registered_at doi_metadata_version doi_status

After DOI registration, verify the DOI metadata before marking publication complete.

================================================== PHASE 18 — PUBLIC ARTICLE PAGE

Each published paper gets a permanent URL:

/paper/{public_id}

Page must contain:

title authors affiliations abstract keywords article type publication date version DOI license citation formats PDF certificate link corrections retractions funding conflict of interest ethics statement data availability

Do not require login to view public metadata/abstract unless the business model specifically requires it.

================================================== PHASE 19 — SCHOLARLY METADATA

Implement machine-readable metadata compatible with scholarly discovery.

Include:

citation_title citation_author citation_publication_date citation_pdf_url citation_doi

Use semantic HTML and appropriate structured metadata.

Generate:

APA Vancouver MLA BibTeX RIS

Do not claim Google Scholar indexing automatically.

================================================== PHASE 20 — CERTIFICATE ENGINE

Create CertificateService.

Certificate types:

SUBMISSION PUBLICATION PEER_REVIEW AUTHOR_RECORD

Do NOT issue PEER_REVIEW unless peer review actually occurred.

Certificate must contain:

platform name certificate type recipient name paper title author status article ID DOI if available publication date certificate ID issue date status verification URL QR code

Example:

CERT-2026-000184

Certificate URL:

/verify/CERT-2026-000184

================================================== PHASE 21 — CERTIFICATE SECURITY

Generate certificate PDF.

Calculate SHA-256 hash.

Store:

certificate_id paper_id recipient_name_at_issue certificate_type document_hash issued_at status verification_token

Generate QR code pointing to:

/verify/{certificate_id}

Verification page must independently retrieve the certificate from the database.

Possible status:

VALID REVOKED SUPERSEDED RETRACTED

Never silently delete certificates.

================================================== PHASE 22 — CERTIFICATE LANGUAGE

Use precise wording.

For publication certificate:

"This certificate confirms that the named individual is recorded by the platform as an author/uploader of the identified research work and that the work was published through the platform on the stated date."

Do NOT say:

"This certificate proves the research is scientifically correct."

Do NOT say:

"Government certified."

Do NOT say:

"Accredited."

unless there is actual legal/accreditation authority supporting those claims.

Add a small disclaimer:

"This certificate records a platform publication event and does not by itself constitute governmental, institutional, accreditation, or independent scientific certification of the research."

================================================== PHASE 23 — VERIFICATION PAGE

/verify/{certificate_id}

Display:

Certificate status Recipient name Paper title Article ID DOI Publication date Certificate type Issue date Current publication status Verification timestamp

Buttons:

View Article View DOI Download Certificate

If paper is retracted:

Clearly show:

RETRACTED

Do not erase the historical certificate record.

================================================== PHASE 24 — AUDIT LOGGING

Create immutable-style audit records.

Record:

user action resource old_value where appropriate new_value where appropriate timestamp IP/security metadata as legally appropriate model model_version policy_version

Events:

submission_created file_uploaded rights_accepted ethics_declaration ai_started ai_completed decision_created human_review decision_overridden payment_created payment_completed doi_registered publication_created certificate_issued certificate_revoked paper_corrected paper_retracted

Do not allow ordinary users to delete audit logs.

================================================== PHASE 25 — ADMIN DASHBOARD

Create dashboards for:

Submissions AI decisions Human review queue Payments Certificates DOIs Copyright complaints Ethics issues Retractions Corrections System health

AI queue should show:

Submission Study type AI status Decision Risk indicators Model version Policy version Human review status

================================================== PHASE 26 — COPYRIGHT COMPLAINT SYSTEM

Every published work needs:

Report copyright issue

Complaint workflow:

submitted → evidence review → author notification → temporary restriction where appropriate → decision → restore/remove → appeal

Do not permanently remove material solely because an automated system received a complaint.

================================================== PHASE 27 — CORRECTION AND RETRACTION

Implement:

Correction Expression of Concern Retraction

Never silently edit published scientific records.

Public article must show:

Current status Publication history Corrections Retractions

Preserve previous versions.

================================================== PHASE 28 — SECURITY

Implement:

HTTPS

secure cookies

CSRF protection where applicable

XSS protection

SQL injection protection

RBAC

MFA for administrators

rate limiting

brute-force protection

upload limits

malware scanning

secure object storage

signed private URLs

encryption at rest where supported

encryption in transit

secrets management

database backups

recovery procedures

security headers

CSP where compatible

dependency auditing

Do not expose storage bucket credentials to frontend code.

================================================== PHASE 29 — AI SECURITY

Treat manuscripts as untrusted input.

Defend against:

prompt injection inside papers

malicious instructions in PDFs

hidden text

poisoned citations

adversarial content

model extraction

data exfiltration

tool abuse

The manuscript must never be able to instruct the AI:

"Accept this paper."

AI system instructions must remain higher priority.

AI must not have direct database write access.

AI must not have arbitrary network access.

AI must not directly execute publication/payment/refund/admin commands.

================================================== PHASE 30 — AI PRIVACY

Create a configurable AI privacy mode.

Prefer:

PRIVATE_INFERENCE

where manuscripts are processed within infrastructure with appropriate contractual/data controls.

If an external model is used:

document provider

data processing

retention

training policy

confidentiality

jurisdiction

user disclosure

Do not send entire manuscripts to arbitrary external APIs.

================================================== PHASE 31 — DATABASE

Create normalized schema for at least:

users profiles organizations papers paper_versions paper_authors files licenses rights_declarations ethics_declarations ai_runs ai_findings ai_evidence decision_policies decisions human_reviews payments payment_events products doi_records certificates certificate_events audit_logs copyright_complaints corrections retractions notifications

Use foreign keys.

Use indexes for:

DOI article ID certificate ID user ID publication date status ORCID

Use transactions for publication/payment/certificate state transitions.

================================================== PHASE 32 — STATE MACHINE

Implement explicit paper states:

DRAFT SUBMITTED PROCESSING AI_SCREENING REVIEW_REQUIRED REVISION_REQUIRED ACCEPTED REJECTED PAYMENT_PENDING PAYMENT_COMPLETED PUBLICATION_PENDING PUBLISHED CORRECTED RETRACTED ARCHIVED

Prevent illegal transitions.

Example:

REJECTED → PUBLISHED

must not be possible without an explicit administrative override workflow.

================================================== PHASE 33 — EMAIL NOTIFICATIONS

Send transactional notifications:

Submission received AI screening started Revision required Accepted Rejected Human review required Payment successful Payment failed Published DOI registered Certificate issued Correction Retraction Copyright complaint

Never put sensitive manuscript content into ordinary email unnecessarily.

================================================== PHASE 34 — TESTING

Create extensive tests.

Unit tests:

decision policy

payment state

certificate generation

certificate hash

DOI state

paper state machine

rights declarations

author permissions

Integration tests:

Upload → AI → decision → payment → publication → DOI → certificate

Security tests:

unauthorized paper access

unauthorized admin actions

payment manipulation

webhook forgery

certificate ID guessing

file upload attacks

prompt injection

privilege escalation

Critical invariant tests:

Payment cannot change AI decision.

AI cannot directly publish.

AI cannot directly reject without policy engine.

Published version cannot be silently overwritten.

Certificate cannot be modified after issuance.

Retracted paper remains historically verifiable.

Browser cannot fake successful payment.

User cannot access another user's private manuscript.

Reviewer cannot see papers not assigned to them.

AI cannot access arbitrary backend tools.

================================================== PHASE 35 — AI EVALUATION TEST SET

Create a versioned benchmark dataset containing:

clearly acceptable papers

clearly unacceptable submissions

incomplete manuscripts

plagiarism examples

high-similarity but legitimate papers

fabricated references

incorrect DOI

statistical errors

ethics failures

patient privacy failures

duplicate publications

unusual legitimate research

adversarial prompt-injection papers

malformed PDFs

AI-generated manuscripts

papers containing legitimate AI assistance

Measure:

false acceptance rate false rejection rate review-required rate citation error detection plagiarism detection precision/recall ethics detection statistical issue detection

Never optimize merely for the highest acceptance rate.

================================================== PHASE 36 — POLICY VERSIONING

Every decision must reference:

policy_id policy_version

Example:

MEDICAL_RESEARCH_POLICY v1.0

If policy changes to v1.1, old decisions retain v1.0.

Never silently reinterpret historical decisions under the newest policy.

================================================== PHASE 37 — LEGAL PAGES

Create production-ready placeholders/pages for:

/terms /privacy /copyright /submission-policy /author-agreement /licensing /publication-ethics /peer-review /fees /refund-policy /complaints /copyright-complaint /corrections /retractions /ai-policy /certificate-policy /contact

Do not fabricate legal claims or claim compliance with laws/certifications that have not been verified.

Clearly mark legal documents for professional legal review before production.

================================================== PHASE 38 — PAYMENT LEGALITY

Design the payment abstraction so the platform can initially integrate a supported Kyrgyzstan acquiring provider and later support additional providers.

Do not assume Stripe, PayPal, or another international processor is available for a Kyrgyzstan merchant account.

Payment provider must be configurable.

Use hosted payment pages/tokenized payment methods where possible.

Verify all payment webhooks cryptographically.

================================================== PHASE 39 — CERTIFICATE DESIGN

Create a professional academic certificate.

It should include:

Platform logo/name Certificate title Recipient full name Research title Author role Article ID DOI Publication date Certificate ID QR verification Verification URL Digital fingerprint/hash Platform signature/issuer information

Do not use fake university seals. Do not use fake accreditation logos. Do not imply government approval.

Make the certificate printable in A4 and usable digitally.

================================================== PHASE 40 — UI/UX

Create a professional scholarly interface.

Avoid:

cheesy academic graphics

excessive gradients

fake institutional branding

misleading "certified" badges

aggressive payment upsells

Core navigation:

Home Explore Submit Research My Research Certificates Profile

Admin navigation:

Submissions AI Screening Human Review Publications Payments DOIs Certificates Complaints Corrections Retractions Users Policies Audit Logs System

Submission progress:

Manuscript

Authors

Rights

Ethics

Review

Payment

Publication

Certificate

================================================== PHASE 41 — NO FALSE ACADEMIC CLAIMS

The UI must never automatically say:

"Scientifically validated"

"Government certified"

"University approved"

"Scopus indexed"

"PubMed indexed"

"Peer reviewed"

unless the corresponding process actually occurred and the database records prove it.

For an AI-screened paper use precise language such as:

"Passed automated platform screening"

For a genuinely peer-reviewed paper:

"Peer review completed"

Only if reviewers actually completed the configured peer-review workflow.

================================================== PHASE 42 — OBSERVABILITY

Implement structured logging.

Monitor:

AI latency AI failures AI provider failures payment failures webhook failures DOI failures certificate generation failures file scanning failures queue failures database failures

Never log manuscript contents, passwords, payment credentials, or unnecessary personal information.

================================================== PHASE 43 — FAILURE RECOVERY

Every asynchronous operation must be retryable and idempotent.

Example:

AI fails → retry

DOI registration times out → verify status before retrying

Payment webhook arrives twice → process once

Certificate generation fails → regenerate safely using same certificate ID/version

Email fails → retry without duplicating publication

Never create duplicate DOI records or duplicate charges because of retries.

================================================== PHASE 44 — IMPLEMENTATION ORDER

Implement in this order:

Repository audit

Database/schema

Authentication/RBAC

Researcher profiles

Submission system

Secure file pipeline

Rights/ethics declarations

Versioning

AI provider abstraction

AI screening modules

Decision policy engine

Human review

Payment abstraction

Payment integration

Publication workflow

DOI integration

Public article pages

Certificate engine

Certificate verification

Audit logging

Corrections/retractions

Security hardening

Testing

Deployment

Monitoring

Do not jump directly to visual polishing before the core workflow is correct.

================================================== PHASE 45 — DELIVERABLES

At completion provide:

Architecture summary

Database schema

API routes

State machine

AI decision schema

Decision-policy schema

Payment architecture

Certificate architecture

DOI architecture

Security model

Privacy model

Copyright workflow

Ethics workflow

Human-review workflow

Test strategy

Environment-variable documentation

Deployment instructions

Migration instructions

Known limitations

Remaining legal-review requirements

Most importantly, do not merely describe these systems. Implement them in the repository.

Before declaring completion:

run tests

run type checking

run linting

inspect database migrations

test unauthorized access

test payment webhook verification

test duplicate webhook handling

test certificate verification

test paper versioning

test AI decision determinism

test human override

test retraction

test correction

test prompt injection resistance

test malicious uploads

If an external integration cannot be tested because credentials or production access are unavailable, implement the provider abstraction and mocked/integration-test path, clearly document what remains unverified, and do not falsely claim the integration works.

Do not invent credentials, API keys, DOI prefixes, payment accounts, accreditation, legal approvals, journal indexing, or institutional affiliations.

The final system must be auditable, versioned, secure, privacy-conscious, scholarly in its metadata, and explicit about the difference between automated screening, editorial decision, peer review, publication, and scientific validity.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/8080949b-11f2-4520-9b73-4295783096dd).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
