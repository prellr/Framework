import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function sourceFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else if (/\.(?:ts|tsx)$/.test(entry.name)) files.push(path);
  }
  return files;
}

test("Polymarket and Formula Lab API surfaces are query-only and cannot reach trade authority", () => {
  const polymarketRouter = read("../routers/polymarket.ts");
  const formulaRouter = read("../routers/formula-lab.ts");
  const researchSurface = `${polymarketRouter}\n${formulaRouter}`;

  assert.match(polymarketRouter, /export const polymarketRouter = t\.router/);
  assert.match(formulaRouter, /export const formulaLabRouter = t\.router/);
  assert.doesNotMatch(researchSurface, /\.(?:mutation|subscription)\s*\(/);
  assert.doesNotMatch(researchSurface, /\b(?:tradeProcedure|jesterTradeCall)\b/);
  assert.doesNotMatch(
    researchSurface,
    /from\s+["'][^"']*(?:services\/trading|routers\/trading|credentials|fills-store)[^"']*["']/,
  );
  for (const prohibited of [
    "placeOrder",
    "submitOrder",
    "createOrder",
    "signOrder",
    "privateKey",
    "subscribe_cached_best",
    "allocation_set",
    "close_all",
  ]) {
    assert.equal(
      researchSurface.includes(prohibited),
      false,
      `${prohibited} must not be reachable from a research router`,
    );
  }
});

test("root routing keeps human-gated Jester trading outside both research namespaces", () => {
  const rootRouter = read("../trpc/router.ts");
  assert.match(rootRouter, /polymarket:\s*polymarketRouter/);
  assert.match(rootRouter, /formulaLab:\s*formulaLabRouter/);
  assert.match(rootRouter, /trading:\s*tradingRouter/);
  assert.doesNotMatch(
    rootRouter,
    /polymarket:\s*t\.router\([\s\S]{0,500}tradingRouter/,
  );
  assert.doesNotMatch(
    rootRouter,
    /formulaLab:\s*t\.router\([\s\S]{0,500}tradingRouter/,
  );
});

test("Polymarket and Formula Lab pages expose no activation or trading mutation control", () => {
  const webRoot = new URL("../../../web/src/pages/", import.meta.url).pathname;
  const files = [
    ...sourceFiles(join(webRoot, "polymarket")),
    ...sourceFiles(join(webRoot, "formula-lab")),
  ];
  assert.ok(files.length > 10);
  const source = files.map((file) => readFileSync(file, "utf8")).join("\n");
  assert.doesNotMatch(source, /\btrpc\.trading\b/);
  assert.doesNotMatch(source, /from\s+["'][^"']*(?:ActivateDialog|pages\/trading)[^"']*["']/);
  assert.doesNotMatch(source, /(?:to|href)=["']\/trading(?:\/|["'])/);
  assert.doesNotMatch(
    source,
    /\.(?:activate|setRisk|setAllocation|resumeAll|toggleStrategy|killSwitch)\.useMutation\b/,
  );
});
