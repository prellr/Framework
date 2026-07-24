import { useEffect, useState } from "react";
import {
  KeyRound,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  RefreshCw,
  Trash2,
  Lock,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";

/**
 * Jester credential settings (Phase 0 UI). Store/verify a per-user Jester API key.
 * The key is verified against Jester, encrypted server-side, and never returned here.
 *
 * Interaction follows Fluid Functionalism — motion communicates state: the status pills
 * spring-pop when connection state changes, and the save button morphs through
 * verify → success so the outcome is felt, not just read.
 */
export function CredentialsPage({ embedded }: { embedded?: boolean } = {}) {
  const utils = trpc.useUtils();
  const status = trpc.credentials.status.useQuery();
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  const save = trpc.credentials.save.useMutation({
    onSuccess: () => {
      setApiKey("");
      setJustSaved(true);
      utils.credentials.status.invalidate();
    },
  });
  const reverify = trpc.credentials.reverify.useMutation({
    onSuccess: () => utils.credentials.status.invalidate(),
  });
  const remove = trpc.credentials.remove.useMutation({
    onSuccess: () => utils.credentials.status.invalidate(),
  });

  // Reset the transient "saved" flash after the spring settles.
  useEffect(() => {
    if (!justSaved) return;
    const id = setTimeout(() => setJustSaved(false), 2200);
    return () => clearTimeout(id);
  }, [justSaved]);

  const s = status.data;
  const hasKey = s?.hasKey ?? false;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {!embedded && (
        <PageHeader
          title="Jester Connection"
          subtitle="Paste your Jester API key so the app can pull the catalog and run backtests on your account. It's verified, encrypted at rest, and used only for read & backtest calls — this system can never place a trade. Get a key from the Jester agent dashboard."
        />
      )}

      {/* ── Connection status — pills animate when state changes ───────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            Status
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          {status.isLoading ? (
            <span className="text-sm text-muted-foreground">Checking…</span>
          ) : (
            <>
              <StatusPill tone={hasKey ? "success" : "muted"}>
                <KeyRound className="h-3 w-3" />
                {hasKey ? "Key connected" : "No key"}
              </StatusPill>
              {hasKey && (
                <>
                  <StatusPill tone="muted">Account {s?.accountId ?? "—"}</StatusPill>
                  <StatusPill tone={s?.hyperliquidReady ? "success" : "warning"}>
                    {s?.hyperliquidReady ? (
                      <CheckCircle2 className="h-3 w-3" />
                    ) : (
                      <AlertTriangle className="h-3 w-3" />
                    )}
                    Hyperliquid {s?.hyperliquidReady ? "ready" : "setup incomplete"}
                  </StatusPill>
                </>
              )}
            </>
          )}
          {hasKey && (
            <div className="ml-auto flex gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => reverify.mutate()}
                disabled={reverify.isPending}
              >
                <RefreshCw className={cn("h-3.5 w-3.5", reverify.isPending && "animate-spin")} />
                Re-verify
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => remove.mutate()}
                disabled={remove.isPending}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remove
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Set / replace the key ─────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{hasKey ? "Replace key" : "Connect a key"}</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (apiKey.trim().length >= 10)
                save.mutate({
                  apiKey: apiKey.trim(),
                  baseUrl: baseUrl.trim() || undefined,
                });
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="apiKey">Jester API key</Label>
              <Input
                id="apiKey"
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="x-api-key from the agent dashboard"
              />
              <p className="text-xs text-muted-foreground">
                Verified against Jester, then encrypted. Never displayed again.
              </p>
            </div>

            {showAdvanced ? (
              <div className="space-y-1.5">
                <Label htmlFor="baseUrl">Deployment URL</Label>
                <Input
                  id="baseUrl"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://app.jester.trade"
                />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowAdvanced(true)}
                className="text-xs text-muted-foreground underline-offset-4 hover:underline"
              >
                Advanced: custom deployment URL
              </button>
            )}

            <div className="flex items-center gap-3">
              <SaveButton
                pending={save.isPending}
                saved={justSaved}
                disabled={apiKey.trim().length < 10}
              />
              {save.error && (
                <span className="animate-spring-nudge text-sm text-destructive">
                  {save.error.message}
                </span>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
        <Lock className="h-3 w-3" />
        Your key is encrypted at rest and used only for read &amp; backtest calls.
      </p>
    </div>
  );
}

/** The save button morphs through its states so the result is felt, not just read. */
function SaveButton({
  pending,
  saved,
  disabled,
}: {
  pending: boolean;
  saved: boolean;
  disabled: boolean;
}) {
  return (
    <Button type="submit" disabled={disabled || pending} className="min-w-40 transition-spring">
      {pending ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          Verifying…
        </>
      ) : saved ? (
        <span className="animate-spring-pop inline-flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" />
          Connected
        </span>
      ) : (
        <>
          <KeyRound className="h-4 w-4" />
          Verify &amp; save
        </>
      )}
    </Button>
  );
}
