import Link from "next/link";
import { Button } from "@/components/ui/primitives";

export default function NotFound() {
  return (
    <div className="mx-auto mt-16 max-w-md space-y-3 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-sm text-muted-foreground">The page or entity you are looking for does not exist.</p>
      <Link href="/search">
        <Button>Search companies</Button>
      </Link>
    </div>
  );
}
