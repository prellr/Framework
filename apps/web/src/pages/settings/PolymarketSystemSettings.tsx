import { useState } from "react";
import { Database, ExternalLink, LockKeyhole, Save, Shield, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";

type RuntimeVariable = {
  name: string;
  set: boolean;
  secret: boolean;
  preview: string | null;
  value: string | null;
};

type Field = {
  key: string;
  label: string;
  description: string;
  placeholder: string;
  secret?: boolean;
};

const BUILDER_FIELDS: Field[] = [
  {
    key: "POLYMARKET_BUILDER_ADDRESS",
    label: "Builder address",
    description: "Public API-only address shown on the Polymarket Builder profile.",
    placeholder: "0x… Builder address",
  },
  {
    key: "POLYMARKET_BUILDER_CODE",
    label: "Builder code",
    description: "Public bytes32 code attached to routed orders for Builder volume attribution.",
    placeholder: "0x… Builder code",
  },
  {
    key: "POLYMARKET_BUILDER_API_KEY",
    label: "Builder API key",
    description:
      "System credential used later for Builder-managed account provisioning and relays.",
    placeholder: "Builder API key",
    secret: true,
  },
  {
    key: "POLYMARKET_BUILDER_API_SECRET",
    label: "Builder API secret",
    description:
      "Secret paired with the Builder API key. Save the three Builder credentials together.",
    placeholder: "Builder API secret",
    secret: true,
  },
  {
    key: "POLYMARKET_BUILDER_API_PASSPHRASE",
    label: "Builder API passphrase",
    description: "Passphrase generated with the Builder API key.",
    placeholder: "Builder API passphrase",
    secret: true,
  },
];

const LIMIT_FIELDS: Field[] = [
  {
    key: "POLYMARKET_MAX_ORDER_USD",
    label: "System max order ($)",
    description: "No user account may configure a larger single-order budget.",
    placeholder: "5",
  },
  {
    key: "POLYMARKET_MAX_OPEN_EXPOSURE_USD",
    label: "System max exposure ($)",
    description: "Platform ceiling across one user wallet's unresolved exposure.",
    placeholder: "25",
  },
  {
    key: "POLYMARKET_DAILY_LOSS_LIMIT_USD",
    label: "System daily loss ceiling ($)",
    description: "Largest daily stop a user account may request.",
    placeholder: "20",
  },
  {
    key: "POLYMARKET_MAX_BOOK_AGE_MS",
    label: "System max quote age (ms)",
    description: "Oldest local book any future route may accept.",
    placeholder: "2000",
  },
];

const RESEARCH_FIELDS: Field[] = [
  {
    key: "polymarket_book_capture_enabled",
    label: "Capture public order books",
    description: "Feeds execution-depth and slippage research.",
    placeholder: "true or false",
  },
  {
    key: "signal_gauge_logger_enabled",
    label: "Signal Gauge logger",
    description: "Read-only decision collection.",
    placeholder: "true or false",
  },
  {
    key: "signal_gauge_pairs",
    label: "Signal Gauge pairs",
    description: "Comma-separated source pairs.",
    placeholder: "BTC-USD,ETH-USD,SOL-USD",
  },
  {
    key: "paper_floor_enabled",
    label: "Paper decision floor",
    description: "Records eligible paper decisions for grading.",
    placeholder: "true or false",
  },
  {
    key: "v1_signal_logger_enabled",
    label: "Jester V1 logger",
    description: "Read-only subscribed signal collection.",
    placeholder: "true or false",
  },
  {
    key: "v1_signal_pairs",
    label: "Jester V1 pairs",
    description: "Comma-separated subscribed pairs.",
    placeholder: "BNB-USD,BTC-USD",
  },
];

function SettingField({
  field,
  variable,
  edit,
  onChange,
}: {
  field: Field;
  variable?: RuntimeVariable;
  edit?: string;
  onChange: (value: string) => void;
}) {
  const secret = field.secret || variable?.secret;
  return (
    <div className="space-y-2 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor={field.key}>{field.label}</Label>
        <Badge variant={variable?.set ? "success" : "secondary"}>
          {variable?.set ? "Set" : "Not set"}
        </Badge>
        {secret && variable?.preview ? (
          <span className="text-muted-foreground font-mono text-xs">{variable.preview}</span>
        ) : null}
      </div>
      <p className="text-muted-foreground text-xs leading-relaxed">{field.description}</p>
      <Input
        id={field.key}
        type={secret ? "password" : "text"}
        autoComplete="off"
        value={edit ?? (secret ? "" : (variable?.value ?? ""))}
        placeholder={
          secret && variable?.set ? "Stored securely — type to replace" : field.placeholder
        }
        onChange={(event) => onChange(event.target.value)}
      />
      {secret ? (
        <p className="text-muted-foreground text-[11px]">
          Encrypted at rest and never returned to the browser.
        </p>
      ) : null}
    </div>
  );
}

export function PolymarketSystemSettings() {
  const utils = trpc.useUtils();
  const settings = trpc.admin.settings.useQuery();
  const readiness = trpc.polymarket.connectorReadiness.useQuery(undefined, {
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const [edits, setEdits] = useState<Record<string, string>>({});
  const save = trpc.admin.updateSettings.useMutation({
    onSuccess: async () => {
      setEdits({});
      await Promise.all([
        utils.admin.settings.invalidate(),
        utils.polymarket.connectorReadiness.invalidate(),
      ]);
    },
  });
  const group = settings.data?.groups.find((item) => item.id === "polymarket");
  const variables = new Map(
    (group?.vars ?? []).map((variable) => [variable.name, variable as RuntimeVariable]),
  );
  const setEdit = (key: string, value: string) =>
    setEdits((current) => ({ ...current, [key]: value }));
  const status = readiness.data;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Polymarket system connector
              </CardTitle>
              <CardDescription className="mt-2 max-w-3xl">
                Shared Alchemy infrastructure: public market data, Builder identity, platform-wide
                ceilings, and the global kill switch. User wallets, signers, and Relayer keys never
                belong in Admin settings.
              </CardDescription>
            </div>
            <Badge variant={status?.publicApi.reachable ? "success" : "secondary"}>
              {status?.publicApi.reachable ? "Public data connected" : "Public data unavailable"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border p-3">
            <div className="text-muted-foreground text-xs">Official SDK</div>
            <div className="mt-1 font-medium">
              {status?.publicApi.reachable ? "Connected" : "Unavailable"}
            </div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-muted-foreground text-xs">Builder credentials</div>
            <div className="mt-1 font-medium">
              {status?.builder.credentialsReady
                ? "Complete"
                : status?.builder.partiallyConfigured
                  ? "Incomplete set"
                  : "Optional for existing accounts"}
            </div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-muted-foreground text-xs">System ceilings</div>
            <div className="mt-1 font-medium">
              {status?.risk.controlsReady ? "Configured" : "Incomplete"}
            </div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-muted-foreground text-xs">Order route</div>
            <div className="text-warning mt-1 font-medium">Not installed</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5" />
            Builder platform identity
          </CardTitle>
          <CardDescription>
            Builder credentials are shared system credentials for a platform routing user orders
            and, later, provisioning gasless deposit wallets. They do not replace each user&apos;s
            signer or existing-account Relayer key.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-2">
          {BUILDER_FIELDS.map((field) => (
            <SettingField
              key={field.key}
              field={field}
              variable={variables.get(field.key)}
              edit={edits[field.key]}
              onChange={(value) => setEdit(field.key, value)}
            />
          ))}
          <div className="flex items-center gap-2 lg:col-span-2">
            <a
              className="text-primary inline-flex items-center gap-1 text-sm hover:underline"
              href="https://polymarket.com/settings?tab=builder"
              target="_blank"
              rel="noreferrer"
            >
              Open Polymarket Builder settings
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
            <span className="text-muted-foreground text-xs">
              Create one Builder API key and save its key, secret, and passphrase together.
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Platform-wide safety ceilings</CardTitle>
          <CardDescription>
            User wallet limits can be stricter but cannot exceed these values.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-2">
          {LIMIT_FIELDS.map((field) => (
            <SettingField
              key={field.key}
              field={field}
              variable={variables.get(field.key)}
              edit={edits[field.key]}
              onChange={(value) => setEdit(field.key, value)}
            />
          ))}
          <Button
            variant="outline"
            className="w-fit lg:col-span-2"
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
            Use conservative ceilings
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Shared infrastructure
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-2">
          <SettingField
            field={{
              key: "POLYGON_RPC_URL",
              label: "Polygon RPC endpoint",
              description:
                "Shared endpoint for future independent wallet and transaction reconciliation.",
              placeholder: "https://polygon-mainnet…",
              secret: true,
            }}
            variable={variables.get("POLYGON_RPC_URL")}
            edit={edits.POLYGON_RPC_URL}
            onChange={(value) => setEdit("POLYGON_RPC_URL", value)}
          />
          <div className="bg-muted/20 rounded-lg border p-4">
            <div className="flex items-center gap-2 font-medium">
              <LockKeyhole className="h-4 w-4" />
              Live execution
            </div>
            <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
              {status?.execution.armRequested ? "Requested but ignored." : "Off."} No submission,
              cancellation, or emergency cancel-all route exists, so configuration alone cannot move
              funds.
            </p>
          </div>
        </CardContent>
      </Card>

      <details className="rounded-lg border">
        <summary className="hover:bg-muted/20 cursor-pointer list-none px-5 py-4">
          <div className="font-medium">Research collection</div>
          <div className="text-muted-foreground mt-1 text-xs">
            Public order-book and signal loggers; unrelated to user authentication.
          </div>
        </summary>
        <div className="grid gap-3 border-t p-5 lg:grid-cols-2">
          {RESEARCH_FIELDS.map((field) => (
            <SettingField
              key={field.key}
              field={field}
              variable={variables.get(field.key)}
              edit={edits[field.key]}
              onChange={(value) => setEdit(field.key, value)}
            />
          ))}
        </div>
      </details>

      <div className="bg-background sticky bottom-0 flex flex-wrap items-center gap-3 border-t py-4">
        <Button
          disabled={!Object.keys(edits).length || save.isPending}
          onClick={() => save.mutate({ settings: edits })}
        >
          <Save className="mr-2 h-4 w-4" />
          {save.isPending ? "Saving…" : "Save system connector"}
        </Button>
        <span className="text-muted-foreground text-xs">
          Saving does not verify a user wallet or enable execution.
        </span>
        {save.error ? (
          <p className="text-destructive basis-full text-sm">{save.error.message}</p>
        ) : null}
      </div>
    </div>
  );
}
