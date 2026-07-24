import { useState } from "react";
import { UserPlus, KeyRound, Trash2, Save } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { TZ_OPTIONS, VIEWER_TZ, tzLabel, effectiveTz } from "@/lib/tz";

const ROLES = ["viewer", "operator", "manager", "admin"] as const;
type RoleOption = (typeof ROLES)[number];

export function AdminPage({ embedded }: { embedded?: boolean } = {}) {
  const [tab, setTab] = useState<"users" | "settings">("users");

  return (
    <div className="space-y-6">
      <PageHeader title="Admin" subtitle="Users and runtime settings" />

      <div className="flex gap-2 border-b">
        {(["users", "settings"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "border-b-2 px-4 py-2 text-sm font-medium capitalize transition-colors",
              tab === t
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "users" ? <UsersTab /> : <SettingsTab />}
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
              <Input id="new-name" value={name} onChange={(e) => setName(e.target.value)} required />
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
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
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
            <p className="mt-2 text-sm text-destructive">{createUser.error.message}</p>
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
                  <p className="text-sm text-muted-foreground">{user.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={user.role ?? "viewer"}
                    disabled={isSelf || setUserRole.isPending}
                    onChange={(e) =>
                      setUserRole.mutate({ userId: user.id, role: e.target.value as RoleOption })
                    }
                    className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
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
          Day-based views (daily win rate, per-day rollups) are bucketed in this zone. The server runs in
          UTC, so without this a late-evening session would land on the wrong calendar day.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={value}
            onChange={(e) => setTz(e.target.value)}
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm"
          >
            {TZ_OPTIONS.map((z) => (
              <option key={z} value={z}>
                {z} ({tzLabel(z)})
              </option>
            ))}
          </select>
          <Button disabled={save.isPending || value === saved} onClick={() => save.mutate({ timezone: value })}>
            <Save className="mr-2 h-4 w-4" />
            {save.isPending ? "Saving…" : "Save"}
          </Button>
          <span className="text-xs text-muted-foreground">
            {saved ? `Saved: ${saved}` : `Not set — using this browser's zone (${VIEWER_TZ})`}
          </span>
        </div>
        {save.error && <p className="text-sm text-destructive">{save.error.message}</p>}
      </CardContent>
    </Card>
  );
}

function SettingsTab() {
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

  return (
    <div className="space-y-6">
      <TimezoneCard />

      {settings.data?.groups.map((group) => (
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
                    <span className="font-mono text-xs text-muted-foreground" title="Value is hidden — enter a new one to replace it">
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
                  <p className="text-[11px] text-muted-foreground">
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
            <p className="text-sm text-destructive">{updateSettings.error.message}</p>
          )}
        </div>
      )}
    </div>
  );
}
