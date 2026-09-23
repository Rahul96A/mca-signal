import { FilingsView } from "@/components/company/filings-view";

export default async function Page({ params }: { params: Promise<{ identifier: string }> }) {
  const { identifier } = await params;
  return <FilingsView identifier={decodeURIComponent(identifier).toUpperCase()} />;
}
