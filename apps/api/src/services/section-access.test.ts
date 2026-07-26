import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SECTION_ACCESS,
  normalizeSectionAccess,
  SECTION_KEYS,
} from "./section-access-contract.ts";

test("section access defaults cover every registered application section", () => {
  assert.deepEqual(Object.keys(DEFAULT_SECTION_ACCESS).sort(), [...SECTION_KEYS].sort());
  assert.equal(DEFAULT_SECTION_ACCESS.sub35, "manager");
  assert.equal(DEFAULT_SECTION_ACCESS.sweeps, "operator");
});

test("section access accepts stricter roles while preserving hard floors", () => {
  const normalized = normalizeSectionAccess({
    overview: "manager",
    strategies: "admin",
    sweeps: "viewer",
    sub35: "viewer",
    settings: "operator",
    unknown: "admin",
  });

  assert.equal(normalized.overview, "manager");
  assert.equal(normalized.strategies, "admin");
  assert.equal(normalized.sweeps, "operator");
  assert.equal(normalized.sub35, "manager");
  assert.equal(normalized.settings, "operator");
  assert.equal("unknown" in normalized, false);
});

test("section access rejects malformed role values", () => {
  const normalized = normalizeSectionAccess({
    analytics: "owner",
    live: 3,
    formulaLab: null,
  });

  assert.equal(normalized.analytics, DEFAULT_SECTION_ACCESS.analytics);
  assert.equal(normalized.live, DEFAULT_SECTION_ACCESS.live);
  assert.equal(normalized.formulaLab, DEFAULT_SECTION_ACCESS.formulaLab);
});
