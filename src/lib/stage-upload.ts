import { supabase } from "@/integrations/supabase/client";
import { createStagedUpload } from "@/lib/staged-upload.functions";
import { STAGE_THRESHOLD_BYTES, encodeStagedRef } from "@/lib/staged-file";

type Progress = (fraction: number) => void;
type Staged = { ref: string } | null;

/** One upload per File object: the form starts it as soon as a file is chosen, and the suggest / submit steps reuse it. */
const cache = new WeakMap<File, { promise: Promise<Staged>; listeners: Set<Progress>; last: number }>();

function putWithProgress(url: string, file: Blob, onProgress: Progress): Promise<void> {
  return new Promise((resolve, reject) => {
    const key = (import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] as string | undefined) ?? "";
    const body = new FormData();
    body.append("cacheControl", "3600");
    body.append("", file);
    const x = new XMLHttpRequest();
    x.open("PUT", url);
    if (key) x.setRequestHeader("apikey", key);
    x.setRequestHeader("x-upsert", "false");
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    x.onload = () => (x.status >= 200 && x.status < 300 ? resolve() : reject(new Error(`HTTP ${x.status}`)));
    x.onerror = () => reject(new Error("network"));
    x.onabort = () => reject(new Error("aborted"));
    x.send(body);
  });
}

async function run(file: File, emit: Progress): Promise<Staged> {
  if (file.size <= STAGE_THRESHOLD_BYTES) { emit(1); return null; }
  const t = await createStagedUpload({ data: { name: file.name, size: file.size } });
  const base = (import.meta.env["VITE_SUPABASE_URL"] as string | undefined) ?? "";
  const blob = new File([file], "manuscript", { type: t.contentType });
  try {
    if (!base) throw new Error("no url");
    const url = `${base.replace(/\/$/, "")}/storage/v1/object/upload/sign/manuscripts/${t.path.split("/").map(encodeURIComponent).join("/")}?token=${encodeURIComponent(t.token)}`;
    await putWithProgress(url, blob, emit);
  } catch {
    // Progress-capable path failed (CORS, proxy, etc.): fall back to the SDK upload, which shows no percentage.
    const up = await supabase.storage.from("manuscripts").uploadToSignedUrl(t.path, t.token, blob, { contentType: t.contentType });
    if (up.error) throw new Error("Upload failed: " + up.error.message);
  }
  emit(1);
  return { ref: encodeStagedRef({ path: t.path, name: file.name, type: t.contentType }) };
}

/** Starts (or joins) the upload of a file. Safe to call repeatedly; `onProgress` receives 0..1. */
export function stageFile(file: File, onProgress?: Progress): Promise<Staged> {
  let e = cache.get(file);
  if (!e) {
    const listeners = new Set<Progress>();
    const entry = { promise: null as unknown as Promise<Staged>, listeners, last: 0 };
    entry.promise = run(file, (f) => { entry.last = f; listeners.forEach((l) => l(f)); }).catch((err) => { cache.delete(file); throw err; });
    cache.set(file, entry);
    e = entry;
  }
  if (onProgress) { e.listeners.add(onProgress); onProgress(e.last); }
  return e.promise;
}

/** Appends a file to form data. Big files go straight to storage first so the server call stays tiny. */
export async function appendFile(fd: FormData, key: string, file: File, onProgress?: Progress): Promise<void> {
  const s = await stageFile(file, onProgress);
  if (s) fd.append(key, s.ref); else fd.append(key, file);
}

/** Drops the cached upload so the next attempt uploads again (used when the server may already have consumed the staged copy). */
export function forgetFile(file: File | null | undefined): void { if (file) cache.delete(file); }
