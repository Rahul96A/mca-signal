import { NetworkView } from "@/components/company/network-view";

export default async function Page({ params }: { params: Promise<{ identifier: string }> }) {
  const { identifier } = await params;
  return <NetworkView identifier={decodeURIComponent(identifier).toUpperCase()} />;
}
