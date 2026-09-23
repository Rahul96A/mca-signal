import { OverviewView } from "@/components/company/overview-view";

export default async function CompanyPage({ params }: { params: Promise<{ identifier: string }> }) {
  const { identifier } = await params;
  return <OverviewView identifier={decodeURIComponent(identifier).toUpperCase()} />;
}
