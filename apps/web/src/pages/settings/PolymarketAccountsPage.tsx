import { useState } from "react";
import {
  CircleAlert,
  ExternalLink,
  LockKeyhole,
  Plus,
  ShieldCheck,
  Star,
  Trash2,
  WalletCards,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";

type WalletType = "deposit" | "proxy" | "safe" | "eoa";

const INITIAL_FORM = {
  label: "",
  walletType: "deposit" as WalletType,
  walletAddress: "",
  signerAddress: "",
  signerPrivateKey: "",
  relayerApiKey: "",
  maxOrderUsd: "5",
  maxOpenExposureUsd: "25",
  dailyLossLimitUsd: "20",
  maxBookAgeMs: "2000",
  isDefault: false,
};

function Field({
  id,
  label,
  description,
  value,
  onChange,
  placeholder,
  secret,
}: {
  id: string;
  label: string;
  description: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  secret?: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <p className="text-muted-foreground text-xs leading-relaxed">{description}</p>
      <Input
        id={id}
        type={secret ? "password" : "text"}
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

export function PolymarketAccountsPage() {
  const utils = trpc.useUtils();
  const accounts = trpc.polymarketAccounts.list.useQuery(undefined, { staleTime: 30_000 });
  const systemStatus = trpc.polymarket.connectorReadiness.useQuery(undefined, {
    staleTime: 30_000,
  });
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(INITIAL_FORM);
  const update = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const refresh = () => utils.polymarketAccounts.list.invalidate();
  const create = trpc.polymarketAccounts.create.useMutation({
    onSuccess: async () => {
      setForm(INITIAL_FORM);
      setAdding(false);
      await refresh();
    },
  });
  const setDefault = trpc.polymarketAccounts.setDefault.useMutation({ onSuccess: refresh });
  const remove = trpc.polymarketAccounts.remove.useMutation({ onSuccess: refresh });

  const save = () =>
    create.mutate({
      label: form.label,
      walletType: form.walletType,
      walletAddress: form.walletAddress,
      signerAddress: form.signerAddress,
      signerPrivateKey: form.signerPrivateKey,
      relayerApiKey: form.relayerApiKey,
      maxOrderUsd: Number(form.maxOrderUsd),
      maxOpenExposureUsd: Number(form.maxOpenExposureUsd),
      dailyLossLimitUsd: Number(form.dailyLossLimitUsd),
      maxBookAgeMs: Number(form.maxBookAgeMs),
      isDefault: form.isDefault,
    });

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <WalletCards className="h-5 w-5" />
                Your Polymarket accounts
              </CardTitle>
              <CardDescription className="mt-2 max-w-3xl">
                Connect more than one funded wallet, keep their credentials and risk budgets
                separate, and choose which account Alchemy should treat as the default. These are
                your accounts—not the platform&apos;s shared Builder connection.
              </CardDescription>
            </div>
            <Button onClick={() => setAdding((value) => !value)}>
              <Plus className="mr-2 h-4 w-4" />
              {adding ? "Close form" : "Add account"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-3">
          <div className="rounded-lg border p-3">
            <div className="text-muted-foreground text-xs">Connected wallets</div>
            <div className="mt-1 text-xl font-semibold">{accounts.data?.accounts.length ?? 0}</div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-muted-foreground text-xs">Account verification</div>
            <div className="mt-1 font-medium">Not installed yet</div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-muted-foreground text-xs">Order execution</div>
            <div className="text-warning mt-1 font-medium">Locked · no route</div>
          </div>
        </CardContent>
      </Card>

      {adding ? (
        <Card>
          <CardHeader>
            <CardTitle>Add an existing Polymarket account</CardTitle>
            <CardDescription>
              Use Polymarket Settings → API Keys → Relayer API Keys. The funder wallet holds the
              positions; the signer address and private key identify the wallet authorized to act
              for it.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {!systemStatus.data?.risk.controlsReady ? (
              <div className="border-warning/30 bg-warning/5 rounded-lg border p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <CircleAlert className="h-4 w-4 text-amber-500" />
                  Admin risk ceilings are required first
                </div>
                <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                  An administrator must configure the system maximum order, exposure, daily loss,
                  and quote-age ceilings before any user account can be saved.
                </p>
              </div>
            ) : null}
            <div className="grid gap-5 lg:grid-cols-2">
              <Field
                id="pm-label"
                label="Account label"
                description="A private label such as Research wallet or Live wallet 2."
                value={form.label}
                onChange={(value) => update("label", value)}
                placeholder="Research wallet"
              />
              <div className="space-y-2">
                <Label htmlFor="pm-wallet-type">Wallet type</Label>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  Choose the account structure shown by Polymarket. Most email/social-login accounts
                  created since May 4, 2026 use a Deposit Wallet; older accounts may use a proxy or
                  Safe wallet.
                </p>
                <select
                  id="pm-wallet-type"
                  className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                  value={form.walletType}
                  onChange={(event) => update("walletType", event.target.value as WalletType)}
                >
                  <option value="deposit">Deposit wallet (current default)</option>
                  <option value="proxy">Proxy wallet</option>
                  <option value="safe">Safe wallet</option>
                  <option value="eoa">EOA / direct wallet</option>
                </select>
              </div>
              <Field
                id="pm-wallet"
                label="Funder / account wallet address"
                description="The public 0x address that holds Polymarket funds and positions."
                value={form.walletAddress}
                onChange={(value) => update("walletAddress", value)}
                placeholder="0x…"
              />
              <Field
                id="pm-signer-address"
                label="Signer address"
                description="The public 0x address shown with the Relayer API key."
                value={form.signerAddress}
                onChange={(value) => update("signerAddress", value)}
                placeholder="0x…"
              />
              <Field
                id="pm-signer-key"
                label="Signer private key"
                description="The dedicated signer used locally for Polymarket authentication and order signatures."
                value={form.signerPrivateKey}
                onChange={(value) => update("signerPrivateKey", value)}
                placeholder="0x…"
                secret
              />
              <Field
                id="pm-relayer-key"
                label="Relayer API key"
                description="Create this in your Polymarket account settings. This is not the admin Builder API key."
                value={form.relayerApiKey}
                onChange={(value) => update("relayerApiKey", value)}
                placeholder="Relayer API key"
                secret
              />
            </div>

            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-medium">Account risk budget</h3>
                  <p className="text-muted-foreground mt-1 text-xs">
                    Account limits may be lower than, but never exceed, the admin system ceilings.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setForm((current) => ({
                      ...current,
                      maxOrderUsd: "5",
                      maxOpenExposureUsd: "25",
                      dailyLossLimitUsd: "20",
                      maxBookAgeMs: "2000",
                    }))
                  }
                >
                  Conservative defaults
                </Button>
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Field
                  id="pm-max-order"
                  label="Max order ($)"
                  description="Largest single order."
                  value={form.maxOrderUsd}
                  onChange={(value) => update("maxOrderUsd", value)}
                />
                <Field
                  id="pm-max-exposure"
                  label="Max exposure ($)"
                  description="Total unresolved exposure."
                  value={form.maxOpenExposureUsd}
                  onChange={(value) => update("maxOpenExposureUsd", value)}
                />
                <Field
                  id="pm-daily-loss"
                  label="Daily loss stop ($)"
                  description="Stops new orders for the day."
                  value={form.dailyLossLimitUsd}
                  onChange={(value) => update("dailyLossLimitUsd", value)}
                />
                <Field
                  id="pm-book-age"
                  label="Max quote age (ms)"
                  description="Reject stale local books."
                  value={form.maxBookAgeMs}
                  onChange={(value) => update("maxBookAgeMs", value)}
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isDefault}
                onChange={(event) => update("isDefault", event.target.checked)}
              />
              Make this my default Polymarket account
            </label>

            <div className="border-destructive/30 bg-destructive/5 rounded-lg border p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <LockKeyhole className="h-4 w-4" />
                Secret handling
              </div>
              <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                Signer and Relayer values are encrypted before storage and are never returned to
                this browser. Use a dedicated signer and a tightly funded account. Never paste
                either secret into chat.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                disabled={create.isPending || !systemStatus.data?.risk.controlsReady}
                onClick={save}
              >
                {create.isPending ? "Encrypting and saving…" : "Save account"}
              </Button>
              <a
                href="https://docs.polymarket.com/trading/wallets-auth#connect-your-account"
                target="_blank"
                rel="noreferrer"
                className="text-primary inline-flex items-center gap-1 text-sm hover:underline"
              >
                Official account connection guide
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
              {create.error ? (
                <p className="text-destructive basis-full text-sm">{create.error.message}</p>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {accounts.isLoading ? (
        <Card>
          <CardContent className="text-muted-foreground p-6 text-sm">
            Loading your Polymarket accounts…
          </CardContent>
        </Card>
      ) : accounts.data?.accounts.length ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {accounts.data.accounts.map((account) => (
            <Card key={account.id}>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      {account.label}
                      {account.isDefault ? <Badge variant="success">Default</Badge> : null}
                    </CardTitle>
                    <CardDescription className="mt-1">
                      {account.walletType.toUpperCase()} · {account.walletMasked}
                    </CardDescription>
                  </div>
                  <Badge variant="secondary">{account.status}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-muted-foreground text-xs">Signer</div>
                    <div className="mt-1 font-mono">{account.signerMasked}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs">Credentials</div>
                    <div className="mt-1 flex items-center gap-1.5">
                      <ShieldCheck className="h-4 w-4 text-emerald-500" />
                      Encrypted
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <div className="rounded-md border p-2">
                    <div className="text-muted-foreground">Order</div>
                    <div className="mt-1 font-medium">${account.maxOrderUsd}</div>
                  </div>
                  <div className="rounded-md border p-2">
                    <div className="text-muted-foreground">Exposure</div>
                    <div className="mt-1 font-medium">${account.maxOpenExposureUsd}</div>
                  </div>
                  <div className="rounded-md border p-2">
                    <div className="text-muted-foreground">Loss stop</div>
                    <div className="mt-1 font-medium">${account.dailyLossLimitUsd}</div>
                  </div>
                  <div className="rounded-md border p-2">
                    <div className="text-muted-foreground">Quote age</div>
                    <div className="mt-1 font-medium">{account.maxBookAgeMs} ms</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!account.isDefault ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={setDefault.isPending}
                      onClick={() => setDefault.mutate({ id: account.id })}
                    >
                      <Star className="mr-2 h-3.5 w-3.5" />
                      Set default
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    disabled={remove.isPending}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Remove ${account.label}? Stored credentials will be deleted.`,
                        )
                      ) {
                        remove.mutate({ id: account.id });
                      }
                    }}
                  >
                    <Trash2 className="mr-2 h-3.5 w-3.5" />
                    Remove
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="flex gap-3 p-6">
            <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
            <div>
              <div className="font-medium">No Polymarket accounts connected</div>
              <p className="text-muted-foreground mt-1 text-sm">
                Public research continues to work. Add an account only when you are ready to prepare
                authenticated, still-locked verification.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
