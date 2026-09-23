import { route } from "@/lib/api";
import { getDossier } from "@/lib/services/entity-service";
import { generateReport } from "@/lib/services/report-service";
import { reportPdf, sectionCsv } from "@/lib/services/export-service";
import { ValidationError } from "@/lib/services/errors";

export const dynamic = "force-dynamic";

/** GET /api/companies/:id/export?format=pdf  |  ?format=csv&section=filings|financials|charges|directors|signals|network */
export const GET = route<{ id: string }>(
  async (req, { id }) => {
    const url = new URL(req.url);
    const format = url.searchParams.get("format") ?? "pdf";
    const d = await getDossier(id);
    const base = d.profile.identifier;
    if (format === "csv") {
      const section = url.searchParams.get("section") ?? "filings";
      const csv = sectionCsv(d, section);
      return new Response("﻿" + csv, {
        headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${base}-${section}.csv"` },
      });
    }
    if (format === "pdf") {
      const report = await generateReport(id);
      const pdf = reportPdf(d, report);
      return new Response(Buffer.from(pdf), {
        headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${base}-report.pdf"` },
      });
    }
    throw new ValidationError("format must be pdf or csv");
  },
  { rateLimit: 30 },
);
