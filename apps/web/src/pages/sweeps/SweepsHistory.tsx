import { Link, useNavigate } from "@tanstack/react-router";
import { Rocket, Sparkles, Boxes } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";

const STATUS_VARIANT: Record<string, "success" | "warning" | "secondary" | "destructive"> = {
  done: "success",
  running: "warning",
  queued: "secondary",
  canceled: "secondary",
  failed: "destructive",
};

export function SweepsHistory({ embedded }: { embedded?: boolean } = {}) {
  const navigate = useNavigate();
  const list = trpc.sweeps.list.useQuery(undefined, { refetchInterval: 5_000 });

  return (
    <div className="space-y-6">
      {!embedded && (
        <PageHeader
          title="Sweep History"
          subtitle="Every sweep and optimization run. Click a row to reopen its live results."
          actions={
            <Link to="/sweeps" className={buttonVariants({ variant: "outline" })}>
              <Rocket className="h-4 w-4" />
              New Sweep
            </Link>
          }
        />
      )}

      {list.data && list.data.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="No sweeps yet"
          description="Launch one from New Sweep, or Optimize a strategy from the Catalog."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Run</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Progress</th>
                <th className="px-3 py-2 text-right">Created</th>
              </tr>
            </thead>
            <tbody>
              {list.data?.map((s) => (
                <tr
                  key={s.id}
                  onClick={() => navigate({ to: "/sweeps/$sweepId", params: { sweepId: s.id } })}
                  className="cursor-pointer border-b last:border-0 hover:bg-accent/40"
                >
                  <td className="max-w-md truncate px-3 py-2 font-medium">
                    {s.name || <span className="font-mono text-xs text-muted-foreground">{s.id}</span>}
                  </td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      {s.kind === "optimize" ? (
                        <Sparkles className="h-3 w-3" />
                      ) : (
                        <Rocket className="h-3 w-3" />
                      )}
                      {s.kind}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={STATUS_VARIANT[s.status] ?? "secondary"}>{s.status}</Badge>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {s.doneCells}/{s.totalCells}
                  </td>
                  <td className="px-3 py-2 text-right text-xs tabular-nums text-muted-foreground">
                    {new Date(s.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
