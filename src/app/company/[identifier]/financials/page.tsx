import { FinancialsView } from "@/components/company/financials-view";

export default async function Page({ params }: { params: Promise<{ identifier: string }> }) {
  const { identifier } = await params;
  return <FinancialsView identifier={decodeURIComponent(identifier).toUpperCase()} />;
}
