import { ChargesView } from "@/components/company/charges-view";

export default async function Page({ params }: { params: Promise<{ identifier: string }> }) {
  const { identifier } = await params;
  return <ChargesView identifier={decodeURIComponent(identifier).toUpperCase()} />;
}
