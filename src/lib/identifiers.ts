/** Parsing/validation of Indian corporate identifiers. Safe for client and server. */

// CIN: L/U + 5-digit NIC + 2-letter state + 4-digit year + 3-letter ownership + 6-digit reg no.
export const CIN_RE = /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/;
// LLPIN: 3 letters, hyphen, 4 digits (e.g. AAB-1234). Foreign LLPs use FLLP-xxxx.
export const LLPIN_RE = /^(?:[A-Z]{3}|FLLP)-\d{4}$/;
// DIN: 8 digits.
export const DIN_RE = /^\d{8}$/;

export type IdentifierKind = "cin" | "llpin" | "din" | "text";

export function normalizeIdentifier(raw: string): string {
  return decodeURIComponent(raw).trim().toUpperCase().replace(/\s+/g, "");
}

export function detectIdentifier(raw: string): { kind: IdentifierKind; value: string } {
  const v = normalizeIdentifier(raw);
  if (CIN_RE.test(v)) return { kind: "cin", value: v };
  if (LLPIN_RE.test(v)) return { kind: "llpin", value: v };
  if (DIN_RE.test(v)) return { kind: "din", value: v };
  return { kind: "text", value: raw.trim() };
}

const OWNERSHIP: Record<string, string> = {
  PTC: "Private Limited Company",
  PLC: "Public Limited Company",
  OPC: "One Person Company",
  FTC: "Subsidiary of Foreign Company",
  GOI: "Government of India Company",
  SGC: "State Government Company",
  GAP: "Public Limited Company (Guarantee)",
  GAT: "Private Limited Company (Guarantee)",
  NPL: "Not-for-Profit (Section 8) Licensed Company",
  ULL: "Public Unlimited Company",
  ULT: "Private Unlimited Company",
};

/** Decode the parts of a CIN. Purely structural — not a validity check against the registry. */
export function decodeCin(cin: string) {
  if (!CIN_RE.test(cin)) return null;
  return {
    listing: cin[0] === "L" ? "Listed" : "Unlisted",
    nicCode: cin.slice(1, 6),
    stateCode: cin.slice(6, 8),
    incorporationYear: Number(cin.slice(8, 12)),
    ownership: OWNERSHIP[cin.slice(12, 15)] ?? cin.slice(12, 15),
    registrationNumber: cin.slice(15),
  };
}

/** Normalise a company name for matching: upper-case, strip punctuation & legal suffixes. */
export function normalizeName(name: string): string {
  return name
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\b(PRIVATE|PVT|LIMITED|LTD|LLP|OPC|THE|COMPANY|CO)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
