import { createSecureClient, relayerApiKey, WalletType } from "@polymarket/client";
import { isWalletDeployed } from "@polymarket/client/actions";
import { privateKey } from "@polymarket/client/viem";
import type { PolymarketWalletType } from "@framework/db";

const WALLET_TYPES: Record<PolymarketWalletType, WalletType> = {
  eoa: WalletType.EOA,
  proxy: WalletType.POLY_PROXY,
  safe: WalletType.GNOSIS_SAFE,
  deposit: WalletType.DEPOSIT_WALLET,
};

type VerificationConnection = {
  account: {
    signer: string;
    wallet: string;
    walletType: WalletType;
  };
  readOpenOrders(): Promise<void>;
  readRelayerStatus(input: { wallet: string; type: WalletType }): Promise<boolean>;
  close(): Promise<void>;
};

export type PolymarketVerificationAdapter = {
  deriveSignerAddress(signerPrivateKey: string): Promise<string>;
  connect(input: {
    walletAddress: string;
    signerAddress: string;
    signerPrivateKey: string;
    relayerApiKey: string;
  }): Promise<VerificationConnection>;
};

export type PolymarketVerificationResult = {
  signerMatches: true;
  walletMatches: true;
  walletTypeMatches: true;
  clobAuthentication: true;
  relayerAuthentication: true;
  walletDeployed: boolean | null;
};

export class PolymarketVerificationError extends Error {
  constructor(
    public readonly publicMessage: string,
    options?: ErrorOptions,
  ) {
    super(publicMessage, options);
    this.name = "PolymarketVerificationError";
  }
}

function sameAddress(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

export function publicPolymarketVerificationError(error: unknown) {
  if (error instanceof PolymarketVerificationError) {
    return error.publicMessage;
  }
  const raw = error instanceof Error ? error.message : String(error);
  if (/401|403|auth|credential|signature|api.?key|unauthor/i.test(raw)) {
    return "Polymarket rejected the saved credentials. Check the signer, wallet type, and Relayer API key.";
  }
  if (/timeout|network|fetch|socket|transport|connect|dns/i.test(raw)) {
    return "Polymarket could not be reached. No account settings were changed; try verification again.";
  }
  return "Polymarket verification failed. Recheck the account details and try again.";
}

const sdkAdapter: PolymarketVerificationAdapter = {
  async deriveSignerAddress(signerPrivateKey) {
    return privateKey(signerPrivateKey).getAddress();
  },
  async connect({ walletAddress, signerAddress, signerPrivateKey, relayerApiKey: relayerKey }) {
    const client = await createSecureClient({
      wallet: walletAddress,
      signer: privateKey(signerPrivateKey),
      apiKey: relayerApiKey({ key: relayerKey, address: signerAddress }),
    });
    return {
      account: client.account,
      async readOpenOrders() {
        await client.listOpenOrders().firstPage();
      },
      async readRelayerStatus({ wallet, type }) {
        return isWalletDeployed(client, { wallet, type });
      },
      async close() {
        await client.closeSubscriptions();
      },
    };
  },
};

/**
 * Verifies a saved Polymarket account without preparing, signing, submitting,
 * approving, or cancelling an order.
 *
 * Creating the secure client may create-or-derive Polymarket CLOB API
 * credentials through the documented authentication handshake. Those
 * credentials remain inside the short-lived SDK client and are not persisted.
 */
export async function verifyPolymarketAccount(
  input: {
    walletType: PolymarketWalletType;
    walletAddress: string;
    signerAddress: string;
    signerPrivateKey: string;
    relayerApiKey: string;
  },
  adapter: PolymarketVerificationAdapter = sdkAdapter,
): Promise<PolymarketVerificationResult> {
  const derivedSigner = await adapter.deriveSignerAddress(input.signerPrivateKey);
  if (!sameAddress(derivedSigner, input.signerAddress)) {
    throw new PolymarketVerificationError(
      "The saved private key does not derive the recorded signer address.",
    );
  }

  let connection: VerificationConnection | null = null;
  try {
    connection = await adapter.connect(input);
    if (!sameAddress(connection.account.signer, input.signerAddress)) {
      throw new PolymarketVerificationError(
        "Polymarket authenticated a different signer than the recorded signer address.",
      );
    }
    if (!sameAddress(connection.account.wallet, input.walletAddress)) {
      throw new PolymarketVerificationError(
        "Polymarket resolved a different funder wallet than the recorded account wallet.",
      );
    }

    const expectedWalletType = WALLET_TYPES[input.walletType];
    if (connection.account.walletType !== expectedWalletType) {
      throw new PolymarketVerificationError(
        "Polymarket resolved a different wallet type. Update the account wallet type and verify again.",
      );
    }

    await connection.readOpenOrders();

    // The SDK short-circuits a deployment check for an EOA. Use a harmless
    // Deposit Wallet lookup to prove the Relayer credential can authenticate,
    // while keeping the EOA deployment result intentionally not applicable.
    const relayerReadType =
      expectedWalletType === WalletType.EOA ? WalletType.DEPOSIT_WALLET : expectedWalletType;
    const deploymentRead = await connection.readRelayerStatus({
      wallet: input.walletAddress,
      type: relayerReadType,
    });

    return {
      signerMatches: true,
      walletMatches: true,
      walletTypeMatches: true,
      clobAuthentication: true,
      relayerAuthentication: true,
      walletDeployed: expectedWalletType === WalletType.EOA ? null : deploymentRead,
    };
  } finally {
    await connection?.close().catch(() => undefined);
  }
}
