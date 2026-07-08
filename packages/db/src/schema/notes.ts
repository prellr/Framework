import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users.ts";

/**
 * Example domain table. Delete this file (and its router/page) once your
 * project has real domain tables — it exists to demonstrate the schema →
 * router → page pattern end to end.
 */
export const notes = pgTable("note", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  body: text("body"),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
