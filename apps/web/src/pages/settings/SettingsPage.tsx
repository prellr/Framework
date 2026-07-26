import { useState } from "react";
import {
  CheckCircle2,
  CircleAlert,
  Database,
  ExternalLink,
  Gauge,
  KeyRound,
  LockKeyhole,
  RadioTower,
  Save,
  Shield,
  WalletCards,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { CredentialsPage } from "@/pages/settings/CredentialsPage";
import { AdminPage } from "@/pages/admin/AdminPage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";

/**
 * Unified "Settings" surface (UX restructure step 5) — the Jester connection and admin controls in
 * one place, as tabs, instead of two separate nav pages. The Admin tab renders only for admins.
 */
type Tab = "connection" | "polymarket" | "admin";

type ConnectorFieldDefinition = {
  key: string;
  label: string;
  description: string;
  placeholder: string;
  required?: boolean;
  secret?: boolean;
  sourceLabel?: string;
  sourceUrl?: string;
};

const ACCOUNT_FIELDS: ConnectorFieldDefinition[] = [
  {
    key: "POLYMARKET_WALLET_ADDRESS",
    label: "Polymarket trading wallet",
    description:
      "The account/funder wallet that holds the funds and positions. This can differ from the signer address.",
    placeholder: "0x… from your Polymarket account settings",
    required: true,
    sourceLabel: "Open Polymarket settings",
    sourceUrl: "https://polymarket.com/settings",
  },
  {
    key: "POLYMARKET_SIGNER_PRIVATE_KEY",
    label: "Dedicated signer private key",
    description:
      "The private key for the wallet authorized to sign this account's API authentication and orders. Use a dedicated, tightly funded signer—not a treasury or everyday wallet.",
    placeholder: "0x… private key for the dedicated signer",
    required: true,
    secret: true,
    sourceLabel: "Authentication guide",
    sourceUrl: "https://docs.polymarket.com/api-reference/authentication",
  },
  {
    key: "POLYMARKET_RELAYER_API_KEY",
    label: "Relayer API key",
    description:
      "Used for Polymarket's gasless wallet operations. Create this on Polymarket under Settings → API Keys.",
    placeholder: "Relayer key from Polymarket Settings → API Keys",
    required: true,
    secret: true,
    sourceLabel: "Open API Keys",
    sourceUrl: "https://polymarket.com/settings",
  },
  {
    key: "POLYMARKET_RELAYER_API_KEY_ADDRESS",
    label: "Relayer key owner address",
    description:
      "The 0x address shown as the owner of the Relayer API key. It must match the address that created the key.",
    placeholder: "0x… address shown with the Relayer API key",
    required: true,
    sourceLabel: "Gasless setup guide",
    sourceUrl: "https://docs.polymarket.com/trading/gasless",
  },
];

const RISK_FIELDS: ConnectorFieldDefinition[] = [
  {
    key: "POLYMARKET_MAX_ORDER_USD",
    label: "Maximum dollars per order",
    description: "Hard cap on one submitted order. The conservative starting value is $5.",
    placeholder: "5",
    required: true,
  },
  {
    key: "POLYMARKET_MAX_OPEN_EXPOSURE_USD",
    label: "Maximum total open exposure",
    description: "Hard cap across all unresolved Polymarket orders and positions.",
    placeholder: "25",
    required: true,
  },
  {
    key: "POLYMARKET_DAILY_LOSS_LIMIT_USD",
    label: "Daily loss stop",
    description:
      "Stops new orders after realized plus marked losses reach this dollar amount for the day.",
    placeholder: "20",
    required: true,
  },
  {
    key: "POLYMARKET_MAX_BOOK_AGE_MS",
    label: "Maximum quote age",
    description:
      "Rejects an order when the local order book is older than this many milliseconds. Start at 2,000 ms while measuring production latency.",
    placeholder: "2000",
    required: true,
  },
];

const BUILDER_FIELDS: ConnectorFieldDefinition[] = [
  {
    key: "POLYMARKET_BUILDER_CODE",
    label: "Builder attribution code",
    description:
      "Optional public bytes32 code from your Polymarket Builder profile. It credits future matched order volume to Alchemy; it does not authenticate the account or enable trading.",
    placeholder: "0x… copy the Builder code, not the Builder address",
    sourceLabel: "Open Builder profile",
    sourceUrl: "https://polymarket.com/settings?tab=builder",
  },
];

const INFRASTRUCTURE_FIELDS: ConnectorFieldDefinition[] = [
  {
    key: "POLYGON_RPC_URL",
    label: "Polygon RPC endpoint",
    description:
      "Optional for the current public connection; required later for independent wallet, allowance, and transaction reconciliation.",
    placeholder: "https://polygon-mainnet…",
    secret: true,
  },
];

const RESEARCH_FIELDS: ConnectorFieldDefinition[] = [
  {
    key: "polymarket_book_capture_enabled",
    label: "Capture Polymarket order books",
    description: "Collect public book snapshots used by execution-cost and depth analysis.",
    placeholder: "true or false",
  },
  {
    key: "signal_gauge_logger_enabled",
    label: "Collect Signal Gauge decisions",
    description: "Turns the read-only Signal Gauge research logger on or off.",
    placeholder: "true or false",
  },
  {
    key: "signal_gauge_pairs",
    label: "Signal Gauge markets",
    description: "Comma-separated source pairs included by the Signal Gauge logger.",
    placeholder: "BTC-USD,ETH-USD,SOL-USD",
  },
  {
    key: "paper_floor_enabled",
    label: "Collect the paper decision floor",
    description: "Records every eligible paper decision for later grading and segmentation.",
    placeholder: "true or false",
  },
  {
    key: "v1_signal_logger_enabled",
    label: "Collect Jester V1 signals",
    description: "Turns the read-only Jester V1 subscription logger on or off.",
    placeholder: "true or false",
  },
  {
    key: "v1_signal_pairs",
    label: "Jester V1 markets",
    description: "Comma-separated pairs subscribed to from the Jester V1 signal source.",
    placeholder: "BNB-USD,BTC-USD",
  },
];

type RuntimeVariable = {
  name: string;
  set: boolean;
  secret: boolean;
  preview: string | null;
  value: string | null;
};

function SetupState({
  complete,
  label,
  description,
}: {
  complete: boolean;
  label: string;
  description: string;
}) {
  const Icon = complete ? CheckCircle2 : CircleAlert;
  return (
    <div className="flex gap-3 rounded-lg border p-3">
      <Icon
        className={cn("mt-0.5 h-4 w-4 shrink-0", complete ? "text-emerald-500" : "text-amber-500")}
      />
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-muted-foreground mt-0.5 text-xs leading-relaxed">{description}</div>
      </div>
    </div>
  );
}

function ConnectorField({
  definition,
  variable,
  edit,
  onChange,
}: {
  definition: ConnectorFieldDefinition;
  variable?: RuntimeVariable;
  edit: string | undefined;
  onChange: (value: string) => void;
}) {
  const secret = definition.secret || variable?.secret;
  const displayedValue = edit ?? (secret ? "" : (variable?.value ?? ""));
  return (
    <div className="space-y-2 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor={definition.key} className="font-medium">
          {definition.label}
        </Label>
        {definition.required ? (
          <Badge variant={variable?.set ? "success" : "secondary"}>
            {variable?.set ? "Added" : "Required"}
          </Badge>
        ) : (
          <Badge variant="outline">Optional</Badge>
        )}
        {secret && variable?.set && variable.preview ? (
          <span className="text-muted-foreground font-mono text-xs">{variable.preview}</span>
        ) : null}
      </div>
      <p className="text-muted-foreground text-xs leading-relaxed">{definition.description}</p>
      <Input
        id={definition.key}
        type={secret ? "password" : "text"}
        autoComplete="off"
        value={displayedValue}
        placeholder={
          secret && variable?.set
            ? "Stored securely — type only to replace it"
            : definition.placeholder
        }
        onChange={(event) => onChange(event.target.value)}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-muted-foreground font-mono text-[10px]">
          Stored as {definition.key}
        </span>
        {definition.sourceUrl ? (
          <a
            className="text-primary inline-flex items-center gap-1 text-xs hover:underline"
            href={definition.sourceUrl}
            target="_blank"
            rel="noreferrer"
          >
            {definition.sourceLabel}
            <ExternalLink className="h-3 w-3" />
          </a>
        ) : null}
      </div>
      {secret ? (
        <p className="text-muted-foreground text-[11px]">
          Encrypted at rest and never returned to this browser. Never paste this value into chat.
        </p>
      ) : null}
    </div>
  );
}

function PolymarketConnectorSettings() {
  const utils = trpc.useUtils();
  const readiness = trpc.polymarket.connectorReadiness.useQuery(undefined, {
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const settings = trpc.admin.settings.useQuery();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const updateSettings = trpc.admin.updateSettings.useMutation({
    onSuccess: async () => {
      setEdits({});
      await Promise.all([
        utils.admin.settings.invalidate(),
        utils.polymarket.connectorReadiness.invalidate(),
      ]);
    },
  });
  const status = readiness.data;
  const polymarketGroup = settings.data?.groups.find((group) => group.id === "polymarket");
  const variables = new Map(
    (polymarketGroup?.vars ?? []).map((variable) => [variable.name, variable as RuntimeVariable]),
  );
  const setEdit = (key: string, value: string) =>
    setEdits((current) => ({ ...current, [key]: value }));
  const dirty = Object.keys(edits).length > 0;
  const identityReady = Boolean(
    status?.account.walletConfigured && status.account.signerConfigured,
  );
  const relayerReady = Boolean(
    status?.account.relayerApiKeyConfigured && status.account.relayerApiKeyAddressConfigured,
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Polymarket connector</CardTitle>
              <CardDescription className="mt-2 max-w-3xl">
                Market data is connected. The remaining setup identifies a dedicated trading account
                and defines hard risk limits. Saving these values still cannot place an order.
              </CardDescription>
            </div>
            <Badge variant={status?.phase === "configured-locked" ? "success" : "secondary"}>
              {status?.phase === "configured-locked"
                ? "configured · locked"
                : status?.publicApi.reachable
                  ? "public connected · locked"
                  : "execution locked"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
          <div>
            <div className="text-muted-foreground text-xs">Official SDK</div>
            <div className="mt-1 font-medium">
              {status?.publicApi.reachable ? "Connected" : "Unavailable"}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">Account prerequisites</div>
            <div className="mt-1 font-medium">
              {status?.account.configurationReady ? "Configured" : "Incomplete"}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">Risk limits</div>
            <div className="mt-1 font-medium">
              {status?.risk.controlsReady ? "Configured" : "Incomplete"}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">Order route</div>
            <div className="text-warning mt-1 font-medium">Not installed</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What is needed</CardTitle>
          <CardDescription>
            Complete the first four items to prepare a read-only authenticated connection test.
            Alchemy will not create a wallet, export a key, move funds, approve tokens, or enable
            trading from this page.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <SetupState
            complete={Boolean(status?.publicApi.reachable)}
            label="1. Public market data"
            description="Already connected through the official Polymarket SDK; no account is required."
          />
          <SetupState
            complete={identityReady}
            label="2. Trading account and signer"
            description="Add the Polymarket funder wallet plus the dedicated private signer that controls it."
          />
          <SetupState
            complete={relayerReady}
            label="3. Gasless API access"
            description="Create a Relayer API key in Polymarket Settings → API Keys and add its owner address. This is separate from the optional Builder profile."
          />
          <SetupState
            complete={Boolean(status?.risk.controlsReady)}
            label="4. Hard risk limits"
            description="Set per-order, total-exposure, daily-loss, and stale-quote rejection limits."
          />
          <SetupState
            complete={false}
            label="5. Read-only account test"
            description="Not built yet. This will verify identity, wallet type, balances, allowances, and open orders without submitting anything."
          />
          <SetupState
            complete={false}
            label="6. Order lifecycle"
            description="Not built yet. User-stream reconciliation, submit, cancel, cancel-all, and durable fill tracking remain locked."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Builder attribution</CardTitle>
              <CardDescription className="mt-1 max-w-3xl">
                Your Builder profile is useful for attribution and future Builder reporting, but it
                is not a prerequisite for trading Alchemy&apos;s own account. Only the public
                Builder code belongs here. Do not enter the Builder address or create Builder API
                keys for this step.
              </CardDescription>
            </div>
            <Badge
              variant={
                status?.attribution.builderCodeValid
                  ? "success"
                  : status?.attribution.builderCodeConfigured
                    ? "destructive"
                    : "outline"
              }
            >
              {status?.attribution.builderCodeValid
                ? "Code added"
                : status?.attribution.builderCodeConfigured
                  ? "Check code"
                  : "Optional"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {BUILDER_FIELDS.map((definition) => (
            <ConnectorField
              key={definition.key}
              definition={definition}
              variable={variables.get(definition.key)}
              edit={edits[definition.key]}
              onChange={(value) => setEdit(definition.key, value)}
            />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <WalletCards className="text-muted-foreground mt-0.5 h-5 w-5" />
            <div>
              <CardTitle>Account access</CardTitle>
              <CardDescription className="mt-1">
                Required for the future authenticated connection test. The wallet is the funded
                Polymarket account; the signer proves control and signs orders locally.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-2">
          {ACCOUNT_FIELDS.map((definition) => (
            <ConnectorField
              key={definition.key}
              definition={definition}
              variable={variables.get(definition.key)}
              edit={edits[definition.key]}
              onChange={(value) => setEdit(definition.key, value)}
            />
          ))}
          <div className="border-destructive/30 bg-destructive/5 rounded-lg border p-4 lg:col-span-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <LockKeyhole className="h-4 w-4" />
              Use a dedicated signer
            </div>
            <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
              Do not use a general-purpose wallet or treasury key. Fund the Polymarket account only
              to the approved exposure limit. If your current login does not expose a private key,
              do not guess—create a dedicated API wallet whose signer you control.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <Gauge className="text-muted-foreground mt-0.5 h-5 w-5" />
              <div>
                <CardTitle>Risk limits</CardTitle>
                <CardDescription className="mt-1">
                  Required hard stops for the connector—not strategy suggestions.
                </CardDescription>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setEdits((current) => ({
                  ...current,
                  POLYMARKET_MAX_ORDER_USD: "5",
                  POLYMARKET_MAX_OPEN_EXPOSURE_USD: "25",
                  POLYMARKET_DAILY_LOSS_LIMIT_USD: "20",
                  POLYMARKET_MAX_BOOK_AGE_MS: "2000",
                }))
              }
            >
              Use conservative starting limits
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-2">
          {RISK_FIELDS.map((definition) => (
            <ConnectorField
              key={definition.key}
              definition={definition}
              variable={variables.get(definition.key)}
              edit={edits[definition.key]}
              onChange={(value) => setEdit(definition.key, value)}
            />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <Database className="text-muted-foreground mt-0.5 h-5 w-5" />
            <div>
              <CardTitle>Optional infrastructure</CardTitle>
              <CardDescription className="mt-1">
                This does not block the current public market-data connection.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {INFRASTRUCTURE_FIELDS.map((definition) => (
            <ConnectorField
              key={definition.key}
              definition={definition}
              variable={variables.get(definition.key)}
              edit={edits[definition.key]}
              onChange={(value) => setEdit(definition.key, value)}
            />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Live trading arm</CardTitle>
          <CardDescription>
            This setting is intentionally unavailable until authenticated recovery, balances, order
            submission, cancellation, and emergency cancel-all are implemented and tested.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="bg-muted/20 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
            <div>
              <div className="text-sm font-medium">Live execution</div>
              <div className="text-muted-foreground mt-1 font-mono text-[10px]">
                POLYMARKET_LIVE_EXECUTION_ENABLED
              </div>
            </div>
            <Badge variant="secondary">
              {status?.execution.armRequested ? "Requested but ignored" : "Off · locked"}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <details className="group rounded-lg border">
        <summary className="hover:bg-muted/20 cursor-pointer list-none px-5 py-4">
          <div className="font-medium">Advanced: research collection</div>
          <div className="text-muted-foreground mt-1 text-xs">
            Optional public-data and signal loggers. These settings do not authenticate an account
            or enable trading.
          </div>
        </summary>
        <div className="grid gap-3 border-t p-5 lg:grid-cols-2">
          {RESEARCH_FIELDS.map((definition) => (
            <ConnectorField
              key={definition.key}
              definition={definition}
              variable={variables.get(definition.key)}
              edit={edits[definition.key]}
              onChange={(value) => setEdit(definition.key, value)}
            />
          ))}
        </div>
      </details>

      <div className="bg-background sticky bottom-0 flex flex-wrap items-center gap-3 border-t py-4">
        <Button
          disabled={!dirty || updateSettings.isPending}
          onClick={() => updateSettings.mutate({ settings: edits })}
        >
          <Save className="mr-2 h-4 w-4" />
          {updateSettings.isPending ? "Saving…" : "Save connector settings"}
        </Button>
        <span className="text-muted-foreground text-xs">
          Saving configuration does not run a connection test or place an order.
        </span>
        {updateSettings.error ? (
          <p className="text-destructive basis-full text-sm">{updateSettings.error.message}</p>
        ) : null}
      </div>
    </div>
  );
}

export function SettingsPage() {
  const me = trpc.admin.me.useQuery(undefined, { staleTime: 60_000 });
  const isAdmin = (me.data?.role as string) === "admin";
  const [tab, setTab] = useState<Tab>("connection");

  const TABS: { key: Tab; label: string; icon: typeof KeyRound }[] = [
    { key: "connection", label: "Jester connection", icon: KeyRound },
    ...(isAdmin
      ? [{ key: "polymarket" as Tab, label: "Polymarket connector", icon: RadioTower }]
      : []),
    ...(isAdmin ? [{ key: "admin" as Tab, label: "Admin", icon: Shield }] : []),
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Settings"
        subtitle="Connections, account prerequisites, safety limits, users, and runtime configuration."
      />

      {TABS.length > 1 && (
        <div className="flex gap-1 border-b">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={
                  "inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors " +
                  (active
                    ? "border-primary text-foreground"
                    : "text-muted-foreground hover:text-foreground border-transparent")
                }
              >
                <Icon className="h-4 w-4" />
                {t.label}
              </button>
            );
          })}
        </div>
      )}

      {tab === "admin" && isAdmin ? (
        <AdminPage embedded />
      ) : tab === "polymarket" && isAdmin ? (
        <PolymarketConnectorSettings />
      ) : (
        <CredentialsPage embedded />
      )}
    </div>
  );
}
