export function loginAuthMethod(
  authPath: string | null,
  impersonatedBy: string | null | undefined,
): string {
  if (impersonatedBy) return "impersonation";
  if (authPath?.includes("/sign-in/email")) return "email/password";
  if (authPath?.includes("/sign-in/social")) return "social";
  if (authPath?.includes("/sign-up/")) return "sign-up";
  if (authPath?.includes("/callback/")) return "oauth callback";
  return "session";
}
