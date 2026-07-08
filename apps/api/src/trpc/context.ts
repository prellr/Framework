import { initTRPC } from "@trpc/server";
import { timingSafeEqual } from "crypto";
import type { Context as HonoContext } from "hono";
import superjson from "superjson";
import { auth } from "../auth.ts";
import { getSetting } from "../services/config.ts";

/** Synthetic user injected when a valid X-API-Key is presented (MCP / agent access). */
const AGENT_USER = {
  id: "agent",
  name: "Agent",
  email: "agent@localhost",
  role: "manager" as const,
  banned: false,
  banReason: null,
  banExpires: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  emailVerified: false,
  image: null,
};

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
      return { user: AGENT_USER, session: null, req: c.req.raw };
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
