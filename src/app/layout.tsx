import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";
import { SiteHeader } from "@/components/layout/site-header";

export const metadata: Metadata = {
  title: { default: "MCA Signal — Indian Company Intelligence", template: "%s · MCA Signal" },
  description: "Research Indian private limited companies and LLPs using official MCA / data.gov.in data with transparent provenance.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen font-sans antialiased">
        <Providers>
          <SiteHeader />
          <main className="mx-auto w-full max-w-7xl px-4 py-6">{children}</main>
          <footer className="mx-auto max-w-7xl px-4 pb-10 pt-4 text-xs text-muted-foreground no-print">
            Data provenance is shown on every record. Official data: Ministry of Corporate Affairs via data.gov.in (GODL). Not legal or financial advice.
          </footer>
        </Providers>
      </body>
    </html>
  );
}
