/**
 * A confirmed unsubscribe suppresses source polling until the next deep subscription audit.
 * Unknown audit state deliberately keeps polling so a transient Jester timeout cannot hide a
 * legitimate subscribed signal.
 */
export function resolveV1PollState(
  cached: boolean | null,
  audited: boolean | null,
): { subscribed: boolean | null; shouldPoll: boolean } {
  const subscribed = audited ?? cached;
  return {
    subscribed,
    shouldPoll: subscribed !== false,
  };
}
