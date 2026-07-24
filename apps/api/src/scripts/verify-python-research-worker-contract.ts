/**
 * Cross-language contract verifier.
 *
 * The Python package builds a causal Parquet fixture and evaluates a real formula shard. This
 * script then validates the resulting envelope with the exact Zod schema used by the Hono worker
 * gateway. No database, network venue, paper ledger, strategy registry, or execution path is used.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { researchShardResultSchema } from "../research-worker-wire-schema.ts";

const apiDirectory = fileURLToPath(new URL("../../", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const workerDirectory = fileURLToPath(
  new URL("../../../../workers/research-python/", import.meta.url),
);

const output = execFileSync(
  "uv",
  [
    "run",
    "--project",
    workerDirectory,
    "python",
    "-m",
    "alchemy_research_worker.contract_fixture",
  ],
  {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
    },
  },
).trim();
const result = researchShardResultSchema.parse(JSON.parse(output));
assert.equal(result.protocolVersion, "alchemy-research-v2");
assert.equal(result.status, "completed");
assert.equal(result.evaluatedCandidates, 1);
assert.ok(result.evaluatedRows > 0);
assert.equal(result.inlineResults?.length, 1);
assert.equal(result.inlineResults?.[0]?.metrics?.paperOnly, true);
assert.ok(
  Number(result.inlineResults?.[0]?.capitalSummary?.finalEquityUsd) > 10_000,
);

console.log(JSON.stringify({
  verifier: "alchemy-python-research-worker-contract-v1",
  gatewaySchemaAccepted: true,
  protocolVersion: result.protocolVersion,
  evaluatedCandidates: result.evaluatedCandidates,
  evaluatedRows: result.evaluatedRows,
  resultDigest: result.resultDigest,
  executionCapable: false,
  apiDirectory,
}, null, 2));
