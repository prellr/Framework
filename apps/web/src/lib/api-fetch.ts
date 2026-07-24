/**
 * tRPC expects JSON. During a rolling deploy nginx can briefly return an HTML
 * 502/503/504 page instead; letting the tRPC parser see that body produces the
 * opaque `Unexpected token '<'` error.
 *
 * Live mutations are never retried here. A dropped response can be ambiguous,
 * so the operator must check current live state before deciding what to do next.
 */
export const guardedApiFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("application/json")) return response;

  const gatewayStatus = [502, 503, 504].includes(response.status);
  const reason = gatewayStatus
    ? "The API restarted or its gateway became unavailable during this request."
    : "The API returned a non-JSON response.";
  throw new Error(
    `${reason} (HTTP ${response.status}). No automatic retry was attempted; check the current live status before retrying.`,
  );
};
