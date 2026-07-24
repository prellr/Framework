import type { Job } from "bullmq";
import { deribitSkewCaptureTick } from "../../services/deribit-skew.ts";

/** Public, read-only BTC/ETH option-skew tape. No signal, paper decision, or execution behavior. */
export async function deribitSkewCaptureProcessor(_job: Job) {
  const result = await deribitSkewCaptureTick();
  if (result.considered || result.errors) {
    console.log(
      `[deribit-skew] captured=${result.captured}/${result.considered} errors=${result.errors}`,
    );
  }
  return result;
}
