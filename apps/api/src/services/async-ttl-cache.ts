/** Small in-process TTL cache for cumulative, read-only research status queries. */
export function createAsyncTtlCache<T>(
  ttlMs: number,
  loader: () => Promise<T>,
  now: () => number = Date.now,
): () => Promise<T> {
  let cached: { value: T; expiresAtMs: number } | null = null;
  let loading: Promise<T> | null = null;

  return async () => {
    const atMs = now();
    if (cached && atMs < cached.expiresAtMs) return cached.value;
    if (loading) return loading;

    loading = loader()
      .then((value) => {
        cached = { value, expiresAtMs: now() + ttlMs };
        return value;
      })
      .finally(() => {
        loading = null;
      });
    return loading;
  };
}
