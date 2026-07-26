import { createTRPCClient, httpLink } from "@trpc/client";
import type { AppRouter } from "@framework/api/router";
import superjson from "superjson";
import { guardedApiFetch } from "@/lib/api-fetch";

export type Role = "viewer" | "operator" | "manager" | "admin";
export type SectionKey =
  | "overview"
  | "strategies"
  | "sweeps"
  | "analytics"
  | "tesseract"
  | "polymarket"
  | "sub35"
  | "formulaLab"
  | "crucible"
  | "screens"
  | "knowledge"
  | "live"
  | "settings"
  | "admin";

export type SectionAccess = Record<SectionKey, Role>;

export const ROLE_RANK: Record<Role, number> = {
  viewer: 0,
  operator: 1,
  manager: 2,
  admin: 3,
};

// Fail closed to the server's hard floors if the visibility contract is temporarily unavailable.
export const DEFAULT_SECTION_ACCESS: SectionAccess = {
  overview: "viewer",
  strategies: "viewer",
  sweeps: "operator",
  analytics: "viewer",
  tesseract: "viewer",
  polymarket: "viewer",
  sub35: "manager",
  formulaLab: "viewer",
  crucible: "viewer",
  screens: "viewer",
  knowledge: "viewer",
  live: "viewer",
  settings: "viewer",
  admin: "admin",
};

export function canAccessSection(
  role: Role | null | undefined,
  section: SectionKey,
  access: Partial<SectionAccess> | null | undefined,
) {
  const actualRole = role ?? "viewer";
  const minimum = access?.[section] ?? DEFAULT_SECTION_ACCESS[section];
  return ROLE_RANK[actualRole] >= ROLE_RANK[minimum];
}

const accessClient = createTRPCClient<AppRouter>({
  links: [
    httpLink({
      url: "/api/trpc",
      transformer: superjson,
      fetch: guardedApiFetch,
    }),
  ],
});

export async function loadSectionAccess(): Promise<SectionAccess> {
  try {
    const result = await accessClient.admin.sectionAccess.query();
    return result.access as SectionAccess;
  } catch {
    return DEFAULT_SECTION_ACCESS;
  }
}
