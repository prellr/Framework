import { db, loginEvents, users } from "@framework/db";
import { eq } from "drizzle-orm";
import { loginAuthMethod } from "./login-history-contract.ts";

type LoginSessionInput = {
  id: string;
  userId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  impersonatedBy?: string | null;
};

/**
 * Record a successful Better Auth session creation without ever blocking the login itself.
 *
 * The unique session id makes the hook idempotent. Authentication remains available if the audit
 * insert fails, while the server log retains a visible operational error.
 */
export async function recordSuccessfulLogin(input: {
  session: LoginSessionInput;
  authPath: string | null;
}): Promise<void> {
  try {
    const [user] = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, input.session.userId))
      .limit(1);
    if (!user) {
      console.error(`[auth] login history skipped: unknown user ${input.session.userId}`);
      return;
    }
    await db
      .insert(loginEvents)
      .values({
        userId: user.id,
        sessionId: input.session.id,
        userName: user.name,
        userEmail: user.email,
        authMethod: loginAuthMethod(input.authPath, input.session.impersonatedBy),
        authPath: input.authPath,
        ipAddress: input.session.ipAddress ?? null,
        userAgent: input.session.userAgent ?? null,
      })
      .onConflictDoNothing({ target: loginEvents.sessionId });
  } catch (error) {
    console.error("[auth] failed to record successful login:", error);
  }
}
