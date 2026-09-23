"use client";
import Link from "next/link";
import { Bookmark, Trash2 } from "lucide-react";
import { useSession, useWatchlist, useWatchlistMutations } from "@/lib/client/hooks";
import { formatDate, titleCase } from "@/lib/format";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Table, TBody, TD, TH, THead, TR } from "@/components/ui/primitives";
import { StatusBadge } from "@/components/badges";
import { EmptyState, ErrorState, LoadingBlock } from "@/components/states";

export default function WatchlistPage() {
  const session = useSession();
  const list = useWatchlist(Boolean(session.data));
  const { remove } = useWatchlistMutations();

  if (session.isLoading || (session.data && list.isLoading)) return <LoadingBlock rows={6} />;
  if (!session.data)
    return (
      <EmptyState
        icon={Bookmark}
        title="Sign in to use your watchlist"
        description="Bookmarked companies are saved to your account."
        action={<Link href="/login?next=/watchlist"><Button size="sm">Sign in</Button></Link>}
      />
    );
  if (list.error) return <ErrorState error={list.error} onRetry={() => list.refetch()} />;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Watchlist ({list.data?.length ?? 0})</CardTitle>
      </CardHeader>
      <CardContent className="p-0 pb-2">
        {!list.data?.length ? (
          <div className="p-5"><EmptyState icon={Bookmark} title="No companies watched yet" description='Open any company and click "Watch" to add it here.' /></div>
        ) : (
          <Table>
            <THead>
              <TR><TH>Entity</TH><TH>Identifier</TH><TH>Status</TH><TH>Added</TH><TH /></TR>
            </THead>
            <TBody>
              {list.data.map((w) => (
                <TR key={w.id}>
                  <TD>
                    <Link href={`/company/${w.entityIdentifier}`} className="font-medium hover:underline">{titleCase(w.entityName)}</Link>
                    {w.entityKind === "llp" && <Badge tone="primary" className="ml-2">LLP</Badge>}
                  </TD>
                  <TD className="font-mono text-xs">{w.entityIdentifier}</TD>
                  <TD><StatusBadge status={w.status} /></TD>
                  <TD className="text-xs tabular">{formatDate(w.createdAt)}</TD>
                  <TD className="text-right">
                    <Button variant="ghost" size="icon" aria-label={`Remove ${w.entityName}`} disabled={remove.isPending} onClick={() => remove.mutate(w.entityIdentifier)}>
                      <Trash2 />
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
