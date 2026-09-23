import { Suspense } from "react";
import { ReportView } from "@/components/company/report-view";
import { LoadingBlock } from "@/components/states";

export default async function Page({ params }: { params: Promise<{ identifier: string }> }) {
  const { identifier } = await params;
  return (
    <Suspense fallback={<LoadingBlock rows={12} />}>
      <ReportView identifier={decodeURIComponent(identifier).toUpperCase()} />
    </Suspense>
  );
}
