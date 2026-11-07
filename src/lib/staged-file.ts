/**
 * Large manuscripts (PDFs with photos) must not travel through a Vercel function: the platform rejects request bodies over
 * 4.5 MB with FUNCTION_PAYLOAD_TOO_LARGE. Files above STAGE_THRESHOLD_BYTES are therefore uploaded by the browser straight
 * to Supabase Storage (signed upload URL), and the form data only carries this small reference. Pure helpers, safe on both sides.
 */
export const STAGE_THRESHOLD_BYTES = 1024 * 1024;
export const STAGING_PREFIX = "staging";

export interface StagedRef { path: string; name: string; type: string }
export type FileOrRef = File | StagedRef;

const MARK = "staged:";
export const encodeStagedRef = (r: StagedRef) => MARK + JSON.stringify(r);

/** Reads one form field: a real File, a staged reference, or null when empty/missing. */
export function readFileField(d: FormData, key: string): FileOrRef | null {
  const v = d.get(key);
  if (v instanceof File) return v.size > 0 ? v : null;
  if (typeof v === "string" && v.startsWith(MARK)) {
    try {
      const r = JSON.parse(v.slice(MARK.length)) as Partial<StagedRef>;
      if (typeof r.path === "string" && typeof r.name === "string") return { path: r.path, name: r.name.slice(0, 255), type: typeof r.type === "string" ? r.type : "" };
    } catch { /* fall through */ }
  }
  return null;
}
