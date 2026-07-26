import assert from "node:assert/strict";
import test from "node:test";
import { WalletType } from "@polymarket/client";
import {
  PolymarketVerificationError,
  publicPolymarketVerificationError,
  type PolymarketVerificationAdapter,
  verifyPolymarketAccount,
} from "./polymarket-account-verification.ts";

const signer = "0x1111111111111111111111111111111111111111";
const wallet = "0x2222222222222222222222222222222222222222";

function adapter(
  overrides: {
    derivedSigner?: string;
    accountSigner?: string;
    accountWallet?: string;
    accountWalletType?: WalletType;
    walletDeployed?: boolean;
  } = {},
) {
  const calls = {
    connected: 0,
    connectInput: null as Parameters<PolymarketVerificationAdapter["connect"]>[0] | null,
    openOrders: 0,
    relayer: [] as Array<{ wallet: string; type: WalletType }>,
    closed: 0,
  };
  const implementation: PolymarketVerificationAdapter = {
    async deriveSignerAddress() {
      return overrides.derivedSigner ?? signer;
    },
    async connect(input) {
      calls.connected += 1;
      calls.connectInput = input;
      return {
        account: {
          signer: overrides.accountSigner ?? signer,
          wallet: overrides.accountWallet ?? wallet,
          walletType: overrides.accountWalletType ?? WalletType.DEPOSIT_WALLET,
        },
        async readOpenOrders() {
          calls.openOrders += 1;
        },
        async readRelayerStatus(input) {
          calls.relayer.push(input);
          return overrides.walletDeployed ?? true;
        },
        async close() {
          calls.closed += 1;
        },
      };
    },
  };
  return { implementation, calls };
}

const baseInput = {
  walletType: "deposit" as const,
  walletAddress: wallet,
  signerAddress: signer,
  signerPrivateKey: `0x${"a".repeat(64)}`,
  relayerApiKey: "relayer-secret",
};

test("verification performs both authenticated reads and returns safe checks", async () => {
  const fake = adapter();
  const result = await verifyPolymarketAccount(baseInput, fake.implementation);
  assert.deepEqual(result, {
    signerMatches: true,
    walletMatches: true,
    walletTypeMatches: true,
    clobAuthentication: true,
    relayerAuthentication: true,
    walletDeployed: true,
  });
  assert.equal(fake.calls.openOrders, 1);
  assert.equal(fake.calls.connectInput?.signerAddress, signer);
  assert.deepEqual(fake.calls.relayer, [{ wallet, type: WalletType.DEPOSIT_WALLET }]);
  assert.equal(fake.calls.closed, 1);
});

test("signer mismatch fails before any network connection", async () => {
  const fake = adapter({ derivedSigner: wallet });
  await assert.rejects(
    verifyPolymarketAccount(baseInput, fake.implementation),
    PolymarketVerificationError,
  );
  assert.equal(fake.calls.connected, 0);
});

test("wallet type mismatch closes the client and performs no authenticated reads", async () => {
  const fake = adapter({ accountWalletType: WalletType.GNOSIS_SAFE });
  await assert.rejects(
    verifyPolymarketAccount(baseInput, fake.implementation),
    PolymarketVerificationError,
  );
  assert.equal(fake.calls.openOrders, 0);
  assert.equal(fake.calls.relayer.length, 0);
  assert.equal(fake.calls.closed, 1);
});

test("EOA verification proves relayer authentication without claiming deployment", async () => {
  const fake = adapter({ accountWalletType: WalletType.EOA, walletDeployed: false });
  const result = await verifyPolymarketAccount(
    { ...baseInput, walletType: "eoa" },
    fake.implementation,
  );
  assert.equal(result.walletDeployed, null);
  assert.deepEqual(fake.calls.relayer, [{ wallet, type: WalletType.DEPOSIT_WALLET }]);
});

test("public errors never echo raw credential material", () => {
  const raw = "401 invalid api key relayer-secret";
  const message = publicPolymarketVerificationError(new Error(raw));
  assert.doesNotMatch(message, /relayer-secret/);
  assert.match(message, /rejected the saved credentials/i);
});
