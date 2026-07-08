import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users.ts";

/**
 * Key/value store for runtime-configurable settings.
 * Keys correspond to environment variable names (e.g. "RESEND_API_KEY").
 * getSetting() reads from here first, then falls back to process.env.
 */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
});
