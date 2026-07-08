import { bigserial, index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users.ts";

export const auditLogs = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(), // e.g. "notes.update"
    resourceType: text("resource_type"),
    resourceId: text("resource_id"),
    oldValue: jsonb("old_value"),
    newValue: jsonb("new_value"),
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("audit_log_user_id_idx").on(t.userId),
    index("audit_log_resource_idx").on(t.resourceType, t.resourceId),
    index("audit_log_created_at_idx").on(t.createdAt),
  ],
);
