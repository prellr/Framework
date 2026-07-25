import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loginAuthMethod } from "./login-history-contract.ts";

test("login method classification keeps successful session sources legible", () => {
  assert.equal(loginAuthMethod("/api/auth/sign-in/email", null), "email/password");
  assert.equal(loginAuthMethod("/api/auth/sign-in/social", null), "social");
  assert.equal(loginAuthMethod("/api/auth/sign-up/email", null), "sign-up");
  assert.equal(loginAuthMethod("/api/auth/callback/google", null), "oauth callback");
  assert.equal(loginAuthMethod("/api/auth/impersonate-user", "admin-id"), "impersonation");
  assert.equal(loginAuthMethod(null, null), "session");
});

test("successful login hook is installed at session creation and not page access", () => {
  const authSource = readFileSync(new URL("../auth.ts", import.meta.url), "utf8");
  assert.match(authSource, /databaseHooks:\s*\{[\s\S]*session:\s*\{[\s\S]*create:/);
  assert.match(authSource, /recordSuccessfulLogin/);
  assert.doesNotMatch(authSource, /getSession[\s\S]*recordSuccessfulLogin/);
});

test("login history writes are idempotent and do not throw through authentication", () => {
  const source = readFileSync(new URL("./login-history.ts", import.meta.url), "utf8");
  assert.match(source, /onConflictDoNothing\(\{\s*target:\s*loginEvents\.sessionId\s*\}\)/);
  assert.match(source, /catch \(error\)/);
  assert.doesNotMatch(source, /throw error/);
});
