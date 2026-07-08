import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";

export function DashboardPage() {
  const health = trpc.health.useQuery(undefined, { refetchInterval: 60_000 });
  const me = trpc.admin.me.useQuery();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        subtitle="Replace this page with your app's home view"
        actions={
          health.data ? (
            <Badge variant="success">API healthy</Badge>
          ) : (
            <Badge variant="warning">API unreachable</Badge>
          )
        }
      />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Welcome{me.data ? `, ${me.data.name}` : ""}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <p>
              You're signed in{me.data ? ` as ${me.data.email} (${me.data.role})` : ""}. This
              starter includes auth with role-based access, an admin page, a runtime settings
              store, background jobs, SSE, and an example Notes module showing the schema →
              router → page pattern.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>API status</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {health.data ? (
              <p>
                OK — last checked{" "}
                {new Date(health.data.timestamp).toLocaleTimeString()}
              </p>
            ) : (
              <p>Waiting for /api/trpc/health…</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
