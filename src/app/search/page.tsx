import { Suspense } from "react";
import type { Metadata } from "next";
import { SearchResultsView } from "@/components/search/search-results";
import { LoadingBlock } from "@/components/states";

export const metadata: Metadata = { title: "Search" };

export default function SearchPage() {
  return (
    <Suspense fallback={<LoadingBlock rows={8} />}>
      <SearchResultsView />
    </Suspense>
  );
}
