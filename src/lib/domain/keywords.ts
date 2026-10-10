/** Keywords are stored as a list; a tracked change holds them as one comma-separated line. */
export const parseKeywords = (s: string): string[] => [...new Set(s.split(",").map((k) => k.trim()).filter(Boolean))];
