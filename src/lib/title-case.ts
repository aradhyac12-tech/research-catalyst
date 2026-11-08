// Article titles are written in title case automatically: "diabetes in older adults" and "DIABETES IN OLDER ADULTS" both become
// "Diabetes in Older Adults". Acronyms (MRI, COVID-19, IL-6) and deliberate mixed-case terms (mRNA, pH, iPSC) are kept as typed.
// formatTitle() is applied when a title is submitted or renamed; displayTitle() is the same rule applied when showing older titles.
const SMALL = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "from", "if", "in", "into", "nor", "of", "off", "on", "onto", "or", "per", "so", "the", "to", "up", "via", "vs", "vs.", "versus", "with", "within", "without", "among", "between", "over", "than", "yet"]);
const KEEP = new Set(["COVID", "SARS", "CRISPR", "HIV", "AIDS", "MRSA", "CT", "MRI", "ICU", "DNA", "RNA", "AI", "BMI", "COPD", "ECG", "EEG", "PCR", "ELISA", "USA", "UK", "US", "WHO", "ICD", "NICU", "ADHD", "PTSD", "GERD", "HPV", "HBV", "HCV", "TB", "UTI", "IVF", "OCD", "BP", "HbA1c", "II", "III", "IV", "VI", "VII", "VIII", "IX", "XI", "XII", "SPECT", "PET", "COX", "TNF", "IL", "CAR", "NK", "ML", "LLM", "IoT", "3D", "2D"]);

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// A token the author clearly styled on purpose: capitals after the first letter (mRNA, pH, iPSC, DNA) or digits mixed with letters (COVID-19, B12, p53).
function isDeliberate(word: string): boolean {
  return /\d/.test(word) || /[a-z][A-Z]/.test(word) || /^[a-z]+[A-Z]/.test(word) || KEEP.has(word.replace(/s$/, ""));
}

export function formatTitle(input: string): string {
  const t = input.replace(/\s+/g, " ").trim();
  if (!t) return t;
  const letters = t.replace(/[^A-Za-z]/g, "");
  // ALL CAPS shouts: lowercase everything except known acronyms first, so only those survive. Mixed titles keep their deliberate casing.
  const shouting = letters.length >= 4 && t === t.toUpperCase();
  const parts = t.split(" ");
  let first = true;
  let afterBreak = false;
  const out = parts.map((part, idx) => {
    const m = /^([^A-Za-z0-9]*)([A-Za-z0-9][A-Za-z0-9'’\-\/]*)(.*)$/.exec(part);
    if (!m) return part;
    const [, pre, word, post] = m as unknown as [string, string, string, string];
    const last = idx === parts.length - 1;
    const upperOk = KEEP.has(word) || KEEP.has(word.replace(/s$/, ""));
    const fixWord = (w: string, lead: boolean): string => {
      if (!w) return w;
      if (shouting ? KEEP.has(w) || (/\d/.test(w) && /[A-Za-z]/.test(w) && /^[A-Z0-9]+$/.test(w)) : isDeliberate(w)) return w;
      const lower = w.toLowerCase();
      if (!lead && !last && SMALL.has(lower)) return lower;
      if (lead && !first && !afterBreak && !last && SMALL.has(lower)) return lower;
      return cap(lower === w || shouting ? lower : w);
    };
    let res: string;
    if (upperOk && shouting) res = word;
    else if (word.includes("-") || word.includes("/")) {
      // Hyphenated or slashed compounds: each side is handled alone ("Long-Term", "Follow-Up", "Type-2", "IL-6").
      if (/[a-z][A-Z]/.test(word) && !shouting) res = word;
      else {
        const bits = word.split(/([\-\/])/);
        res = bits.map((b, i) => (b === "-" || b === "/" ? b : fixWord(b, i === 0 || (!!bits[i - 1] && false)))).join("");
        // After a hyphen a small word still starts with a capital when it is the second part of a compound ("Follow-Up").
        res = res.split(/([\-\/])/).map((b, i, arr) => (i > 0 && (arr[i - 1] === "-" || arr[i - 1] === "/") && /^[a-z]/.test(b) ? cap(b) : b)).join("");
      }
    } else res = fixWord(word, true);
    first = false;
    afterBreak = /[:?!.—–]$/.test(post) || /[:?!—–]$/.test(word);
    return pre + res + post;
  });
  return out.join(" ");
}

// Display rule for titles already stored (older submissions): identical to formatTitle, never written back by the display layer.
export function displayTitle(title: string): string {
  return formatTitle(title ?? "");
}
