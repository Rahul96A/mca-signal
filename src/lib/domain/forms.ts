/** Catalogue of common MCA e-forms. Safe for client and server. */
export const FORM_CATALOG: Record<string, { description: string; group: "annual" | "director" | "capital" | "charge" | "auditor" | "resolution" | "office" | "incorporation" | "closure" | "llp" | "other" }> = {
  "AOC-4": { description: "Financial statements and other documents", group: "annual" },
  "AOC-4 XBRL": { description: "Financial statements in XBRL format", group: "annual" },
  "AOC-4 CFS": { description: "Consolidated financial statements", group: "annual" },
  "MGT-7": { description: "Annual return", group: "annual" },
  "MGT-7A": { description: "Annual return (OPC / small company)", group: "annual" },
  "DIR-12": { description: "Appointment / change in designation / cessation of directors and KMP", group: "director" },
  "DIR-11": { description: "Notice of resignation by director to ROC", group: "director" },
  "PAS-3": { description: "Return of allotment of securities", group: "capital" },
  "SH-7": { description: "Notice of alteration of share capital", group: "capital" },
  "MGT-14": { description: "Filing of resolutions and agreements with ROC", group: "resolution" },
  "CHG-1": { description: "Creation or modification of charge", group: "charge" },
  "CHG-4": { description: "Satisfaction of charge", group: "charge" },
  "CHG-9": { description: "Creation or modification of charge for debentures", group: "charge" },
  "ADT-1": { description: "Appointment of auditor", group: "auditor" },
  "ADT-3": { description: "Resignation of auditor", group: "auditor" },
  "INC-22": { description: "Notice of situation or change of registered office", group: "office" },
  "INC-24": { description: "Approval for change of name", group: "resolution" },
  "INC-20A": { description: "Declaration of commencement of business", group: "incorporation" },
  "STK-2": { description: "Application for removal of name (strike off)", group: "closure" },
  "LLP Form 11": { description: "Annual return of LLP", group: "llp" },
  "LLP Form 8": { description: "Statement of account & solvency", group: "llp" },
  "LLP Form 3": { description: "Information about LLP agreement and changes", group: "llp" },
  "LLP Form 4": { description: "Notice of appointment / cessation / change of partner", group: "llp" },
  "LLP Form 15": { description: "Notice for change of registered office", group: "llp" },
};

export const KEY_FORMS = ["AOC-4", "MGT-7", "MGT-7A", "DIR-12", "PAS-3", "MGT-14", "CHG-1", "CHG-4", "ADT-1", "LLP Form 8", "LLP Form 11"];

export function describeForm(formType: string): string | null {
  return FORM_CATALOG[formType]?.description ?? null;
}

/** "2023-24" → FY start year 2023. */
export function fyStartYear(fy: string | null | undefined): number | null {
  const m = fy?.match(/^(\d{4})/);
  return m ? Number(m[1]) : null;
}
export function fyLabel(startYear: number): string {
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

/**
 * Statutory due-date estimate for recurring annual forms (Companies Act 2013 / LLP Act 2008):
 * AGM within 6 months of FY end (30 Sep) → AOC-4 within 30 days (≈30 Oct), MGT-7/7A within 60 days (≈29 Nov).
 * OPCs: AOC-4 within 180 days of FY end (27 Sep). LLP Form 11 by 30 May, Form 8 by 30 Oct.
 * These are ESTIMATES: actual AGM dates, MCA-granted extensions and relaxation circulars can change them.
 */
export function estimateDueDate(formType: string, financialYear: string | null, opts: { isOpc?: boolean } = {}): string | null {
  const y = fyStartYear(financialYear);
  if (y === null) return null;
  const next = y + 1; // FY ends 31 March of `next`
  switch (formType) {
    case "AOC-4":
    case "AOC-4 XBRL":
    case "AOC-4 CFS":
      return opts.isOpc ? `${next}-09-27` : `${next}-10-30`;
    case "MGT-7":
    case "MGT-7A":
      return `${next}-11-29`;
    case "LLP Form 11":
      return `${next}-05-30`;
    case "LLP Form 8":
      return `${next}-10-30`;
    default:
      return null;
  }
}
