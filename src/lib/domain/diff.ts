// Word-level before/after comparison for tracked changes. Pure function; tested in diff.test.ts.
export type DiffOp = { type: "same" | "del" | "ins"; text: string };

const tokens = (s: string) => s.split(/(\s+)/).filter((t) => t.length > 0);

export function diffWords(before: string, after: string): DiffOp[] {
  const a = tokens(before), b = tokens(after);
  const n = a.length, m = b.length;
  if (n * m > 4_000_000) return [{ type: "del", text: before }, { type: "ins", text: after }]; // too large to compare word by word
  const L: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i]![j] = a[i] === b[j] ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!);
  const raw: DiffOp[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { raw.push({ type: "same", text: a[i]! }); i++; j++; }
    else if (L[i + 1]![j]! >= L[i]![j + 1]!) raw.push({ type: "del", text: a[i++]! });
    else raw.push({ type: "ins", text: b[j++]! });
  }
  while (i < n) raw.push({ type: "del", text: a[i++]! });
  while (j < m) raw.push({ type: "ins", text: b[j++]! });
  // Merge neighbours of the same kind so the page renders one mark per change, not one per word.
  const out: DiffOp[] = [];
  for (const op of raw) {
    const last = out[out.length - 1];
    if (last && last.type === op.type) last.text += op.text; else out.push({ ...op });
  }
  return out;
}

/** Text as it would read with every change applied / with none applied. */
export const afterText = (ops: DiffOp[]) => ops.filter((o) => o.type !== "del").map((o) => o.text).join("");
export const beforeText = (ops: DiffOp[]) => ops.filter((o) => o.type !== "ins").map((o) => o.text).join("");
