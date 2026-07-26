import type { Role } from "@framework/db";

export const SECTION_ACCESS_SETTING_KEY = "ALCHEMY_SECTION_ACCESS_V1";

export const SECTION_KEYS = [
  "overview",
  "strategies",
  "sweeps",
  "analytics",
  "tesseract",
  "polymarket",
  "sub35",
  "formulaLab",
  "crucible",
  "screens",
  "knowledge",
  "live",
  "settings",
] as const;

export type SectionKey = (typeof SECTION_KEYS)[number];
export type SectionAccess = Record<SectionKey, Role>;

export const ROLE_RANK: Record<Role, number> = {
  viewer: 0,
  operator: 1,
  manager: 2,
  admin: 3,
};

export const SECTION_DEFINITIONS: ReadonlyArray<{
  key: SectionKey;
  label: string;
  description: string;
  hardFloor: Role;
}> = [
  {
    key: "overview",
    label: "Overview",
    description: "System dashboard and high-level research status.",
    hardFloor: "viewer",
  },
  {
    key: "strategies",
    label: "Strategies",
    description: "Strategy catalog and strategy detail pages.",
    hardFloor: "viewer",
  },
  {
    key: "sweeps",
    label: "Sweeps",
    description: "Backtest sweep launcher, history, and run details.",
    hardFloor: "operator",
  },
  {
    key: "analytics",
    label: "Analytics",
    description: "Leaderboards, asset comparisons, charts, and results.",
    hardFloor: "viewer",
  },
  {
    key: "tesseract",
    label: "Tesseract",
    description: "Tesseract field research and diagnostics.",
    hardFloor: "viewer",
  },
  {
    key: "polymarket",
    label: "Polymarket",
    description: "Polymarket research dashboard, strategies, assets, and evidence.",
    hardFloor: "viewer",
  },
  {
    key: "sub35",
    label: "Sub35",
    description: "Selected-strategy under-35¢ portfolio research and trade history.",
    hardFloor: "manager",
  },
  {
    key: "formulaLab",
    label: "Formula Lab",
    description: "Formula research, experiments, results, and system views.",
    hardFloor: "viewer",
  },
  {
    key: "crucible",
    label: "Crucible",
    description: "Read-only Crucible discovery results and collections.",
    hardFloor: "viewer",
  },
  {
    key: "screens",
    label: "Screens & Alerts",
    description: "Saved screens, filters, and alerts.",
    hardFloor: "viewer",
  },
  {
    key: "knowledge",
    label: "Knowledge",
    description: "Research notes, findings, and the knowledge base.",
    hardFloor: "viewer",
  },
  {
    key: "live",
    label: "Live",
    description: "Live subscriptions, performance, positions, and trade views.",
    hardFloor: "viewer",
  },
  {
    key: "settings",
    label: "Settings",
    description: "Personal connections and wallets; admin configuration remains admin-only.",
    hardFloor: "viewer",
  },
];

const ROLES: readonly Role[] = ["viewer", "operator", "manager", "admin"];

export const DEFAULT_SECTION_ACCESS: SectionAccess = Object.fromEntries(
  SECTION_DEFINITIONS.map((section) => [section.key, section.hardFloor]),
) as SectionAccess;

export function normalizeSectionAccess(candidate: unknown): SectionAccess {
  const source =
    candidate && typeof candidate === "object" && !Array.isArray(candidate)
      ? (candidate as Record<string, unknown>)
      : {};
  const normalized = { ...DEFAULT_SECTION_ACCESS };

  for (const section of SECTION_DEFINITIONS) {
    const requested = source[section.key];
    if (
      typeof requested === "string" &&
      ROLES.includes(requested as Role) &&
      ROLE_RANK[requested as Role] >= ROLE_RANK[section.hardFloor]
    ) {
      normalized[section.key] = requested as Role;
    }
  }
  return normalized;
}

export function sectionAccessView(access: SectionAccess) {
  return {
    access,
    sections: SECTION_DEFINITIONS.map((section) => ({
      ...section,
      minRole: access[section.key],
    })),
  };
}
