// DOIProvider abstraction. Paperly never invents DOIs: without a registration-agency
// agreement and prefix, the NotConfigured provider records NOT_CONFIGURED.
export interface DoiMetadata {
  title: string; authors: Array<{ name: string; orcid?: string | null }>; publicationDate: string;
  url: string; publicId: string; license: string | null; abstract: string;
}
export type DoiStatus = "NOT_CONFIGURED" | "PENDING" | "SUBMITTED" | "REGISTERED" | "VERIFIED" | "FAILED";
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
 * Crossref skeleton: requires CROSSREF_USERNAME, CROSSREF_PASSWORD, CROSSREF_DOI_PREFIX,
 * which only exist after Crossref membership. Deposit XML generation and polling are
 * not implemented until real credentials allow testing.
 */
export function getDoiProvider(): DOIProvider {
  return new NotConfiguredDOIProvider();
}
