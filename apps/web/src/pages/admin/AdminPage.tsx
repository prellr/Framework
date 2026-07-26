import { useMemo, useState } from "react";
import type { RouterOutput } from "@framework/api/router";
import { UserPlus, KeyRound, Trash2, Save, History, ChevronLeft, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { PolymarketSystemSettings } from "@/pages/settings/PolymarketSystemSettings";
import { TZ_OPTIONS, VIEWER_TZ, tzLabel, effectiveTz } from "@/lib/tz";
import {
  nextSortState,
  PolymarketSortableHeader,
  stableSortRows,
  type SortState,
  type SortValue,
} from "@/pages/polymarket/PolymarketSortableHeader";

const ROLES = ["viewer", "operator", "manager", "admin"] as const;
type RoleOption = (typeof ROLES)[number];
type AdminTab = "users" | "login-history" | "settings";
type LoginEvent = RouterOutput["admin"]["loginHistory"]["events"][number];
type LoginSortKey = "at" | "user" | "method" | "ip" | "agent";

function loginValue(event: LoginEvent, key: LoginSortKey): SortValue {
  switch (key) {
    case "at":
      return new Date(event.createdAt).getTime();
    case "user":
      return `${event.userName} ${event.userEmail}`;
    case "method":
      return event.authMethod;
    case "ip":
      return event.ipAddress;
    case "agent":
      return event.userAgent;
  }
}

export function AdminPage({ embedded }: { embedded?: boolean } = {}) {
  const [tab, setTab] = useState<AdminTab>("users");

  return (
    <div className="space-y-6">
      <PageHeader title="Admin" subtitle="Users, successful login history, and runtime settings" />

      <div className="flex gap-2 border-b">
        {(
          [
            ["users", "Users"],
            ["login-history", "Login history"],
            ["settings", "Settings"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "border-b-2 px-4 py-2 text-sm font-medium transition-colors",
              tab === key
                ? "border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground border-transparent",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "users" ? (
        <UsersTab />
      ) : tab === "login-history" ? (
        <LoginHistoryTab />
      ) : (
        <div className="space-y-8">
          <PolymarketSystemSettings />
          <RuntimeSettingsPanel />
        </div>
      )}
    </div>
  );
}

// ── Users ─────────────────────────────────────────────────────────────────────

function UsersTab() {
  const utils = trpc.useUtils();
  const users = trpc.admin.listUsers.useQuery();
  const me = trpc.admin.me.useQuery();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<RoleOption>("viewer");

  const createUser = trpc.admin.createUser.useMutation({
    onSuccess: () => {
      setName("");
      setEmail("");
      setPassword("");
      setRole("viewer");
      utils.admin.listUsers.invalidate();
    },
  });
  const setUserRole = trpc.admin.setUserRole.useMutation({
    onSuccess: () => utils.admin.listUsers.invalidate(),
  });
  const resetPassword = trpc.admin.resetUserPassword.useMutation();
  const removeUser = trpc.admin.removeUser.useMutation({
    onSuccess: () => utils.admin.listUsers.invalidate(),
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Add user</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3 md:grid-cols-5"
            onSubmit={(e) => {
              e.preventDefault();
              createUser.mutate({ name, email, password, role });
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="new-name">Name</Label>
              <Input
                id="new-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-email">Email</Label>
              <Input
                id="new-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-password">Password</Label>
              <Input
                id="new-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-role">Role</Label>
              <select
                id="new-role"
                value={role}
                onChange={(e) => setRole(e.target.value as RoleOption)}
                className="border-input flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-sm"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={createUser.isPending} className="w-full">
                <UserPlus className="mr-2 h-4 w-4" />
                {createUser.isPending ? "Adding…" : "Add"}
              </Button>
            </div>
          </form>
          {createUser.error && (
            <p className="text-destructive mt-2 text-sm">{createUser.error.message}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Users</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {users.data?.map((user) => {
            const isSelf = user.id === me.data?.id;
            return (
              <div
                key={user.id}
                className="flex flex-col gap-3 rounded-lg border p-3 md:flex-row md:items-center md:justify-between"
              >
                <div>
                  <div className="flex items-center gap-2 font-medium">
                    {user.name}
                    {isSelf && <Badge variant="secondary">you</Badge>}
                  </div>
                  <p className="text-muted-foreground text-sm">{user.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={user.role ?? "viewer"}
                    disabled={isSelf || setUserRole.isPending}
                    onChange={(e) =>
                      setUserRole.mutate({ userId: user.id, role: e.target.value as RoleOption })
                    }
                    className="border-input h-8 rounded-md border bg-transparent px-2 text-sm"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const newPassword = prompt(`New password for ${user.email} (min 8 chars):`);
                      if (newPassword && newPassword.length >= 8) {
                        resetPassword.mutate({ userId: user.id, newPassword });
                      }
                    }}
                  >
                    <KeyRound className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isSelf}
                    onClick={() => {
                      if (confirm(`Remove ${user.email}?`)) {
                        removeUser.mutate({ userId: user.id });
                      }
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Login history ─────────────────────────────────────────────────────────────

function LoginHistoryTab() {
  const limit = 100;
  const [userId, setUserId] = useState("all");
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState<SortState<LoginSortKey>>({
    key: "at",
    direction: "desc",
  });
  const users = trpc.admin.listUsers.useQuery();
  const history = trpc.admin.loginHistory.useQuery({
    userId: userId === "all" ? undefined : userId,
    limit,
    offset,
  });
  const rows = useMemo(
    () =>
      stableSortRows(
        history.data?.events ?? [],
        (event) => loginValue(event, sort.key),
        sort.direction,
      ),
    [history.data, sort],
  );
  const timezone = effectiveTz(undefined);
  const sortRows = (key: LoginSortKey, initialDirection: "asc" | "desc" = "asc") =>
    setSort((current) => nextSortState(current, key, initialDirection));
  const total = history.data?.total ?? 0;
  const first = total === 0 ? 0 : offset + 1;
  const last = Math.min(total, offset + limit);

  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <History className="h-4 w-4" />
            Successful logins
          </CardTitle>
          <CardDescription className="mt-1">
            Append-only session creation history. Passwords, cookies, and session tokens are never
            stored in or returned by this view.
          </CardDescription>
        </div>
        <div className="w-full sm:w-72">
          <Label htmlFor="login-user-filter" className="text-xs">
            User
          </Label>
          <select
            id="login-user-filter"
            value={userId}
            onChange={(event) => {
              setUserId(event.target.value);
              setOffset(0);
            }}
            className="border-input mt-1 flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-sm"
          >
            <option value="all">All users</option>
            {users.data?.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name} · {user.email}
              </option>
            ))}
          </select>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {history.isLoading ? (
          <div className="bg-muted/20 h-56 animate-pulse" />
        ) : history.isError ? (
          <div className="text-destructive px-6 py-8 text-sm">
            Login history is unavailable: {history.error.message}
          </div>
        ) : rows.length === 0 ? (
          <div className="text-muted-foreground px-6 py-12 text-center text-sm">
            No successful logins have been recorded for this scope yet.
          </div>
        ) : (
          <div className="overflow-x-auto border-y">
            <table className="w-full min-w-[960px] text-sm">
              <thead className="bg-muted/20 text-muted-foreground text-[10px] uppercase tracking-[0.12em]">
                <tr>
                  <PolymarketSortableHeader
                    column="at"
                    active={sort.key}
                    direction={sort.direction}
                    onSort={sortRows}
                  >
                    Signed in
                  </PolymarketSortableHeader>
                  <PolymarketSortableHeader
                    column="user"
                    active={sort.key}
                    direction={sort.direction}
                    onSort={sortRows}
                  >
                    User
                  </PolymarketSortableHeader>
                  <PolymarketSortableHeader
                    column="method"
                    active={sort.key}
                    direction={sort.direction}
                    onSort={sortRows}
                  >
                    Method
                  </PolymarketSortableHeader>
                  <PolymarketSortableHeader
                    column="ip"
                    active={sort.key}
                    direction={sort.direction}
                    onSort={sortRows}
                  >
                    IP address
                  </PolymarketSortableHeader>
                  <PolymarketSortableHeader
                    column="agent"
                    active={sort.key}
                    direction={sort.direction}
                    onSort={sortRows}
                  >
                    Browser / client
                  </PolymarketSortableHeader>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((event) => (
                  <tr key={event.id} className="hover:bg-muted/10 align-top">
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="font-medium">
                        {new Date(event.createdAt).toLocaleString(undefined, {
                          timeZone: timezone,
                          dateStyle: "medium",
                          timeStyle: "medium",
                        })}
                      </div>
                      <div className="text-muted-foreground mt-0.5 text-[10px]">{timezone}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{event.userName}</div>
                      <div className="text-muted-foreground mt-0.5 text-xs">{event.userEmail}</div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="secondary">{event.authMethod}</Badge>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{event.ipAddress ?? "—"}</td>
                    <td
                      className="text-muted-foreground max-w-md px-4 py-3 text-xs leading-relaxed"
                      title={event.userAgent ?? undefined}
                    >
                      <span className="line-clamp-2">{event.userAgent ?? "—"}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs">
          <span>
            Showing {first.toLocaleString()}–{last.toLocaleString()} of {total.toLocaleString()}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={offset === 0 || history.isFetching}
              onClick={() => setOffset(Math.max(0, offset - limit))}
            >
              <ChevronLeft className="mr-1 h-3.5 w-3.5" />
              Newer
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={offset + limit >= total || history.isFetching}
              onClick={() => setOffset(offset + limit)}
            >
              Older
              <ChevronRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Settings ──────────────────────────────────────────────────────────────────

/** Per-user display timezone — drives calendar-day bucketing (the API container runs in UTC). */
function TimezoneCard() {
  const utils = trpc.useUtils();
  const me = trpc.admin.me.useQuery();
  const current = effectiveTz((me.data as any)?.timezone);
  const saved = (me.data as any)?.timezone as string | null | undefined;
  const [tz, setTz] = useState<string | null>(null);
  const value = tz ?? current;
  const save = trpc.admin.setTimezone.useMutation({ onSuccess: () => utils.admin.me.invalidate() });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your timezone</CardTitle>
        <CardDescription>
          Day-based views (daily win rate, per-day rollups) are bucketed in this zone. The server
          runs in UTC, so without this a late-evening session would land on the wrong calendar day.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={value}
            onChange={(e) => setTz(e.target.value)}
            className="border-input h-9 rounded-md border bg-transparent px-3 text-sm shadow-sm"
          >
            {TZ_OPTIONS.map((z) => (
              <option key={z} value={z}>
                {z} ({tzLabel(z)})
              </option>
            ))}
          </select>
          <Button
            disabled={save.isPending || value === saved}
            onClick={() => save.mutate({ timezone: value })}
          >
            <Save className="mr-2 h-4 w-4" />
            {save.isPending ? "Saving…" : "Save"}
          </Button>
          <span className="text-muted-foreground text-xs">
            {saved ? `Saved: ${saved}` : `Not set — using this browser's zone (${VIEWER_TZ})`}
          </span>
        </div>
        {save.error && <p className="text-destructive text-sm">{save.error.message}</p>}
      </CardContent>
    </Card>
  );
}

export function RuntimeSettingsPanel({
  groupIds,
  includeTimezone = true,
}: {
  groupIds?: readonly string[];
  includeTimezone?: boolean;
} = {}) {
  const utils = trpc.useUtils();
  const settings = trpc.admin.settings.useQuery();
  const [edits, setEdits] = useState<Record<string, string>>({});

  const updateSettings = trpc.admin.updateSettings.useMutation({
    onSuccess: () => {
      setEdits({});
      utils.admin.settings.invalidate();
    },
  });

  const dirty = Object.keys(edits).length > 0;
  const groups = settings.data?.groups.filter((group) =>
    groupIds ? groupIds.includes(group.id) : group.id !== "polymarket",
  );

  return (
    <div className="space-y-6">
      {includeTimezone ? <TimezoneCard /> : null}

      {groups?.map((group) => (
        <Card key={group.id}>
          <CardHeader>
            <CardTitle>{group.name}</CardTitle>
            <CardDescription>{group.description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {group.vars.map((v) => (
              <div key={v.name} className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <Label htmlFor={v.name} className="font-mono text-xs">
                    {v.name}
                  </Label>
                  <Badge variant={v.set ? "success" : "secondary"}>
                    {v.set ? "set" : "not set"}
                  </Badge>
                  {(v as any).secret && (v as any).preview && (
                    <span
                      className="text-muted-foreground font-mono text-xs"
                      title="Value is hidden — enter a new one to replace it"
                    >
                      {(v as any).preview}
                    </span>
                  )}
                </div>
                <Input
                  id={v.name}
                  type={(v as any).secret ? "password" : "text"}
                  autoComplete="off"
                  value={edits[v.name] ?? v.value ?? ""}
                  placeholder={
                    (v as any).secret && v.set
                      ? "Hidden — type a new value to replace it"
                      : "(empty — falls back to env var)"
                  }
                  onChange={(e) => setEdits((prev) => ({ ...prev, [v.name]: e.target.value }))}
                />
                {(v as any).secret && (
                  <p className="text-muted-foreground text-[11px]">
                    Stored value is never sent to the browser. Leave blank to keep it unchanged.
                  </p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      ))}

      {settings.data && (
        <div className="flex items-center gap-3">
          <Button
            disabled={!dirty || updateSettings.isPending}
            onClick={() => updateSettings.mutate({ settings: edits })}
          >
            <Save className="mr-2 h-4 w-4" />
            {updateSettings.isPending ? "Saving…" : "Save changes"}
          </Button>
          {updateSettings.error && (
            <p className="text-destructive text-sm">{updateSettings.error.message}</p>
          )}
        </div>
      )}
    </div>
  );
}
