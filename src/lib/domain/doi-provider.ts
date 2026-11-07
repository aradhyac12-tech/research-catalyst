// DOIProvider abstraction. Paperly never invents DOIs: without a registration-agency
// agreement and prefix, the NotConfigured provider records NOT_CONFIGURED.
export interface DoiMetadata {
  title: string; authors: Array<{ name: string; orcid?: string | null }>; publicationDate: string;
  url: string; publicId: string; license: string | null; abstract: string;
}
// Lifecycle: NOT_CONFIGURED (no agency) -> READY (configured, metadata complete) -> REGISTERING -> REGISTERED -> VERIFIED.
// UPDATE_REQUIRED: a registered record's metadata changed (e.g. correction) and the agency must be updated.
// A DOI is shown publicly only at VERIFIED.
export type DoiStatus = "NOT_CONFIGURED" | "READY" | "PENDING" | "REGISTERING" | "SUBMITTED" | "REGISTERED" | "VERIFIED" | "FAILED" | "UPDATE_REQUIRED";
export interface DoiResult { status: DoiStatus; doi: string | null; error?: string }

export interface DOIProvider {
  readonly name: string;
  register(meta: DoiMetadata, idempotencyKey: string): Promise<DoiResult>;
  /** Must be called before retrying a timed-out registration, and before marking complete. */
  verify(doi: string, meta: DoiMetadata): Promise<DoiResult>;
}

export class NotConfiguredDOIProvider implements DOIProvider {
  readonly name = "none";
  async register(): Promise<DoiResult> {
    return { status: "NOT_CONFIGURED", doi: null, error: "No DOI registration agency agreement configured" };
  }
  async verify(): Promise<DoiResult> {
    return { status: "NOT_CONFIGURED", doi: null };
  }
}

/**
 * Agency skeletons. They exist so that configuration is explicit and testable, but they NEVER return a DOI:
 * the deposit XML / JSON and polling are not implemented until a membership, prefix and sandbox credentials
 * exist to test against. With credentials present they report FAILED with a plain message instead of pretending.
 */
class AgencyNotImplementedProvider implements DOIProvider {
  readonly name: string;
  private readonly envKeys: string[];
  constructor(name: string, envKeys: string[]) { this.name = name; this.envKeys = envKeys; }
  private configured() { return this.envKeys.every((k) => !!process.env[k]); }
  async register(): Promise<DoiResult> {
    return this.configured()
      ? { status: "FAILED", doi: null, error: `${this.name} credentials are present but deposit is not implemented yet` }
      : { status: "NOT_CONFIGURED", doi: null, error: `${this.name} is not configured (${this.envKeys.join(", ")})` };
  }
  async verify(): Promise<DoiResult> { return this.register(); }
}
export const crossrefProvider = () => new AgencyNotImplementedProvider("crossref", ["CROSSREF_USERNAME", "CROSSREF_PASSWORD", "CROSSREF_DOI_PREFIX"]);
export const dataciteProvider = () => new AgencyNotImplementedProvider("datacite", ["DATACITE_REPOSITORY_ID", "DATACITE_PASSWORD", "DATACITE_DOI_PREFIX"]);

/** DOIs may only be requested for a record that is final: accepted work in production, with an identifier and a title. */
export function doiRegistrationAllowed(input: { status: string; publicationType: string; hasTitle: boolean; env: string | undefined }): { ok: boolean; reason?: string } {
  if (input.status !== "PUBLICATION_PENDING") return { ok: false, reason: "A DOI can only be requested for an accepted record in production" };
  if (!input.hasTitle) return { ok: false, reason: "Metadata is incomplete" };
  if (input.env === "production" || input.env === "sandbox") return { ok: true };
  return { ok: false, reason: "DOI_ENV must be set to sandbox or production" };
}

/**
 * Crossref skeleton: requires CROSSREF_USERNAME, CROSSREF_PASSWORD, CROSSREF_DOI_PREFIX,
 * which only exist after Crossref membership. Deposit XML generation and polling are
 * not implemented until real credentials allow testing.
 */
export function getDoiProvider(): DOIProvider {
  return new NotConfiguredDOIProvider();
}
