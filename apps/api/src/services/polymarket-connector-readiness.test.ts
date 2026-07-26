import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  POLYMARKET_CONNECTOR_READINESS,
  polymarketConnectorReadiness,
} from "./polymarket-connector-readiness.ts";
import { isSecretSetting } from "./config.ts";

const address = "0x1111111111111111111111111111111111111111";
const secret = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const relayerKey = "relayer-key-that-must-never-leave-the-server";

test("connector readiness exposes a public connection without inventing an execution path", async () => {
  const settings = new Map<string, string>([
    ["POLYMARKET_WALLET_ADDRESS", address],
    ["POLYMARKET_SIGNER_PRIVATE_KEY", secret],
    ["POLYMARKET_RELAYER_API_KEY", relayerKey],
    ["POLYMARKET_RELAYER_API_KEY_ADDRESS", address],
    ["POLYGON_RPC_URL", "https://polygon.example.invalid"],
    ["POLYMARKET_LIVE_EXECUTION_ENABLED", "true"],
    ["POLYMARKET_MAX_ORDER_USD", "5"],
    ["POLYMARKET_MAX_OPEN_EXPOSURE_USD", "25"],
    ["POLYMARKET_DAILY_LOSS_LIMIT_USD", "20"],
    ["POLYMARKET_MAX_BOOK_AGE_MS", "2000"],
  ]);
  const status = await polymarketConnectorReadiness(
    {
      readSetting: async (key) => settings.get(key),
      probePublicClient: async () => ({
        reachable: true,
        activeMarketsSampled: 1,
        latencyMs: 12,
        error: null,
      }),
    },
    Date.UTC(2026, 6, 25, 20),
  );

  assert.equal(status.phase, "configured-locked");
  assert.equal(status.publicApi.reachable, true);
  assert.equal(status.account.configurationReady, true);
  assert.equal(status.risk.controlsReady, true);
  assert.equal(status.execution.armRequested, true);
  assert.equal(status.execution.routeAvailable, false);
  assert.equal(status.execution.enabled, false);
  assert.equal(status.lifecycle.orderSubmission, false);
  assert.equal(status.lifecycle.cancellation, false);
  assert.equal(status.account.walletMasked, "0x1111…1111");
  const serialized = JSON.stringify(status);
  assert.doesNotMatch(serialized, new RegExp(secret));
  assert.doesNotMatch(serialized, new RegExp(relayerKey));
});

test("connector readiness fails closed around public and malformed configuration", async () => {
  const settings = new Map<string, string>([
    ["POLYMARKET_WALLET_ADDRESS", "not-an-address"],
    ["POLYMARKET_MAX_ORDER_USD", "25"],
    ["POLYMARKET_MAX_OPEN_EXPOSURE_USD", "5"],
    ["POLYMARKET_DAILY_LOSS_LIMIT_USD", "-1"],
    ["POLYMARKET_MAX_BOOK_AGE_MS", "0"],
  ]);
  const status = await polymarketConnectorReadiness(
    {
      readSetting: async (key) => settings.get(key),
      probePublicClient: async () => ({
        reachable: false,
        activeMarketsSampled: 0,
        latencyMs: 40,
        error: "transport",
      }),
    },
    1,
  );

  assert.equal(status.phase, "public-disconnected");
  assert.equal(status.account.configurationReady, false);
  assert.equal(status.risk.controlsReady, false);
  assert.equal(status.execution.enabled, false);
  assert.ok(status.blockers.length >= 6);
});

test("readiness implementation is bounded to the official public SDK", async () => {
  const source = await readFile(
    new URL("./polymarket-connector-readiness.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /createPublicClient/);
  assert.match(source, /listMarkets/);
  assert.doesNotMatch(source, /createSecureClient\s*\(/);
  assert.doesNotMatch(source, /placeMarketOrder\s*\(/);
  assert.doesNotMatch(source, /placeLimitOrder\s*\(/);
  assert.doesNotMatch(source, /cancelOrder\s*\(/);
  assert.equal(POLYMARKET_CONNECTOR_READINESS.submissionEnabled, false);
  assert.equal(POLYMARKET_CONNECTOR_READINESS.cancellationEnabled, false);

  const router = await readFile(new URL("../routers/polymarket.ts", import.meta.url), "utf8");
  assert.match(
    router,
    /connectorReadiness:\s*protectedProcedure\.query\(\(\)\s*=>\s*polymarketConnectorReadiness\(\)\)/,
  );
});

test("connector credentials and RPC endpoints remain write-only while public addresses remain visible", () => {
  assert.equal(isSecretSetting("POLYMARKET_SIGNER_PRIVATE_KEY"), true);
  assert.equal(isSecretSetting("POLYMARKET_RELAYER_API_KEY"), true);
  assert.equal(isSecretSetting("POLYGON_RPC_URL"), true);
  assert.equal(isSecretSetting("POLYMARKET_WALLET_ADDRESS"), false);
  assert.equal(isSecretSetting("POLYMARKET_RELAYER_API_KEY_ADDRESS"), false);
});
