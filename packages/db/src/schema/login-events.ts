import { bigserial, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./users.ts";

/**
 * Append-only successful-login history.
 *
 * Better Auth may expire or delete the live session row, so this deliberately snapshots the user,
 * network, and client metadata needed for an administrative security review.
 */
export const loginEvents = pgTable(
  "login_event",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    sessionId: text("session_id").notNull(),
    userName: text("user_name").notNull(),
    userEmail: text("user_email").notNull(),
    authMethod: text("auth_method").notNull(),
    authPath: text("auth_path"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("login_event_session_id_uniq").on(t.sessionId),
    index("login_event_user_created_idx").on(t.userId, t.createdAt),
    index("login_event_created_at_idx").on(t.createdAt),
    index("login_event_ip_created_idx").on(t.ipAddress, t.createdAt),
  ],
);
