import { AlertTriangle, Inbox, RefreshCw } from "lucide-react";
import { Button, Card, Skeleton } from "./ui/primitives";

export function EmptyState({ title, description, icon: Icon = Inbox, action }: { title: string; description?: string; icon?: typeof Inbox; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-10 text-center">
      <Icon className="size-8 text-muted-foreground" />
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="max-w-md text-xs text-muted-foreground">{description}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : "Something went wrong";
  return (
    <Card className="flex flex-col items-center gap-3 border-danger/30 p-8 text-center">
      <AlertTriangle className="size-8 text-danger" />
      <div>
        <p className="text-sm font-medium">Unable to load data</p>
        <p className="mt-1 text-xs text-muted-foreground">{message}</p>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw /> Retry
        </Button>
      )}
    </Card>
  );
}

export function LoadingBlock({ rows = 4 }: { rows?: number }) {
  return (
    <Card className="space-y-3 p-5" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-5 w-1/3" />
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-4 w-full" />
      ))}
    </Card>
  );
}
