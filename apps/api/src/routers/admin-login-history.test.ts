import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("login history is an admin-only, bounded, token-free read", () => {
  const source = readFileSync(new URL("./admin.ts", import.meta.url), "utf8");
  const start = source.indexOf("loginHistory:");
  const end = source.indexOf("// Create a new user", start);
  const block = source.slice(start, end);
  assert.match(block, /loginHistory:\s*adminProcedure/);
  assert.match(block, /max\(250\)/);
  assert.match(block, /loginEvents\.createdAt/);
  assert.doesNotMatch(block, /sessionId|sessions\.token|loginEvents\.authPath/);
});

test("login-event migration preserves retained sessions without exposing tokens", () => {
  const migration = readFileSync(
    new URL("../../../../packages/db/drizzle/0040_complex_preak.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /CREATE TABLE "login_event"/);
  assert.match(migration, /existing session backfill/);
  assert.match(migration, /ON CONFLICT \("session_id"\) DO NOTHING/);
  assert.doesNotMatch(migration, /s\."token"/);
});
