import { zenodoContinue } from "@/lib/zenodo.functions";

export type AutoResult = { done: true } | { done: false; message: string };

/** After "Publish": keep finishing the DOI registration and publication by itself until it is done, so nobody has to press Retry.
 *  Calls the resumable server step every few seconds (each call picks up where the last one stopped) for up to about four minutes. */
export async function finishRegistrationAutomatically(paperId: string, onProgress?: (n: number) => void): Promise<AutoResult> {
  let last = "Registration is taking longer than expected. It will keep retrying; you can also press Retry in Admin > Journal > DOI.";
  for (let n = 1; n <= 40; n++) {
    onProgress?.(n);
    try {
      const r = await zenodoContinue({ data: { paperId } });
      if (r.outcome === "registered") return { done: true };
      if (r.outcome === "failed" && !r.retryable) return { done: false, message: `DOI registration stopped (${r.code}). ${r.message}` };
      if (r.outcome === "failed") last = `DOI registration is retrying (${r.code}).`;
    } catch (e) { last = e instanceof Error ? e.message : last; }
    await new Promise((res) => setTimeout(res, n < 4 ? 3000 : 6000));
  }
  return { done: false, message: last };
}
