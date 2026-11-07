import { db } from "@/lib/server/core.server";
import { MAX_UPLOAD_BYTES, manuscriptKind, kindMime } from "@/lib/domain/file-security";
import { STAGING_PREFIX, type FileOrRef } from "@/lib/staged-file";

const BUCKET = "manuscripts";

/** Signed upload ticket so the browser can send the file straight to storage (bypasses the function body limit). */
export async function createUploadTicket(uid: string, name: string, size: number) {
  if (size > MAX_UPLOAD_BYTES) throw new Error("File is larger than 50 MB");
  const kind = manuscriptKind(name);
  if (!kind) throw new Error("Only PDF or Word (.docx) manuscripts are accepted");
  const path = `${STAGING_PREFIX}/${uid}/${crypto.randomUUID()}.${kind}`;
  const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new Error("Could not prepare the upload. Please try again.");
  return { path, token: data.token, contentType: kindMime(kind) };
}

/** Turns a staged reference back into a File (and deletes the staging object). Real Files pass through untouched. */
export async function resolveFile(uid: string, f: FileOrRef, keep = false): Promise<File> {
  if (f instanceof File) return f;
  // A user may only ever read their own staging folder.
  if (!f.path.startsWith(`${STAGING_PREFIX}/${uid}/`) || f.path.includes("..")) throw new Error("Upload not found. Please choose the file again.");
  const { data, error } = await db.storage.from(BUCKET).download(f.path);
  if (error || !data) throw new Error("The uploaded file could not be read. Please choose it again.");
  if (!keep) await db.storage.from(BUCKET).remove([f.path]).catch(() => undefined);
  const kind = manuscriptKind(f.name) ?? manuscriptKind(f.path);
  return new File([await data.arrayBuffer()], f.name, { type: kind ? kindMime(kind) : f.type });
}
