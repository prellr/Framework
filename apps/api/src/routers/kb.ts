import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, kbArticles, kbRevisions } from "@framework/db";
import { t } from "../trpc/context.ts";
import { operatorProcedure, protectedProcedure } from "../trpc/middleware.ts";
import { audit } from "../services/audit.ts";

const categoryEnum = z.enum(["operations", "strategy", "research", "provider", "decision", "postmortem"]);

const upsertInput = z.object({
  slug: z
    .string()
    .min(3)
    .regex(/^[a-z0-9-]+$/, "slug must be kebab-case"),
  title: z.string().min(3),
  category: categoryEnum,
  tags: z.array(z.string()).optional(),
  body: z.string().min(1),
  sources: z.array(z.object({ title: z.string(), url: z.string() })).optional(),
  status: z.enum(["active", "superseded", "archived"]).optional(),
  supersededBySlug: z.string().nullish(),
});

/**
 * Knowledgebase. Read before re-researching; write findings back after.
 * Search is Postgres full-text over title+body with rank ordering.
 */
export const kbRouter = t.router({
  search: protectedProcedure
    .input(
      z.object({
        query: z.string().optional(),
        category: categoryEnum.optional(),
        tag: z.string().optional(),
        includeArchived: z.boolean().default(false),
        limit: z.number().min(1).max(100).default(25),
      }),
    )
    .query(async ({ input }) => {
      const conditions = [];
      if (!input.includeArchived) conditions.push(sql`${kbArticles.status} != 'archived'`);
      if (input.category) conditions.push(eq(kbArticles.category, input.category));
      if (input.tag) conditions.push(sql`${input.tag} = any(${kbArticles.tags})`);
      if (input.query) {
        conditions.push(
          sql`to_tsvector('english', ${kbArticles.title} || ' ' || ${kbArticles.body}) @@ websearch_to_tsquery('english', ${input.query})`,
        );
      }
      const rows = await db
        .select({
          slug: kbArticles.slug,
          title: kbArticles.title,
          category: kbArticles.category,
          tags: kbArticles.tags,
          status: kbArticles.status,
          updatedAt: kbArticles.updatedAt,
          updatedBy: kbArticles.updatedBy,
          snippet: input.query
            ? sql<string>`ts_headline('english', ${kbArticles.body}, websearch_to_tsquery('english', ${input.query}), 'MaxWords=30, MinWords=15')`
            : sql<string>`left(${kbArticles.body}, 180)`,
          rank: input.query
            ? sql<number>`ts_rank(to_tsvector('english', ${kbArticles.title} || ' ' || ${kbArticles.body}), websearch_to_tsquery('english', ${input.query}))`
            : sql<number>`0`,
        })
        .from(kbArticles)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(
          input.query
            ? sql`ts_rank(to_tsvector('english', ${kbArticles.title} || ' ' || ${kbArticles.body}), websearch_to_tsquery('english', ${input.query})) desc`
            : desc(kbArticles.updatedAt),
        )
        .limit(input.limit);
      return rows;
    }),

  get: protectedProcedure.input(z.object({ slug: z.string() })).query(async ({ input }) => {
    const [article] = await db.select().from(kbArticles).where(eq(kbArticles.slug, input.slug)).limit(1);
    if (!article) return null;
    const [{ revisionCount }] = await db
      .select({ revisionCount: sql<number>`count(*)` })
      .from(kbRevisions)
      .where(eq(kbRevisions.articleId, article.id));
    return { ...article, revisionCount: Number(revisionCount) };
  }),

  categories: protectedProcedure.query(async () => {
    return db
      .select({ category: kbArticles.category, count: sql<number>`count(*)` })
      .from(kbArticles)
      .where(sql`${kbArticles.status} != 'archived'`)
      .groupBy(kbArticles.category)
      .orderBy(kbArticles.category);
  }),

  /** Create or update. Updates snapshot the previous version to kb_revision. */
  upsert: operatorProcedure.input(upsertInput).mutation(async ({ input, ctx }) => {
    const [existing] = await db.select().from(kbArticles).where(eq(kbArticles.slug, input.slug)).limit(1);
    const editor = ctx.user.email ?? ctx.user.id;

    if (existing) {
      await db.insert(kbRevisions).values({
        articleId: existing.id,
        title: existing.title,
        category: existing.category,
        tags: existing.tags,
        body: existing.body,
        editedBy: editor,
      });
      await db
        .update(kbArticles)
        .set({
          title: input.title,
          category: input.category,
          tags: input.tags ?? existing.tags,
          body: input.body,
          sources: input.sources ?? existing.sources,
          status: input.status ?? existing.status,
          supersededBySlug: input.supersededBySlug === undefined ? existing.supersededBySlug : input.supersededBySlug,
          updatedBy: editor,
          updatedAt: new Date(),
        })
        .where(eq(kbArticles.id, existing.id));
      await audit(ctx, "kb.update", { resourceType: "kbArticle", resourceId: input.slug });
      return { slug: input.slug, created: false };
    }

    await db.insert(kbArticles).values({
      slug: input.slug,
      title: input.title,
      category: input.category,
      tags: input.tags ?? null,
      body: input.body,
      sources: input.sources ?? null,
      status: input.status ?? "active",
      supersededBySlug: input.supersededBySlug ?? null,
      createdBy: editor,
      updatedBy: editor,
    });
    await audit(ctx, "kb.create", { resourceType: "kbArticle", resourceId: input.slug });
    return { slug: input.slug, created: true };
  }),

  /** Archive (never delete) — the trail of retired knowledge stays queryable. */
  archive: operatorProcedure
    .input(z.object({ slug: z.string(), supersededBySlug: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      await db
        .update(kbArticles)
        .set({
          status: input.supersededBySlug ? "superseded" : "archived",
          supersededBySlug: input.supersededBySlug ?? null,
          updatedBy: ctx.user.email ?? ctx.user.id,
          updatedAt: new Date(),
        })
        .where(eq(kbArticles.slug, input.slug));
      await audit(ctx, "kb.archive", { resourceType: "kbArticle", resourceId: input.slug });
      return { success: true };
    }),

  revisions: protectedProcedure.input(z.object({ slug: z.string() })).query(async ({ input }) => {
    const [article] = await db
      .select({ id: kbArticles.id })
      .from(kbArticles)
      .where(eq(kbArticles.slug, input.slug))
      .limit(1);
    if (!article) return [];
    return db
      .select({
        id: kbRevisions.id,
        title: kbRevisions.title,
        editedBy: kbRevisions.editedBy,
        editedAt: kbRevisions.editedAt,
      })
      .from(kbRevisions)
      .where(eq(kbRevisions.articleId, article.id))
      .orderBy(desc(kbRevisions.editedAt));
  }),
});
