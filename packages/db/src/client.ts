import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index.ts";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is required");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  // Without keepalive, Docker's bridge network silently drops idle TCP
  // connections after a few minutes. The next query on a zombie connection
  // hangs at the TCP layer for the kernel's retransmit timeout before
  // pg-pool can surface "Connection terminated unexpectedly", and new
  // requests queue up and exhaust the pool. Keepalive keeps the OS sending
  // heartbeat packets so connections stay live OR die fast enough for
  // pg-pool to recycle them.
  keepAlive: true,
  // Hard cap on how long a single client.connect() waits when the pool is
  // saturated. Default is 0 (wait forever) — that turns a pool hiccup into
  // a multi-minute hang where every request piles up on getSession. 5s is
  // long enough for a healthy pool to free a slot and short enough to get
  // a clear error in logs if something's wedged.
  connectionTimeoutMillis: 5_000,
  // Drop idle clients aggressively so zombie connections (above) get
  // recycled before they bite.
  idleTimeoutMillis: 30_000,
});

// Surface pool errors (backend crash, network drop) in logs instead of
// letting them become silent unhandledRejections.
pool.on("error", (err) => {
  console.error("[db.pool] idle client error:", err.message);
});

export const db = drizzle(pool, { schema });
export type Db = typeof db;
