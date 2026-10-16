// Minimal Zenodo REST client (https://developers.zenodo.org/): deposit create, bucket upload, metadata update, publish, read, search.
// fetch is injected so the client is testable without network. The token is only ever placed in the Authorization header and is
// redacted from every error message that leaves this module.
import { classifyHttpError, networkError, redactSecret, timeoutError, REQUEST_TIMEOUT_MS, UPLOAD_TIMEOUT_MS, type ClassifiedError, type DepositMetadata } from "./zenodo";

export class ZenodoError extends Error {
  readonly info: ClassifiedError;
  constructor(info: ClassifiedError) { super(info.message); this.name = "ZenodoError"; this.info = info; }
}
export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: unknown; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; headers: { get(n: string): string | null }; text(): Promise<string> }>;

export interface ZenodoDeposition {
  id: number; state?: string; submitted?: boolean; doi?: string; doi_url?: string; record_id?: number;
  metadata?: { notes?: string; title?: string; doi?: string };
  links?: { bucket?: string; html?: string; record_html?: string; latest_draft?: string };
  files?: Array<{ filename?: string; filesize?: number; checksum?: string }>;
}

export class ZenodoClient {
  constructor(private readonly o: { baseUrl: string; token: string; fetch: FetchLike }) {}
  private async call<T>(method: string, url: string, opts: { json?: unknown; body?: Uint8Array; contentType?: string; timeoutMs?: number } = {}): Promise<T> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? REQUEST_TIMEOUT_MS);
    try {
      const headers: Record<string, string> = { Authorization: `Bearer ${this.o.token}`, Accept: "application/json", "User-Agent": "Paperly/1.0 (+https://paperly-ashy.vercel.app)" };
      if (opts.json !== undefined) headers["Content-Type"] = "application/json";
      if (opts.body) headers["Content-Type"] = opts.contentType ?? "application/octet-stream";
      const res = await this.o.fetch(url, { method, headers, body: opts.json !== undefined ? JSON.stringify(opts.json) : opts.body, signal: ctl.signal });
      const text = await res.text();
      if (!res.ok) { const c = classifyHttpError(res.status, res.headers.get("retry-after"), redactSecret(text, this.o.token)); throw new ZenodoError(c); }
      return (text ? JSON.parse(text) : {}) as T;
    } catch (e) {
      if (e instanceof ZenodoError) throw e;
      if (e instanceof Error && (e.name === "AbortError" || /abort|timeout/i.test(e.message))) throw new ZenodoError(timeoutError());
      throw new ZenodoError(networkError());
    } finally { clearTimeout(timer); }
  }
  private dep = (p = "") => `${this.o.baseUrl}/deposit/depositions${p}`;

  /** Cheap authenticated read; proves the token and environment work without creating anything. */
  async testConnection(): Promise<{ ok: true }> { await this.call("GET", `${this.dep()}?size=1`); return { ok: true }; }
  createDeposit(metadata: DepositMetadata) { return this.call<ZenodoDeposition>("POST", this.dep(), { json: { metadata } }); }
  getDeposit(id: number) { return this.call<ZenodoDeposition>("GET", this.dep(`/${id}`)); }
  updateMetadata(id: number, metadata: DepositMetadata) { return this.call<ZenodoDeposition>("PUT", this.dep(`/${id}`), { json: { metadata } }); }
  async uploadFile(bucketUrl: string, filename: string, bytes: Uint8Array) {
    if (!bucketUrl.startsWith(this.o.baseUrl.replace(/\/api$/, ""))) throw new ZenodoError({ kind: "validation", code: "ZENODO_BUCKET_URL_INVALID", retryable: false, retryAfterMs: null, message: "Zenodo returned an unexpected upload address" });
    return this.call<{ key?: string; size?: number; checksum?: string }>("PUT", `${bucketUrl}/${encodeURIComponent(filename)}`, { body: bytes, contentType: "application/pdf", timeoutMs: UPLOAD_TIMEOUT_MS });
  }
  /** Re-opens a published record for a metadata correction. The DOI and record id are unchanged; no new deposit is created. */
  edit(id: number) { return this.call<ZenodoDeposition>("POST", this.dep(`/${id}/actions/edit`), { json: undefined }); }
  publish(id: number) { return this.call<ZenodoDeposition>("POST", this.dep(`/${id}/actions/publish`), { json: undefined }); }
  /** Finds our own deposit after an uncertain create, by the idempotency marker stored in its notes. Newest first. */
  async findByMarker(marker: string): Promise<ZenodoDeposition | null> {
    const list = await this.call<ZenodoDeposition[]>("GET", `${this.dep()}?sort=mostrecent&size=50&status=draft`);
    const published = await this.call<ZenodoDeposition[]>("GET", `${this.dep()}?sort=mostrecent&size=50&status=published`);
    return [...list, ...published].find((d) => d.metadata?.notes?.includes(marker)) ?? null;
  }
}
