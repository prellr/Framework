import { db, auditLogs } from "@framework/db";

/**
 * Write an audit trail entry. Fire-and-forget from mutations:
 *
 *   await audit(ctx, "notes.update", { resourceType: "note", resourceId: String(id), oldValue, newValue });
 */
export async function audit(
  ctx: { user: { id: string } | null; req: Request },
  action: string,
  detail: {
    resourceType?: string;
    resourceId?: string;
    oldValue?: unknown;
    newValue?: unknown;
  } = {},
): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      // API-key/MCP requests use a synthetic `agent` principal that intentionally has no row in
      // the human user table. Preserve the action/resource audit record without violating the FK.
      userId: ctx.user?.id === "agent" ? null : ctx.user?.id ?? null,
      action,
      resourceType: detail.resourceType ?? null,
      resourceId: detail.resourceId ?? null,
      oldValue: detail.oldValue ?? null,
      newValue: detail.newValue ?? null,
      ipAddress: ctx.req.headers.get("x-forwarded-for") ?? null,
    });
  } catch (err) {
    // Never let audit failures break the mutation itself
    console.error("[audit] failed to write log:", err);
  }
}
