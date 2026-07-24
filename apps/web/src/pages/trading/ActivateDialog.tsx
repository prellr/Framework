import { useEffect, useState } from "react";
import { Zap, AlertTriangle } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";

/**
 * THE single activation pathway. Every "go live" in the app routes through here — from a strategy
 * page (default params) or a sweep/leaderboard/results row (a tuned param set). It resolves to ONE
 * backend call, `deploy.deploy` → deployParamSet, which:
 *   1. bare-subscribes the strategy on the pair if it isn't already live (no ranked combo / no
 *      Observatory optimize required — that whole dependency is gone),
 *   2. optionally applies a chosen param set (registered on the fly for a tuned set).
 * The strategy runs at its OWN configured risk-per-trade (Jester default ~2% max loss/trade) — we do
 * NOT touch allocation_set (that's exchange capital split, not risk). Partial-failure aware: each
 * step's outcome comes back and any failure is surfaced.
 */
export function ActivateDialog({
  open,
  onClose,
  strategyId,
  strategyName,
  pair,
  timeframe = "15m",
  days = 30,
  parameters,
  note,
  onActivated,
}: {
  open: boolean;
  onClose: () => void;
  strategyId: string;
  strategyName?: string;
  pair: string;
  timeframe?: string;
  days?: number;
  /** A specific tuned set to offer alongside default params (e.g. from a sweep/leaderboard row). */
  parameters?: Record<string, unknown> | null;
  note?: string;
  onActivated?: () => void;
}) {
  const utils = trpc.useUtils();
  const hasTuned = !!parameters && Object.keys(parameters).length > 0;
  const [choice, setChoice] = useState<"default" | "tuned">(hasTuned ? "tuned" : "default");

  const register = trpc.deploy.register.useMutation();
  const deploy = trpc.deploy.deploy.useMutation({
    onSuccess: () => {
      utils.trading.center.invalidate();
      utils.trading.myStrategies.invalidate();
      onActivated?.();
    },
  });
  const deployed = deploy.data as any;
  const busy = register.isPending || deploy.isPending;

  // Jester rate-limits the live trade channel — parse the cooldown and disable Confirm until it clears.
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    const m = deploy.error?.message?.match(/try again in\s+(\d+)\s*s/i);
    if (m) setCooldown(parseInt(m[1], 10) + 1);
  }, [deploy.error]);
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((c) => (c <= 1 ? 0 : c - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  // Reset to a clean slate every time the dialog opens — otherwise a prior result (e.g. a
  // rate-limited attempt) lingers and the dialog only offers "Done", stranding a retry.
  useEffect(() => {
    if (open) {
      setChoice(hasTuned ? "tuned" : "default");
      setCooldown(0);
      deploy.reset();
      register.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const goLive = async () => {
    let paramHash: string | undefined;
    if (choice === "tuned" && hasTuned) {
      // Register the tuned set on the fly to get Jester's deployable hash, then deploy it.
      const reg = await register.mutateAsync({ strategyId, pair, timeframe, days, parameters: parameters! }).catch(() => null);
      if (!reg?.registered || !reg.jesterHash) return; // register error is shown below
      paramHash = reg.jesterHash;
    }
    deploy.mutate({ strategyId, pair, timeframe, paramHash, confirm: true });
  };

  const rateLimited = cooldown > 0;

  return (
    <Dialog open={open} onClose={onClose} title={<span>Activate <span className="font-mono text-sm">{strategyName ?? strategyId}</span></span>}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Deploy this strategy live on your Hyperliquid account: <span className="font-mono">{pair} · {timeframe}</span>. Jester
          trades it going forward at the strategy's configured risk-per-trade. This is real money.
        </p>

        {note && (
          <div className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-foreground">{note}</div>
        )}

        {/* Param set — the single choice that used to be four separate pathways. */}
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Parameters</div>
          <label className="flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm">
            <input type="radio" className="mt-0.5" checked={choice === "default"} onChange={() => setChoice("default")} />
            <span>
              <span className="font-medium">Default parameters</span>
              <span className="block text-xs text-muted-foreground">Run the strategy as-is — no optimize, no ranked combo needed.</span>
            </span>
          </label>
          {hasTuned && (
            <label className="flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm">
              <input type="radio" className="mt-0.5" checked={choice === "tuned"} onChange={() => setChoice("tuned")} />
              <span className="min-w-0">
                <span className="font-medium">Tuned set</span>
                <span className="block truncate font-mono text-[11px] text-muted-foreground" title={Object.entries(parameters!).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ")}>
                  {Object.entries(parameters!).map(([k, v]) => `${k}=${v}`).join(", ")}
                </span>
                <span className="block text-xs text-muted-foreground">Registered on Jester when you confirm, then applied.</span>
              </span>
            </label>
          )}
        </div>

        {register.error && <p className="text-sm text-destructive">Register failed: {register.error.message}</p>}
        {register.data && !register.data.registered && (
          <p className="text-sm text-destructive">Couldn't register these params: {register.data.note}</p>
        )}

        {/* Per-trade risk — the strategy's OWN setting, not something set here. allocation_set (which
            we used to call) controls exchange capital split, not risk, so it's intentionally gone. */}
        <div className="rounded-md border bg-muted/20 p-2 text-xs text-muted-foreground">
          Trades at the strategy's configured <span className="font-medium text-foreground">risk-per-trade</span> (Jester
          default ≈ 2% max loss per trade, with its own stop / take-profit). Custom per-strategy risk sizing is a separate
          control — not set on this screen.
        </div>

        {/* Result / warnings */}
        {deployed && (
          <div className={"rounded-md border p-2 text-xs text-foreground " + ((deployed.warnings?.length ?? 0) > 0 ? "border-warning/40 bg-warning/10" : "border-success/40 bg-success/10")}>
            <span className={"font-medium " + ((deployed.warnings?.length ?? 0) > 0 ? "text-warning" : "text-success")}>
              {(deployed.warnings?.length ?? 0) > 0 ? "Live — with warnings" : "Live."}
            </span>
            {(deployed.warnings ?? []).map((w: string, i: number) => (
              <div key={i} className="mt-1 flex gap-1"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{w}</div>
            ))}
          </div>
        )}
        {deploy.error &&
          (rateLimited ? (
            <p className="text-sm text-warning">Jester is rate-limiting live actions. Retry in {cooldown}s.</p>
          ) : (
            <p className="text-sm text-destructive">{deploy.error.message}</p>
          ))}

        <div className="flex justify-end gap-2">
          {deployed ? (
            <Button onClick={onClose}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button disabled={busy || rateLimited} onClick={goLive}>
                <Zap className="h-4 w-4" />
                {register.isPending
                  ? "Registering…"
                  : deploy.isPending
                    ? "Activating…"
                    : rateLimited
                      ? `Retry in ${cooldown}s`
                      : "Confirm & activate live"}
              </Button>
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}
