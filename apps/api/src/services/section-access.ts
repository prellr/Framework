import { getSetting, setSetting } from "./config.ts";
import {
  DEFAULT_SECTION_ACCESS,
  normalizeSectionAccess,
  SECTION_ACCESS_SETTING_KEY,
  sectionAccessView,
  type SectionAccess,
} from "./section-access-contract.ts";

export * from "./section-access-contract.ts";

export async function getSectionAccess(): Promise<SectionAccess> {
  const raw = await getSetting(SECTION_ACCESS_SETTING_KEY);
  if (!raw) return { ...DEFAULT_SECTION_ACCESS };
  try {
    return normalizeSectionAccess(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SECTION_ACCESS };
  }
}

export async function saveSectionAccess(candidate: unknown): Promise<SectionAccess> {
  const normalized = normalizeSectionAccess(candidate);
  await setSetting(SECTION_ACCESS_SETTING_KEY, JSON.stringify(normalized));
  return normalized;
}
