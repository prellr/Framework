import { index, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Knowledgebase: durable institutional memory for research, operations,
 * strategy decisions, and postmortems. Agents (via MCP) and humans (via the
 * web UI) read it before redoing research and write findings back after.
 *
 * Continual improvement is structural: updates snapshot the prior version to
 * kb_revision (append-only), and articles are never deleted — they're
 * archived or superseded with a pointer, so the "why we stopped doing X"
 * trail survives.
 */

export const kbArticles = pgTable(
  "kb_article",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    /** operations | strategy | research | provider | decision | postmortem */
    category: text("category").notNull(),
    tags: text("tags").array(),
    /** Markdown body. */
    body: text("body").notNull(),
    /** active | superseded | archived */
    status: text("status").notNull().default("active"),
    supersededBySlug: text("superseded_by_slug"),
    /** [{title, url}] — provenance for research claims. */
    sources: jsonb("sources"),
    createdBy: text("created_by"),
    updatedBy: text("updated_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("kb_article_category_idx").on(t.category, t.status)],
);

export const kbRevisions = pgTable(
  "kb_revision",
  {
    id: serial("id").primaryKey(),
    articleId: integer("article_id")
      .notNull()
      .references(() => kbArticles.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    category: text("category").notNull(),
    tags: text("tags").array(),
    body: text("body").notNull(),
    editedBy: text("edited_by"),
    editedAt: timestamp("edited_at").notNull().defaultNow(),
  },
  (t) => [index("kb_revision_article_idx").on(t.articleId, t.editedAt)],
);
