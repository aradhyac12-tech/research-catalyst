// Paperly INTERNAL identifiers. None of these is a DOI, none resolves through doi.org, and none may be presented as one.
// PLY paper (0003)  VER manuscript version  ETH ethics case  REV peer review  CERT certificate (0000)
export const IDENTIFIER_KINDS = {
  PLY: { entity: "paper", label: "Paperly record ID" },
  VER: { entity: "version", label: "Paperly version ID" },
  ETH: { entity: "ethics_case", label: "Paperly ethics case ID (internal)" },
  REV: { entity: "review", label: "Paperly review ID" },
  CERT: { entity: "certificate", label: "Paperly certificate ID" },
} as const;
export type IdentifierPrefix = keyof typeof IDENTIFIER_KINDS;

export const IDENTIFIER_RE = /^(PLY|VER|ETH|REV|CERT)-([0-9]{4})-([0-9]{6,})$/;
export const ETH_ID_RE = /^ETH-[0-9]{4}-[0-9]{6}$/;
export const VER_ID_RE = /^VER-[0-9]{4}-[0-9]{6}$/;
export const REV_ID_RE = /^REV-[0-9]{4}-[0-9]{6}$/;

export function parseIdentifier(id: string): { prefix: IdentifierPrefix; year: number; serial: number } | null {
  const m = IDENTIFIER_RE.exec(id);
  if (!m) return null;
  return { prefix: m[1] as IdentifierPrefix, year: Number(m[2]), serial: Number(m[3]) };
}

/** The public label for an internal identifier. Always states that it is a Paperly identifier and never a DOI. */
export function identifierLabel(id: string): string {
  const p = parseIdentifier(id);
  return p ? `${IDENTIFIER_KINDS[p.prefix].label} (Paperly internal identifier, not a DOI)` : "Paperly identifier (not a DOI)";
}

/** A DOI always starts with the directory indicator "10."; an internal identifier must never look like one or be built from one. */
export function looksLikeDoi(s: string): boolean {
  return /^(https?:\/\/(dx\.)?doi\.org\/)?10\.\d{4,9}\//i.test(s.trim());
}
