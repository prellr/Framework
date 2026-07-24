/**
 * Jester API client — the single chokepoint for every outbound Jester call.
 *
 * Responsibilities:
 *   1. Enforce the analysis-only allowlist (services/jester-allowlist.ts) BEFORE any request.
 *   2. Decrypt the per-user API key at call time (services/crypto.ts) — never held in plaintext.
 *   3. Inject `x-api-key` and, on POST, the `X-Requested-With` CSRF header Jester requires.
 *   4. Unwrap Jester's error envelope (errors arrive as HTTP 200 with {success:false,_httpStatus}).
 *
 * Rate limiting (Jester throttles backtests) is layered on in Phase 2 via the BullMQ worker;
 * this module stays request-scoped and stateless.
 */

import { db, jesterCredentials } from "@framework/db";
import { eq } from "drizzle-orm";
import { assertAllowed, assertTradeAllowed, type Method } from "./jester-allowlist.ts";
import { open } from "./crypto.ts";
import { bustLiveCache } from "./live-cache.ts";

export class JesterError extends Error {
  constructor(
    message: string,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "JesterError";
  }
}

/**
 * Low-level call with an explicit key/baseUrl. Used both by jesterCall (after decrypting a
 * stored credential) and by credential verification (before a credential exists). Every path
 * still passes through assertAllowed — there is no way to reach Jester that skips it.
 */
export async function rawCall(
  baseUrl: string,
  apiKey: string,
  method: Method,
  path: string,
  body?: unknown,
  timeoutMs = 25_000,
): Promise<any> {
  assertAllowed(method, path, body);

  // Fail fast on a hang. Some Jester endpoints (notably my_strategies) can stall indefinitely on
  // their side; without a timeout the request holds a connection open forever and the UI spins.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let res: Response;
  let text: string;
  try {
    res = await fetch(baseUrl.replace(/\/$/, "") + path, {
      method,
      headers: {
        "x-api-key": apiKey,
        ...(method === "POST" && {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest", // Jester CSRF guard — required on all POSTs
        }),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ac.signal,
    });
    // Non-JSON (e.g. an HTML 404 page) → surface as an error rather than throwing on parse.
    text = await res.text();
  } catch (e) {
    if (ac.signal.aborted) throw new JesterError(`Jester call timed out after ${timeoutMs / 1000}s (${path})`, 504);
    throw e;
  } finally {
    clearTimeout(timer);
  }
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new JesterError(`Non-JSON response (${res.status}) from ${path}`, res.status);
  }

  if (json && json.success === false) {
    // The specific reason lives in different places depending on the endpoint: `error` (most),
    // `result.error` (MCP tool wrapper), or `message`/`code` (REST endpoints like /backtests, which
    // returns {code:"QUEUE_FULL", message:"…"}). Surface the first we find instead of the opaque
    // "Jester call failed" — otherwise real, actionable errors (queue full, rate limit) are hidden.
    const msg = json.error ?? json.result?.error ?? json.message ?? json.result?.message ?? json.code ?? "Jester call failed";
    throw new JesterError(msg, json._httpStatus ?? res.status);
  }
  return json;
}

async function decrypt(userId: string): Promise<{ baseUrl: string; apiKey: string }> {
  const [cred] = await db
    .select()
    .from(jesterCredentials)
    .where(eq(jesterCredentials.userId, userId))
    .limit(1);
  if (!cred) throw new JesterError("No Jester credential on file for this user", 401);
  const apiKey = await open({ encryptedKey: cred.encryptedKey, keyNonce: cred.keyNonce });
  return { baseUrl: cred.baseUrl, apiKey };
}

/** Make an allowed Jester call using the user's stored (decrypted) credential. */
export async function jesterCall(
  userId: string,
  method: Method,
  path: string,
  body?: unknown,
  timeoutMs?: number,
): Promise<any> {
  const { baseUrl, apiKey } = await decrypt(userId);
  return rawCall(baseUrl, apiKey, method, path, body, timeoutMs);
}

/**
 * TRADE channel — the ONLY way this system performs a mutating Jester action. Separate from the
 * analysis path on purpose: it gates on the narrow TRADE_ACTIONS allowlist (not the analysis one),
 * so `assertAllowed` / MUTATE_TOOLS stay fully fail-closed for every normal call. This function must
 * only ever be invoked from the human-gated `trading` router (manager+ real session). It executes a
 * REAL action on the live account.
 */
export async function jesterTradeCall(
  userId: string,
  name: string,
  action: string,
  extraArgs: Record<string, unknown> = {},
  timeoutMs = 25_000,
): Promise<any> {
  assertTradeAllowed(name, action); // narrow, curated — throws otherwise
  const { baseUrl, apiKey } = await decrypt(userId);
  const url = baseUrl.replace(/\/$/, "") + "/api/delegated/mcp/tool";

  const doCall = async (args: Record<string, unknown>): Promise<{ status: number; json: any }> => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({ name, args }),
        signal: ac.signal,
      });
      const text = await res.text();
      try {
        return { status: res.status, json: JSON.parse(text) };
      } catch {
        throw new JesterError(`Non-JSON response (${res.status}) from trade action ${name}.${action}`, res.status);
      }
    } catch (error) {
      if (ac.signal.aborted) {
        throw new JesterError(`Jester trade action timed out after ${timeoutMs / 1000}s (${name}.${action})`, 504);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };

  // First attempt.
  let { status, json } = await doCall({ action, ...extraArgs });

  // Jester's mutate-tier two-step guard: the first call returns a confirmToken that must be
  // resubmitted in args to actually execute. The user has already approved this exact action in the
  // app's Activate dialog (which shows the full summary before the Confirm button), so completing the
  // handshake here is faithful to Jester's "show summary → approve → resubmit with token" contract —
  // not a bypass. This is only reachable via the human-gated trading router (manager+ real session).
  const token = findConfirmToken(json);
  if (token) {
    ({ status, json } = await doCall({ action, ...extraArgs, confirmToken: token }));
  }

  if (json && json.success === false) {
    // Surface Jester's real reason — it may sit at the top level or nested under result.
    const msg =
      json.error ??
      json.result?.error ??
      json.result?.message ??
      json.message ??
      `Trade action ${name}.${action} failed`;
    throw new JesterError(msg, json._httpStatus ?? status);
  }
  // A successful MUTATION changes live state → invalidate the cached my_strategies snapshot so the
  // next read reflects it immediately. Read-only trade-channel actions leave state unchanged.
  if (!TRADE_READ_ACTIONS.has(action)) bustLiveCache(userId);
  return json;
}

/** Trade-channel actions that only READ — busting the live cache after these would be pointless. */
const TRADE_READ_ACTIONS = new Set(["center", "allocation_get", "recent_signals", "timeframe_options", "strategy_settings"]);

/**
 * Recursively find a `confirmToken` (Jester's two-step mutate guard) anywhere in a response object.
 * Jester may place it at the top level or nested under `result`, so we scan rather than guess a path.
 * Returns the token string, or null if the response isn't a confirm challenge.
 */
function findConfirmToken(obj: any, depth = 0): string | null {
  if (!obj || typeof obj !== "object" || depth > 5) return null;
  for (const [k, v] of Object.entries(obj)) {
    if (/^confirm(ation)?token$/i.test(k) && typeof v === "string" && v.length > 0) return v;
    if (v && typeof v === "object") {
      const found = findConfirmToken(v, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

export interface JesterStatus {
  accountId: string | null;
  hyperliquidReady: boolean | null;
}

/** Parse the derived, non-secret status fields out of a whoami?include=summary response. */
export function deriveStatus(whoami: any): JesterStatus {
  return {
    accountId: whoami?.telegramId != null ? String(whoami.telegramId) : null,
    hyperliquidReady: whoami?.summary?.hyperliquidReady ?? null,
  };
}

/** Verify a raw key by calling whoami, returning derived status. Used before storing. */
export async function verifyKey(baseUrl: string, apiKey: string): Promise<JesterStatus> {
  const whoami = await rawCall(baseUrl, apiKey, "GET", "/api/delegated/whoami?include=summary");
  return deriveStatus(whoami);
}
