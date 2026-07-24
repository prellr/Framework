/**
 * The viewer's timezone, resolved once from the browser.
 *
 * The API container runs in UTC, so any server-side calendar bucketing (per-day rollups) must be
 * told which zone to use — otherwise a US evening's trading splits across two "days" and the current
 * day reads empty. Send this with any request that groups by calendar day.
 *
 * Display formatting (toLocaleString etc.) already uses the browser zone implicitly; this exists so
 * the SERVER can agree with it.
 */
export const VIEWER_TZ: string = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
})();

/** Short label for a zone, e.g. "CDT" — for stamping time-bucketed views. */
export const tzLabel = (tz?: string | null): string => {
  try {
    const parts = new Intl.DateTimeFormat(undefined, {
      timeZone: tz || VIEWER_TZ,
      timeZoneName: "short",
    }).formatToParts(new Date());
    return parts.find((p) => p.type === "timeZoneName")?.value ?? (tz || VIEWER_TZ);
  } catch {
    return tz || VIEWER_TZ;
  }
};

/** The zone a signed-in user has chosen, falling back to the browser's. */
export const effectiveTz = (userTz?: string | null): string => userTz || VIEWER_TZ;

/** A reasonable picker list; the browser's own zone is always included. */
export const TZ_OPTIONS: string[] = [
  ...new Set([
    VIEWER_TZ,
    "UTC",
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "Europe/London",
    "Europe/Berlin",
    "Asia/Singapore",
    "Asia/Tokyo",
    "Australia/Sydney",
  ]),
];
