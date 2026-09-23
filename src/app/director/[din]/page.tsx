import { DirectorView } from "@/components/director-view";

export default async function DirectorPage({ params }: { params: Promise<{ din: string }> }) {
  const { din } = await params;
  return <DirectorView din={din} />;
}
