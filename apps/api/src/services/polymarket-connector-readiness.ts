import { createPublicClient } from "@polymarket/client";
import { getSetting } from "./config.ts";

export const POLYMARKET_CONNECTOR_READINESS = {
  version: "polymarket-connector-readiness-v1",
  sdkPackage: "@polymarket/client",
  sdkVersion: "0.2.0",
  environment: "production",
  publicProbeCacheMs: 30_000,
  executionRouteAvailable: false,
  authenticatedClientEnabled: false,
  userStreamEnabled: false,
  submissionEnabled: false,
  cancellationEnabled: false,
} as const;

export const POLYMARKET_CONNECTOR_SETTING_KEYS = {
  walletAddress: "POLYMARKET_WALLET_ADDRESS",
  signerPrivateKey: "POLYMARKET_SIGNER_PRIVATE_KEY",
  relayerApiKey: "POLYMARKET_RELAYER_API_KEY",
  relayerApiKeyAddress: "POLYMARKET_RELAYER_API_KEY_ADDRESS",
  polygonRpcUrl: "POLYGON_RPC_URL",
  liveExecutionEnabled: "POLYMARKET_LIVE_EXECUTION_ENABLED",
  maxOrderUsd: "POLYMARKET_MAX_ORDER_USD",
  maxOpenExposureUsd: "POLYMARKET_MAX_OPEN_EXPOSURE_USD",
  dailyLossLimitUsd: "POLYMARKET_DAILY_LOSS_LIMIT_USD",
  maxBookAgeMs: "POLYMARKET_MAX_BOOK_AGE_MS",
} as const;

type ReadSetting = (key: string) => Promise<string | undefined>;
type ProbePublicClient = () => Promise<{
  reachable: boolean;
  activeMarketsSampled: number;
  latencyMs: number | null;
  error: "rate-limited" | "rejected" | "transport" | "unexpected" | null;
}>;

interface ReadinessDependencies {
  readSetting?: ReadSetting;
  probePublicClient?: ProbePublicClient;
}

interface CachedProbe {
  expiresAtMs: number;
  value: Awaited<ReturnType<ProbePublicClient>>;
}

let publicProbeCache: CachedProbe | null = null;

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function maskAddress(value: string | undefined): string | null {
  if (!value || !EVM_ADDRESS.test(value)) return null;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function positiveNumber(value: string | undefined): number | null {
  if (value == null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function classifyProbeError(
  error: unknown,
): Exclude<Awaited<ReturnType<ProbePublicClient>>["error"], null> {
  const name = error instanceof Error ? error.name : "";
  if (name === "RateLimitError") return "rate-limited";
  if (name === "RequestRejectedError") return "rejected";
  if (name === "TransportError" || name === "TimeoutError") return "transport";
  return "unexpected";
}

async function defaultPublicProbe(): ReturnType<ProbePublicClient> {
  const startedAt = performance.now();
  try {
    const client = createPublicClient();
    const page = await client.listMarkets({ closed: false, pageSize: 1 }).firstPage();
    return {
      reachable: true,
      activeMarketsSampled: page.items.length,
      latencyMs: Math.max(0, performance.now() - startedAt),
      error: null,
    };
  } catch (error) {
    return {
      reachable: false,
      activeMarketsSampled: 0,
      latencyMs: Math.max(0, performance.now() - startedAt),
      error: classifyProbeError(error),
    };
  }
}

async function loadPublicProbe(
  probe: ProbePublicClient,
  nowMs: number,
  cache: boolean,
): ReturnType<ProbePublicClient> {
  if (cache && publicProbeCache && publicProbeCache.expiresAtMs > nowMs) {
    return publicProbeCache.value;
  }
  const value = await probe();
  if (cache) {
    publicProbeCache = {
      expiresAtMs: nowMs + POLYMARKET_CONNECTOR_READINESS.publicProbeCacheMs,
      value,
    };
  }
  return value;
}

/**
 * Returns a secret-free connector control-plane projection.
 *
 * It makes one bounded public SDK request and checks only whether account/risk settings exist and
 * are structurally valid. It never creates a SecureClient, signs a message, derives credentials,
 * reads balances, subscribes to the user stream, or exposes an order/cancel method.
 */
export async function polymarketConnectorReadiness(
  dependencies: ReadinessDependencies = {},
  nowMs = Date.now(),
) {
  const readSetting = dependencies.readSetting ?? getSetting;
  const probe = dependencies.probePublicClient ?? defaultPublicProbe;
  const keys = POLYMARKET_CONNECTOR_SETTING_KEYS;
  const [
    publicApi,
    walletAddress,
    signerPrivateKey,
    relayerApiKey,
    relayerApiKeyAddress,
    polygonRpcUrl,
    executionArm,
    maxOrderUsdRaw,
    maxOpenExposureUsdRaw,
    dailyLossLimitUsdRaw,
    maxBookAgeMsRaw,
  ] = await Promise.all([
    loadPublicProbe(probe, nowMs, dependencies.probePublicClient == null),
    readSetting(keys.walletAddress),
    readSetting(keys.signerPrivateKey),
    readSetting(keys.relayerApiKey),
    readSetting(keys.relayerApiKeyAddress),
    readSetting(keys.polygonRpcUrl),
    readSetting(keys.liveExecutionEnabled),
    readSetting(keys.maxOrderUsd),
    readSetting(keys.maxOpenExposureUsd),
    readSetting(keys.dailyLossLimitUsd),
    readSetting(keys.maxBookAgeMs),
  ]);

  const walletValid = Boolean(walletAddress && EVM_ADDRESS.test(walletAddress));
  const relayerAddressValid = Boolean(
    relayerApiKeyAddress && EVM_ADDRESS.test(relayerApiKeyAddress),
  );
  const risk = {
    maxOrderUsd: positiveNumber(maxOrderUsdRaw),
    maxOpenExposureUsd: positiveNumber(maxOpenExposureUsdRaw),
    dailyLossLimitUsd: positiveNumber(dailyLossLimitUsdRaw),
    maxBookAgeMs: positiveNumber(maxBookAgeMsRaw),
  };
  const riskControlsReady =
    Object.values(risk).every((value) => value != null) &&
    risk.maxOpenExposureUsd! >= risk.maxOrderUsd!;
  const accountConfigurationReady =
    walletValid && Boolean(signerPrivateKey) && Boolean(relayerApiKey) && relayerAddressValid;
  const executionArmRequested = executionArm === "true";

  const blockers: string[] = [];
  if (!publicApi.reachable) blockers.push("Official public SDK probe is not reachable.");
  if (!walletAddress) blockers.push("Account wallet address is not configured.");
  else if (!walletValid) blockers.push("Account wallet address is not a valid EVM address.");
  if (!signerPrivateKey) blockers.push("Dedicated signer is not configured.");
  if (!relayerApiKey) blockers.push("Relayer API key is not configured.");
  if (!relayerApiKeyAddress) blockers.push("Relayer API key address is not configured.");
  else if (!relayerAddressValid) blockers.push("Relayer API key address is not valid.");
  if (!riskControlsReady) blockers.push("All four explicit risk limits are not valid.");
  blockers.push("Authenticated client and user-stream reconciliation are not implemented yet.");
  blockers.push("No order submission or cancellation route exists.");
  if (!executionArmRequested) blockers.push("Live execution arm is off.");

  return {
    ...POLYMARKET_CONNECTOR_READINESS,
    checkedAtMs: nowMs,
    phase:
      accountConfigurationReady && riskControlsReady
        ? "configured-locked"
        : publicApi.reachable
          ? "public-connected"
          : "public-disconnected",
    publicApi,
    account: {
      walletConfigured: Boolean(walletAddress),
      walletValid,
      walletMasked: maskAddress(walletAddress),
      signerConfigured: Boolean(signerPrivateKey),
      relayerApiKeyConfigured: Boolean(relayerApiKey),
      relayerApiKeyAddressConfigured: Boolean(relayerApiKeyAddress),
      relayerApiKeyAddressValid: relayerAddressValid,
      relayerApiKeyAddressMasked: maskAddress(relayerApiKeyAddress),
      polygonRpcConfigured: Boolean(polygonRpcUrl),
      configurationReady: accountConfigurationReady,
    },
    risk: {
      ...risk,
      controlsReady: riskControlsReady,
    },
    lifecycle: {
      publicMarketData: publicApi.reachable,
      sharedMarketStream: true,
      feeAwareShadowPlans: true,
      authenticatedClient: false,
      userOrderStream: false,
      restRecovery: false,
      balancesAndAllowances: false,
      orderSubmission: false,
      cancellation: false,
    },
    execution: {
      armRequested: executionArmRequested,
      routeAvailable: false,
      enabled: false,
    },
    blockers,
  } as const;
}

export function resetPolymarketConnectorReadinessCache() {
  publicProbeCache = null;
}
