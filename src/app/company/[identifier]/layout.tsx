import type { Metadata } from "next";
import { CompanyShell } from "@/components/company/company-shell";

export async function generateMetadata({ params }: { params: Promise<{ identifier: string }> }): Promise<Metadata> {
  const { identifier } = await params;
  return { title: decodeURIComponent(identifier).toUpperCase() };
}

export default async function CompanyLayout({ children, params }: { children: React.ReactNode; params: Promise<{ identifier: string }> }) {
  const { identifier } = await params;
  return <CompanyShell identifier={decodeURIComponent(identifier).toUpperCase()}>{children}</CompanyShell>;
}
