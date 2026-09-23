import { DirectorsView } from "@/components/company/directors-view";

export default async function Page({ params }: { params: Promise<{ identifier: string }> }) {
  const { identifier } = await params;
  return <DirectorsView identifier={decodeURIComponent(identifier).toUpperCase()} />;
}
