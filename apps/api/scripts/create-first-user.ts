/**
 * Bootstrap the first admin user. Run once after the first migration:
 *
 *   pnpm --filter @framework/api create-first-user
 *
 * Override the defaults with env vars:
 *   ADMIN_EMAIL / ADMIN_NAME / ADMIN_PASSWORD
 */
import { auth } from "../src/auth.ts";
import { db, users } from "@framework/db";
import { eq } from "drizzle-orm";

const email = process.env.ADMIN_EMAIL ?? "admin@example.com";
const name = process.env.ADMIN_NAME ?? "Admin";
const password = process.env.ADMIN_PASSWORD ?? "Admin123!";

async function createFirstUser() {
  try {
    console.log("Creating first admin user...");

    // Sign-up through Better Auth so the credential account row is created
    // with the correct hash format.
    const result = await auth.api.signUpEmail({
      body: { email, name, password },
    });

    if (!result.user?.id) {
      throw new Error("Sign-up did not return a user");
    }

    await db
      .update(users)
      .set({ role: "admin", emailVerified: true, updatedAt: new Date() })
      .where(eq(users.id, result.user.id));

    console.log("✅ Admin user created");
    console.log(`   Email:    ${email}`);
    console.log(`   Password: ${password}`);
    console.log("   Change this password after first login.");
    process.exit(0);
  } catch (err) {
    console.error("❌ Error:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

createFirstUser();
