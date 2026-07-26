import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("personal Polymarket account APIs require a signed-in human and stay user-scoped", () => {
  const router = read("../routers/polymarket-accounts.ts");
  const middleware = read("../trpc/middleware.ts");

  assert.match(middleware, /export const humanProcedure/);
  assert.match(middleware, /ctx\.user\.id === "agent" \|\| !ctx\.session/);
  assert.doesNotMatch(router, /\bprotectedProcedure\b/);
  assert.doesNotMatch(router, /\b(?:tradeProcedure|adminProcedure)\b/);
  assert.ok((router.match(/\bhumanProcedure\b/g) ?? []).length >= 6);
  assert.ok((router.match(/eq\(polymarketAccounts\.userId, ctx\.user\.id\)/g) ?? []).length >= 8);
});

test("multi-wallet responses expose account metadata but never sealed credentials", () => {
  const router = read("../routers/polymarket-accounts.ts");
  const publicProjection = router.match(
    /function publicAccount\([\s\S]+?\n}\n\nasync function accountForUser/,
  )?.[0];

  assert.ok(publicProjection, "public account projection must remain explicit");
  assert.doesNotMatch(
    publicProjection,
    /encryptedSignerKey:\s*row\.encryptedSignerKey|signerKeyNonce:\s*row\.signerKeyNonce/,
  );
  assert.doesNotMatch(
    publicProjection,
    /encryptedRelayerApiKey:\s*row\.encryptedRelayerApiKey|relayerApiKeyNonce:\s*row\.relayerApiKeyNonce/,
  );
  assert.doesNotMatch(router, /\b(?:unseal|decrypt)\s*\(/);
  assert.doesNotMatch(
    router,
    /\b(?:placeOrder|submitOrder|createOrder|signOrder|cancelOrder)\s*\(/,
  );
});

test("multi-wallet storage preserves account isolation and fail-closed risk ceilings", () => {
  const schema = read("../../../../packages/db/src/schema/polymarket-accounts.ts");
  const router = read("../routers/polymarket-accounts.ts");

  assert.match(schema, /references\(\(\) => users\.id, \{ onDelete: "cascade" \}\)/);
  assert.match(
    schema,
    /uniqueIndex\("polymarket_account_user_wallet_uidx"\)\.on\(table\.userId, table\.walletAddress\)/,
  );
  assert.match(router, /configured\.some\(\(value\) => value == null\)/);
  assert.match(router, /system-wide Polymarket risk ceilings/);
  assert.match(router, /Choose another default account before unsetting this one/);
});
