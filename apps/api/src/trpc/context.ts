import { initTRPC } from "@trpc/server";
import { timingSafeEqual } from "crypto";
import type { Context as HonoContext } from "hono";
import superjson from "superjson";
import { auth } from "../auth.ts";
import { getSetting } from "../services/config.ts";

/**
 * Synthetic user injected when a valid X-API-Key is presented (MCP / agent access).
 * Role is READ-ONLY (viewer) by default — this system is analysis-only and agents should
 * not spend rate budget or mutate unless an operator explicitly opts in via the
 * AGENT_API_ROLE setting. Never grant an agent key more than "operator".
 */
function agentUser(role: "viewer" | "operator") {
  return {
    id: "agent",
    name: "Agent",
    email: "agent@localhost",
    role,
    banned: false,
    banReason: null,
    banExpires: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    emailVerified: false,
    image: null,
  };
}

export async function createContext(c: HonoContext) {
  // ── Agent / MCP access via X-API-Key ──────────────────────────────────────
  const providedKey = c.req.header("X-API-Key");
  if (providedKey) {
    const expectedKey = await getSetting("AGENT_API_KEY");
    if (
      expectedKey &&
      providedKey.length === expectedKey.length &&
      timingSafeEqual(Buffer.from(providedKey), Buffer.from(expectedKey))
    ) {
      // Read-only unless an operator explicitly opts the agent key up.
      const configured = (await getSetting("AGENT_API_ROLE")) === "operator" ? "operator" : "viewer";
      return { user: agentUser(configured), session: null, req: c.req.raw };
    }
  }

  // ── Normal session auth ───────────────────────────────────────────────────
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  return {
    user: session?.user ?? null,
    session: session?.session ?? null,
    req: c.req.raw,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;

export const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape }) {
    return shape;
  },
});
